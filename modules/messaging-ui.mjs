/**
 * Bridge from background to any open manager popup window(s).
 *
 * Manager pages connect with `browser.runtime.connect({name:"tbsync-manager"})`
 * at load time; the background pushes broadcast events to all connected ports.
 * Messages are small and throttling happens upstream (in router.mjs) before we
 * get here.
 */

const MANAGER_PORT_NAME = "tbsync-manager";
const managerPorts = new Set();
const rpcHandlers = new Map();
const internalListeners = new Set();

/** Subscribe to the same event stream that goes to manager ports, but
 *  from inside the background. Used by host-internal modules (like the
 *  changelog watcher) that need to react to state changes without owning
 *  RPC plumbing. */
export function onInternalEvent(fn) {
  internalListeners.add(fn);
  return () => internalListeners.delete(fn);
}

export function init() {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== MANAGER_PORT_NAME) return;
    managerPorts.add(port);
    port.onDisconnect.addListener(() => managerPorts.delete(port));
    port.onMessage.addListener(msg => handleManagerRpc(port, msg));
  });
}

export function broadcast(event) {
  for (const fn of internalListeners) {
    try { fn(event); } catch (err) { console.warn("[tbsync] internal listener failed:", err); }
  }
  for (const port of managerPorts) {
    try { port.postMessage({ kind: "event", event }); } catch { managerPorts.delete(port); }
  }
}

export function setManagerRpcHandler(cmd, fn) {
  rpcHandlers.set(cmd, fn);
}

async function handleManagerRpc(port, msg) {
  if (!msg || msg.kind !== "rpc" || !msg.requestId) return;
  const fn = rpcHandlers.get(msg.cmd);
  try {
    if (!fn) throw new Error(`unknown manager rpc: ${msg.cmd}`);
    const result = await fn(msg.args ?? {});
    port.postMessage({ kind: "rpc-response", requestId: msg.requestId, ok: true, result: result ?? null });
  } catch (err) {
    port.postMessage({
      kind: "rpc-response",
      requestId: msg.requestId,
      ok: false,
      error: err.message,
      errorCode: err.code ?? null,
    });
  }
}
