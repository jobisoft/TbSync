import { KEYS } from "./storage-keys.mjs";
import { serialize } from "./storage-queue.mjs";

/**
 * ProviderMeta directory, backed by browser.storage.local under KEYS.PROVIDERS.
 * Keyed by ProviderMeta.providerId (the provider's shortName).
 */

async function read() {
  const rv = await browser.storage.local.get({ [KEYS.PROVIDERS]: {} });
  return rv[KEYS.PROVIDERS];
}

export async function list() {
  return Object.values(await read());
}

export async function get(providerId) {
  const state = await read();
  return state[providerId] ?? null;
}

export function upsert(providerId, patch) {
  return serialize(async () => {
    const state = await read();
    const prior = state[providerId] ?? {};
    state[providerId] = { ...prior, ...patch, providerId, lastSeen: Date.now() };
    await browser.storage.local.set({ [KEYS.PROVIDERS]: state });
    return state[providerId];
  });
}

export function setState(providerId, providerState) {
  return serialize(async () => {
    const state = await read();
    if (!state[providerId]) return null;
    state[providerId].state = providerState;
    await browser.storage.local.set({ [KEYS.PROVIDERS]: state });
    return state[providerId];
  });
}

export function remove(providerId) {
  return serialize(async () => {
    const state = await read();
    if (!state[providerId]) return false;
    delete state[providerId];
    await browser.storage.local.set({ [KEYS.PROVIDERS]: state });
    return true;
  });
}
