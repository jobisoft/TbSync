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
import * as consoleTail from "./modules/console-tail.mjs";
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
import {
  LEGACY_DIR,
  runIfNeeded as runLegacyMigration,
} from "./modules/legacy-migration-runner.mjs";
import {
  backupFiles,
  contentLines,
  effectiveOp,
  diffLines,
  displayNameOf,
  easServerIdOf,
  groupVCardToList,
  isGroup,
  listToGroupVCard,
  parseLegacyChangelog,
  resolveTarget,
  stripIdentity,
  transplantIdentity,
} from "./modules/legacy-rescue.mjs";
import {
  addMailingListMember,
  createContact,
  createMailingList,
  deleteContact,
  listContacts,
  listMailingListMembers,
  listMailingLists,
  updateContact,
} from "./vendor/tbsync/address-book.mjs";
import {
  createItem,
  deleteItem,
  listItems,
  updateItem,
} from "./vendor/tbsync/calendar.mjs";
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


// ── Migrating a carried-over account ───────────────────────────────────────

/** Accounts being migrated right now.
 *
 *  The only guard this needs. Everything else is already held off by the
 *  lock itself - syncing, folder changes, disconnecting are all refused
 *  while it stands - so the one thing left to prevent is a second run of
 *  the migration, which is the one flow the lock lets through. */
const migratingAccounts = new Set();

/** Read the current contents of a folder, keyed by the id the server knows
 *  each item by. What the replay looks an edit up in. */
async function currentByServerId(row) {
  const byServerId = new Map();
  const nodes =
    row.targetType === "contacts"
      ? await listContacts(row.targetID)
      : await listItems(row.targetID);
  for (const node of nodes) {
    const stamp = easServerIdOf(node, null);
    if (stamp) byServerId.set(stamp, node);
  }
  return byServerId;
}

/** What the replay would do, before anybody is asked.
 *
 *  Every kept entry, said in terms of what will happen to the resource it
 *  belongs to. An edit whose item the fresh pull did not bring back is
 *  described but cannot be taken: the server no longer has it, so there is
 *  nothing to change and re-creating it would resurrect what somebody else
 *  deleted. */
async function describeLegacyReplay(accountId) {
  const stored = await browser.storage.local.get({ [KEYS.LEGACY_RESCUE]: {} });
  const rescue = (stored[KEYS.LEGACY_RESCUE] ?? {})[accountId];
  const folders_ = [];

  for (const held of rescue?.folders ?? []) {
    const row = await folders.get(accountId, held.folderId);
    if (!row?.targetID) continue;
    const byServerId = await currentByServerId(row);
    const rows = [];
    for (const entry of held.items ?? []) {
      // Carried for the backup's sake, owed to nobody.
      if (entry.op === "context") continue;
      const current = entry.serverId ? byServerId.get(entry.serverId) : null;
      // What it can still do rather than what it was: an edit whose item
      // the server no longer has goes back as a creation.
      const op = effectiveOp(entry, byServerId);
      const available = op !== null;
      // What the change would do, so the answer is not given on a count
      // alone. A creation is shown as what it is; a change against what the
      // item says now, so the user can see which version they are choosing;
      // a deletion as what would go.
      const now = contentLines(current?.vCard ?? current?.item);
      const kept = contentLines(entry.data);
      rows.push({
        rescueId: entry.rescueId,
        op,
        // What kind of thing it is. Taken from the folder row, which by now
        // the provider has corrected - the same reason it was never stored
        // beside the entry.
        // A list says what it is in its own data; everything else is
        // whatever its folder holds.
        type: isGroup(entry.data) ? "list" : row.targetType,
        available,
        name:
          displayNameOf(entry.data) ||
          displayNameOf(current?.vCard ?? current?.item) ||
          "",
        detail:
          op === "deleted"
            ? diffLines(now, [])
            : op === "added"
              ? diffLines([], kept)
              : diffLines(now, kept),
      });
    }
    if (rows.length) {
      folders_.push({ folderId: row.folderId, name: row.displayName, rows });
    }
  }
  return { folders: folders_ };
}

/** Rebuild every selected folder of a carried-over account from the server.
 *
 *  Per folder: let go of the local resource, take it again, and pull it in
 *  full. Letting go deletes the resource and returns the provider's own
 *  per-folder state to nothing; taking it again builds a fresh one; and
 *  because the provider's sync key went back with it, the pull that follows
 *  is a complete one without anybody having to ask for that.
 *
 *  The row survives all of it, with the id this account's record refers to
 *  it by - which is what lets the whole thing happen in place, with the
 *  account never leaving the locked state that is keeping everyone else
 *  out. */
async function rebuildCarriedOverFolders(acc, report) {
  const rows = (await folders.listForAccount(acc.accountId)).filter(
    (row) => row.selected && row.targetID,
  );
  for (const row of rows) {
    report({ folder: row.displayName, step: "replacing" });
    // A restart part-way through would have found these already rebuilt and
    // frozen them with the rest; nothing can be written to a resource in
    // that state.
    await thawLegacyTargets(acc.accountId).catch(() => {});
    await selectFolder(acc, row.folderId, false);
    await selectFolder(acc, row.folderId, true);
    report({ folder: row.displayName, step: "syncing" });
    await syncAccount(acc.accountId, {
      syncList: false,
      only: row.folderId,
      carriedOverMigration: true,
    });
  }
}

/** Write one kept edit back. Returns the id it was written as, if it made
 *  one - a list needs that to point at a card this run has just created. */
async function replayOne(row, entry, byServerId) {
  const isBook = row.targetType === "contacts";
  const op = effectiveOp(entry, byServerId);
  if (!op) return null;

  if (op === "added") {
    // No identity, whether this was always a creation or has become one:
    // a UID naming a resource that is gone, and a ServerId either never
    // issued or since retired. A card gets a fresh one from Thunderbird,
    // the calendar API wants one up front, so one is minted here.
    const data = stripIdentity(entry.data);
    let id;
    if (isBook) {
      id = await createContact(row.targetID, data);
    } else {
      id = crypto.randomUUID();
      await createItem(row.targetID, {
        id,
        type: row.targetType === "tasks" ? "task" : "event",
        ical: data.replace(
          /^(BEGIN:(?:VEVENT|VTODO))$/im,
          `$1\r\nUID:${id}`,
        ),
      });
    }
    // A change that became a creation is still what anything naming that
    // ServerId meant - a mailing list holding the card, say - so the entry
    // now standing for it is the one just written.
    if (entry.serverId) byServerId.set(entry.serverId, { id });
    return id;
  }

  const current = byServerId.get(entry.serverId);

  if (op === "deleted") {
    if (isBook) await deleteContact(current.id);
    else await deleteItem(row.targetID, current.id);
    return null;
  }

  const merged = transplantIdentity({
    from: current.vCard ?? current.item,
    into: entry.data,
  });
  if (isBook) await updateContact(current.id, merged);
  else await updateItem(row.targetID, current.id, { ical: merged });
  return current.id;
}

/** Put the mailing lists back.
 *
 *  Last, once every taken edit has been written, so the cards a list names
 *  are there to be found. A member says which kind of name it is using: one
 *  the server knows, or one of this record's own entries - and that second
 *  kind is why the ids the replay handed out are kept as it goes. */
async function restoreMailingLists(row, held, createdIds, byServerId, wanted) {
  let restored = 0;
  for (const entry of held.items ?? []) {
    const list = groupVCardToList(entry.data);
    if (!list || !wanted.has(entry.rescueId)) continue;
    try {
      const listId = await createMailingList(row.targetID, {
        name: list.name || "?",
        nickName: list.nickName,
        description: list.description,
      });
      for (const member of list.members) {
        const contactId = member.serverId
          ? byServerId.get(member.serverId)?.id
          : createdIds.get(member.rescueId);
        if (!contactId) continue;
        await addMailingListMember(listId, contactId).catch(() => {});
      }
      restored++;
    } catch (err) {
      console.debug("[tbsync] restoring a mailing list failed:", err?.message ?? err);
    }
  }
  return restored;
}

/** Write back the edits the user chose, then let the account go. */
async function applyLegacyReplay(accountId, taken) {
  const wanted = new Set(taken ?? []);
  const stored = await browser.storage.local.get({ [KEYS.LEGACY_RESCUE]: {} });
  const rescue = (stored[KEYS.LEGACY_RESCUE] ?? {})[accountId];
  const createdIds = new Map();
  let applied = 0;
  let failed = 0;
  let lists = 0;

  for (const held of rescue?.folders ?? []) {
    const row = await folders.get(accountId, held.folderId);
    if (!row?.targetID) {
      // Its resource is gone, so there is nowhere to put these back and the
      // lock is about to be lifted over them. Counted and named rather than
      // passed over, because this is the one way a rescued change can be
      // lost without anybody being told.
      const owed = (held.items ?? []).filter(
        (e) => e.op !== "context",
      ).length;
      if (owed) {
        failed += owed;
        await eventLog
          .append({
            accountId,
            folderId: held.folderId,
            level: "warning",
            message:
              `${owed} rescued change(s) could not be offered or restored: ` +
              `the folder they belong to no longer has a calendar or ` +
              `address book.`,
          })
          .catch(() => {});
      }
      continue;
    }
    const byServerId = await currentByServerId(row);

    for (const entry of held.items ?? []) {
      if (entry.op === "context") continue;
      if (isGroup(entry.data) || !wanted.has(entry.rescueId)) continue;
      // A deletion of something the server has already dropped asks for
      // nothing, so it is not one of the changes reported as put back.
      if (!effectiveOp(entry, byServerId)) continue;
      try {
        const id = await replayOne(row, entry, byServerId);
        if (id) createdIds.set(entry.rescueId, id);
        applied++;
      } catch (err) {
        // One item that will not go back must not strand the rest, nor the
        // account: it has no second way out.
        failed++;
        await eventLog
          .append({
            accountId,
            folderId: held.folderId,
            level: "warning",
            message: `Could not restore a rescued change: ${err?.message ?? err}`,
          })
          .catch(() => {});
      }
    }
    lists += await restoreMailingLists(row, held, createdIds, byServerId, wanted);
  }

  await eventLog.append({
    accountId,
    folderId: null,
    level: "info",
    message:
      `Restored ${applied} rescued change(s)` +
      (lists ? ` and ${lists} mailing list(s)` : "") +
      (failed ? `; ${failed} could not be written` : "") +
      `. They are waiting to be synchronized, as they were.`,
  });
  await liftLegacyLock(accountId);
  ui.broadcast({ type: "accounts-changed", accountId });
  ui.broadcast({ type: "folders-changed", accountId });
  return { applied, failed, lists };
}

// ── Manager popup → background RPC handlers ────────────────────────────────

ui.setManagerRpcHandler("getState", async () => {
  const [accountList, needsSync, live, rescues] = await Promise.all([
    accounts.list(),
    folders.needsSyncMap(),
    providers.list(),
    browser.storage.local.get({ [KEYS.LEGACY_RESCUE]: {} }),
  ]);
  const heldFor = rescues[KEYS.LEGACY_RESCUE] ?? {};
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
      // How much a previous version left this account holding. Nothing but
      // a number: it decides which of the two ways out the manager offers,
      // and says how much is waiting when that way is the migration.
      legacyHeld: countHeld(heldFor[a.accountId]),
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

/** The window that offers the migration, and the three things it asks for.
 *
 *  Opened from here rather than by the manager so a second one cannot be
 *  put up for the same account: the migration is not something to have two
 *  of. */
const migrationWindows = new Map();

ui.setManagerRpcHandler("openMigrationDialog", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) throw new Error("unknown account");
  const open = migrationWindows.get(accountId);
  if (open != null) {
    await browser.windows.update(open, { focused: true }).catch(() => {});
    return null;
  }
  const url = new URL(
    browser.runtime.getURL("dialogs/legacy-migration/migration.html"),
  );
  url.searchParams.set("accountId", accountId);
  const win = await browser.windows.create({
    url: url.toString(),
    type: "popup",
    width: 720,
    height: 560,
  });
  migrationWindows.set(accountId, win.id);
  const onRemoved = (windowId) => {
    if (windowId !== win.id) return;
    browser.windows.onRemoved.removeListener(onRemoved);
    migrationWindows.delete(accountId);
  };
  browser.windows.onRemoved.addListener(onRemoved);
  return null;
});

ui.setManagerRpcHandler("getMigrationOffer", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) throw new Error("unknown account");
  const stored = await browser.storage.local.get({ [KEYS.LEGACY_RESCUE]: {} });
  const rescue = (stored[KEYS.LEGACY_RESCUE] ?? {})[accountId];
  let changes = 0;
  for (const folder of rescue?.folders ?? []) {
    for (const entry of folder.items ?? []) {
      if (entry.op !== "context") changes++;
    }
  }
  return { accountName: acc.accountName, changes };
});

/** Rebuild the account, then say what is left to decide.
 *
 *  One call: the rebuild has to finish before the list means anything, and
 *  the window has nothing to ask in between. Progress arrives as events
 *  while it runs. */
ui.setManagerRpcHandler("startMigration", async ({ accountId }) => {
  const acc = await accounts.get(accountId);
  if (!acc) throw new Error("unknown account");
  if (!acc.legacyImported) throw new Error("account is not carried over");
  if (migratingAccounts.has(accountId)) {
    throw withCode(new Error("Migration already running"), "E:BUSY");
  }
  if (!router.isProviderConnected(acc.provider)) {
    throw withCode(
      new Error("Provider not available"),
      ERR.PROVIDER_UNAVAILABLE,
    );
  }
  migratingAccounts.add(accountId);
  ui.broadcast({ type: "accounts-changed", accountId });
  try {
    // The provider's own step, before a single folder is touched: whatever
    // it keeps for this account that a carried-over profile left wrong is
    // put right while the resources are about to be replaced anyway, so
    // the rebuild's own pull runs under the corrected settings. Optional,
    // and a provider that fails it does not cost the user the rebuild.
    try {
      await router.sendCmd(acc.provider, HOST_CMD.MIGRATE_LEGACY_ACCOUNT, {
        accountId,
      });
    } catch (err) {
      await eventLog.append({
        accountId,
        folderId: null,
        level: "warning",
        message: `The provider could not migrate its own settings for this account: ${err?.message ?? err}`,
      });
    }

    await rebuildCarriedOverFolders(acc, (progress) =>
      ui.broadcast({ type: "migration-progress", accountId, ...progress }),
    );
    return await describeLegacyReplay(accountId);
  } finally {
    migratingAccounts.delete(accountId);
    ui.broadcast({ type: "accounts-changed", accountId });
  }
});

ui.setManagerRpcHandler("applyMigration", async ({ accountId, take }) => {
  const acc = await accounts.get(accountId);
  if (!acc) throw new Error("unknown account");
  if (migratingAccounts.has(accountId)) {
    throw withCode(new Error("Migration already running"), "E:BUSY");
  }
  migratingAccounts.add(accountId);
  try {
    return await applyLegacyReplay(accountId, take);
  } finally {
    migratingAccounts.delete(accountId);
  }
});

/** The rescued changes as files somebody can import, one per resource.
 *
 *  A backup is for reading elsewhere: what comes out is ordinary vCard and
 *  iCalendar, named after the resource it came from, with this
 *  installation's own marks taken off. The window puts them in an archive
 *  and hands it over. */
ui.setManagerRpcHandler("getRescueBackup", async ({ accountId }) => {
  const stored = await browser.storage.local.get({ [KEYS.LEGACY_RESCUE]: {} });
  const rescue = (stored[KEYS.LEGACY_RESCUE] ?? {})[accountId];
  if (!rescue) return { files: [] };
  const info = new Map();
  for (const row of await folders.listForAccount(accountId)) {
    info.set(row.folderId, { name: row.displayName, type: row.targetType });
  }
  return { files: backupFiles(rescue, info) };
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
      await dropLegacyRescue(accountId);
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
  // The teardown deletes the account's calendars and address books, and
  // while this flag stands they hold something no server can give back -
  // either edits a previous version never sent, or the fact that nobody has
  // looked yet. One term, and this does not ask why it is set. Refused here
  // as well as in the manager because a second window, a stale render or
  // the bridge reach this directly. Removing the account is still allowed,
  // and still deletes them - that one is the user saying so.
  if (!enabled && acc.legacyReplayPending) {
    throw new Error("Account still holds changes a previous version made");
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
      });
      if (!enabled) {
        // A disconnect ends the account's carried-over life: everything the
        // conversion brought is deleted below, and reconnecting rebuilds it
        // from the server. That is one of the two ways the lock comes off,
        // and it goes through the same function as the other so neither can
        // leave part of it standing.
        //
        // Only for an account that is actually carrying one. Every other
        // disconnect has nothing to lift, and a resource this add-on never
        // froze is not ours to make writable on the way out.
        if (acc.legacyImported || acc.legacyReplayPending) {
          await liftLegacyLock(accountId);
        }
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
    await selectFolder(acc, folderId, selected);
    return null;
  },
);

/** Bind or unbind one folder: the provider is told, the local resource is
 *  created or deleted, and the row is left describing what happened.
 *
 *  Separate from the RPC above because the migration drives the same steps
 *  while that RPC is refusing everybody - the account is locked precisely
 *  so that nothing *else* can do this, and the migration is the one thing
 *  that may. The guards belong to the caller; this is the work.
 */
async function selectFolder(acc, folderId, selected) {
  const accountId = acc.accountId;
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
}


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
 *  `liftLegacyLock` takes these flags off again, for both ways out of the
 *  lock - the disconnect, which deletes the resources in the same handler,
 *  and a finished migration, which keeps them. The flag blocks neither,
 *  since a whole book is removed through the address book manager rather
 *  than through the directory. */
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

/** How many entries a rescue holds. Derived, never stored: a tally of the
 *  record is not a fact about it. */
function countHeld(rescue) {
  let n = 0;
  for (const folder of rescue?.folders ?? []) {
    for (const entry of folder.items ?? []) {
      if (entry.op !== "context") n++;
    }
  }
  return n;
}

/** Every mailing list in a book, as an entry of its own.
 *
 *  Neither this version nor the previous one syncs a list - ActiveSync has
 *  no such thing - so a list exists only in the book it is in. The rebuild
 *  deletes that book, and no server can give the list back: unlike every
 *  other thing in there, it is gone for good. So all of them are kept, not
 *  only the ones somebody edited, and put back afterwards.
 *
 *  A member names itself by what will identify it once the book has been
 *  rebuilt. A card the server holds comes back carrying the same stamp, so
 *  that is the name. A card the previous version never sent has no name on
 *  the server at all; it is one of the entries this record is about to have
 *  re-created, so it is named by that entry.
 *
 *  Best effort, like everything else here: a list that cannot be read is
 *  one list lost, not a rescue abandoned. */
async function rescueMailingLists(bookId, properties, resolved, mintId) {
  const out = [];
  // What the record already accounts for, so a member that is also an edit
  // is not carried twice.
  const known = new Set();
  for (const item of resolved.items) if (item.serverId) known.add(item.serverId);
  for (const id of resolved.createdBy.keys()) known.add(id);

  let lists = [];
  try {
    lists = await listMailingLists(bookId);
  } catch (err) {
    console.debug(
      `[tbsync] reading the mailing lists of ${bookId} failed:`,
      err?.message ?? err,
    );
    return out;
  }

  for (const list of lists) {
    try {
      const members = [];
      for (const card of await listMailingListMembers(list.id)) {
        const stamp = easServerIdOf(card, properties);
        if (!stamp) continue;
        const rescueId = resolved.createdBy.get(stamp);
        members.push(rescueId ? { rescueId } : { serverId: stamp });
        // A member the record would otherwise not hold - a card the server
        // has, which nobody edited. It is not owed to anyone and is never
        // replayed; it is here so that a list in the backup can name its
        // members and be a list rather than a title.
        if (!known.has(stamp)) {
          known.add(stamp);
          out.push({
            rescueId: mintId(),
            op: "context",
            serverId: stamp,
            data: card.vCard ?? card.properties?.vCard ?? null,
          });
        }
      }
      out.push({
        rescueId: mintId(),
        op: "added",
        serverId: null,
        data: listToGroupVCard({
          name: list.name,
          nickName: list.nickName,
          description: list.description,
          members,
        }),
      });
    } catch (err) {
      console.debug(
        `[tbsync] reading the mailing list ${list?.id} failed:`,
        err?.message ?? err,
      );
    }
  }
  return out;
}

/** Let a locked account's resources accept edits again.
 *
 *  The mirror of the freeze, and it exists because the freeze runs at every
 *  boot: a restart in the middle of a migration would find the *rebuilt*
 *  resources and make those read-only too, and nothing would ever write to
 *  them again. Whatever is bound to the account when the lock lifts is
 *  released, without asking how it came to be frozen. */
async function thawLegacyTargets(accountId) {
  for (const row of await folders.listForAccount(accountId)) {
    if (!row?.targetID) continue;
    try {
      if (row.targetType === "contacts") {
        await browser.LegacyData.setAddressBookReadOnly(row.targetID, false);
      } else if (row.targetType === "calendars" || row.targetType === "tasks") {
        await messenger.calendar.calendars.update(row.targetID, {
          readOnly: false,
        });
      }
    } catch (err) {
      console.debug(
        `[tbsync] releasing ${row.targetID} (${row.targetType}) failed:`,
        err?.message ?? err,
      );
    }
  }
}

/** Read out the edits a previous version queued and never sent.
 *
 *  The account is locked and its resources are frozen, so what they hold is
 *  what that version left behind. Anything it had not pushed lives nowhere
 *  else - the server does not have it - and a later step offers it back
 *  once the resources have been rebuilt.
 *
 *  Written once. A rescue already stored is left alone, so this cannot
 *  overwrite a record of edits with a reading taken after something has
 *  already consumed them.
 *
 *  Best effort throughout, and deliberately silent about a resource it
 *  cannot read: the account is still locked afterwards, and a rescue that
 *  stops the boot would strand every other account too.
 *
 *  What is stored is the edits themselves and where they came from, and
 *  nothing that could be worked out from them. Each edit is its operation,
 *  the server's own id for it - null when the server never had it - and the
 *  item's text exactly as it stands. Its UID and whether it is a card, an
 *  event or a task are all in that text already, and the folder it belongs
 *  to is the row it is filed under, so none of them is copied out to fall
 *  out of step later.
 */
async function rescueLegacyEdits(accountId) {
  const stored = await browser.storage.local.get({ [KEYS.LEGACY_RESCUE]: {} });
  const all = stored[KEYS.LEGACY_RESCUE] ?? {};
  if (all[accountId]) return;

  const path = `${LEGACY_DIR}/changelog68.json`;
  if (!(await browser.ProfileFiles.exists(LEGACY_DIR))) return;
  if (!(await browser.ProfileFiles.exists(path))) return;

  const parsed = parseLegacyChangelog(
    await browser.ProfileFiles.readJSON(path),
  );
  if (!parsed) return;

  // For the log line only - a tally of what was stored, so it is not
  // stored beside it. Counted from what THIS account resolved rather than
  // from the parse: one changelog covers every account the previous version
  // had, and its own totals would credit each account with the others'.
  const counts = { added: 0, modified: 0, deleted: 0 };
  const rescued = [];
  // Entry ids run across the whole account, not per folder: a list names a
  // member by one, and nothing should have to say which folder it meant.
  let minted = 0;
  const mintId = () => `r${++minted}`;

  for (const row of await folders.listForAccount(accountId)) {
    // The changelog names a resource by the id the previous version bound
    // it to, which the import lifted into `targetID`.
    const bucket = parsed.targets[row?.targetID];
    if (!bucket) continue;

    let nodes = [];
    let properties = null;
    try {
      if (row.targetType === "contacts") {
        nodes = await listContacts(row.targetID);
        // The stamp identifying a card to its provider is a card property,
        // which the contacts API does not return.
        properties = await browser.LegacyData.readCardProperties(row.targetID);
      } else if (row.targetType === "calendars" || row.targetType === "tasks") {
        nodes = await listItems(row.targetID);
      }
    } catch (err) {
      console.debug(
        `[tbsync] reading ${row.targetID} (${row.targetType}) for rescue failed:`,
        err?.message ?? err,
      );
    }

    const resolved = resolveTarget(bucket, nodes, properties, mintId);
    const items = resolved.items;
    if (row.targetType === "contacts") {
      items.push(
        ...(await rescueMailingLists(row.targetID, properties, resolved, mintId)),
      );
    }
    if (!items.length) continue;
    for (const item of items) counts[item.op]++;
    rescued.push({
      // The folder row, not a copy of what it says. This runs before the
      // provider has converted its own half of the import, and one of the
      // things still uncorrected is `targetType`: the previous version used
      // Lightning's single "calendar" for both calendars and task lists, so
      // a task list reads as "calendars" until the provider re-derives it.
      // Reading and freezing do not care - both go through the calendar API
      // - but recording it here would file a task as an event for whatever
      // reads this later. The row keeps its id, so the type can be had from
      // it correctly whenever it is actually needed.
      folderId: row.folderId,
      legacyTargetId: row.targetID,
      items,
    });
  }

  // One write, at the end: a crash part-way leaves nothing rather than a
  // fragment that would be mistaken for a complete reading and never
  // retried.
  all[accountId] = { capturedAt: Date.now(), folders: rescued };
  await serialize(() =>
    browser.storage.local.set({ [KEYS.LEGACY_RESCUE]: all }),
  );

  const kept = counts.added + counts.modified + counts.deleted;
  if (!kept) {
    // Nothing was owed. The account is still locked and still cannot sync,
    // but there is nothing here a teardown could destroy, so the hold on
    // the disconnect comes off and the old remedy - disconnect, reconnect,
    // rebuild from the server - is the way out again.
    await accounts.update(accountId, { legacyReplayPending: false });
    ui.broadcast({ type: "accounts-changed", accountId });
    return;
  }
  await eventLog.append({
    accountId,
    folderId: null,
    level: "info",
    message:
      `Rescued ${kept} change(s) a previous version never sent ` +
      `(${counts.added} added, ${counts.modified} modified, ` +
      `${counts.deleted} deleted).`,
  });
  ui.broadcast({ type: "accounts-changed", accountId });
}

/** Let a carried-over account go: it can sync again, nothing holds its
 *  disconnect, and what was kept for it is released.
 *
 *  The one way the lock comes off, whichever route the user took to it -
 *  disconnecting, or finishing the migration. Everything the lock put in
 *  place is undone here, so no route can undo half of it: the two flags go
 *  together, the kept edits go with them, and the resources are writable
 *  again. A rescue outliving its account's lock would be a record nothing
 *  can ever offer, and a resource left read-only would be a lock nobody
 *  can lift. */
async function liftLegacyLock(accountId) {
  await thawLegacyTargets(accountId).catch((err) =>
    console.warn("[tbsync] releasing legacy resources failed:", err),
  );
  await accounts.update(accountId, {
    legacyImported: false,
    legacyReplayPending: false,
  });
  await dropLegacyRescue(accountId);
}

/** Forget an account's rescue. Removing the account is the only way a
 *  locked one goes away, so this is the only path that can orphan one. */
async function dropLegacyRescue(accountId) {
  const stored = await browser.storage.local.get({ [KEYS.LEGACY_RESCUE]: {} });
  const all = stored[KEYS.LEGACY_RESCUE] ?? {};
  if (!all[accountId]) return;
  delete all[accountId];
  await serialize(() =>
    browser.storage.local.set({ [KEYS.LEGACY_RESCUE]: all }),
  );
}

// ── Boot ───────────────────────────────────────────────────────────────────

// First, and before anything can fail. Two errors below are the host's own
// and never travel through a provider call - an incompatible provider
// (`registry.mjs`) and a legacy migration that threw
// (`legacy-migration-runner.mjs`) - so this is the only "before" they have.
// It has to precede `ensureSchema`, which is where the import runs: a mark
// taken after it would miss the very failure it exists to explain. Taking it
// here also starts the capture at the earliest moment there is, so what
// follows is recorded as it happens rather than reconstructed afterwards
// from whatever the platform still had in its own backlog.
await consoleTail.markBoot();

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
  if (acc.legacyImported) {
    // Freeze first: the rescue reads these resources, and nothing may edit
    // them while it does.
    await freezeLegacyTargets(acc.accountId).catch((err) =>
      console.warn("[tbsync] freezing legacy resources failed:", err),
    );
    await rescueLegacyEdits(acc.accountId).catch((err) =>
      console.warn("[tbsync] rescuing legacy edits failed:", err),
    );
  }
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
