/**
 * Base class for TbSync provider add-ons. Owns the handshake, port
 * lifecycle, RPC dispatch, and setup/config popup windowing. Subclasses
 * override `on*` virtual hooks - one per HOST_CMD. Required overrides
 * throw `E:UNKNOWN_COMMAND`; safe-no-op hooks return `null`.
 *
 * Startup: `new MyProvider(options); provider.init();`.
 *
 * **MIRRORED INTO EVERY PROVIDER ADD-ON** - see the header of
 * `./protocol.mjs` for the sync rule.
 */

import {
  DEFAULT_RPC_TIMEOUT_MS,
  DISCOVERY, ERR, HOST_CMD, NO_TIMEOUT_CMDS,
  PORT_NAME, PROTOCOL_VERSION,
  PROVIDER_CMD, PROVIDER_NOTIFY, withCode,
} from "./protocol.mjs";

// Subclass-facing surface. Subclass code imports only from this file;
// protocol.mjs and status.mjs stay as mirror-synced contract files.
export { ERR, withCode } from "./protocol.mjs";
export { ok, warning, error } from "./status.mjs";

/** Extension id of the TbSync host. */
export const TBSYNC_ID = "tbsync@jobisoft.de";


const DEFAULT_SETUP_WIDTH = 520;
const DEFAULT_SETUP_HEIGHT = 640;
const DEFAULT_CONFIG_WIDTH = 520;
const DEFAULT_CONFIG_HEIGHT = 580;

// Host-availability retry schedule - first announce 250 ms after host flips
// to enabled (it's still initialising its onMessageExternal listener), then
// every 500 ms up to 10 attempts.
const ANNOUNCE_INITIAL_DELAY_MS = 250;
const ANNOUNCE_RETRY_DELAY_MS = 500;
const ANNOUNCE_MAX_ATTEMPTS = 10;

const HOST_AVAILABLE_KEY = "host-available";

export class TbSyncProviderImplementation {
  #port = null;
  #pending = new Map();           // requestId → {resolve, reject, timer}
  #pendingSetups = new Map();     // setupToken → {resolve, reject, windowId}
  #pendingConfigs = new Map();    // accountId → windowId
  #pendingReauths = new Map();    // accountId → windowId
  #announceInFlight = false;
  #firstConnect = false;          // flips true on the first onConnectedToHost
  #onceConnectedCbs = [];         // queue drained on first connect

  #name;
  #shortName;
  #icons;
  #capabilities;
  #maintainerEmail;
  #contributorsUrl;
  #setupPath;
  #setupWidth;
  #setupHeight;
  #configPath;
  #configWidth;
  #configHeight;
  #logPrefix;

  constructor(options = {}) {
    const manifest = browser.runtime.getManifest();
    this.#name = options.name ?? manifest.name;
    // Prefix for outbound RPC-correlation tokens; makes log lines from
    // different providers easy to tell apart.
    this.#shortName = options.shortName ?? browser.runtime.id;
    this.#icons = options.icons ?? manifest.icons ?? {};
    this.#capabilities = options.capabilities ?? {};
    this.#maintainerEmail = options.maintainerEmail ?? null;
    this.#contributorsUrl = options.contributorsUrl ?? null;
    this.#setupPath = options.setupPath ?? null;
    this.#setupWidth = options.setupWidth ?? DEFAULT_SETUP_WIDTH;
    this.#setupHeight = options.setupHeight ?? DEFAULT_SETUP_HEIGHT;
    this.#configPath = options.configPath ?? null;
    this.#configWidth = options.configWidth ?? DEFAULT_CONFIG_WIDTH;
    this.#configHeight = options.configHeight ?? DEFAULT_CONFIG_HEIGHT;
    this.#logPrefix = options.logPrefix ?? `[${browser.runtime.id}]`;
  }

  /** True while a TbSync port is open. */
  get isConnected() { return this.#port !== null; }

  // ── Entry point ─────────────────────────────────────────────────────────

  /** Attach every listener. Call once, after constructing the subclass.
   *  Calling twice double-registers. */
  init() {
    this.#attachPort();
    this.#attachProbeListener();
    this.#attachSetupCompletedListener();
    this.#attachSetupCancelListener();
    this.#watchHostAvailability();
    this.#primeHostAvailability().catch(err =>
      console.warn(`${this.#logPrefix} management.getAll() failed at startup:`, err)
    );
  }

  // ── Outbound: handshake ─────────────────────────────────────────────────

  /** Send an announce. Returns the host's reply, or null on rejection / no response. */
  async announce() {
    const manifest = browser.runtime.getManifest();
    // Resolve relative icon paths to absolute moz-extension:// URLs so the
    // host can render them cross-extension via <img src>. The provider must
    // list these paths in its manifest's web_accessible_resources.
    const absoluteIcons = Object.fromEntries(
      Object.entries(this.#icons).map(([size, path]) => [
        size,
        /^(moz-extension|https?):/.test(path) ? path : browser.runtime.getURL(path),
      ])
    );
    const payload = {
      type: DISCOVERY.ANNOUNCE,
      protocolVersion: PROTOCOL_VERSION,
      providerId: browser.runtime.id,
      providerName: this.#name,
      providerVersion: manifest.version,
      icons: absoluteIcons,
      capabilities: this.#capabilities,
    };
    payload.shortName = this.#shortName;
    if (this.#maintainerEmail) payload.maintainerEmail = this.#maintainerEmail;
    if (this.#contributorsUrl) payload.contributorsUrl = this.#contributorsUrl;

    try {
      const reply = await browser.runtime.sendMessage(TBSYNC_ID, payload);
      if (!reply?.ok) {
        console.warn(`${this.#logPrefix} announce rejected:`, reply);
        return null;
      }
      return reply;
    } catch {
      return null;
    }
  }

  /** Best-effort unannounce. */
  async unannounce() {
    try {
      await browser.runtime.sendMessage(TBSYNC_ID, {
        type: DISCOVERY.UNANNOUNCE,
        providerId: browser.runtime.id,
      });
    } catch { /* host already gone */ }
  }

  // ── Outbound: RPC provider → host ───────────────────────────────────────

  registerAccount(args) { return this.#sendCmd(PROVIDER_CMD.REGISTER_ACCOUNT, args); }
  updateAccount(args)   { return this.#sendCmd(PROVIDER_CMD.UPDATE_ACCOUNT,   args); }
  updateFolder(args)    { return this.#sendCmd(PROVIDER_CMD.UPDATE_FOLDER,    args); }
  pushFolderList(args)  { return this.#sendCmd(PROVIDER_CMD.PUSH_FOLDER_LIST, args); }
  /** Accounts owned by this provider, scoped on the host side. */
  listAccounts()                 { return this.#sendCmd(PROVIDER_CMD.LIST_ACCOUNTS); }
  /** `{account, folders}` for one account, or `null` if it doesn't exist
   *  or isn't owned by this provider. */
  getAccount(accountId)          { return this.#sendCmd(PROVIDER_CMD.GET_ACCOUNT, { accountId }); }
  /** Stamp a `*_by_server` pre-tag on `folder.changelog` so the host's
   *  observer drops the next Thunderbird event for this item as
   *  self-inflicted (1500 ms freeze). Args:
   *    { accountId, folderId, parentId, itemId, status, kind }
   *  `kind` selects both the matching strategy and the event family:
   *    - `"contact"`      : itemId = TB contact id; suppresses
   *                         `messenger.contacts.*` events.
   *    - `"list"`         : itemId = TB mailing-list id; suppresses
   *                         `messenger.mailingLists.*` events.
   *    - `"list-by-name"` : itemId = list NAME (string). Used only for
   *                         pull-creates where the TB id isn't known
   *                         pre-call. The watcher matches the row by
   *                         name on the next `mailingLists.onCreated`
   *                         and upgrades it in place to
   *                         `kind: "list", itemId: <real id>`.
   *    - `"event"`        : itemId = TB calendar item id; suppresses
   *                         `messenger.calendar.items.*` events whose
   *                         `item.type === "event"`.
   *    - `"task"`         : itemId = TB calendar item id; suppresses
   *                         `messenger.calendar.items.*` events whose
   *                         `item.type === "task"`.
   *    - `"calendar-item"`: itemId = TB calendar item id; reserved for
   *                         the `onRemoved` path where the item type
   *                         is no longer available. The watcher resolves
   *                         this against any matching `(parentId, itemId)`
   *                         row regardless of kind.
   *  Must be awaited BEFORE the actual TB API call so the tag is
   *  durable before the event fires. */
  changelogMarkServerWrite(args) { return this.#sendCmd(PROVIDER_CMD.CHANGELOG_MARK_SERVER_WRITE, args); }
  /** Remove the changelog entry for `(parentId, itemId)` regardless of
   *  status. Called after successfully pushing a `*_by_user` entry. */
  changelogRemove(args)          { return this.#sendCmd(PROVIDER_CMD.CHANGELOG_REMOVE, args); }

  /** Provider-scoped upgrade lock. While `locked: true`, the host
   *  refuses every user-initiated RPC against any account belonging to
   *  this provider and skips autosync ticks - the manager surfaces the
   *  state as "Provider is performing one-time upgrade work…". The
   *  upgrade itself is exempt: provider→host commands like
   *  `updateAccount` / `changelogMarkServerWrite` continue to flow.
   *  Always pair a `true` call with a `false` call (use try/finally). */
  setProviderUpgradeLock(locked) {
    return this.#sendCmd(PROVIDER_CMD.SET_PROVIDER_UPGRADE_LOCK, { locked: !!locked });
  }

  // ── Outbound: notifications ─────────────────────────────────────────────

  reportSyncState(payload)    { this.#notify(PROVIDER_NOTIFY.REPORT_SYNC_STATE, payload); }
  reportProgress(payload)     { this.#notify(PROVIDER_NOTIFY.REPORT_PROGRESS,   payload); }
  /** Append a line to the host's event log. `payload.level` is REQUIRED and
   *  MUST be one of "error" | "warning" | "debug"; a plain Error is thrown
   *  at the call site if it's missing or bogus (fail-fast, not a wire error). */
  reportEventLog(payload) {
    const level = payload?.level;
    if (level !== "error" && level !== "warning" && level !== "debug") {
      throw new Error(`reportEventLog: level must be "error" | "warning" | "debug" (got ${JSON.stringify(level)})`);
    }
    this.#notify(PROVIDER_NOTIFY.REPORT_EVENT_LOG, payload);
  }

  // ── Virtual hooks - subclass overrides ──────────────────────────────────

  /** Sync a whole account. Host calls this before walking selected folders. */
  async onSyncAccount(_args)           { throw this.#notImplemented("onSyncAccount"); }
  /** Sync one folder. Host calls this per selected folder after onSyncAccount. */
  async onSyncFolder(_args)            { throw this.#notImplemented("onSyncFolder"); }
  /** Cooperative cancel for an in-flight sync. */
  async onCancelSync(_args)            { return null; }

  async onAccountEnabled(_args)        { return null; }
  async onAccountDisabled(_args)       { return null; }
  async onAccountDeleted(_args)        { return null; }
  async onFolderEnabled(_args)         { return null; }
  async onFolderDisabled(_args)        { return null; }

  async onGetSortedFolders(_args)      { throw this.#notImplemented("onGetSortedFolders"); }

  async onReauthenticate(_args)        { throw this.#notImplemented("onReauthenticate"); }

  /** Called each time the host opens a port to us (initial boot + every
   *  reconnect after a host restart). Safe place for startup work that
   *  needs to read host state - listAccounts, getAccount, etc. - since the
   *  port is live from this point. Must be idempotent. */
  async onConnectedToHost()            { return null; }

  /** One-shot wrapper around the first `onConnectedToHost`. `cb` fires
   *  exactly once: immediately if the provider is already connected, or
   *  on the next port-open otherwise. Used by independent boot paths
   *  (e.g. the fixup runner) that need to wait for "provider is ready
   *  for host RPC" without coupling to any other init path. */
  onceConnectedToHost(cb) {
    if (this.#firstConnect) {
      queueMicrotask(cb);
    } else {
      this.#onceConnectedCbs.push(cb);
    }
  }

  /** Open the setup popup, wait for `tbsync-setup-completed`, register the
   *  account with the host, and return `{accountId, accountName, accountEntries}`. */
  async onOpenSetupPopup(args) {
    if (!this.#setupPath) throw this.#notImplemented("onOpenSetupPopup (no setupPath)");
    const { setupToken } = args;
    if (!setupToken) {
      throw withCode(new Error("openSetupPopup: args.setupToken is required"), ERR.UNKNOWN_COMMAND);
    }
    const url = new URL(browser.runtime.getURL(this.#setupPath));
    url.searchParams.set("setupToken", setupToken);
    if (args.locale) url.searchParams.set("locale", args.locale);

    const win = await browser.windows.create({
      url: url.toString(),
      type: "popup",
      width: this.#setupWidth,
      height: this.#setupHeight,
    });

    const { accountName, initialFolders, custom } =
      await new Promise((resolve, reject) => {
        this.#pendingSetups.set(setupToken, { resolve, reject, windowId: win.id });
      });

    // `custom` - if present - seeds the new account's opaque provider blob
    // atomically with the host row creation. See protocol.mjs PROVIDER_CMD.
    const { accountId } = await this.registerAccount({
      setupToken,
      accountName,
      initialFolders,
      custom,
    });

    // Give the subclass a chance to do any post-register bookkeeping
    // (e.g. seed an in-memory cache keyed by accountId).
    await this.onRegisterSuccessful({
      accountId,
      accountName,
    });

    return { accountId, accountName };
  }

  /** Called after registerAccount returns so a subclass can do any
   *  post-register bookkeeping. Return value is discarded. */
  async onRegisterSuccessful(_args) { return null; }

  /** Bring an in-flight setup popup to the front. Manager calls this when
   *  the user clicks the same provider while its setup is already open;
   *  resolves quickly if no popup is in flight. */
  async onFocusSetupPopup() {
    for (const { windowId } of this.#pendingSetups.values()) {
      if (windowId == null) continue;
      try {
        await browser.windows.update(windowId, { focused: true });
      } catch { /* window already closed */ }
    }
    return null;
  }

  /** Open the config popup with `accountId`, `readOnly`, and `mode` URL
   *  params. Resolves when the popup closes. */
  async onOpenConfigPopup(args) {
    if (!this.#configPath) throw this.#notImplemented("onOpenConfigPopup (no configPath)");
    const url = new URL(browser.runtime.getURL(this.#configPath));
    url.searchParams.set("accountId", args.accountId);
    if (args.readOnly) url.searchParams.set("readOnly", "1");
    if (args.mode) url.searchParams.set("mode", args.mode);
    const win = await browser.windows.create({
      url: url.toString(),
      type: "popup",
      width: this.#configWidth,
      height: this.#configHeight,
    });
    // Register the windowId so onFocusConfigPopup can raise this window
    // if the manager re-issues the click while it's still open.
    this.#pendingConfigs.set(args.accountId, win.id);
    try {
      await waitForWindowClose(win.id);
    } finally {
      this.#pendingConfigs.delete(args.accountId);
    }
    return null;
  }

  /** Bring an in-flight config popup to the front. Quick no-op when
   *  there's no popup open for `args.accountId`. */
  async onFocusConfigPopup(args) {
    const windowId = this.#pendingConfigs.get(args.accountId);
    if (windowId == null) return null;
    try {
      await browser.windows.update(windowId, { focused: true });
    } catch { /* window already closed */ }
    return null;
  }

  /** Symmetric focus for a reauth popup. Subclasses that drive their own
   *  consent window (e.g. EAS's nativeclient flow) register the windowId
   *  in `registerReauthWindow` while the popup is open; this method then
   *  brings it to the front. Subclasses that delegate reauth to
   *  `browser.identity.launchWebAuthFlow` (e.g. Google) never register -
   *  the call is a deliberate no-op for them. */
  async onFocusReauthPopup(args) {
    const windowId = this.#pendingReauths.get(args.accountId);
    if (windowId == null) return null;
    try {
      await browser.windows.update(windowId, { focused: true });
    } catch { /* window already closed */ }
    return null;
  }

  /** Subclass hook - track a reauth popup window for the duration of a
   *  custom OAuth flow so `onFocusReauthPopup` can raise it. Always pair
   *  with `unregisterReauthWindow` in a finally block. */
  registerReauthWindow(accountId, windowId) {
    if (windowId != null) this.#pendingReauths.set(accountId, windowId);
  }
  unregisterReauthWindow(accountId) {
    this.#pendingReauths.delete(accountId);
  }

// ── Private: port + dispatch ────────────────────────────────────────────

  #attachPort() {
    browser.runtime.onConnectExternal.addListener(incoming => {
      if (incoming.sender?.id !== TBSYNC_ID) return;
      if (incoming.name !== PORT_NAME) return;
      if (this.#port) {
        try { this.#port.disconnect(); } catch { /* ignore */ }
      }
      this.#port = incoming;
      incoming.onMessage.addListener(msg => this.#onPortMessage(msg));
      incoming.onDisconnect.addListener(() => {
        if (this.#port === incoming) this.#port = null;
        this.#rejectAllPending(ERR.PORT_CLOSED, "host disconnected");
      });
      // Fire the subclass hook so startup work that needs the port
      // (provider→host reads via listAccounts/getAccount) runs at the
      // right moment. Warn-not-throw keeps a buggy subclass from poisoning
      // the fresh port.
      this.onConnectedToHost().catch(err =>
        console.warn(`${this.#logPrefix} onConnectedToHost failed:`, err)
      );
      // Drain any one-shot waiters registered via onceConnectedToHost,
      // then mark the first-connect flag so future registrations fire
      // immediately. Independent of the regular onConnectedToHost call
      // above so a buggy hook can't starve the waiters.
      if (!this.#firstConnect) {
        this.#firstConnect = true;
        const cbs = this.#onceConnectedCbs;
        this.#onceConnectedCbs = [];
        for (const cb of cbs) {
          try { cb(); } catch (err) {
            console.warn(`${this.#logPrefix} onceConnectedToHost callback threw:`, err);
          }
        }
      }
    });
  }

  /** Re-announce when the host probes us (after its own restart). */
  #attachProbeListener() {
    browser.runtime.onMessageExternal.addListener((msg, sender) => {
      if (sender?.id !== TBSYNC_ID) return;
      if (msg?.type !== DISCOVERY.PROBE) return;
      this.announce().catch(() => { });
      return Promise.resolve({ ok: true, providerId: browser.runtime.id });
    });
  }

  #onPortMessage(msg) {
    if (!msg || typeof msg !== "object") return;

    // Response to a provider→host RPC.
    if (msg.requestId && (msg.ok === true || msg.ok === false) && !msg.cmd) {
      const entry = this.#pending.get(msg.requestId);
      if (!entry) return;
      this.#pending.delete(msg.requestId);
      if (entry.timer) clearTimeout(entry.timer);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(withCode(
        new Error(msg.error ?? "host error"),
        msg.errorCode ?? ERR.UNKNOWN_COMMAND,
        msg.errorDetails ?? null
      ));
      return;
    }

    // Incoming host→provider RPC.
    if (msg.requestId && msg.cmd) {
      this.#dispatchHostCmd(msg);
    }
  }

  async #dispatchHostCmd(msg) {
    const activePort = this.#port;
    if (!activePort) return;
    try {
      const result = await this.#callHostCmdHandler(msg.cmd, msg.args ?? {});
      if (this.#port === activePort) {
        activePort.postMessage({ requestId: msg.requestId, ok: true, result: result ?? null });
      }
    } catch (err) {
      if (this.#port === activePort) {
        activePort.postMessage({
          requestId: msg.requestId,
          ok: false,
          error: err.message ?? "unknown error",
          errorCode: err.code ?? ERR.UNKNOWN_COMMAND,
          errorDetails: err.details ?? null,
        });
      }
    }
  }

  /** Map HOST_CMD to the on* hook. Adding a new command = one case here
   *  plus one override in the subclass. */
  #callHostCmdHandler(cmd, args) {
    switch (cmd) {
      case HOST_CMD.SYNC_ACCOUNT:             return this.onSyncAccount(args);
      case HOST_CMD.SYNC_FOLDER:              return this.onSyncFolder(args);
      case HOST_CMD.CANCEL_SYNC:              return this.onCancelSync(args);
      case HOST_CMD.OPEN_SETUP_POPUP:         return this.onOpenSetupPopup(args);
      case HOST_CMD.FOCUS_SETUP_POPUP:        return this.onFocusSetupPopup(args);
      case HOST_CMD.OPEN_CONFIG_POPUP:        return this.onOpenConfigPopup(args);
      case HOST_CMD.FOCUS_CONFIG_POPUP:       return this.onFocusConfigPopup(args);
      case HOST_CMD.FOCUS_REAUTH_POPUP:       return this.onFocusReauthPopup(args);
      case HOST_CMD.REAUTHENTICATE:           return this.onReauthenticate(args);
      case HOST_CMD.ACCOUNT_ENABLED:          return this.onAccountEnabled(args);
      case HOST_CMD.ACCOUNT_DISABLED:         return this.onAccountDisabled(args);
      case HOST_CMD.ACCOUNT_DELETED:          return this.onAccountDeleted(args);
      case HOST_CMD.FOLDER_ENABLED:           return this.onFolderEnabled(args);
      case HOST_CMD.FOLDER_DISABLED:          return this.onFolderDisabled(args);
      case HOST_CMD.GET_SORTED_FOLDERS:       return this.onGetSortedFolders(args);
      default:
        throw withCode(new Error(`Unknown command: ${cmd}`), ERR.UNKNOWN_COMMAND);
    }
  }

  #sendCmd(cmd, args = {}) {
    if (!this.#port) {
      return Promise.reject(withCode(new Error("host not connected"), ERR.PORT_CLOSED));
    }
    const requestId = `${this.#shortName}-request-${crypto.randomUUID()}`;
    const activePort = this.#port;
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      if (!NO_TIMEOUT_CMDS.has(cmd)) {
        entry.timer = setTimeout(() => {
          this.#pending.delete(requestId);
          reject(withCode(new Error(`Timeout waiting for ${cmd}`), ERR.TIMEOUT));
        }, DEFAULT_RPC_TIMEOUT_MS);
      }
      this.#pending.set(requestId, entry);
      try {
        activePort.postMessage({ requestId, cmd, args });
      } catch (err) {
        this.#pending.delete(requestId);
        if (entry.timer) clearTimeout(entry.timer);
        reject(withCode(err, ERR.PORT_CLOSED));
      }
    });
  }

  #notify(type, payload = {}) {
    if (!this.#port) return;
    try {
      this.#port.postMessage({ type, payload });
    } catch { /* port races with disconnect; drop silently */ }
  }

  #rejectAllPending(code, message) {
    for (const [, entry] of this.#pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(withCode(new Error(message), code));
    }
    this.#pending.clear();
  }

  // ── Private: setup-popup completion & cancellation ──────────────────────

  #attachSetupCompletedListener() {
    browser.runtime.onMessage.addListener(msg => {
      if (msg?.type !== "tbsync-setup-completed") return;
      this.completeSetup(msg);
    });
  }

  /** Resolve a pending setup programmatically. Used by subclasses that
   *  finalise setup from the background page itself (e.g. an OAuth flow
   *  that runs in-page rather than from a UI dialog), since
   *  `runtime.sendMessage` is not delivered back to the calling frame
   *  and the `tbsync-setup-completed` round-trip would otherwise be
   *  needed. Returns true if a pending setup was matched. */
  completeSetup({ setupToken, accountName, initialFolders, custom }) {
    const entry = this.#pendingSetups.get(setupToken);
    if (!entry) return false;
    this.#pendingSetups.delete(setupToken);
    entry.resolve({
      accountName,
      initialFolders: initialFolders ?? [],
      custom: custom ?? {},
    });
    return true;
  }

  /** Reject the pending setup promise when the window is closed. 500 ms
   *  grace period because the completion message races window.close(). */
  #attachSetupCancelListener() {
    browser.windows.onRemoved.addListener(winId => {
      for (const [token, entry] of this.#pendingSetups) {
        if (entry.windowId !== winId) continue;
        setTimeout(() => {
          const still = this.#pendingSetups.get(token);
          if (!still) return;
          this.#pendingSetups.delete(token);
          still.reject(Object.assign(new Error("setup cancelled"), { code: ERR.CANCELLED }));
        }, 500);
      }
    });
  }

  // ── Private: host-availability tracking ─────────────────────────────────

  /** Track host state in session storage. `management.*` events update it;
   *  a storage.onChanged observer kicks announce-with-retry on transition
   *  to true so every path funnels through one log site. */
  #watchHostAvailability() {
    browser.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName !== "session" || !changes[HOST_AVAILABLE_KEY]) return;
      if (changes[HOST_AVAILABLE_KEY].newValue !== true) return;
      if (this.#announceInFlight) return;
      this.#announceInFlight = true;
      try {
        await this.#announceWithRetry();
      } finally {
        this.#announceInFlight = false;
      }
    });

    const onHostEvent = (info, available) => {
      if (info.id !== TBSYNC_ID) return;
      console.log(`${this.#logPrefix} management event for host, available=${available}`);
      this.#setHostAvailable(available).catch(err =>
        console.warn(`${this.#logPrefix} setHostAvailable failed:`, err)
      );
    };
    browser.management.onInstalled.addListener(info => onHostEvent(info, info.enabled));
    browser.management.onEnabled.addListener(info => onHostEvent(info, true));
    browser.management.onDisabled.addListener(info => onHostEvent(info, false));
    browser.management.onUninstalled.addListener(info => onHostEvent(info, false));
  }

  async #primeHostAvailability() {
    const all = await browser.management.getAll();
    const host = all.find(a => a.id === TBSYNC_ID);
    const available = !!host?.enabled;
    console.log(`${this.#logPrefix} initial host state: ${available ? "available" : "absent"}`);
    await this.#setHostAvailable(available);
  }

  async #setHostAvailable(available) {
    await browser.storage.session.set({ [HOST_AVAILABLE_KEY]: !!available });
  }

  async #announceWithRetry() {
    for (let attempt = 1; attempt <= ANNOUNCE_MAX_ATTEMPTS; attempt++) {
      await new Promise(r =>
        setTimeout(r, attempt === 1 ? ANNOUNCE_INITIAL_DELAY_MS : ANNOUNCE_RETRY_DELAY_MS)
      );
      // Abort if the host flipped back off while we were waiting.
      const rv = await browser.storage.session.get({ [HOST_AVAILABLE_KEY]: false });
      if (!rv[HOST_AVAILABLE_KEY]) {
        console.log(`${this.#logPrefix} host went away during retry - stopping`);
        return;
      }
      console.log(`${this.#logPrefix} announcing (attempt ${attempt}/${ANNOUNCE_MAX_ATTEMPTS})`);
      const reply = await this.announce();
      if (reply) {
        console.log(`${this.#logPrefix} announce accepted by host`, reply);
        return;
      }
    }
    console.warn(`${this.#logPrefix} announce failed after all retries`);
  }

  // ── Private: helpers ────────────────────────────────────────────────────

  #notImplemented(which) {
    return withCode(
      new Error(`${which} not implemented by provider`),
      ERR.UNKNOWN_COMMAND
    );
  }
}

/** Resolve when `windows.onRemoved` fires for `windowId`. */
function waitForWindowClose(windowId) {
  return new Promise(resolve => {
    const listener = closedId => {
      if (closedId !== windowId) return;
      browser.windows.onRemoved.removeListener(listener);
      resolve();
    };
    browser.windows.onRemoved.addListener(listener);
  });
}
