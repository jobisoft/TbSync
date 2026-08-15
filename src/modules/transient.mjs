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

/** Work asked for while the account was busy, as
 *  `accountId -> Map<kind, { at, payload }>`.
 *
 *  Deferred rather than dropped because something asked for it on purpose -
 *  a user pressing Reload on a calendar, the calendar's own refresh timer,
 *  or the maintenance tick.
 *
 *  **One slot per kind** is the whole design. There is nowhere to put a
 *  second sync, so five impatient clicks cost one run, and a kind cannot
 *  crowd out another kind however often it arrives.
 *
 *  `at` is when the slot was *first* filled, and a merge keeps the earlier
 *  one. That is not cosmetic: the next item to run is the oldest slot, so a
 *  request that kept refreshing its own timestamp could starve every other
 *  kind indefinitely.
 *
 *  In memory, like the locks above - a host restart drops deferred work,
 *  which is the right trade against replaying it against a world that has
 *  moved on. */
export const pendingWork = new Map();

/** The kinds that can be queued. `sync` carries `{ full, folderIds }`;
 *  `maintain` carries nothing. */
export const WORK = Object.freeze({ SYNC: "sync", MAINTAIN: "maintain" });

/** Accounts a provider has declared "upgrading" via SET_PROVIDER_UPGRADE_LOCK.
 *  While in this set, the host refuses every user-initiated RPC against
 *  the account and skips autosync ticks - the provider is treated as
 *  unavailable for the duration of its upgrade work. Cleared when the
 *  provider sends `{locked: false}` (or the provider port closes; see
 *  registry.mjs handleUnannounce). */
export const upgradeAccounts = new Set();

/** Accounts that have been registered but are not ready to be used, held
 *  here across `onRegisterSuccessful` - see SET_ACCOUNT_SETUP_LOCK. One
 *  account, not the provider's whole set: preparing a new account must not
 *  freeze the ones already working.
 *
 *  In memory on purpose. A provider that dies mid-setup leaves a mark that
 *  the next host start drops, which is the right trade against a flag on
 *  disk that could strand an account for good. */
export const settingUpAccounts = new Set();

/** Accounts inside a HOST_CMD.MAINTAIN call.
 *
 *  A lock of its own rather than reusing `syncingAccounts`: the manager
 *  renders these sets, and painting "syncing" while a provider tidies its
 *  own storage would say something untrue about an account doing no
 *  network at all. It greys out Sync exactly as the other locks do, so a
 *  user cannot click into a request that would silently wait.
 *
 *  In memory for the reason `settingUpAccounts` gives: a provider that dies
 *  mid-maintenance leaves a mark the next host start drops, rather than a
 *  disk flag that could strand an account for good. */
export const maintainingAccounts = new Set();

/** Serialise the sets for inclusion in the `getState` RPC reply. */
export function snapshot() {
  return {
    syncingAccounts: [...syncingAccounts],
    cancellingAccounts: [...cancellingAccounts],
    busyAccounts: [...busyAccounts],
    busyFolders: [...busyFolders],
    upgradeAccounts: [...upgradeAccounts],
    settingUpAccounts: [...settingUpAccounts],
    maintainingAccounts: [...maintainingAccounts],
    pendingWork: Object.fromEntries(
      [...pendingWork].map(([accountId, kinds]) => [
        accountId,
        Object.fromEntries(kinds),
      ]),
    ),
  };
}
