import { KEYS } from "./storage-keys.mjs";
import { serialize } from "./storage-queue.mjs";

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

export async function listForAccount(accountId) {
  const state = await read();
  const bucket = state[accountId] ?? {};
  return Object.values(bucket).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
}

/** `{ [accountId]: true }` for every account that has at least one
 *  selected folder carrying a pending user-side changelog entry -
 *  i.e. local changes that haven't been pushed to the server yet. The
 *  manager surfaces these as a "needs sync" status without needing to
 *  load each account's folders client-side. Read-only folders never
 *  accumulate user-side entries (the watcher skips them), so the
 *  `_by_user` filter implicitly handles that. */
export async function needsSyncMap() {
  const state = await read();
  const out = {};
  for (const [accountId, bucket] of Object.entries(state)) {
    out[accountId] = Object.values(bucket).some(f =>
      f.selected
      && Array.isArray(f.changelog)
      && f.changelog.some(e => typeof e?.status === "string" && e.status.endsWith("_by_user"))
    );
  }
  return out;
}

export async function get(accountId, folderId) {
  const state = await read();
  return state[accountId]?.[folderId] ?? null;
}

export function replaceAccountFolders(accountId, incoming) {
  return serialize(async () => {
    const state = await read();
    const previous = state[accountId] ?? {};
    const next = {};
    incoming.forEach((descriptor, index) => {
      const prior = previous[descriptor.folderId];
      next[descriptor.folderId] = {
        folderId: descriptor.folderId,
        accountId,
        targetType: descriptor.targetType,
        displayName: descriptor.displayName ?? prior?.displayName ?? descriptor.folderId,
        selected: prior?.selected ?? descriptor.selected ?? false,
        readOnly: descriptor.readOnly ?? prior?.readOnly ?? false,
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
        targetID:   "targetID"   in descriptor ? descriptor.targetID   : (prior?.targetID   ?? null),
        targetName: "targetName" in descriptor ? descriptor.targetName : (prior?.targetName ?? null),
        // Host-owned per-folder change queue. Authored by the address-book
        // observer (changelog-watcher.mjs); consumed by the provider at sync
        // time. Entry shape: `{ parentId, itemId, timestamp, status }`.
        // Preserved across folder-list pushes so a re-push doesn't wipe
        // pending entries.
        changelog: prior?.changelog ?? [],
        // Opaque provider-owned blob. Preserved across pushes so a full
        // folder re-push doesn't wipe provider-local per-folder state.
        custom: descriptor.custom ?? prior?.custom ?? {},
      };
    });
    state[accountId] = next;
    await write(state);
    return Object.values(next);
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

/** Replace any existing entry for `(parentId, itemId)` with a server-side
 *  pre-tag. Used by PROVIDER_CMD.CHANGELOG_MARK_SERVER_WRITE to freeze the
 *  next observer event for that item as self-inflicted. `kind` is one of
 *  `"contact"` | `"list"` | `"list-by-name"`:
 *    - `"contact"` / `"list"` : itemId is the TB id; the watcher
 *      exact-matches on `(parentId, kind, itemId)`.
 *    - `"list-by-name"` : itemId is the list NAME. Used by list pull-
 *      creates where the TB id isn't known pre-call; the watcher
 *      matches by name on the next `mailingLists.onCreated` and
 *      upgrades the row to `kind: "list", itemId: <real id>`. */
export async function markServerWrite(accountId, folderId, { parentId, itemId, status, kind }) {
  return mutateChangelog(accountId, folderId, entries => {
    const without = entries.filter(e => !(e.parentId === parentId && e.itemId === itemId));
    without.push({ kind, parentId, itemId, timestamp: Date.now(), status });
    return without;
  });
}

/** Remove the entry matching `(parentId, itemId)`, regardless of status.
 *  Used by provider after successfully pushing a user-entry to the server. */
export async function removeChangelogEntry(accountId, folderId, { parentId, itemId }) {
  return mutateChangelog(accountId, folderId, entries =>
    entries.filter(e => !(e.parentId === parentId && e.itemId === itemId))
  );
}

/** All folder rows that currently have a non-null `targetID`. The watcher
 *  uses this at startup + on every folders-changed broadcast to rebuild
 *  its `bookId → {accountId, folderId}` registry. */
export async function listWatchedTargets() {
  const state = await read();
  const out = [];
  for (const [accountId, bucket] of Object.entries(state)) {
    for (const folder of Object.values(bucket)) {
      if (folder?.targetID) {
        out.push({ accountId, folderId: folder.folderId, targetID: folder.targetID });
      }
    }
  }
  return out;
}
