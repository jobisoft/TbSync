import { KEYS } from "./storage-keys.mjs";
import { serialize } from "./storage-queue.mjs";

/**
 * Account directory, backed by browser.storage.local under KEYS.ACCOUNTS.
 *
 * Shape:
 *   { sequence: number, data: { [accountId: string]: AccountRecord } }
 */

async function read() {
  const rv = await browser.storage.local.get({ [KEYS.ACCOUNTS]: { sequence: 0, data: {} } });
  return rv[KEYS.ACCOUNTS];
}

async function write(state) {
  await browser.storage.local.set({ [KEYS.ACCOUNTS]: state });
}

export async function list() {
  const state = await read();
  return Object.values(state.data);
}

export async function get(accountId) {
  const state = await read();
  return state.data[accountId] ?? null;
}

export async function byProvider(providerId) {
  const state = await read();
  return Object.values(state.data).filter(a => a.provider === providerId);
}

export function create({
  provider,
  accountName,
  autoSyncIntervalMinutes = 0,
  custom = {},
}) {
  return serialize(async () => {
    const state = await read();
    state.sequence += 1;
    const accountId = String(state.sequence);
    const record = {
      accountId,
      accountName,
      provider,
      // Newly-registered accounts start disabled. The user clicks Connect
      // in the manager when they're ready, which fires ACCOUNT_ENABLED.
      // This lets the user review / edit settings before any network work
      // begins, and unifies "first connect" with "re-enable after disable"
      // on the provider side.
      enabled: false,
      error: null,
      lastSyncTime: 0,
      // Minutes between automatic syncs. 0 disables auto-sync (manual only).
      autoSyncIntervalMinutes,
      // Provider-writable backoff (epoch ms). When set in the future, the
      // autosync runner skips this account until the timestamp elapses;
      // manual sync via the manager always proceeds. Providers patch this
      // via UPDATE_ACCOUNT after a soft failure (rate limit, transient
      // server issue) so subsequent autosync ticks don't hammer the server.
      noAutosyncUntil: 0,
      // Opaque provider-owned blob. The host never interprets this; provider
      // patches via PROVIDER_CMD.UPDATE_ACCOUNT with shallow-merge semantics.
      custom,
    };
    state.data[accountId] = record;
    await write(state);
    return record;
  });
}

export function update(accountId, patch) {
  return serialize(async () => {
    const state = await read();
    if (!state.data[accountId]) return null;
    state.data[accountId] = { ...state.data[accountId], ...patch };
    await write(state);
    return state.data[accountId];
  });
}

export function remove(accountId) {
  return serialize(async () => {
    const state = await read();
    if (!state.data[accountId]) return false;
    delete state.data[accountId];
    await write(state);
    return true;
  });
}
