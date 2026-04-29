/**
 * Shared write-queue for extension-storage mutations (storage.local
 * and storage.session alike - the queue is storage-agnostic).
 *
 * Every read-modify-write site in the host funnels through `serialize`
 * so concurrent triggers (every installed provider racing into the
 * announce handler at startup, the changelog watcher firing while a
 * sync is running, two folder updates from different providers) can't
 * trample each other.
 *
 * Pattern matches quicktext/src/modules/storage.mjs:609 - one promise
 * chain, the next call awaits the prior, errors propagate to the
 * caller but are swallowed in the chain itself so one failed write
 * doesn't kill the queue.
 */

let _queue = Promise.resolve();

export function serialize(fn) {
  const result = _queue.then(fn, fn);
  _queue = result.catch(() => {});
  return result;
}
