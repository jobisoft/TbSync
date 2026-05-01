import { ERR, HOST_CMD, PROVIDER_CMD, withCode } from "./tbsync/protocol.mjs";
import { STATUS_TYPES } from "./tbsync/status.mjs";
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  KEYS,
} from "./modules/storage-keys.mjs";
import * as accounts from "./modules/accounts.mjs";
import * as folders from "./modules/folders.mjs";
import * as providers from "./modules/providers.mjs";
import { KNOWN_PROVIDERS } from "./modules/known-providers.mjs";
import * as eventLog from "./modules/event-log.mjs";
import * as registry from "./modules/registry.mjs";
import * as router from "./modules/router.mjs";
import * as ui from "./modules/messaging-ui.mjs";
import * as actionBadge from "./modules/action-badge.mjs";
import * as changelogWatcher from "./modules/changelog-watcher.mjs";
import {
  busyAccounts,
  busyFolders,
  upgradeAccounts,
  snapshot as transientSnapshot,
} from "./modules/transient.mjs";
import {
  syncAccount,
  recomputeAccountError,
} from "./modules/sync-coordinator.mjs";
import { runIfNeeded as runLegacyMigration } from "./modules/legacy-migration-runner.mjs";
import { serialize } from "./modules/storage-queue.mjs";

// Since we are no longer an Experiment, we could be installed in Firefox, exit
// early in that case.
const browserInfo = await browser.runtime.getBrowserInfo();
if (browserInfo.name !== "Thunderbird") {
  browser.browserAction.onClicked.addListener(() => {
    browser.runtime.openOptionsPage();
  });
  throw new Error(
    `TbSync is only supported on Thunderbird and cannot be used with other apps or browsers, for example Firefox.`,
  );
}

// Where "TbSync Manager" bug reports are sent. Provider-authored reports go
// to the provider's own `maintainerEmail` (carried on ProviderMeta from the
// announce handshake).
const CORE_MAINTAINER_EMAIL = "john.bieling@gmx.de";

/** Validate the per-account icon override shape. Accepts a size-keyed
 *  map of string URLs (`{ "16": "moz-extension://…", … }`) or null/missing
 *  meaning "no override". Anything else collapses to null so a malformed
 *  payload from a provider can't poison the persisted account record. */
function validIconOrNull(icon) {
  if (!icon || typeof icon !== "object") return null;
  const out = {};
  for (const [size, url] of Object.entries(icon)) {
    if (typeof url === "string" && url) out[size] = url;
  }
  return Object.keys(out).length ? out : null;
}

// ── Startup ────────────────────────────────────────────────────────────────

async function ensureSchema() {
  const rv = await browser.storage.local.get({
    [KEYS.SCHEMA_VERSION]: 0,
    [KEYS.SETTINGS]: null,
  });
  if (rv[KEYS.SCHEMA_VERSION] !== CURRENT_SCHEMA_VERSION) {
    await serialize(() =>
      browser.storage.local.set({
        [KEYS.SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
      }),
    );
  }
  if (!rv[KEYS.SETTINGS]) {
    await serialize(() =>
      browser.storage.local.set({ [KEYS.SETTINGS]: DEFAULT_SETTINGS }),
    );
  }

  await runLegacyMigration();
}

const MANAGER_TAB_KEY = "managerTabId";

async function getManagerTabId() {
  const rv = await browser.storage.session.get({ [MANAGER_TAB_KEY]: null });
  return rv[MANAGER_TAB_KEY];
}

async function setManagerTabId(id) {
  await browser.storage.session.set({ [MANAGER_TAB_KEY]: id });
}

async function clearManagerTabId() {
  await browser.storage.session.remove(MANAGER_TAB_KEY);
}

browser.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === (await getManagerTabId())) await clearManagerTabId();
});

async function openManagerTab() {
  const existing = await getManagerTabId();
  if (existing != null) {
    try {
      await focusManagerTab();
      return;
    } catch (err) {
      console.debug("[tbsync] focusManagerTab failed; clearing stale id:", err);
      await clearManagerTabId();
    }
  }
  const tab = await browser.tabs.create({ url: "manager/manager.html" });
  await setManagerTabId(tab.id);
}

async function focusManagerTab() {
  const id = await getManagerTabId();
  if (id == null) return;
  try {
    const tab = await browser.tabs.update(id, { active: true });
    if (tab?.windowId != null) {
      await browser.windows
        .update(tab.windowId, { focused: true })
        .catch((err) =>
          console.debug("[tbsync] windows.update(focus) failed:", err),
        );
    }
  } catch (err) {
    // Tab is gone; let onRemoved clear the id on its own.
    console.debug("[tbsync] tabs.update(active) failed; tab is gone:", err);
  }
}

async function runPopupFlow(fn) {
  try {
    return await fn();
  } finally {
    await focusManagerTab();
  }
}

/** Wrap an account-scoped UI RPC so the manager sees the account as
 *  "busy" for the lifetime of the callback, and re-renders at start + end. */
async function withBusyAccount(accountId, fn) {
  busyAccounts.add(accountId);
  ui.broadcast({ type: "accounts-changed", accountId });
  try {
    return await fn();
  } finally {
    busyAccounts.delete(accountId);
    ui.broadcast({ type: "accounts-changed", accountId });
  }
}

// ── Provider → TbSync RPC handlers ─────────────────────────────────────────

router.setProviderRpcHandler(
  PROVIDER_CMD.REGISTER_ACCOUNT,
  async (providerId, args) => {
    const { accountName, custom, icon } = args ?? {};
    if (!accountName) {
      throw withCode(
        new Error("registerAccount requires accountName"),
        ERR.UNKNOWN_ACCOUNT,
      );
    }
    const record = await accounts.create({
      provider: providerId,
      accountName,
      icon: validIconOrNull(icon),
      custom: custom && typeof custom === "object" ? custom : {},
    });
    if (Array.isArray(args.initialFolders) && args.initialFolders.length) {
      await folders.replaceAccountFolders(
        record.accountId,
        args.initialFolders,
      );
    }
    ui.broadcast({ type: "accounts-changed", accountId: record.accountId });
    return { accountId: record.accountId };
  },
);

router.setProviderRpcHandler(
  PROVIDER_CMD.UPDATE_ACCOUNT,
  async (providerId, args) => {
    const { accountId, patch } = args ?? {};
    const acc = await accounts.get(accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    // Provider-writable top-level fields: display-name corrections, the
    // autosync backoff timestamp, and the per-account icon override.
    // `error` and `lastSyncTime` are host-authored (sync-coordinator
    // stamps them).
    const allowed = ["accountName", "noAutosyncUntil", "icon"];
    const clean = {};
    for (const key of allowed) {
      if (!(key in (patch ?? {}))) continue;
      if (key === "icon") {
        // Patch null clears the override; otherwise it must be a
        // size-keyed map.
        clean.icon = patch.icon === null ? null : validIconOrNull(patch.icon);
      } else {
        clean[key] = patch[key];
      }
    }
    // `custom` is the opaque provider-owned blob - shallow-merged so a patch
    // like `{custom: {readOnlyMode: true}}` leaves sibling keys untouched.
    if (
      patch &&
      "custom" in patch &&
      patch.custom &&
      typeof patch.custom === "object"
    ) {
      clean.custom = { ...(acc.custom ?? {}), ...patch.custom };
    }
    await accounts.update(accountId, clean);
    ui.broadcast({ type: "accounts-changed", accountId });
    return null;
  },
);

router.setProviderRpcHandler(
  PROVIDER_CMD.UPDATE_FOLDER,
  async (providerId, args) => {
    const { accountId, folderId, patch } = args ?? {};
    const acc = await accounts.get(accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    const existing = await folders.get(accountId, folderId);
    if (!existing) {
      throw withCode(new Error("unknown folder"), ERR.UNKNOWN_FOLDER);
    }
    const allowed = [
      "displayName",
      "targetType",
      "readOnly",
      "targetID",
      "targetName",
    ];
    const clean = {};
    for (const key of allowed)
      if (key in (patch ?? {})) clean[key] = patch[key];
    // `custom` is shallow-merged on the folder row - same semantics as
    // UPDATE_ACCOUNT above. Sibling keys survive a partial patch.
    if (
      patch &&
      "custom" in patch &&
      patch.custom &&
      typeof patch.custom === "object"
    ) {
      clean.custom = { ...(existing.custom ?? {}), ...patch.custom };
    }
    await folders.update(accountId, folderId, clean);
    ui.broadcast({ type: "folders-changed", accountId });
    return null;
  },
);

router.setProviderRpcHandler(
  PROVIDER_CMD.PUSH_FOLDER_LIST,
  async (providerId, args) => {
    const { accountId, folders: descriptors } = args ?? {};
    const acc = await accounts.get(accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    if (!Array.isArray(descriptors)) {
      throw new Error("folders must be an array");
    }
    const result = await folders.replaceAccountFolders(accountId, descriptors);
    ui.broadcast({ type: "folders-changed", accountId });
    // Server removed these folders. The row is already gone (replaceAccount
    // Folders just wrote storage), so the watcher's onRemoved listener will
    // no-op when our deletes fire below. Cache populate already happened
    // for any selected rows; deleting the local target now does not affect
    // the cache. We skip awaiting individual deletes - they're best-effort.
    for (const t of result.removedTargets) {
      deleteLocalTargetBestEffort(t).catch((err) =>
        console.debug(
          `[tbsync] delete local target ${t.targetID} failed:`,
          err?.message ?? err,
        ),
      );
    }
    return null;
  },
);

async function deleteLocalTargetBestEffort({ targetID, targetType }) {
  if (!targetID) return;
  if (targetType === "calendars" || targetType === "tasks") {
    await messenger.calendar.calendars.remove(targetID);
  } else if (targetType === "contacts") {
    await messenger.addressBooks.delete(targetID);
  }
}

// Provider reads - scoped to the caller's providerId. The provider is the
// one that needs to pull account/folder rows on demand (its handlers receive
// only {accountId}/{folderId}) now that the host is source of truth.
router.setProviderRpcHandler(PROVIDER_CMD.LIST_ACCOUNTS, async (providerId) => {
  const all = await accounts.list();
  return all.filter((a) => a.provider === providerId);
});

router.setProviderRpcHandler(
  PROVIDER_CMD.GET_ACCOUNT,
  async (providerId, args) => {
    const { accountId } = args ?? {};
    const acc = await accounts.get(accountId);
    if (!acc || acc.provider !== providerId) return null;
    const folderList = await folders.listForAccount(accountId);
    return { account: acc, folders: folderList };
  },
);

// Changelog writes - scoped to the caller's providerId (we refuse to touch
// a folder belonging to another provider). The observer on the host owns
// user-initiated entries; these RPCs are for provider-initiated pre-tagging
// and entry removal.
router.setProviderRpcHandler(
  PROVIDER_CMD.CHANGELOG_MARK_SERVER_WRITE,
  async (providerId, args) => {
    const { accountId, folderId, parentId, itemId, status, kind } = args ?? {};
    const acc = await accounts.get(accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    const allowedKinds = [
      "contact",
      "list",
      "list-by-name",
      "event",
      "task",
      "calendar-item",
    ];
    if (!allowedKinds.includes(kind)) {
      throw withCode(
        new Error(
          `changelogMarkServerWrite: kind must be one of ${allowedKinds.join(" | ")} (got ${JSON.stringify(kind)})`,
        ),
        ERR.UNKNOWN_COMMAND,
      );
    }
    if (typeof itemId !== "string" || itemId.length === 0) {
      throw withCode(
        new Error(
          `changelogMarkServerWrite: itemId must be a non-empty string (got ${JSON.stringify(itemId)})`,
        ),
        ERR.UNKNOWN_COMMAND,
      );
    }
    await folders.markServerWrite(accountId, folderId, {
      parentId,
      itemId,
      status,
      kind,
    });
    return null;
  },
);

router.setProviderRpcHandler(
  PROVIDER_CMD.CHANGELOG_REMOVE,
  async (providerId, args) => {
    const { accountId, folderId, parentId, itemId } = args ?? {};
    const acc = await accounts.get(accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    await folders.removeChangelogEntry(accountId, folderId, {
      parentId,
      itemId,
    });
    return null;
  },
);

router.setProviderRpcHandler(
  PROVIDER_CMD.CHANGELOG_MOVE_TO_TAIL,
  async (providerId, args) => {
    const { accountId, folderId, items } = args ?? {};
    const acc = await accounts.get(accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    if (!Array.isArray(items)) {
      throw new Error("changelogMoveToTail: items must be an array");
    }
    await folders.moveChangelogEntriesToTail(accountId, folderId, items);
    return null;
  },
);

router.setProviderRpcHandler(
  PROVIDER_CMD.SET_PROVIDER_UPGRADE_LOCK,
  async (providerId, args) => {
    const locked = !!args?.locked;
    const accs = await accounts.byProvider(providerId);
    for (const a of accs) {
      if (locked) upgradeAccounts.add(a.accountId);
      else upgradeAccounts.delete(a.accountId);
    }
    // One broadcast covers every affected account; manager re-renders the
    // sidebar from the snapshot returned by getState, which now reflects
    // the new upgradeAccounts set.
    ui.broadcast({ type: "accounts-changed" });
    return null;
  },
);

/** Reject an account-scoped UI RPC if the provider has the account
 *  locked for an upgrade. Throws with ERR.PROVIDER_UNAVAILABLE so the
 *  manager surfaces it the same way it surfaces a missing provider. */
function assertNotUpgrading(accountId) {
  if (upgradeAccounts.has(accountId)) {
    throw withCode(
      new Error("Account is being upgraded"),
      ERR.PROVIDER_UNAVAILABLE,
    );
  }
}

// ── Manager popup → background RPC handlers ────────────────────────────────

ui.setManagerRpcHandler("getState", async () => {
  const [accountList, needsSync, live] = await Promise.all([
    accounts.list(),
    folders.needsSyncMap(),
    providers.list(),
  ]);
  // Overlay the known-providers catalogue: attach installUrl to live entries
  // that match a known id, and synthesize stub rows for known providers that
  // aren't installed so the manager can show an install affordance.
  const liveIds = new Set(live.map((p) => p.providerId));
  const providerList = live.map((p) => {
    const known = KNOWN_PROVIDERS[p.providerId];
    return known?.installUrl ? { ...p, installUrl: known.installUrl } : p;
  });
  for (const [providerId, known] of Object.entries(KNOWN_PROVIDERS)) {
    if (liveIds.has(providerId)) continue;
    providerList.push({
      providerId,
      providerName: known.providerName,
      state: "uninstalled",
      capabilities: {},
      icons: {},
      installUrl: known.installUrl,
    });
  }
  return {
    accounts: accountList.map((a) => ({
      ...a,
      needsSync: !!needsSync[a.accountId],
    })),
    providers: providerList,
    eventLog: await eventLog.list(),
    settings: (
      await browser.storage.local.get({ [KEYS.SETTINGS]: DEFAULT_SETTINGS })
    )[KEYS.SETTINGS],
    transient: transientSnapshot(),
  };
});

ui.setManagerRpcHandler("getFolders", async ({ accountId }) => ({
  folders: await folders.listForAccount(accountId),
}));

ui.setManagerRpcHandler("clearEventLog", async () => {
  await eventLog.clear();
  ui.broadcast({ type: "event-log-cleared" });
  return null;
});

// Write the capture threshold for the event log. The gate runs on
// subsequent appends; existing entries are not retroactively removed or
// resurrected. Validation is loose (coerce + clamp) because it's coming
// from a trusted UI dropdown.
ui.setManagerRpcHandler(
  "getCoreMaintainerEmail",
  async () => CORE_MAINTAINER_EMAIL,
);

ui.setManagerRpcHandler("setLogLevel", async ({ level }) => {
  const n = Number(level);
  if (!Number.isInteger(n) || n < 0 || n > 3) {
    throw new Error(
      `setLogLevel: level must be 0, 1, 2, or 3 (got ${JSON.stringify(level)})`,
    );
  }
  await serialize(async () => {
    const rv = await browser.storage.local.get({
      [KEYS.SETTINGS]: DEFAULT_SETTINGS,
    });
    const settings = { ...rv[KEYS.SETTINGS], logLevel: n };
    await browser.storage.local.set({ [KEYS.SETTINGS]: settings });
  });
  ui.broadcast({ type: "settings-changed" });
  return null;
});

ui.setManagerRpcHandler("syncAccount", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) throw new Error("unknown account");
  assertNotUpgrading(accountId);
  if (!router.isProviderConnected(acc.provider)) {
    throw withCode(
      new Error("Provider not available"),
      ERR.PROVIDER_UNAVAILABLE,
    );
  }
  // Kick the sync async; the manager reacts to broadcast events.
  syncAccount(accountId).catch((err) =>
    console.warn("[tbsync] sync error:", err),
  );
  return null;
});

ui.setManagerRpcHandler(
  "setAutoSyncInterval",
  async ({ accountId, minutes }) => {
    const acc = await accounts.get(accountId);
    if (!acc) throw new Error("unknown account");
    assertNotUpgrading(accountId);
    const normalized = Math.max(0, Math.floor(Number(minutes) || 0));
    await accounts.update(accountId, { autoSyncIntervalMinutes: normalized });
    ui.broadcast({ type: "accounts-changed", accountId });
    return null;
  },
);

ui.setManagerRpcHandler("addAccount", async ({ providerId }) => {
  if (!router.isProviderConnected(providerId)) {
    throw new Error("Provider not connected");
  }
  return await runPopupFlow(async () => {
    const setupToken = `setup-${crypto.randomUUID()}`;
    const locale = browser.i18n.getUILanguage();
    return await router.sendCmd(providerId, HOST_CMD.OPEN_SETUP_POPUP, {
      setupToken,
      locale,
    });
  });
});

// Bring an in-flight setup popup to the front. Used by the manager when
// the user clicks a provider whose setup is already running, instead of
// the previous "do nothing" behaviour.
ui.setManagerRpcHandler("focusSetupPopup", async ({ providerId }) => {
  if (!router.isProviderConnected(providerId)) return null;
  await router
    .sendCmd(providerId, HOST_CMD.FOCUS_SETUP_POPUP, {})
    .catch((err) =>
      console.debug(`[tbsync] focusSetupPopup → ${providerId} failed:`, err),
    );
  return null;
});

// Symmetric focus path for an open config popup. Routed to the owning
// provider, which knows the windowId. Silent no-op when the provider is
// disconnected or no popup is open for the account.
ui.setManagerRpcHandler("focusConfigPopup", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) return null;
  if (!router.isProviderConnected(acc.provider)) return null;
  await router
    .sendCmd(acc.provider, HOST_CMD.FOCUS_CONFIG_POPUP, { accountId })
    .catch((err) =>
      console.debug(`[tbsync] focusConfigPopup → ${acc.provider} failed:`, err),
    );
  return null;
});

// Symmetric focus path for an open reauth popup. No-op for providers
// whose reauth flow is browser-managed (e.g. Google's
// `launchWebAuthFlow`); future EAS reauth registers its own popup window.
ui.setManagerRpcHandler("focusReauthPopup", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) return null;
  if (!router.isProviderConnected(acc.provider)) return null;
  await router
    .sendCmd(acc.provider, HOST_CMD.FOCUS_REAUTH_POPUP, { accountId })
    .catch((err) =>
      console.debug(`[tbsync] focusReauthPopup → ${acc.provider} failed:`, err),
    );
  return null;
});

ui.setManagerRpcHandler("editAccount", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) throw new Error("unknown account");
  assertNotUpgrading(accountId);
  if (!router.isProviderConnected(acc.provider)) {
    throw withCode(
      new Error("Provider not available"),
      ERR.PROVIDER_UNAVAILABLE,
    );
  }
  await withBusyAccount(accountId, () =>
    runPopupFlow(() =>
      router.sendCmd(acc.provider, HOST_CMD.OPEN_CONFIG_POPUP, {
        accountId,
        readOnly: acc.enabled === true,
      }),
    ),
  );
  return null;
});

ui.setManagerRpcHandler("signInAgain", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) throw new Error("unknown account");
  assertNotUpgrading(accountId);
  if (!router.isProviderConnected(acc.provider)) {
    throw withCode(
      new Error("Provider not available"),
      ERR.PROVIDER_UNAVAILABLE,
    );
  }
  let statusData = null;
  let caught = null;
  await withBusyAccount(accountId, async () => {
    try {
      statusData = await runPopupFlow(() =>
        router.sendCmd(acc.provider, HOST_CMD.REAUTHENTICATE, { accountId }),
      );
    } catch (err) {
      caught = err;
    }
    // Auto-reconnect on successful reauth: clear the authentication-failed
    // error, then run the normal enable flow so the provider rebuilds its
    // Thunderbird resources + folder list. Kept inside withBusyAccount so
    // the UI shows a single "Working…" pill across the whole sequence.
    if (!caught && statusData?.type === STATUS_TYPES.SUCCESS) {
      await accounts.update(accountId, { error: null });
      await router.sendCmd(acc.provider, HOST_CMD.ACCOUNT_ENABLED, {
        accountId,
      });
      await accounts.update(accountId, { enabled: true });
    }
  });
  if (caught) {
    await eventLog.append({
      accountId,
      folderId: null,
      level: "error",
      message: `Re-authentication failed: ${caught.message}`,
      details: caught.details ?? null,
    });
    return null;
  }
  if (statusData?.type === STATUS_TYPES.SUCCESS) return null;
  // Non-success StatusData: cancellations don't get logged (user's intentional
  // abort); anything else does so the Event Log has the trail without popping
  // a dialog.
  const isCancelled = statusData?.details === ERR.CANCELLED;
  if (!isCancelled) {
    await eventLog.append({
      accountId,
      folderId: null,
      level: "error",
      message: `Re-authentication failed: ${statusData?.message ?? "unknown"}`,
      details: statusData?.details ?? null,
    });
  }
  return null;
});

ui.setManagerRpcHandler(
  "deleteAccount",
  async ({ accountId, purgeTargets = true }) => {
    const acc = await accounts.get(accountId);
    if (!acc) return null;
    assertNotUpgrading(accountId);
    // A missing provider must not block removal: the user has no other way
    // to get rid of the orphaned account. Skip the provider's cleanup hook
    // and forget the record locally - Thunderbird-side targets stay behind
    // until the provider reappears or the user removes them by hand.
    await withBusyAccount(accountId, async () => {
      if (router.isProviderConnected(acc.provider)) {
        await router.sendCmd(acc.provider, HOST_CMD.ACCOUNT_DELETED, {
          accountId,
          purgeTargets,
        });
      }
      await folders.clearAccount(accountId);
      await accounts.remove(accountId);
    });
    ui.broadcast({ type: "folders-changed", accountId });
    return null;
  },
);

ui.setManagerRpcHandler("setAccountEnabled", async ({ accountId, enabled }) => {
  const acc = await accounts.get(accountId);
  if (!acc) return null;
  assertNotUpgrading(accountId);
  if (!router.isProviderConnected(acc.provider)) {
    throw withCode(
      new Error("Provider not available"),
      ERR.PROVIDER_UNAVAILABLE,
    );
  }
  await withBusyAccount(accountId, async () => {
    const cmd = enabled ? HOST_CMD.ACCOUNT_ENABLED : HOST_CMD.ACCOUNT_DISABLED;
    await router.sendCmd(acc.provider, cmd, { accountId });
    await accounts.update(accountId, {
      enabled,
      lastSyncTime: enabled ? acc.lastSyncTime : 0,
      // Clear any standing auth/sync error on re-enable; on disable, drop
      // it too so the row reads as a clean "off" state.
      error: null,
    });
    if (!enabled) {
      // Host forgets its folder records on disable; the provider already
      // cleared its Thunderbird resources inside ACCOUNT_DISABLED above.
      await folders.clearAccount(accountId);
    }
  });
  ui.broadcast({ type: "folders-changed", accountId });
  return null;
});

ui.setManagerRpcHandler(
  "setFolderDownloadOnly",
  async ({ accountId, folderId, downloadOnly }) => {
    // User toggled the manager's ACL icon. The server-announced `readOnly`
    // flag (provider-authored) cannot be flipped here - that's the server's
    // ACL. `downloadOnly` is a pure user preference layered on top, only
    // meaningful when `readOnly` is false.
    const acc = await accounts.get(accountId);
    if (!acc) throw new Error("unknown account");
    assertNotUpgrading(accountId);
    const folder = await folders.get(accountId, folderId);
    if (!folder) throw new Error("unknown folder");
    if (folder.readOnly) {
      throw new Error("Folder is read-only on the server");
    }
    if (busyFolders.has(folderId)) {
      throw withCode(new Error("Folder is busy"), "E:BUSY");
    }
    await folders.update(accountId, folderId, { downloadOnly: !!downloadOnly });
    ui.broadcast({ type: "folders-changed", accountId });
    return null;
  },
);

ui.setManagerRpcHandler(
  "setFolderSelected",
  async ({ accountId, folderId, selected }) => {
    const acc = await accounts.get(accountId);
    if (!acc) throw new Error("unknown account");
    assertNotUpgrading(accountId);
    if (!router.isProviderConnected(acc.provider)) {
      throw withCode(
        new Error("Provider not available"),
        ERR.PROVIDER_UNAVAILABLE,
      );
    }
    const folder = await folders.get(accountId, folderId);
    if (!folder) throw new Error("unknown folder");
    if (busyFolders.has(folderId)) {
      throw withCode(new Error("Folder is busy"), "E:BUSY");
    }

    busyFolders.add(folderId);
    ui.broadcast({ type: "folders-changed", accountId });
    try {
      const cmd = selected ? HOST_CMD.FOLDER_ENABLED : HOST_CMD.FOLDER_DISABLED;
      await router.sendCmd(acc.provider, cmd, { accountId, folderId });
      // On disable, wipe the host-owned per-folder fields so re-enable shows
      // a clean slate. The provider handles its own per-folder state (custom.*,
      // targetID, targetName) inside FOLDER_DISABLED above.
      const patch = selected
        ? { selected }
        : {
            selected,
            status: null,
            lastSyncTime: 0,
            warning: null,
            error: null,
            changelog: [],
          };
      await folders.update(accountId, folderId, patch);
      // Recompute account.error: deselecting a failing folder should
      // immediately drop the toolbar badge and the manager's
      // account-row aggregated error, not wait for the next sync.
      // Re-enabling a folder is a no-op here (folder.error is null on
      // enable) but kept symmetric.
      await recomputeAccountError(accountId);
    } catch (err) {
      await eventLog.append({
        accountId,
        folderId,
        level: "error",
        message: `Could not ${selected ? "enable" : "disable"} resource: ${err.message}`,
        details: err.details ?? null,
      });
      throw err;
    } finally {
      busyFolders.delete(folderId);
      ui.broadcast({ type: "folders-changed", accountId });
    }
    return null;
  },
);

// ── Auto-sync ──────────────────────────────────────────────────────────────

const AUTOSYNC_ALARM = "tbsync.autosync.tick";
const AUTOSYNC_TICK_MINUTES = 1;

async function onAutosyncTick() {
  const now = Date.now();
  for (const acc of await accounts.list()) {
    if (!acc.enabled) continue;
    if (acc.error === "E:AUTH") continue;
    if (busyAccounts.has(acc.accountId)) continue;
    if (upgradeAccounts.has(acc.accountId)) continue;
    // Provider-set backoff: skip until the timestamp elapses. Manual sync
    // from the manager bypasses this gate by calling syncAccount directly.
    if ((acc.noAutosyncUntil ?? 0) > now) continue;
    // syncAccount() returns early if the account is already in flight, so we
    // don't need to check syncingAccounts here explicitly.
    const intervalMs = (acc.autoSyncIntervalMinutes ?? 0) * 60_000;
    if (intervalMs <= 0) continue;
    if (now - (acc.lastSyncTime ?? 0) < intervalMs) continue;
    syncAccount(acc.accountId).catch((err) =>
      console.warn(`[tbsync] autosync(${acc.accountId}) failed:`, err),
    );
  }
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTOSYNC_ALARM) return;
  onAutosyncTick().catch((err) =>
    console.warn("[tbsync] autosync tick failed:", err),
  );
});

// ── Boot ───────────────────────────────────────────────────────────────────

await ensureSchema();
ui.init();
actionBadge.init();
await actionBadge.refresh();
await changelogWatcher.init();
registry.init({
  openPortToProvider: router.openPortToProvider,
  closePortToProvider: router.closePortToProvider,
});

browser.browserAction.onClicked.addListener(() => {
  openManagerTab().catch((err) =>
    console.warn("[tbsync] could not open manager:", err),
  );
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === "open-manager") {
    openManagerTab().catch((err) =>
      console.warn("[tbsync] could not open manager:", err),
    );
  }
});

await browser.alarms.create(AUTOSYNC_ALARM, {
  periodInMinutes: AUTOSYNC_TICK_MINUTES,
});
