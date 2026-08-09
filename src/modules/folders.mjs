import { KEYS } from "./storage-keys.mjs";
import { serialize } from "../vendor/tbsync/storage-queue.mjs";
import {
  isUserEntry,
  markServerWriteUpdater,
  moveToTailUpdater,
  providerOwnsChanges,
  recordUserEditUpdater,
  removeEntryUpdater,
} from "../vendor/tbsync/changelog-core.mjs";

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

/** `{ [accountId]: true }` for every account that has at least one
 *  selected folder carrying a pending user-side change - i.e. local edits
 *  that haven't been pushed to the server yet. The manager surfaces these
 *  as a "needs sync" status without needing to load each account's folders
 *  client-side. Read-only folders never accumulate user-side entries (the
 *  watcher skips them), so the `_by_user` filter implicitly handles that.
 *
 *  Where the provider owns the changes, the queue is not here to count, so
 *  the count comes to us: the provider keeps `custom.pendingUserChanges`
 *  roughly current as it queues and drains. Roughly is the right word and
 *  the accepted cost - this drives a badge, and the alternative is asking
 *  every provider over RPC to paint an icon. A stale count shows or hides
 *  a dot; nothing reads it to decide what to sync. */
export async function needsSyncMap() {
  const state = await read();
  const out = {};
  for (const [accountId, bucket] of Object.entries(state)) {
    out[accountId] = Object.values(bucket).some((f) => {
      if (!f.selected) return false;
      if (providerOwnsChanges(f.targetType)) {
        return Number(f.custom?.pendingUserChanges ?? 0) > 0;
      }
      return (
        Array.isArray(f.changelog) &&
        f.changelog.some(
          (e) => typeof e?.status === "string" && isUserEntry(e.status),
        )
      );
    });
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
        // Host-owned per-folder change queue. Authored by the address-book
        // observer (changelog-watcher.mjs); consumed by the provider at sync
        // time. Entry shape: `{ parentId, itemId, timestamp, status }`.
        // Preserved across folder-list pushes so a re-push doesn't wipe
        // pending entries. Stays empty where the provider owns the changes.
        changelog: prior?.changelog ?? [],
        // This binding's generation - see the Sessions block above. Kept
        // like the changelog: a re-push is the provider re-describing the
        // same folders, not the user tearing one down.
        sessionId: prior?.sessionId ?? newSession(),
        // Host-owned contact-content hashes used by the watcher to suppress
        // TB ghost onUpdated events (PopularityIndex, address-picker
        // recency markers). Map shape: `{ [contactId]: sha1Hex }`.
        // Preserved across folder-list pushes.
        contactHashes: prior?.contactHashes ?? {},
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

export function update(accountId, folderId, patch) {
  return serialize(async () => {
    const state = await read();
    if (!state[accountId]?.[folderId]) return null;
    state[accountId][folderId] = { ...state[accountId][folderId], ...patch };
    await write(state);
    return state[accountId][folderId];
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

// ── Changelog helpers ─────────────────────────────────────────────────────
//
// The changelog lives at `folder.changelog`. These helpers are atomic at the
// storage-blob level (single read-modify-write per call) so concurrent
// watcher events + RPC mutations don't step on each other. Callers pass an
// `updater(entries)` that returns the new entries array.

/** Generic read-modify-write helper for `folder.changelog`. The updater
 *  receives the current entries array and returns the new one. Returning
 *  the same reference short-circuits the write (no storage churn, no
 *  broadcast). Used by both the host-side watcher (for state machine
 *  transitions) and the provider-facing RPCs below. */
export function mutateChangelog(accountId, folderId, updater) {
  return serialize(async () => {
    const state = await read();
    const folder = state[accountId]?.[folderId];
    if (!folder) return null;
    const before = Array.isArray(folder.changelog) ? folder.changelog : [];
    const after = updater(before) ?? before;
    if (after === before) return before;
    folder.changelog = after;
    state[accountId][folderId] = folder;
    await write(state);
    return after;
  });
}

// The four mutations below are the host's storage-bound wrappers around the
// vendored core's pure updaters. The rules - which status follows which op,
// what a pre-tag replaces, what a removal is allowed to touch - live in
// `changelog-core.mjs` and are the same rules a provider keeping its own
// queue runs. Only the read-modify-write around them is ours.

/**
 * Record a user edit a provider was handed directly, folding it into
 * whatever is already queued for that item.
 *
 * `detail` is opaque to the host - for calendars it carries what the item
 * looked like *before* the edit, which is the only thing the provider
 * cannot re-derive at push time.
 *
 * Returns whether the queue actually moved. The caller broadcasts on that
 * rather than on every call: a second edit of an already-queued item is a
 * no-op, and a bulk change would otherwise fire one folders-changed per
 * item - the same UI thrash the observer path documents avoiding.
 */
export async function recordUserEdit(
  accountId,
  folderId,
  { parentId, itemId, kind, op, detail },
) {
  let changed = false;
  await mutateChangelog(accountId, folderId, (entries) => {
    const result = recordUserEditUpdater(entries, {
      parentId,
      itemId,
      kind,
      op,
      detail,
      now: Date.now(),
    });
    changed = result.changed;
    return result.entries;
  });
  return changed;
}

/** Replace any existing row for the triple with a server-side pre-tag. Used
 *  by PROVIDER_CMD.CHANGELOG_MARK_SERVER_WRITE to freeze the next observer
 *  event for that item as self-inflicted. */
export async function markServerWrite(
  accountId,
  folderId,
  { parentId, itemId, status, kind },
) {
  return mutateChangelog(accountId, folderId, (entries) =>
    markServerWriteUpdater(entries, {
      parentId,
      itemId,
      kind,
      status,
      now: Date.now(),
    }),
  );
}

/** Remove the queued **user** edit matching `(parentId, itemId, kind)`. Used
 *  by a provider once it has dealt with that edit - pushed it, or
 *  established that it can never be pushed. A `*_by_server` row is left
 *  alone; see the core for why that distinction is load-bearing. */
export async function removeChangelogEntry(
  accountId,
  folderId,
  { parentId, itemId, kind },
) {
  return mutateChangelog(accountId, folderId, (entries) =>
    removeEntryUpdater(entries, { parentId, itemId, kind }),
  );
}

/** Move entries matching any `(parentId, itemId, kind)` in `items` to the
 *  tail of the changelog, preserving their original timestamps and status.
 *  Used by providers after a push partially failed so the next sync attempts
 *  the un-failed items first. */
export async function moveChangelogEntriesToTail(accountId, folderId, items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return mutateChangelog(accountId, folderId, (entries) =>
    moveToTailUpdater(entries, items),
  );
}

/** Generic read-modify-write helper for `folder.contactHashes`. Same
 *  pattern as `mutateChangelog` above. Returning the same reference
 *  short-circuits the write. */
export function mutateContactHashes(accountId, folderId, updater) {
  return serialize(async () => {
    const state = await read();
    const folder = state[accountId]?.[folderId];
    if (!folder) return null;
    const before =
      folder.contactHashes && typeof folder.contactHashes === "object"
        ? folder.contactHashes
        : {};
    const after = updater(before) ?? before;
    if (after === before) return before;
    folder.contactHashes = after;
    state[accountId][folderId] = folder;
    await write(state);
    return after;
  });
}

/** All folder rows that currently have a non-null `targetID`. The watcher
 *  uses this at startup + on every folders-changed broadcast to rebuild
 *  its `bookId → {accountId, folderId}` registry. */
/** The folder bound to `targetID`, or null. Lets a provider report against
 *  the resource it was handed without having to carry an id mapping of its
 *  own - the host owns that table, so it does the lookup. */
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

export async function listWatchedTargets() {
  const state = await read();
  const out = [];
  for (const [accountId, bucket] of Object.entries(state)) {
    for (const folder of Object.values(bucket)) {
      if (folder?.targetID) {
        out.push({
          accountId,
          folderId: folder.folderId,
          targetID: folder.targetID,
          targetType: folder.targetType ?? null,
        });
      }
    }
  }
  return out;
}
