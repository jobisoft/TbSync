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

/** Accounts with a UI-driven RPC (edit, reauth, delete, connect, disconnect)
 *  in flight. Locks action buttons in the manager for these accounts. */
export const busyAccounts = new Set();

/** Folders with a toggle (enable/disable) RPC in flight. Locks the
 *  checkbox + rejects overlapping toggles on the same folder. */
export const busyFolders = new Set();

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
    busyAccounts: [...busyAccounts],
    busyFolders: [...busyFolders],
    upgradeAccounts: [...upgradeAccounts],
  };
}
