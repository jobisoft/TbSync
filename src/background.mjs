import {
  ERR,
  HOST_CMD,
  PROVIDER_CMD,
  withCode,
} from "./vendor/tbsync/protocol.mjs";
import { STATUS_TYPES } from "./vendor/tbsync/status.mjs";
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  EVENT_LOG_DISPLAY_MAX,
  KEYS,
} from "./modules/storage-keys.mjs";
import * as accounts from "./modules/accounts.mjs";
import * as folders from "./modules/folders.mjs";
import * as providers from "./modules/providers.mjs";
import {
  KNOWN_PROVIDERS,
  installUrlFor,
  linkFor,
} from "./modules/known-providers.mjs";
import * as eventLog from "./modules/event-log.mjs";
import * as registry from "./modules/registry.mjs";
import * as router from "./modules/router.mjs";
import * as ui from "./modules/messaging-ui.mjs";
import * as actionBadge from "./modules/action-badge.mjs";
import * as actionMenu from "./modules/action-menu.mjs";
import {
  busyAccounts,
  busyFolders,
  settingUpAccounts,
  upgradeAccounts,
  snapshot as transientSnapshot,
} from "./modules/transient.mjs";
import {
  syncAccount,
  maintainAccount,
  abortAccountSync,
  endAccountCancel,
  recomputeAccountError,
} from "./modules/sync-coordinator.mjs";
import { runIfNeeded as runLegacyMigration } from "./modules/legacy-migration-runner.mjs";
import { serialize } from "./vendor/tbsync/storage-queue.mjs";

// Where "TbSync Manager" bug reports are sent. Provider-authored reports go
// to the provider's own `maintainerEmail` (carried on ProviderMeta from the
// announce handshake).
export const CORE_MAINTAINER_EMAIL = "john.bieling@gmx.de";

/** Validate the per-account icon override shape. Accepts a size-keyed
 *  map of **relative** paths within the provider extension
 *  (`{ "16": "icons/foo16.png", … }`) or null/missing meaning "no
 *  override". Throws on absolute URLs - they'd bake the provider's
 *  unstable `moz-extension://UUID` prefix into persistent storage. */
function validIconOrNull(icon) {
  if (icon == null) return null;
  if (typeof icon !== "object") {
    throw withCode(
      new Error("icon must be a size-keyed object or null"),
      ERR.UNKNOWN_COMMAND,
    );
  }
  const out = {};
  for (const [size, path] of Object.entries(icon)) {
    if (typeof path !== "string" || !path) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
      throw withCode(
        new Error(`icon[${size}] must be a relative path, got: ${path}`),
        ERR.UNKNOWN_COMMAND,
      );
    }
    out[size] = path;
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
    // Fixups run before the version is stamped, so an interrupted upgrade
    // is retried on the next boot rather than skipped. Each is idempotent
    // for the same reason.
    if (rv[KEYS.SCHEMA_VERSION] < 2) {
      const stamped = await folders.backfillSessionIds();
      if (stamped) {
        console.info(`[tbsync] gave ${stamped} folder row(s) a session id`);
      }
    }
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

/** Read the manager tab id published by manager.mjs. The manager is the
 *  sole writer of this key (via tabs.getCurrent at boot); the background
 *  only reads. browser.storage.session is wiped at restart, so the
 *  restored manager re-publishes its id when its module first runs. */
async function getManagerTabId() {
  const rv = await browser.storage.session.get({ [MANAGER_TAB_KEY]: null });
  return rv[MANAGER_TAB_KEY];
}

async function openManagerTab() {
  if (await focusManagerTab()) return;
  await browser.tabs.create({ url: "manager/manager.html" });
}

/** Focus the manager tab if its id is in the cache and the tab still
 *  exists. Returns true on success, false otherwise (caller's signal to
 *  open a fresh tab). A stale id self-corrects: the next manager.mjs
 *  load overwrites the cache. */
async function focusManagerTab() {
  const id = await getManagerTabId();
  if (id == null) return false;
  try {
    const tab = await browser.tabs.update(id, { active: true });
    if (tab?.windowId != null) {
      await browser.windows
        .update(tab.windowId, { focused: true })
        .catch((err) =>
          console.debug("[tbsync] windows.update(focus) failed:", err),
        );
    }
    return true;
  } catch (err) {
    console.debug("[tbsync] tabs.update(active) failed; tab is gone:", err);
    return false;
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
      // Merged by `accounts.update` inside the storage lock, not here:
      // `acc` was read before it and a patch landing in between would be
      // overwritten whole.
      clean.custom = patch.custom;
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
      "targetColor",
      "localChanges",
    ];
    const clean = {};
    for (const key of allowed)
      if (key in (patch ?? {})) clean[key] = patch[key];
    // `custom` is shallow-merged on the folder row so sibling keys survive
    // a partial patch - but the merge belongs to `folders.update`, inside
    // the storage lock. Doing it here would merge against `existing`, read
    // before the lock was taken, so a patch landing in between would be
    // overwritten entirely rather than merged with.
    if (
      patch &&
      "custom" in patch &&
      patch.custom &&
      typeof patch.custom === "object"
    ) {
      clean.custom = patch.custom;
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
    // Folders just wrote storage), so the watcher's onRemoved listener
    // no-ops when our deletes fire below. Cache populate already happened
    // for any selected rows, so deleting the local target does not affect
    // the cache. Individual deletes are best-effort and not awaited.
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

/** Remove the local resource behind a folder the server no longer lists.
 *
 *  Address books only. A provider supplies its own calendars and deletes them
 *  itself - it is handed the same removal list by `pushFolderList` - and the
 *  host has no calendar API to reach them with. */
async function deleteLocalTargetBestEffort({ targetID, targetType }) {
  if (!targetID) return;
  if (targetType === "contacts") {
    await messenger.addressBooks.delete(targetID);
  } else if (targetType === "calendars" || targetType === "tasks") {
    // Works whether or not the owning provider is alive: a calendar whose
    // provider type is unregistered exists as a force-disabled dummy under
    // the same id, and unregistering it deletes the registration. This is
    // what lets a disconnect or removal finish without the provider.
    await messenger.calendar.calendars.remove(targetID);
  }
}

/** Delete every local target behind the given folder rows, tolerating rows
 *  that have no target or whose target is already gone.
 *
 *  The host owns target *deletion* in every flow - disconnect, removal,
 *  folder deselect, server-dropped folders - while providers own creation.
 *  One owner that runs every time, instead of a provider-side copy that
 *  cannot run exactly when it is needed most (provider dead or wedged). */
async function deleteTargetsBestEffort(rows) {
  for (const row of rows ?? []) {
    if (!row?.targetID) continue;
    try {
      await deleteLocalTargetBestEffort(row);
    } catch (err) {
      // Already gone counts as done; anything else is worth a trace but
      // must not block a teardown.
      console.debug(
        `[tbsync] delete target ${row.targetID} (${row.targetType}) failed:`,
        err?.message ?? err,
      );
    }
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

router.setProviderRpcHandler(
  PROVIDER_CMD.FOLDER_TARGET_REMOVED,
  async (providerId, args) => {
    const { targetID } = args ?? {};
    const owner = await folders.getByTarget(targetID);
    if (!owner) return null;
    const acc = await accounts.get(owner.accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    const cleared = await folders.clearTarget(owner.accountId, owner.folderId);
    if (cleared)
      ui.broadcast({ type: "folders-changed", accountId: owner.accountId });
    return null;
  },
);

router.setProviderRpcHandler(
  PROVIDER_CMD.REQUEST_SYNC,
  async (providerId, args) => {
    const { parentId } = args ?? {};
    const owner = await folders.getByTarget(parentId);
    if (!owner) {
      throw withCode(new Error("unknown folder"), ERR.UNKNOWN_FOLDER);
    }
    const acc = await accounts.get(owner.accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    await syncAccount(owner.accountId, { only: owner.folderId });
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
      // An account still carrying `legacyMigrationPending` holds
      // half-converted data and stays blocked no matter who releases the
      // lock - the provider signals a successful conversion by clearing
      // that flag, so one that survived the upgrade run is one that did
      // not convert. It gets another attempt on the next boot.
      else if (!a.legacyMigrationPending) upgradeAccounts.delete(a.accountId);
    }
    // One broadcast covers every affected account; manager re-renders the
    // sidebar from the snapshot returned by getState, which now reflects
    // the new upgradeAccounts set.
    ui.broadcast({ type: "accounts-changed" });
    return null;
  },
);

router.setProviderRpcHandler(
  PROVIDER_CMD.SET_ACCOUNT_SETUP_LOCK,
  async (providerId, args) => {
    const { accountId } = args ?? {};
    const acc = await accounts.get(accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    if (args?.locked) settingUpAccounts.add(accountId);
    else settingUpAccounts.delete(accountId);
    ui.broadcast({ type: "accounts-changed", accountId });
    return null;
  },
);

/**
 * Mark resources a provider can no longer sync, so they stop looking like
 * working ones.
 *
 * Normally there is nothing here to do: the host deletes a target in every
 * teardown flow, so by the time a provider notices the binding is gone the
 * calendar or book is gone too. The case this exists for is the host losing
 * its own rows - reinstalling TbSync - which leaves the resources behind
 * with nothing syncing them and no way to reconnect them: the provider's
 * queued edits name ids from the old binding, and the sync keys that would
 * have placed them went with the rows.
 *
 * Marked, not deleted. The data is the user's, a rename is reversible, and
 * a provider's belief that it has been orphaned is not grounds for
 * destroying a calendar. Calendars are also disabled, which is the clearest
 * signal the platform offers; address books have no disabled state, so the
 * name is the whole signal there.
 */
router.setProviderRpcHandler(
  PROVIDER_CMD.REPORT_ORPHANED_TARGETS,
  async (_providerId, args) => {
    const prefix = browser.i18n.getMessage("orphanedResourcePrefix");
    for (const { targetID, targetType } of args?.targets ?? []) {
      if (!targetID || !prefix) continue;
      try {
        if (targetType === "contacts") {
          const book = await messenger.addressBooks.get(targetID);
          if (!book || book.name.startsWith(prefix)) continue;
          await messenger.addressBooks.update(targetID, {
            name: prefix + book.name,
          });
        } else {
          const cal = await messenger.calendar.calendars.get(targetID);
          if (!cal) continue;
          const patch = {};
          if (!cal.name.startsWith(prefix)) patch.name = prefix + cal.name;
          if (cal.enabled) patch.enabled = false;
          if (!Object.keys(patch).length) continue;
          await messenger.calendar.calendars.update(targetID, patch);
        }
        await eventLog.append({
          accountId: null,
          folderId: null,
          level: "warning",
          message: `A local resource is no longer synced by any account and has been marked: ${targetID}`,
        });
      } catch (err) {
        // Already gone is the normal outcome - every ordinary teardown
        // deletes the target before the provider ever gets here.
        console.debug(`[tbsync] could not mark orphan ${targetID}:`, err);
      }
    }
    return null;
  },
);

router.setProviderRpcHandler(
  PROVIDER_CMD.LEGACY_MIGRATION_DONE,
  async (providerId, args) => {
    const { accountId } = args ?? {};
    const acc = await accounts.get(accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    await accounts.update(accountId, { legacyMigrationPending: false });
    // Deliberately not touching `upgradeAccounts` here: the provider does
    // this work while holding the upgrade lock, and releasing that lock is
    // what unblocks the accounts that made it. A provider that clears the
    // flag without ever locking leaves the account blocked until the next
    // boot, when the seed below no longer sees a flag to act on.
    ui.broadcast({ type: "accounts-changed" });
    return null;
  },
);

/** Reject an account-scoped UI RPC while the provider is working on the
 *  account and it is not usable: an upgrade run, or the preparation that
 *  follows registering it. Throws with ERR.PROVIDER_UNAVAILABLE so the
 *  manager surfaces it the same way it surfaces a missing provider.
 *
 *  Named for what it asserts rather than for one of the two states it
 *  refuses on, so the next state to join them does not make it a lie. */
function assertAccountReady(accountId) {
  if (upgradeAccounts.has(accountId)) {
    throw withCode(
      new Error("Account is being upgraded"),
      ERR.PROVIDER_UNAVAILABLE,
    );
  }
  if (settingUpAccounts.has(accountId)) {
    throw withCode(
      new Error("Account is still being set up"),
      ERR.PROVIDER_UNAVAILABLE,
    );
  }
}

/** Reject a change to which resources an account syncs while it is locked
 *  as set up by an older version.
 *
 *  Deselecting a resource deletes the local copy, and on such an account
 *  that copy is the only place anything the older version never sent still
 *  exists. The manager greys the controls, but a second window, a stale
 *  render or a bridge call reaches the RPC directly - so the refusal has to
 *  live here as well.
 *
 *  Separate from `assertAccountReady`, which is shared with RPCs that have
 *  no reason to refuse this state. */
function assertFolderSelectionUnlocked(acc) {
  if (acc?.legacyImported) {
    throw new Error("Account was set up by an older version");
  }
}

// ── Manager popup → background RPC handlers ────────────────────────────────

ui.setManagerRpcHandler("getState", async () => {
  const [accountList, needsSync, live] = await Promise.all([
    accounts.list(),
    folders.needsSyncMap(),
    providers.list(),
  ]);
  // Overlay the known-providers catalogue: attach an install url to live
  // entries that match a known id, and synthesize stub rows for known
  // providers that aren't installed so the manager can offer them.
  const liveIds = new Set(live.map((p) => p.providerId));
  const providerList = live.map((p) => {
    const known = KNOWN_PROVIDERS[p.providerId];
    // A fundraiser is an offer to pay for work that does not exist. Once it
    // does and the add-on is running, the row's job is to add an account -
    // so the campaign link is deliberately not carried onto a live provider.
    if (!known || known.kind === "fundraiser") return p;
    const installUrl = installUrlFor(known);
    return installUrl ? { ...p, installUrl } : p;
  });
  for (const [providerId, known] of Object.entries(KNOWN_PROVIDERS)) {
    if (liveIds.has(providerId)) continue;
    // Installed and running, but turned away for speaking a different
    // protocol version. The row keeps its download link - replacing the
    // add-on is exactly the remedy - and stops claiming the provider is
    // not installed.
    const incompatible = registry.incompatibleProviders.get(providerId);
    providerList.push({
      providerId,
      // Its own name when it told us one: that is what the user sees in
      // Thunderbird's add-on manager, so it names the thing they have to
      // go and replace.
      providerName: incompatible?.name ?? known.providerName,
      kind: known.kind,
      // "uninstalled" says a thing could be installed and is not. A
      // fundraiser could not be, so it gets its own state and its own label.
      state: known.kind === "fundraiser" ? "fundraiser" : "uninstalled",
      capabilities: {},
      // Bundled with the host when the catalogue carries them. An entry
      // with no add-on behind it has nobody else to announce an icon.
      icons: known.icons ?? {},
      installUrl: linkFor(known),
      incompatibleVersion: incompatible?.version ?? null,
    });
  }
  return {
    accounts: accountList.map((a) => ({
      ...a,
      needsSync: !!needsSync[a.accountId],
    })),
    providers: providerList,
    // The newest slice only. With the limit lifted the log can be far
    // longer than a table should hold; `getEventLogAll` serves the file
    // and the bug report, which do want every line.
    eventLog: await eventLog.list({ limit: EVENT_LOG_DISPLAY_MAX }),
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
  return null;
});

/** Every entry, for the downloaded file and the bug report. The manager
 *  holds only what it can display, so it must ask rather than export its
 *  own view - with the limit lifted the two are not the same log. */
ui.setManagerRpcHandler("getEventLogAll", async () => ({
  entries: await eventLog.list(),
}));

/** Keep every entry of this session, or roll at EVENT_LOG_MAX. Lifting
 *  the limit does not resurrect what has already rolled off. */
ui.setManagerRpcHandler("setEventLogUnlimited", async ({ unlimited }) => {
  await serialize(async () => {
    const rv = await browser.storage.local.get({
      [KEYS.SETTINGS]: DEFAULT_SETTINGS,
    });
    const settings = { ...rv[KEYS.SETTINGS], eventLogUnlimited: !!unlimited };
    await browser.storage.local.set({ [KEYS.SETTINGS]: settings });
  });
  ui.broadcast({ type: "settings-changed" });
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
  assertAccountReady(accountId);
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
    assertAccountReady(accountId);
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

// Raise whichever window the provider already has open for this account -
// its config popup, or a consent window it drove itself. Routed to the
// owning provider, which is the only side that knows the windowId. Silent
// no-op when the provider is disconnected, when nothing is open, or when
// the flow is browser-managed (e.g. Google's `launchWebAuthFlow`, where
// the browser owns the window and never hands over its id).
ui.setManagerRpcHandler("focusAccountPopup", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) return null;
  if (!router.isProviderConnected(acc.provider)) return null;
  await router
    .sendCmd(acc.provider, HOST_CMD.FOCUS_ACCOUNT_POPUP, { accountId })
    .catch((err) =>
      console.debug(
        `[tbsync] focusAccountPopup → ${acc.provider} failed:`,
        err,
      ),
    );
  return null;
});

ui.setManagerRpcHandler("editAccount", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) throw new Error("unknown account");
  assertAccountReady(accountId);
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

ui.setManagerRpcHandler("openServices", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) throw new Error("unknown account");
  assertAccountReady(accountId);
  if (!router.isProviderConnected(acc.provider)) {
    throw withCode(
      new Error("Provider not available"),
      ERR.PROVIDER_UNAVAILABLE,
    );
  }
  // Services live on the server, so there is nothing to show for an
  // account that is not connected to one. The manager disables the button
  // for the same reason; this is the guard for anyone calling it anyway.
  if (!acc.enabled) throw new Error("account is not connected");
  await withBusyAccount(accountId, () =>
    runPopupFlow(() =>
      router.sendCmd(acc.provider, HOST_CMD.OPEN_SERVICES_POPUP, { accountId }),
    ),
  );
  return null;
});

ui.setManagerRpcHandler("authenticateAccount", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) throw new Error("unknown account");
  assertAccountReady(accountId);
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
    // Clear the authentication-failed error so the account is serviceable
    // again. Kept inside withBusyAccount so the UI shows a single "Working…"
    // pill across the whole sequence.
    if (!caught && statusData?.type === STATUS_TYPES.SUCCESS) {
      await accounts.update(accountId, { error: null });
      // An auth failure leaves the account enabled, so normally there is
      // nothing to re-enable. An account stranded in the disabled state
      // still needs the enable flow to rebuild its Thunderbird resources
      // and folder list, so it heals on its first authentication.
      if (!acc.enabled) {
        await router.sendCmd(acc.provider, HOST_CMD.ACCOUNT_ENABLED, {
          accountId,
        });
        await accounts.update(accountId, { enabled: true });
      }
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
  if (statusData?.type === STATUS_TYPES.SUCCESS) {
    // Sync straight away so the user finds out whether the new credentials
    // actually work, rather than waiting for the next autosync tick. Outside
    // withBusyAccount because syncAccount takes its own busy state, and
    // fire-and-forget to match the manual-sync handler. If the credentials
    // are still wrong this re-stamps E:AUTH through the normal path and the
    // Authenticate button comes back.
    syncAccount(accountId).catch((err) =>
      console.warn(`[tbsync] post-auth sync of ${accountId} failed:`, err),
    );
    return null;
  }
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

ui.setManagerRpcHandler("deleteAccount", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) return null;
  // The last-resort exit refuses nothing: no upgrade guard, no transient
  // lock, no provider requirement. A running sync is aborted here, and
  // the host deletes the account's Thunderbird resources itself - a dead
  // provider's calendars exist as inert dummy registrations the calendar
  // API removes like any other. Nothing is left behind.
  try {
    await abortAccountSync(accountId);
    await withBusyAccount(accountId, async () => {
      const rows = await folders.listForAccount(accountId);
      // Let the provider stop and drop its own account state first - auth
      // caches, GAL directories - so the deletions below land on quiet
      // resources. Best effort; a provider that cannot answer forfeits it.
      try {
        if (router.isProviderConnected(acc.provider)) {
          await router.sendCmd(acc.provider, HOST_CMD.ACCOUNT_DELETED, {
            accountId,
          });
        }
      } catch (err) {
        await eventLog.append({
          accountId,
          folderId: null,
          level: "warning",
          message: `Provider did not finish its part of the removal: ${err?.message ?? err}`,
          details: err?.details ?? null,
        });
      }
      // Rows first, targets second. Clearing the rows ends every one of
      // this account's bindings before the deletions fire their cascade
      // of events, so nothing is left resolving ids that are going away.
      // Removing an account always takes its local resources with it -
      // the confirmation says so - and the provider never deletes a
      // target in any flow.
      await folders.clearAccount(accountId);
      await deleteTargetsBestEffort(rows);
      await accounts.remove(accountId);
    });
  } finally {
    // The abort marked the account cancelling; release it even though the
    // record is gone - the set must not collect ids forever.
    endAccountCancel(accountId);
  }
  ui.broadcast({ type: "folders-changed", accountId });
  return null;
});

ui.setManagerRpcHandler("setAccountEnabled", async ({ accountId, enabled }) => {
  const acc = await accounts.get(accountId);
  if (!acc) return null;
  // Connecting needs the provider: only it can reach the server and
  // discover what the account holds, so there is nothing to do without it.
  //
  // Disconnecting does not, and refusing without it was the wrong shape - a
  // wedged or uninstalled provider is exactly when a user reaches for
  // Disconnect. Nothing in the teardown depends on it any more: the host
  // aborts the sync, deletes the Thunderbird resources itself, and ends
  // each folder's binding by minting a new session, which is what makes
  // whatever the provider still holds unclaimed. It is told if it is
  // listening, and finds out by not finding its session if it is not.
  if (enabled) assertAccountReady(accountId);
  // The one state where disconnecting destroys something. The teardown
  // deletes the account's calendars and address books, and on an account
  // set up by an older version those are the only place the edits that
  // version never sent still exist. Refused here as well as in the manager
  // because a second window, a stale render or the bridge reach this
  // directly. Removing the account is still allowed, and still deletes
  // them - that one is the user saying so.
  if (!enabled && acc.legacyImported) {
    throw new Error("Account was set up by an older version");
  }
  if (enabled && !router.isProviderConnected(acc.provider)) {
    throw withCode(
      new Error("Provider not available"),
      ERR.PROVIDER_UNAVAILABLE,
    );
  }
  try {
    // Inside the try: `abortAccountSync` marks the account cancelling before
    // it does anything else, and only this `finally` releases that mark. A
    // throw in between - an event-log write failing, say - would otherwise
    // leave the account marked for the life of the background page, and
    // every future sync of it would return immediately with no explanation.
    if (!enabled) await abortAccountSync(accountId);
    await withBusyAccount(accountId, async () => {
      const cmd = enabled
        ? HOST_CMD.ACCOUNT_ENABLED
        : HOST_CMD.ACCOUNT_DISABLED;
      // Captured before anything clears them: these rows are the only
      // record of which Thunderbird resources belong to this account, and
      // the deletion below runs after the rows themselves are gone.
      const rows = enabled ? null : await folders.listForAccount(accountId);
      if (enabled) {
        await router.sendCmd(acc.provider, cmd, { accountId });
      } else {
        // Ask the provider to stop and clean its own state first, so the
        // deletions below land on resources nothing is still writing to.
        // Best effort: a provider that is wedged or gone must not be able
        // to keep the account connected - the host finishes the teardown
        // alone, which is what makes this the recovery path.
        try {
          if (router.isProviderConnected(acc.provider)) {
            await router.sendCmd(acc.provider, cmd, { accountId });
          }
        } catch (err) {
          await eventLog.append({
            accountId,
            folderId: null,
            level: "warning",
            message: `Provider did not finish its part of the disconnect: ${err?.message ?? err}`,
            details: err?.details ?? null,
          });
        }
      }
      await accounts.update(accountId, {
        enabled,
        lastSyncTime: enabled ? acc.lastSyncTime : 0,
        // Clear any standing auth/sync error on re-enable; on disable, drop
        // it too so the row reads as a clean "off" state.
        error: null,
        // A disconnect ends the account's migrated life: everything the
        // conversion carried is deleted below, and reconnecting rebuilds it
        // from the server. That is the remedy the manager suggests to a
        // carried-over account, so the suggestion retires when it is taken.
        ...(enabled ? null : { legacyImported: false }),
      });
      if (!enabled) {
        // Rows first, targets second: dropping the rows is what unhooks the
        // changelog watcher, so the cascade of deletion events from the
        // targets is not recorded as user edits. The captured rows still
        // carry the ids.
        await folders.clearAccount(accountId);
        await deleteTargetsBestEffort(rows);
      }
    });
  } finally {
    // Only now: the account reads `enabled: false`, so nothing can start a
    // sync into the teardown any more.
    if (!enabled) endAccountCancel(accountId);
  }
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
    assertAccountReady(accountId);
    assertFolderSelectionUnlocked(acc);
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
    assertAccountReady(accountId);
    assertFolderSelectionUnlocked(acc);
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
      if (!selected) {
        // The provider has unhooked and cleared its per-folder state above;
        // deleting the resource itself is the host's job in every flow. The
        // row captured before the RPC still carries the target: the provider
        // does not clear binding fields it will not need, and `folder`
        // predates the call in any case.
        await deleteTargetsBestEffort([folder]);
      }
      // On disable, wipe the host-owned per-folder fields so re-enable shows
      // a clean slate. The provider handles its remaining per-folder state
      // (custom.*, targetID, targetName) inside FOLDER_DISABLED above.
      //
      // The new session is what makes that last part true even when the
      // FOLDER_DISABLED above never arrived - the provider was down, or
      // died mid-handler. Whatever it still holds for this folder is filed
      // under a session nothing names now, and goes when it next looks.
      const patch = selected
        ? { selected }
        : {
            selected,
            status: null,
            lastSyncTime: 0,
            warning: null,
            error: null,
            localChanges: 0,
            sessionId: folders.newSession(),
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

/** How often an enabled account is offered its housekeeping slot.
 *
 *  The offer, not the work: what is due and how often is the provider's,
 *  and it answers `{ done: false }` when there is nothing. Hourly is chosen
 *  so a provider on a daily cycle lands within an hour of its own deadline
 *  without the host having to know what that deadline is.
 *
 *  In memory: a host restart offers the slot again, which costs one
 *  round-trip against a provider that will decline it. */
const MAINTAIN_EVERY_MS = 60 * 60_000;
const lastMaintainOffer = new Map();

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
  await offerMaintenance(now);
}

/** Offer the housekeeping slot to every account that is due one.
 *
 *  After the sync pass on purpose, and one account at a time: an account
 *  that is syncing declines and takes its turn on a later tick - a minute
 *  later, against work due daily - and nothing starts a second provider's
 *  housekeeping while the first is still going.
 */
async function offerMaintenance(now) {
  for (const acc of await accounts.list()) {
    if (!acc.enabled) continue;
    if (now - (lastMaintainOffer.get(acc.accountId) ?? 0) < MAINTAIN_EVERY_MS) {
      continue;
    }
    // Stamped only when the provider was actually asked. Stamping before
    // the attempt spent the whole hour on an account that merely happened
    // to be syncing, and the accounts busy enough to collide are exactly
    // the ones that most need the work done.
    const asked = await maintainAccount(acc.accountId).catch((err) => {
      console.warn(`[tbsync] maintain(${acc.accountId}) failed:`, err);
      return true;
    });
    if (asked) lastMaintainOffer.set(acc.accountId, now);
  }
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTOSYNC_ALARM) return;
  onAutosyncTick().catch((err) =>
    console.warn("[tbsync] autosync tick failed:", err),
  );
});

/** Stop a locked account's local resources from accepting edits.
 *
 *  An account set up by an older version cannot sync, and its calendars and
 *  address books were written by code that addressed their items
 *  differently. Every edit made to them now is an edit against data that
 *  will be replaced, so it is lost either way - silently, and with nothing
 *  telling the user. Freezing them says it.
 *
 *  Best effort per resource: a book or calendar the user deleted by hand
 *  answers false or throws, and the rest still have to be frozen.
 *
 *  Nothing lifts these flags. The only thing that clears `legacyImported`
 *  is the disconnect, and that deletes the resources in the same handler -
 *  which the flag does not block, since a whole book is removed through the
 *  address book manager rather than through the directory. */
async function freezeLegacyTargets(accountId) {
  for (const row of await folders.listForAccount(accountId)) {
    if (!row?.targetID) continue;
    try {
      if (row.targetType === "contacts") {
        await browser.LegacyData.setAddressBookReadOnly(row.targetID, true);
      } else if (row.targetType === "calendars" || row.targetType === "tasks") {
        await messenger.calendar.calendars.update(row.targetID, {
          readOnly: true,
        });
      }
    } catch (err) {
      console.debug(
        `[tbsync] freezing ${row.targetID} (${row.targetType}) failed:`,
        err?.message ?? err,
      );
    }
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────

await ensureSchema();
// Block every account the legacy importer left half-converted, before any
// provider can announce itself. `ensureSchema` is where the import runs, so
// rows it just produced are already readable here, and seeding the same set
// the upgrade lock uses means the existing gates - `assertAccountReady`, the
// autosync tick, the action menu, the manager's "upgrading" row - all cover
// this case without knowing about it. Sequencing this ahead of
// `registry.init` is what closes the window: no port can open, so no sync
// can start against a flagged account before the flag takes effect.
//
// The same loop freezes the local resources of an account the importer
// locked, for the same reason it runs here: this is the first moment those
// rows exist, and nothing else can reach them yet.
for (const acc of await accounts.list()) {
  if (acc.legacyMigrationPending) upgradeAccounts.add(acc.accountId);
  if (acc.legacyImported) await freezeLegacyTargets(acc.accountId);
}
ui.init();
actionBadge.init();
await actionBadge.refresh();
await actionMenu.init();
registry.init({
  openPortToProvider: router.openPortToProvider,
  closePortToProvider: router.closePortToProvider,
});

// Beta-only bridge. `beta/modules/bridge.mjs` is applied to the beta and dev
// trees and is simply absent from an ATN build, where this import failing is
// the normal case and means nothing is wrong. Has to follow `ui.init()`: the
// bridge registers manager RPCs of its own.
try {
  const bridge = await import("./modules/bridge.mjs");
  await bridge.initBackground();
} catch (err) {
  console.debug("[tbsync] bridge not present:", err?.message ?? err);
}

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
