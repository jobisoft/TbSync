/**
 * Shared client for TbSync's UI pages (manager window, event-log tab, future
 * panels) to talk to the background via the `"tbsync-manager"` port.
 *
 * Responsibilities:
 *   - open the port
 *   - reconnect transparently if the background restarts
 *   - correlate requestIds for rpc() calls
 *   - re-attach `errorCode` onto rejected rpc errors so callers can branch on
 *     `err.code` (e.g. ignore E:CANCELLED)
 *   - dispatch broadcast events to the caller's onEvent handler
 *
 * Usage:
 *   const client = createManagerClient({
 *     onEvent: event => { ... },
 *     onReconnect: () => refreshState(),   // optional
 *   });
 *   await client.rpc("getState");
 */

const PORT_NAME = "tbsync-manager";
const RECONNECT_DELAY_MS = 500;

export function createManagerClient({
  onEvent = () => {},
  onReconnect = null,
} = {}) {
  let port = null;
  const pending = new Map();

  function connect() {
    port = browser.runtime.connect({ name: PORT_NAME });
    port.onMessage.addListener((msg) => {
      if (msg.kind === "rpc-response" && msg.requestId) {
        const entry = pending.get(msg.requestId);
        if (!entry) return;
        pending.delete(msg.requestId);
        if (msg.ok) {
          entry.resolve(msg.result);
        } else {
          const err = new Error(msg.error);
          if (msg.errorCode) err.code = msg.errorCode;
          entry.reject(err);
        }
      } else if (msg.kind === "event") {
        onEvent(msg.event);
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(() => {
        connect();
        if (onReconnect) onReconnect();
      }, RECONNECT_DELAY_MS);
    });
  }

  function rpc(cmd, args = {}) {
    if (!port) return Promise.reject(new Error("not connected"));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      port.postMessage({ kind: "rpc", requestId, cmd, args });
    });
  }

  connect();
  return { rpc };
}
