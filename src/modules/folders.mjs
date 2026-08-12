import { KEYS } from "./storage-keys.mjs";
import { serialize } from "../vendor/tbsync/storage-queue.mjs";

/**
 * Folder directory, backed by browser.storage.local under KEYS.FOLDERS.
 *
 * Shape:
 *   { [accountId]: { [folderId]: FolderRecord } }
 *
 * Providers push authoritative folder lists via `pushFolderList`; TbSync
 * preserves the fields that carry state across pushes (selected, orderIndex,
 * lastSyncTime, warning, error).
 */

async function read() {
  const rv = await browser.storage.local.get({ [KEYS.FOLDERS]: {} });
  return rv[KEYS.FOLDERS];
}

async function write(state) {
  await browser.storage.local.set({ [KEYS.FOLDERS]: state });
}

// ── Sessions ──────────────────────────────────────────────────────────────
//
// A folder row outlives the things hanging off it. It is deselected and
// selected again, its local resource is deleted and re-created, and each
// time the sync state that belonged to the old binding - keys, id maps,
// pending edits - is worthless and dangerous to keep.
//
// The host cannot delete that state itself: most of it lives in the
// provider, and the two flows that end a binding, Disconnect and Remove,
// have to work when the provider is broken or uninstalled - that is what
// makes them recovery paths. So the host does not delete; it renames. Each
// binding gets a `sessionId`, minted here and never reused, and ending a
// binding means minting a new one. A provider stores everything under the
// session it saw and drops what belongs to sessions no row names any more.
// Teardown becomes one local write that needs nobody's cooperation.

/** A fresh, never-before-used binding id. Putting one in a folder patch
 *  ends that folder's current binding: whatever any provider still holds
 *  under the old session is unclaimed from that moment, and goes the next
 *  time that provider looks. The row itself survives - the folder can be
 *  bound again later.
 *
 *  Note what this is not. Nothing is sent, nothing is awaited on the other
 *  side, and a provider that is not running at all misses nothing: it finds
 *  out by not finding its session. */
export function newSession() {
  return crypto.randomUUID();
}

/** Give a session to every row that predates them. Rows written before
 *  sessions existed carry none, and a provider cannot namespace against
 *  `undefined` - it would keep one anonymous bucket per folder and never
 *  learn that a binding ended. Runs once, from the schema migration. */
export function backfillSessionIds() {
  return serialize(async () => {
    const state = await read();
    let stamped = 0;
    for (const bucket of Object.values(state)) {
      for (const folder of Object.values(bucket)) {
        if (folder && !folder.sessionId) {
          folder.sessionId = newSession();
          stamped++;
        }
      }
    }
    if (stamped) await write(state);
    return stamped;
  });
}

export async function listForAccount(accountId) {
  const state = await read();
  const bucket = state[accountId] ?? {};
  return Object.values(bucket).sort(
    (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
  );
}

/** Does this folder have edits waiting to be pushed?
 *
 *  The one place that answers it, for the badge, the toolbar menu and both
 *  of the manager's folder indicators - so they cannot disagree, and so a
 *  reader added later inherits the rule instead of having to remember it.
 *
 *  Unselected is always no. That folder's local resource has been deleted
 *  and its binding retired, so it owes nothing whatever it last reported.
 *
 *  The queue is the provider's, so the count comes to us: each keeps
 *  `localChanges` roughly current as it queues and drains. Roughly is the
 *  right word and the accepted cost - this drives a badge, and the
 *  alternative is asking every provider over RPC to paint an icon. A stale
 *  count shows or hides a dot; nothing reads it to decide what to sync. */
export function hasLocalChanges(folder) {
  return !!folder?.selected && Number(folder.localChanges ?? 0) > 0;
}

/** `{ [accountId]: true }` for every account with at least one folder
 *  holding unpushed local edits, which the manager shows as a "needs sync"
 *  status. */
export async function needsSyncMap() {
  const state = await read();
  const out = {};
  for (const [accountId, bucket] of Object.entries(state)) {
    out[accountId] = Object.values(bucket).some(hasLocalChanges);
  }
  return out;
}

export async function get(accountId, folderId) {
  const state = await read();
  return state[accountId]?.[folderId] ?? null;
}

export function replaceAccountFolders(accountId, incoming) {
  return serialize(async () => {
    // Read both stores up front. The cache lives on the account record (in
    // storage.local under KEYS.ACCOUNTS) so insert + consume below need to
    // mutate it alongside the folders blob. Both writes happen in this one
    // serialize() block to keep them atomic relative to other host writes.
    const state = await read();
    const accountsRv = await browser.storage.local.get({
      [KEYS.ACCOUNTS]: { sequence: 0, data: {} },
    });
    const accountsState = accountsRv[KEYS.ACCOUNTS];
    const accountRecord = accountsState.data[accountId];
    const cache =
      accountRecord && typeof accountRecord.deletedFolderCache === "object"
        ? accountRecord.deletedFolderCache
        : null;

    const previous = state[accountId] ?? {};
    const next = {};
    const restored = [];
    let cacheDirty = false;

    incoming.forEach((descriptor, index) => {
      const prior = previous[descriptor.folderId];
      // Consume the cache for genuinely new folders (no `prior`) whose
      // folderId matches a server-deleted entry. Restoring the cached
      // property bag overrides the seed values for those fields and
      // removes the entry so it isn't re-applied next time.
      const cached =
        !prior && cache && cache[descriptor.folderId]
          ? cache[descriptor.folderId]
          : null;
      if (cached) {
        delete cache[descriptor.folderId];
        cacheDirty = true;
        restored.push(descriptor.folderId);
      }
      next[descriptor.folderId] = {
        folderId: descriptor.folderId,
        accountId,
        targetType: descriptor.targetType,
        displayName:
          descriptor.displayName ?? prior?.displayName ?? descriptor.folderId,
        selected:
          prior?.selected ??
          (cached && "selected" in cached ? cached.selected : undefined) ??
          descriptor.selected ??
          false,
        readOnly: descriptor.readOnly ?? prior?.readOnly ?? false,
        // User override toggled via the manager's ACL icon. Preserved
        // across pushes (the provider's PUSH_FOLDER_LIST does not write
        // it) and restored from the deletedFolderCache so a server-side
        // recreate doesn't lose the user's preference.
        downloadOnly:
          prior?.downloadOnly ??
          (cached && "downloadOnly" in cached ? cached.downloadOnly : false),
        hidden: !!descriptor.hidden,
        // Universal sync-status fields - host-authored from the SYNC_FOLDER
        // RPC outcome and from setFolderSelected. Preserved across
        // folder-list pushes; providers do not write them.
        status: prior?.status ?? null,
        warning: prior?.warning ?? null,
        error: prior?.error ?? null,
        lastSyncTime: prior?.lastSyncTime ?? 0,
        orderIndex: index,
        // Universal top-level fields identifying the local sync target. Null
        // until the first sync binds the row to a Thunderbird artifact.
        targetID:
          "targetID" in descriptor
            ? descriptor.targetID
            : (prior?.targetID ?? null),
        // targetName: prefer prior, then cached restoration, then descriptor.
        targetName:
          "targetName" in descriptor
            ? descriptor.targetName
            : (prior?.targetName ??
              (cached && "targetName" in cached ? cached.targetName : null)),
        // targetColor: the same, for the colour of a bound calendar. Held
        // here rather than provider-side because it outlives the binding -
        // a resource that is disabled and enabled again has to come back
        // looking the way the user left it, and the calendar itself is gone
        // in between. No sync protocol carries it: ActiveSync's folder
        // hierarchy has no colour element in any version, so it is local
        // state or it is nothing.
        targetColor:
          "targetColor" in descriptor
            ? descriptor.targetColor
            : (prior?.targetColor ??
              (cached && "targetColor" in cached ? cached.targetColor : null)),
        // How many edits this folder is holding for the server, as its
        // provider last reported. Preserved across pushes: a re-push is the
        // provider re-describing the same folders, not edits being pushed.
        localChanges: prior?.localChanges ?? 0,
        // This binding's generation - see the Sessions block above. Kept
        // for the same reason: a re-push is not the user tearing a folder
        // down.
        sessionId: prior?.sessionId ?? newSession(),
        // Opaque provider-owned blob. Preserved across pushes so a full
        // folder re-push doesn't wipe provider-local per-folder state.
        custom: descriptor.custom ?? prior?.custom ?? {},
      };
    });

    // Server-side removals: every previously-existing folder that isn't in
    // `incoming`. Two consequences:
    //   1. If the row was selected, cache the user's customisations so they
    //      survive a server-side delete-recreate cycle.
    //   2. Surface the removed targets to the caller so the bound local
    //      Thunderbird resource (book / calendar) can be deleted. Caller
    //      MUST do that *after* this function returns - the watcher's
    //      onDeleted/onRemoved listener checks for row existence and
    //      will exit early because the row is already gone.
    const removedTargets = [];
    for (const [folderId, prior] of Object.entries(previous)) {
      if (next[folderId]) continue;
      if (prior?.targetID) {
        removedTargets.push({
          folderId,
          targetID: prior.targetID,
          targetType: prior.targetType ?? null,
        });
      }
      if (!prior?.selected) continue;
      if (!cache) continue;
      const bag = { selected: true };
      if (typeof prior.targetName === "string" && prior.targetName !== "") {
        bag.targetName = prior.targetName;
      }
      if (typeof prior.targetColor === "string" && prior.targetColor !== "") {
        bag.targetColor = prior.targetColor;
      }
      if (prior.downloadOnly === true) {
        bag.downloadOnly = true;
      }
      cache[folderId] = bag;
      cacheDirty = true;
    }

    state[accountId] = next;
    await write(state);
    if (cacheDirty && accountRecord) {
      accountRecord.deletedFolderCache = cache;
      accountsState.data[accountId] = accountRecord;
      await browser.storage.local.set({ [KEYS.ACCOUNTS]: accountsState });
    }
    return { folders: Object.values(next), restored, removedTargets };
  });
}

/** Patch one folder row. `custom` is shallow-merged rather than replaced,
 *  and the merge happens HERE, inside the lock, against the row as it is
 *  at that moment.
 *
 *  That is the whole point: a caller that read the row, built the merged
 *  `custom` itself and passed it in would be merging against a snapshot
 *  taken before the lock, so a concurrent patch landing in between would
 *  be overwritten wholesale. A provider's per-folder sync state is written
 *  from exactly such a path, on every sync. */
export function update(accountId, folderId, patch) {
  return serialize(async () => {
    const state = await read();
    const row = state[accountId]?.[folderId];
    if (!row) return null;
    const { custom, ...rest } = patch ?? {};
    const merged = { ...row, ...rest };
    if (custom && typeof custom === "object") {
      merged.custom = { ...(row.custom ?? {}), ...custom };
    }
    state[accountId][folderId] = merged;
    await write(state);
    return merged;
  });
}

export function clearAccount(accountId) {
  return serialize(async () => {
    const state = await read();
    if (!state[accountId]) return false;
    delete state[accountId];
    await write(state);
    return true;
  });
}

/** Undo a folder's binding to a local resource that no longer exists.
 *
 *  The row stays, so the folder can be enabled again later; it just stops
 *  pointing at something that is gone, and stops syncing until it is. The
 *  session ends with the binding, which is what makes every provider drop
 *  whatever it still holds for it.
 *
 *  Called by `FOLDER_TARGET_REMOVED`: the provider owns the resources it
 *  supplies and the books it watches, so it is the side that notices. */
export async function clearTarget(accountId, folderId) {
  const row = await get(accountId, folderId);
  if (!row) return false;
  if (row.targetID == null && !row.selected) return false; // already cleared
  await update(accountId, folderId, {
    targetID: null,
    targetName: null,
    selected: false,
    localChanges: 0,
    sessionId: newSession(),
  });
  return true;
}

/** The folder bound to `targetID`, or null. Lets a provider report against
 *  the resource it was handed without carrying an id mapping of its own -
 *  the host owns that table, so it does the lookup. */
export async function getByTarget(targetID) {
  if (!targetID) return null;
  const state = await read();
  for (const [accountId, bucket] of Object.entries(state)) {
    for (const folder of Object.values(bucket)) {
      if (folder?.targetID === targetID) {
        return { accountId, folderId: folder.folderId, folder };
      }
    }
  }
  return null;
}
