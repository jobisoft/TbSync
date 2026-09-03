import {
  DEFAULT_RPC_TIMEOUT_MS,
  ERR,
  HOST_CMD,
  NO_TIMEOUT_CMDS,
  PORT_NAME,
  PROVIDER_NOTIFY,
  withCode,
} from "../vendor/tbsync/protocol.mjs";
import * as providers from "./providers.mjs";
import * as ui from "./messaging-ui.mjs";
import * as eventLog from "./event-log.mjs";
import * as consoleTail from "./console-tail.mjs";

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
const pending = new Map(); // requestId -> { accountId, cmd, resolve, fail, timer }
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
    // Where Thunderbird's console stood as this call went out. Read back
    // only if the call fails, and then it says what the console produced
    // while this one command was in flight - which for a provider talking
    // to an Experiment is the only place the real reason is written down.
    // See `console-tail.mjs`. A value, not shared state: concurrent calls
    // each hold their own, so neither consumes the other's output.
    const consoleMark = consoleTail.mark();
    /** Reject, carrying that slice. Every failure of this call goes through
     *  here - the timeout and the dead port below, the provider's own error
     *  reply, and a sweep - so none of them has to remember to collect it.
     *  Settling is one API round trip later than it used to be; everything
     *  that awaits a command already awaits this. */
    const fail = async (err) => {
      err.details = consoleTail.withConsole(
        err.details,
        await consoleTail.since(await consoleMark),
      );
      reject(err);
    };
    // `accountId` and `cmd` are recorded so one account's in-flight *sync*
    // commands can be settled without touching anything else - what
    // Disconnect needs while another account syncs on the same provider,
    // and without sweeping commands that must survive it (its own
    // CANCEL_SYNC, an open popup, a concurrent ACCOUNT_DISABLED).
    const entry = {
      providerId,
      accountId: args?.accountId ?? null,
      cmd,
      resolve,
      fail,
      timer: null,
    };
    if (!NO_TIMEOUT_CMDS.has(cmd)) {
      entry.timer = setTimeout(() => {
        pending.delete(requestId);
        fail(withCode(new Error(`Timeout waiting for ${cmd}`), ERR.TIMEOUT));
      }, DEFAULT_RPC_TIMEOUT_MS);
    }
    pending.set(requestId, entry);
    try {
      port.postMessage({ requestId, cmd, args });
    } catch (err) {
      pending.delete(requestId);
      if (entry.timer) clearTimeout(entry.timer);
      fail(withCode(err, ERR.PORT_CLOSED));
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
      entry.fail(
        withCode(
          new Error(msg.error ?? "provider error"),
          msg.errorCode ?? ERR.PROVIDER_FAULT,
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
      // Persist through the capture gate. The manager UI listens to
      // browser.storage.onChanged for the event-log key and picks up new
      // entries by their per-entry seq, so no broadcast is needed here.
      // Validation lives inside event-log.append - a bogus `level` from a
      // misbehaving provider is rejected here (logged, dropped).
      eventLog.append({ ...payload, providerId }).catch((err) => {
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

function rejectPending(providerId, code, message, { accountId = null, cmds = null } = {}) {
  for (const [rid, entry] of pending) {
    if (entry.providerId !== providerId) continue;
    if (accountId !== null && entry.accountId !== accountId) continue;
    if (cmds !== null && !cmds.has(entry.cmd)) continue;
    pending.delete(rid);
    if (entry.timer) clearTimeout(entry.timer);
    entry.fail(withCode(new Error(message), code));
  }
}

/** The commands an abort settles: the sync flow, and nothing else.
 *
 *  The filter is what keeps an abort from eating its own tail. The abort
 *  sends CANCEL_SYNC and then sweeps - an unfiltered sweep by accountId
 *  rejected that very CANCEL_SYNC, logging "provider did not acknowledge
 *  the cancel" on every disconnect. It also protected nothing else the
 *  account may have in flight: an open config or reauth popup (which must
 *  survive - its window is still on screen, and force-rejecting it strands
 *  the window with the host believing it closed), and a concurrent
 *  ACCOUNT_DISABLED from a second click, which is doing the teardown the
 *  abort exists to enable. */
const ABORTABLE_CMDS = new Set([
  HOST_CMD.SYNC_ACCOUNT,
  HOST_CMD.SYNC_FOLDER,
  HOST_CMD.GET_SORTED_FOLDERS,
]);

/** Settle this account's in-flight sync commands.
 *
 *  The point of no return for an abort: `SYNC_ACCOUNT` and `SYNC_FOLDER` are
 *  in `NO_TIMEOUT_CMDS`, so a provider that never answers would otherwise
 *  leave the awaiting sync suspended for the life of the host. Once these
 *  reject, `syncAccount`'s `finally` runs and the account is usable again -
 *  whatever the provider is or is not doing. GET_SORTED_FOLDERS is included
 *  because the sync loop parks on it too; it has a timeout, so rejecting it
 *  only makes the unwind prompt rather than possible.
 *
 *  A late reply needs no handling: `handleIncoming` returns when the entry
 *  is gone. */
export function abortAccount(providerId, accountId) {
  rejectPending(
    providerId,
    ERR.CANCELLED,
    "Sync cancelled - the account was disconnected",
    { accountId, cmds: ABORTABLE_CMDS },
  );
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
