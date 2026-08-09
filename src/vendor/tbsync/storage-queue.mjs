/**
 * Shared write-queue for extension-storage mutations (storage.local
 * and storage.session alike - the queue is storage-agnostic).
 *
 * Every read-modify-write site funnels through `serialize` so concurrent
 * triggers (every installed provider racing into the host's announce
 * handler at startup, a changelog write landing while a sync is running,
 * two folder updates from different providers) can't trample each other.
 *
 * Pattern matches quicktext/src/modules/storage.mjs:609 - one promise
 * chain, the next call awaits the prior, errors propagate to the
 * caller but are swallowed in the chain itself so one failed write
 * doesn't kill the queue.
 *
 * The chain is module-global, which is exactly right for a vendored file:
 * each extension context gets its own module instance and therefore its own
 * chain, serialising that context's writes to its own storage and nothing
 * else. **Vendored - see `TbSync/common/README.md`.**
 */

let _queue = Promise.resolve();

export function serialize(fn) {
  const result = _queue.then(fn, fn);
  _queue = result.catch(() => {});
  return result;
}
