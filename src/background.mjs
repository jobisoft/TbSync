import { ERR, HOST_CMD, PROVIDER_CMD, withCode } from "./vendor/tbsync/protocol.mjs";
import { STATUS_TYPES } from "./vendor/tbsync/status.mjs";
import {
  ALLOWED_CHANGELOG_KINDS,
  SERVER_TAG_STATUSES,
} from "./vendor/tbsync/changelog-core.mjs";
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  KEYS,
} from "./modules/storage-keys.mjs";
import * as accounts from "./modules/accounts.mjs";
import * as folders from "./modules/folders.mjs";
import * as providers from "./modules/providers.mjs";
import { KNOWN_PROVIDERS, installUrlFor } from "./modules/known-providers.mjs";
import * as eventLog from "./modules/event-log.mjs";
import * as registry from "./modules/registry.mjs";
import * as router from "./modules/router.mjs";
import * as ui from "./modules/messaging-ui.mjs";
import * as actionBadge from "./modules/action-badge.mjs";
import * as actionMenu from "./modules/action-menu.mjs";
import * as changelogWatcher from "./modules/changelog-watcher.mjs";
import {
  busyAccounts,
  busyFolders,
  upgradeAccounts,
  snapshot as transientSnapshot,
} from "./modules/transient.mjs";
import {
  syncAccount,
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
      "targetColor",
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

// Changelog writes - scoped to the caller's providerId (we refuse to touch
// a folder belonging to another provider). The observer on the host owns
// user-initiated entries; these RPCs are for provider-initiated pre-tagging
// and entry removal.
// A changelog row's identity is the triple (parentId, itemId, kind) - every
// handler below validates `kind` so no row can be written or matched with a
// meaningless one. The vocabulary comes from the vendored core, so a
// provider validating its own queue accepts exactly what we accept.

router.setProviderRpcHandler(
  PROVIDER_CMD.CHANGELOG_MARK_SERVER_WRITE,
  async (providerId, args) => {
    const { accountId, folderId, parentId, itemId, status, kind } = args ?? {};
    const acc = await accounts.get(accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    if (!ALLOWED_CHANGELOG_KINDS.includes(kind)) {
      throw withCode(
        new Error(
          `changelogMarkServerWrite: kind must be one of ${ALLOWED_CHANGELOG_KINDS.join(" | ")} (got ${JSON.stringify(kind)})`,
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
    // The status string is load-bearing: the watcher consumes a tag only
    // via the op it announces, and an unknown string would be invisible to
    // `isServerTag` and masquerade as a user entry instead.
    if (!SERVER_TAG_STATUSES.includes(status)) {
      throw withCode(
        new Error(
          `changelogMarkServerWrite: status must be one of ${SERVER_TAG_STATUSES.join(" | ")} (got ${JSON.stringify(status)})`,
        ),
        ERR.UNKNOWN_COMMAND,
      );
    }
    // A pre-tag exists for exactly one purpose: to stop our own observer
    // from logging the write we are about to make as a user edit. Where the
    // provider owns the resource we do not observe it, so there is nothing to
    // suppress - and the tag would never be consumed either, so it would sit
    // in the changelog forever, one per synced item.
    const row = await folders.get(accountId, folderId);
    if (changelogWatcher.providerOwnsChanges(row?.targetType)) return null;

    await folders.markServerWrite(accountId, folderId, {
      parentId,
      itemId,
      status,
      kind,
    });
    return null;
  },
);

/**
 * A user edit the provider was handed directly, for a resource it supplies
 * itself. The host resolves which folder that is - the provider is given a
 * calendar, not a folder id, and the folder table is ours.
 *
 * `detail` is stored verbatim and never inspected here. For calendars it is
 * what the item looked like before the edit, which nothing on this side can
 * reconstruct once the new version has been written.
 */
router.setProviderRpcHandler(
  PROVIDER_CMD.CHANGELOG_RECORD_USER_EDIT,
  async (providerId, args) => {
    const { parentId, itemId, kind, op, detail } = args ?? {};
    const allowedOps = ["created", "updated", "deleted"];
    if (!allowedOps.includes(op)) {
      throw withCode(
        new Error(
          `changelogRecordUserEdit: op must be one of ${allowedOps.join(" | ")} (got ${JSON.stringify(op)})`,
        ),
        ERR.UNKNOWN_COMMAND,
      );
    }
    if (!ALLOWED_CHANGELOG_KINDS.includes(kind)) {
      throw withCode(
        new Error(
          `changelogRecordUserEdit: kind must be one of ${ALLOWED_CHANGELOG_KINDS.join(" | ")} (got ${JSON.stringify(kind)})`,
        ),
        ERR.UNKNOWN_COMMAND,
      );
    }
    if (typeof itemId !== "string" || itemId.length === 0) {
      throw withCode(
        new Error(
          `changelogRecordUserEdit: itemId must be a non-empty string (got ${JSON.stringify(itemId)})`,
        ),
        ERR.UNKNOWN_COMMAND,
      );
    }
    const owner = await folders.getByTarget(parentId);
    if (!owner) {
      throw withCode(new Error("unknown folder"), ERR.UNKNOWN_FOLDER);
    }
    const acc = await accounts.get(owner.accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    const changed = await folders.recordUserEdit(
      owner.accountId,
      owner.folderId,
      { parentId, itemId, kind, op, detail },
    );
    if (changed) {
      ui.broadcast({ type: "folders-changed", accountId: owner.accountId });
    }
    return null;
  },
);

/**
 * The local resource behind one of this provider's folders is gone - the user
 * deleted the calendar or address book it was bound to. Same teardown the
 * observer performs for the resources it still watches: the row stays so the
 * folder can be enabled again, but its binding is cleared and it stops syncing.
 *
 * A provider supplies its own calendars, so it is the only side that sees
 * those removals. It is also the only side that can tell a real deletion from
 * its own extension restarting, which the platform announces the same way.
 */
/**
 * A provider asking for one of its folders to be synced - a user pressing
 * Reload on a calendar it supplies, or that calendar's own refresh timer.
 *
 * The host still decides how: its normal account prologue runs first, only the
 * named folder is synced, and a request arriving mid-sync is deferred rather
 * than dropped. Resolves when that sync has finished, so the provider can
 * report a real outcome back to whatever asked.
 */
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
  PROVIDER_CMD.FOLDER_TARGET_REMOVED,
  async (providerId, args) => {
    const { targetID } = args ?? {};
    const owner = await folders.getByTarget(targetID);
    if (!owner) return null;
    const acc = await accounts.get(owner.accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    await changelogWatcher.clearFolderTarget(
      owner.accountId,
      owner.folderId,
      targetID,
    );
    return null;
  },
);

router.setProviderRpcHandler(
  PROVIDER_CMD.CHANGELOG_REMOVE,
  async (providerId, args) => {
    const { accountId, folderId, parentId, itemId, kind } = args ?? {};
    const acc = await accounts.get(accountId);
    if (!acc || acc.provider !== providerId) {
      throw withCode(new Error("unknown account"), ERR.UNKNOWN_ACCOUNT);
    }
    if (!ALLOWED_CHANGELOG_KINDS.includes(kind)) {
      throw withCode(
        new Error(
          `changelogRemove: kind must be one of ${ALLOWED_CHANGELOG_KINDS.join(" | ")} (got ${JSON.stringify(kind)})`,
        ),
        ERR.UNKNOWN_COMMAND,
      );
    }
    await folders.removeChangelogEntry(accountId, folderId, {
      parentId,
      itemId,
      kind,
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
    for (const i of items) {
      if (!ALLOWED_CHANGELOG_KINDS.includes(i?.kind)) {
        throw withCode(
          new Error(
            `changelogMoveToTail: every item needs a kind out of ${ALLOWED_CHANGELOG_KINDS.join(" | ")} (got ${JSON.stringify(i?.kind)})`,
          ),
          ERR.UNKNOWN_COMMAND,
        );
      }
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
    const installUrl = known && installUrlFor(known);
    return installUrl ? { ...p, installUrl } : p;
  });
  for (const [providerId, known] of Object.entries(KNOWN_PROVIDERS)) {
    if (liveIds.has(providerId)) continue;
    providerList.push({
      providerId,
      providerName: known.providerName,
      state: "uninstalled",
      capabilities: {},
      icons: {},
      installUrl: installUrlFor(known),
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

ui.setManagerRpcHandler("authenticateAccount", async ({ accountId }) => {
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
    // Clear the authentication-failed error so the account is serviceable
    // again. Kept inside withBusyAccount so the UI shows a single "Working…"
    // pill across the whole sequence.
    if (!caught && statusData?.type === STATUS_TYPES.SUCCESS) {
      await accounts.update(accountId, { error: null });
      // An auth failure no longer disables the account, so normally there is
      // nothing to re-enable. Accounts stranded by the version that did
      // disable them still need the enable flow to rebuild their Thunderbird
      // resources and folder list, so they heal on the first authentication
      // after an upgrade.
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

ui.setManagerRpcHandler(
  "deleteAccount",
  async ({ accountId, purgeTargets = true }) => {
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
        // Rows first, targets second - see the disconnect handler: clearing
        // the rows unhooks the changelog watcher before the deletions fire
        // their cascade of events. `purgeTargets` is the host's decision
        // now; the provider never deletes targets in any flow.
        await folders.clearAccount(accountId);
        if (purgeTargets !== false) {
          await deleteTargetsBestEffort(rows);
        }
        await accounts.remove(accountId);
      });
    } finally {
      // The abort marked the account cancelling; release it even though the
      // record is gone - the set must not collect ids forever.
      endAccountCancel(accountId);
    }
    ui.broadcast({ type: "folders-changed", accountId });
    return null;
  },
);

ui.setManagerRpcHandler("setAccountEnabled", async ({ accountId, enabled }) => {
  const acc = await accounts.get(accountId);
  if (!acc) return null;
  // Disconnecting skips the upgrade guard and every transient lock - a
  // sync that will not end is exactly when it is needed, and the host
  // aborts it and deletes the resources itself. Both directions do require
  // the provider's port: disconnect is a configuration change the provider
  // participates in (stop, clean its own state), not the last-resort exit.
  // That is Remove, which refuses nothing - including a dead provider.
  if (enabled) assertNotUpgrading(accountId);
  if (!router.isProviderConnected(acc.provider)) {
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
      if (!selected) {
        // The provider has unhooked and cleared its per-folder state above;
        // deleting the resource itself is the host's job in every flow. The
        // row captured before the RPC still carries the target, because the
        // provider no longer clears binding fields it will not need - and
        // even if it did, `folder` predates the call.
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
            changelog: [],
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
// Block every account the legacy importer left half-converted, before any
// provider can announce itself. `ensureSchema` is where the import runs, so
// rows it just produced are already readable here, and seeding the same set
// the upgrade lock uses means the existing gates - `assertNotUpgrading`, the
// autosync tick, the action menu, the manager's "upgrading" row - all cover
// this case without knowing about it. Sequencing this ahead of
// `registry.init` is what closes the window: no port can open, so no sync
// can start against a flagged account before the flag takes effect.
for (const acc of await accounts.list()) {
  if (acc.legacyMigrationPending) upgradeAccounts.add(acc.accountId);
}
ui.init();
actionBadge.init();
await actionBadge.refresh();
await changelogWatcher.init();
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
