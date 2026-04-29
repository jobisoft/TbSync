import {
  DEFAULT_RPC_TIMEOUT_MS,
  ERR,
  NO_TIMEOUT_CMDS,
  PORT_NAME,
  PROVIDER_NOTIFY,
  withCode,
} from "../tbsync/protocol.mjs";
import * as providers from "./providers.mjs";
import * as ui from "./messaging-ui.mjs";
import * as eventLog from "./event-log.mjs";

// Opaque RPC-correlation token for host→provider commands. Prefix is
// cosmetic (log legibility); providers generate their own request ids on
// the other side of the port with their own shortName prefix.
const genRequestId = () => `tbsync-request-${crypto.randomUUID()}`;

/**
 * Per-provider runtime.connect port owner.
 *
 * Owns exactly one outbound port per providerId. Incoming RPCs (cmds from the
 * provider) are dispatched to handlers registered via `setProviderRpcHandler`.
 * Incoming notifications are thrown at the coalescing broadcaster.
 *
 * Reconnect policy: if the port disconnects without an explicit unannounce we
 * schedule a probe on exponential backoff; the registry flips state on the
 * next announce or after probe failures accumulate.
 */

const ports = new Map(); // providerId(shortName) -> Port
const extensionIds = new Map(); // providerId(shortName) -> extensionId (for runtime.connect on (re)connect)
const pending = new Map(); // requestId -> { resolve, reject, timer }
const backoff = new Map(); // providerId -> { attempts, timerId }
const rpcHandlers = new Map(); // cmd -> async (providerId, args) => result

/** Coalescing state for noisy notifications (per account+folder). */
const coalesceMap = new Map(); // key -> { timer, latest }
const COALESCE_MS = 100;

export function setProviderRpcHandler(cmd, fn) {
  rpcHandlers.set(cmd, fn);
}

export function isProviderConnected(providerId) {
  return ports.has(providerId);
}

export async function openPortToProvider(providerId, extensionId) {
  if (ports.has(providerId)) return;
  if (!extensionId)
    throw new Error(`openPortToProvider(${providerId}) requires extensionId`);
  extensionIds.set(providerId, extensionId);

  let port;
  try {
    port = browser.runtime.connect(extensionId, { name: PORT_NAME });
  } catch (err) {
    throw new Error(`connect(${extensionId}) failed: ${err.message}`);
  }

  ports.set(providerId, port);
  backoff.delete(providerId);

  port.onMessage.addListener((msg) => handleIncoming(providerId, msg));
  port.onDisconnect.addListener(() => handleDisconnect(providerId, port));
}

export function closePortToProvider(providerId) {
  const port = ports.get(providerId);
  if (port) {
    ports.delete(providerId);
    try {
      port.disconnect();
    } catch (err) {
      console.debug(
        `[tbsync] port.disconnect(${providerId}) failed:`,
        err?.message ?? err,
      );
    }
  }
  rejectPending(providerId, ERR.PORT_CLOSED, "Provider disconnected");
  const bo = backoff.get(providerId);
  if (bo?.timerId) clearTimeout(bo.timerId);
  backoff.delete(providerId);
  extensionIds.delete(providerId);
}

/**
 * Send an RPC to the provider and await a response.
 *
 * @param {string} providerId
 * @param {string} cmd
 * @param {object} [args]
 * @returns {Promise<any>} resolves with `result`; rejects with Error(code=errorCode).
 */
export function sendCmd(providerId, cmd, args = {}) {
  const port = ports.get(providerId);
  if (!port) {
    return Promise.reject(
      withCode(new Error("Provider not connected"), ERR.PORT_CLOSED),
    );
  }

  const requestId = genRequestId();
  return new Promise((resolve, reject) => {
    const entry = { providerId, resolve, reject, timer: null };
    if (!NO_TIMEOUT_CMDS.has(cmd)) {
      entry.timer = setTimeout(() => {
        pending.delete(requestId);
        reject(withCode(new Error(`Timeout waiting for ${cmd}`), ERR.TIMEOUT));
      }, DEFAULT_RPC_TIMEOUT_MS);
    }
    pending.set(requestId, entry);
    try {
      port.postMessage({ requestId, cmd, args });
    } catch (err) {
      pending.delete(requestId);
      if (entry.timer) clearTimeout(entry.timer);
      reject(withCode(err, ERR.PORT_CLOSED));
    }
  });
}

// ── Incoming message dispatch ──────────────────────────────────────────────

function handleIncoming(providerId, msg) {
  if (!msg || typeof msg !== "object") return;

  // RPC response to a host-initiated cmd.
  if (msg.requestId && (msg.ok === true || msg.ok === false)) {
    const entry = pending.get(msg.requestId);
    if (!entry) return;
    pending.delete(msg.requestId);
    if (entry.timer) clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.result);
    else
      entry.reject(
        withCode(
          new Error(msg.error ?? "provider error"),
          msg.errorCode ?? ERR.UNKNOWN_COMMAND,
          msg.errorDetails ?? null,
        ),
      );
    return;
  }

  // Notification from the provider.
  if (msg.type && !msg.cmd && !msg.requestId) {
    handleNotification(providerId, msg.type, msg.payload ?? {});
    return;
  }

  // RPC request from the provider (Provider → TbSync).
  if (msg.requestId && msg.cmd) {
    handleProviderRpc(providerId, msg);
    return;
  }
}

async function handleProviderRpc(providerId, msg) {
  const port = ports.get(providerId);
  if (!port) return;
  const fn = rpcHandlers.get(msg.cmd);
  try {
    if (!fn)
      throw withCode(
        new Error(`Unknown command: ${msg.cmd}`),
        ERR.UNKNOWN_COMMAND,
      );
    const result = await fn(providerId, msg.args ?? {});
    port.postMessage({
      requestId: msg.requestId,
      ok: true,
      result: result ?? null,
    });
  } catch (err) {
    port.postMessage({
      requestId: msg.requestId,
      ok: false,
      error: err.message ?? "unknown error",
      errorCode: err.code ?? ERR.UNKNOWN_COMMAND,
      errorDetails: err.details ?? null,
    });
  }
}

function handleNotification(providerId, type, payload) {
  switch (type) {
    case PROVIDER_NOTIFY.REPORT_SYNC_STATE:
    case PROVIDER_NOTIFY.REPORT_PROGRESS: {
      const key = `${type}:${providerId}:${payload.accountId ?? ""}:${payload.folderId ?? ""}`;
      coalesce(key, payload, ({ accountId, folderId, ...rest }) => {
        ui.broadcast({ type, providerId, accountId, folderId, payload: rest });
      });
      break;
    }
    case PROVIDER_NOTIFY.REPORT_EVENT_LOG: {
      // Persist through the capture gate; only broadcast what made it in.
      // Validation lives inside event-log.append - a bogus `level` from a
      // misbehaving provider is rejected here (logged, dropped) instead of
      // polluting the UI.
      eventLog
        .append({ ...payload, providerId })
        .then((entry) => {
          if (entry) ui.broadcast({ type, providerId, payload: entry });
        })
        .catch((err) => {
          console.warn(
            `[tbsync] REPORT_EVENT_LOG from ${providerId} rejected:`,
            err.message,
          );
        });
      break;
    }
    default:
      ui.broadcast({ type, providerId, payload });
  }
}

function coalesce(key, value, flush) {
  const entry = coalesceMap.get(key);
  if (entry) {
    entry.latest = value;
    return;
  }
  const wrapper = { latest: value, timer: null };
  coalesceMap.set(key, wrapper);
  wrapper.timer = setTimeout(() => {
    coalesceMap.delete(key);
    flush(wrapper.latest);
  }, COALESCE_MS);
}

// ── Disconnect handling ───────────────────────────────────────────────────

function handleDisconnect(providerId, port) {
  const current = ports.get(providerId);
  if (current !== port) return;
  ports.delete(providerId);
  rejectPending(providerId, ERR.PORT_CLOSED, "Provider disconnected");
  scheduleBackoffProbe(providerId);
  providers.setState(providerId, "stale").catch((err) => {
    eventLog
      .append({
        level: "warning",
        message: `Could not mark provider ${providerId} stale after disconnect`,
        details: err?.message ?? null,
      })
      .catch((err) =>
        console.debug("[tbsync] event-log append failed:", err),
      );
  });
  ui.broadcast({ type: "providers-changed" });
}

function rejectPending(providerId, code, message) {
  for (const [rid, entry] of pending) {
    if (entry.providerId !== providerId) continue;
    pending.delete(rid);
    if (entry.timer) clearTimeout(entry.timer);
    entry.reject(withCode(new Error(message), code));
  }
}

function scheduleBackoffProbe(providerId) {
  const prior = backoff.get(providerId) ?? { attempts: 0, timerId: null };
  prior.attempts += 1;
  const delay = Math.min(60_000, 2_000 * 2 ** (prior.attempts - 1));
  prior.timerId = setTimeout(async () => {
    try {
      const extId = extensionIds.get(providerId);
      if (!extId) return;
      await openPortToProvider(providerId, extId);
      await providers.setState(providerId, "active").catch((err) => {
        eventLog
          .append({
            level: "warning",
            message: `Could not mark provider ${providerId} active after reconnect`,
            details: err?.message ?? null,
          })
          .catch(() => {
            /* event-log write failed; nothing left to do */
          });
      });
      ui.broadcast({ type: "providers-changed" });
    } catch (err) {
      console.debug(
        `[tbsync] backoff reconnect to ${providerId} failed; rescheduling:`,
        err,
      );
      scheduleBackoffProbe(providerId);
    }
  }, delay);
  backoff.set(providerId, prior);
}
