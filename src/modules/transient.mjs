/**
 * Transient (in-memory, non-persisted) state shared between the sync
 * coordinator and the background RPC handlers. None of this survives a
 * restart of the host add-on - which is the point: these sets model
 * "something is happening right now", and after a restart nothing is.
 *
 * The manager reads a snapshot through the `getState` RPC and uses these
 * sets as inputs to derived status rendering.
 */

/** Accounts the sync coordinator is currently driving through a sync. */
export const syncingAccounts = new Set();

/** Accounts whose sync is being torn down right now.
 *
 *  Set by `abortAccountSync` before it asks the provider to stop, and read
 *  by the sync loop at every await point so it unwinds instead of carrying
 *  on into the next folder. Cleared when the abort finishes - never in the
 *  sync's own `finally`, which may run long after the abort is over. */
export const cancellingAccounts = new Set();

/** Accounts with a UI-driven RPC (edit, reauth, delete, connect, disconnect)
 *  in flight. Locks action buttons in the manager for these accounts. */
export const busyAccounts = new Set();

/** Folders with a toggle (enable/disable) RPC in flight. Locks the
 *  checkbox + rejects overlapping toggles on the same folder. */
export const busyFolders = new Set();

/** Folder syncs a provider asked for while the account was already syncing,
 *  as `accountId -> Set<folderId>`. Drained when that sync finishes.
 *
 *  A request is deferred rather than dropped because something asked for it on
 *  purpose - a user pressing Reload on a calendar, or the calendar's own
 *  refresh timer firing. Repeats for the same folder collapse into the set, so
 *  five impatient clicks still cost one run. */
export const pendingSyncRequests = new Map();

/** Accounts a provider has declared "upgrading" via SET_PROVIDER_UPGRADE_LOCK.
 *  While in this set, the host refuses every user-initiated RPC against
 *  the account and skips autosync ticks - the provider is treated as
 *  unavailable for the duration of its upgrade work. Cleared when the
 *  provider sends `{locked: false}` (or the provider port closes; see
 *  registry.mjs handleUnannounce). */
export const upgradeAccounts = new Set();

/** Serialise the sets for inclusion in the `getState` RPC reply. */
export function snapshot() {
  return {
    syncingAccounts: [...syncingAccounts],
    cancellingAccounts: [...cancellingAccounts],
    busyAccounts: [...busyAccounts],
    busyFolders: [...busyFolders],
    upgradeAccounts: [...upgradeAccounts],
    pendingSyncRequests: Object.fromEntries(
      [...pendingSyncRequests].map(([accountId, folderIds]) => [
        accountId,
        [...folderIds],
      ]),
    ),
  };
}
