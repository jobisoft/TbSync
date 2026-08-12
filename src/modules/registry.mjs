import { DISCOVERY, PROTOCOL_VERSION } from "../vendor/tbsync/protocol.mjs";
import * as eventLog from "./event-log.mjs";
import * as providers from "./providers.mjs";
import * as accounts from "./accounts.mjs";
import * as ui from "./messaging-ui.mjs";
import { settingUpAccounts, upgradeAccounts } from "./transient.mjs";

/**
 * Provider discovery and lifecycle.
 *
 * Responsibilities:
 *   - accept `tbsync-provider-announce` over runtime.onMessageExternal
 *   - validate protocol version
 *   - record ProviderMeta in session-scoped storage
 *   - ask the router to open a port to the newly-announced provider
 *   - broadcast `tbsync-host-ready` once the listener is up
 *   - react to management.onDisabled / onUninstalled
 *
 * The ProviderMeta store is session-scoped, so each browser session
 * starts with an empty registry and rebuilds it from announces. There
 * is therefore no startup-side reconciliation - missing providers are
 * simply absent from the store until they announce themselves.
 *
 * That makes an announce we were not yet listening for unrecoverable, which
 * is what the host-ready broadcast is for: it hands a provider that started
 * before us a reason to announce again. Between the two, whichever side
 * starts later reaches the other, so neither has to guess at the timing.
 */

const listeners = new Set();

function emit(event) {
  for (const fn of listeners) fn(event);
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Attach the registry to the global extension runtime. Call once from
 * background.mjs during startup.
 *
 * @param {object} deps
 * @param {(providerId: string) => Promise<void>} deps.openPortToProvider
 * @param {(providerId: string) => void} deps.closePortToProvider
 */
export function init({ openPortToProvider, closePortToProvider }) {
  // Not async: returning a promise from a message listener claims the
  // message and supplies its response. An async listener would therefore
  // answer every external message, including ones from senders it just
  // declined and any a future listener might want. The guards below bail
  // with a bare return, and only a message we recognise gets a promise.
  browser.runtime.onMessageExternal.addListener((msg, sender) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type !== DISCOVERY.ANNOUNCE && msg.type !== DISCOVERY.UNANNOUNCE)
      return;
    if (!sender?.id) return;
    return handleDiscoveryMessage(msg, sender.id);
  });

  // Attaching the listener above and broadcasting below must stay in this
  // order, and stay adjacent so the dependency is impossible to miss: a
  // provider that hears HOST_READY announces itself straight away, so saying
  // we are ready before we can hear the reply reopens the very race this
  // closes. Deliberately not awaited - discovery is best-effort, and boot
  // must not wait on a loop over every installed add-on.
  broadcastHostReady().catch((err) =>
    console.warn("[tbsync] host-ready broadcast failed:", err),
  );

  /** Announce / unannounce from an identified sender. Closes over the two
   *  port callbacks `init` was given. */
  async function handleDiscoveryMessage(msg, extensionId) {
    if (msg.type === DISCOVERY.UNANNOUNCE) {
      const providerId = await providerIdFromExtensionId(extensionId);
      if (providerId) await handleUnannounce(providerId, closePortToProvider);
      return { ok: true };
    }

    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      // Without this the refusal is invisible: the provider never registers,
      // so the manager renders it as "Not installed" - an install button for
      // an add-on that is plainly installed. Identify it by extensionId
      // rather than shortName, which is not validated until below.
      eventLog
        .append({
          level: "error",
          message: `Provider ${extensionId} uses an incompatible protocol version`,
          details:
            `Provider speaks ${msg.protocolVersion ?? "unknown"}, this ` +
            `TbSync speaks ${PROTOCOL_VERSION}. Update both add-ons to the ` +
            `same release.`,
        })
        .catch(() => {
          /* event-log write failed; nothing left to do */
        });
      return {
        ok: false,
        error: "protocol-version-mismatch",
        tbsyncProtocolVersion: PROTOCOL_VERSION,
        yours: msg.protocolVersion ?? null,
      };
    }

    if (!msg.shortName) {
      return {
        ok: false,
        error: "missing-shortName",
        senderId: extensionId,
      };
    }
    const providerId = msg.shortName;

    const meta = await providers.upsert(providerId, {
      providerName: msg.providerName ?? providerId,
      extensionId,
      icons: msg.icons ?? {},
      capabilities: msg.capabilities ?? {},
      maintainerEmail: msg.maintainerEmail ?? null,
      contributorsUrl: msg.contributorsUrl ?? null,
      state: "active",
    });

    await openPortToProvider(providerId, extensionId).catch((err) => {
      console.warn(
        `[tbsync] could not open port to ${providerId} (${extensionId}):`,
        err,
      );
    });

    emit({ type: "provider-active", providerId, meta });
    ui.broadcast({ type: "providers-changed" });

    return {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      tbsyncVersion: browser.runtime.getManifest().version,
      accepted: true,
    };
  }

  browser.management.onDisabled.addListener(async (addon) => {
    const providerId = await providerIdFromExtensionId(addon.id);
    if (providerId) await handleUnannounce(providerId, closePortToProvider);
  });
  browser.management.onUninstalled.addListener(async (addon) => {
    const providerId = await providerIdFromExtensionId(addon.id);
    if (providerId) await handleUnannounce(providerId, closePortToProvider);
  });
}

/**
 * Tell every enabled extension that the host is listening.
 *
 * Providers ignore anything that is not this message and non-providers ignore
 * it entirely, so there is nothing to target more narrowly with - and nothing
 * worth targeting: the only provider that needs this is one that started
 * before us and has already had its announce refused, which is precisely the
 * provider we have no record of. Remembering past providers would miss the
 * one installed while TbSync was disabled.
 *
 * Every failure mode here is ordinary. Almost every recipient has no listener
 * for it, so per-target rejection is the common case, not an error.
 */
async function broadcastHostReady() {
  let all;
  try {
    all = await browser.management.getAll();
  } catch (err) {
    // Worth a warning: without this list, a provider that started before us
    // never learns we exist and stays unregistered for the whole session.
    console.warn("[tbsync] management.getAll() failed, cannot broadcast:", err);
    return;
  }

  const targets = all.filter(
    (a) => a.type === "extension" && a.enabled && a.id !== browser.runtime.id,
  );
  await Promise.all(
    targets.map(async (a) => {
      try {
        await browser.runtime.sendMessage(a.id, { type: DISCOVERY.HOST_READY });
      } catch {
        // No receiving end, or the add-on declined to answer. Expected.
      }
    }),
  );
}

async function handleUnannounce(providerId, closePortToProvider) {
  closePortToProvider(providerId);
  await providers.remove(providerId);
  // Release any lock the provider was holding - without this, an extension
  // that crashes mid-upgrade would leave its accounts stuck in the
  // "upgrading" state, and one that crashes while preparing a new account
  // would leave that account stuck being set up.
  for (const acc of await accounts.byProvider(providerId)) {
    upgradeAccounts.delete(acc.accountId);
    settingUpAccounts.delete(acc.accountId);
  }
  // Accounts are NOT otherwise mutated here: account.enabled reflects user
  // intent and account.status reflects last-known sync outcome, both of
  // which survive a provider outage. The UI derives read-only/unavailable
  // presentation from ProviderMeta.state at render time.
  emit({ type: "provider-inactive", providerId });
  ui.broadcast({ type: "providers-changed" });
  ui.broadcast({ type: "accounts-changed" });
}

/** Reverse-lookup a providerId (shortName) by the extension id we
 *  stored at announce time. Returns null if the provider isn't tracked
 *  yet (e.g. an extension fires onDisabled before its first announce). */
async function providerIdFromExtensionId(extensionId) {
  for (const meta of await providers.list()) {
    if (meta.extensionId === extensionId) return meta.providerId;
  }
  return null;
}
