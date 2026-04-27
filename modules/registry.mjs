import { DISCOVERY, PROTOCOL_VERSION } from "../tbsync/protocol.mjs";
import * as providers from "./providers.mjs";
import * as accounts from "./accounts.mjs";
import * as ui from "./messaging-ui.mjs";
import { upgradeAccounts } from "./transient.mjs";

/**
 * Provider discovery and lifecycle.
 *
 * Responsibilities:
 *   - accept `tbsync-provider-announce` over runtime.onMessageExternal
 *   - validate protocol version
 *   - persist ProviderMeta
 *   - ask the router to open a port to the newly-announced provider
 *   - react to management.onDisabled / onUninstalled
 *   - re-probe known providers on startup
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
  browser.runtime.onMessageExternal.addListener(async (msg, sender) => {
    if (!msg || typeof msg !== "object") return undefined;
    if (msg.type !== DISCOVERY.ANNOUNCE && msg.type !== DISCOVERY.UNANNOUNCE) return undefined;
    if (!sender?.id) return undefined;

    const extensionId = sender.id;

    if (msg.type === DISCOVERY.UNANNOUNCE) {
      const providerId = await providerIdFromExtensionId(extensionId);
      if (providerId) await handleUnannounce(providerId, closePortToProvider);
      return { ok: true };
    }

    if (msg.protocolVersion !== PROTOCOL_VERSION) {
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

    await openPortToProvider(providerId, extensionId).catch(err => {
      console.warn(`[tbsync] could not open port to ${providerId} (${extensionId}):`, err);
    });

    emit({ type: "provider-active", providerId, meta });
    ui.broadcast({ type: "providers-changed" });

    return {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      tbsyncVersion: browser.runtime.getManifest().version,
      accepted: true,
    };
  });

  browser.management.onDisabled.addListener(async addon => {
    const providerId = await providerIdFromExtensionId(addon.id);
    if (providerId) await handleUnannounce(providerId, closePortToProvider);
  });
  browser.management.onUninstalled.addListener(async addon => {
    const providerId = await providerIdFromExtensionId(addon.id);
    if (providerId) await handleUnannounce(providerId, closePortToProvider);
  });

  return { reprobe: () => reprobeKnownProviders({ openPortToProvider }) };
}

async function handleUnannounce(providerId, closePortToProvider) {
  closePortToProvider(providerId);
  await providers.setState(providerId, "uninstalled");
  // Release any upgrade lock the provider was holding - without this, an
  // extension that crashes mid-upgrade would leave its accounts stuck in
  // the "upgrading" state across restarts of the host.
  for (const acc of await accounts.byProvider(providerId)) {
    upgradeAccounts.delete(acc.accountId);
  }
  // Accounts are NOT otherwise mutated here: account.enabled reflects user
  // intent and account.status reflects last-known sync outcome, both of
  // which survive a provider outage. The UI derives read-only/unavailable
  // presentation from ProviderMeta.state at render time.
  emit({ type: "provider-inactive", providerId });
  ui.broadcast({ type: "providers-changed" });
  ui.broadcast({ type: "accounts-changed" });
}

/**
 * On startup, nudge previously-seen providers to re-announce. We don't rely
 * solely on this because a provider's background may announce first.
 */
async function reprobeKnownProviders({ openPortToProvider }) {
  const known = await providers.list();
  await Promise.all(known.map(async meta => {
    if (!meta.extensionId) return;
    try {
      const reply = await browser.runtime.sendMessage(meta.extensionId, {
        type: DISCOVERY.PROBE,
        protocolVersion: PROTOCOL_VERSION,
      });
      if (reply?.ok) {
        await providers.upsert(meta.providerId, {
          providerName: reply.providerName ?? meta.providerName,
          icons: reply.icons ?? meta.icons,
          capabilities: reply.capabilities ?? meta.capabilities,
          state: "active",
        });
        await openPortToProvider(meta.providerId, meta.extensionId).catch(() => { });
      } else {
        await providers.remove(meta.providerId);
      }
    } catch {
      await providers.remove(meta.providerId);
    }
  }));
  ui.broadcast({ type: "providers-changed" });
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
