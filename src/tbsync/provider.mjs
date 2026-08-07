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
  DISCOVERY,
  ERR,
  HOST_CMD,
  NO_TIMEOUT_CMDS,
  PORT_NAME,
  PROTOCOL_VERSION,
  PROVIDER_CMD,
  PROVIDER_NOTIFY,
  withCode,
} from "./protocol.mjs";

/** Long enough for the reply to reach the host before the background page
 *  goes away with it. Nothing observable happens in between. */
const RELOAD_DELAY_MS = 250;

// Subclass-facing surface. Subclass code imports only from this file;
// protocol.mjs and status.mjs stay as mirror-synced contract files.
export { ERR, withCode } from "./protocol.mjs";
export { ok, warning, error, accountRerun } from "./status.mjs";

/** Extension id of the TbSync host. */
export const TBSYNC_ID = "tbsync@jobisoft.de";

const DEFAULT_SETUP_WIDTH = 520;
const DEFAULT_SETUP_HEIGHT = 640;
const DEFAULT_CONFIG_WIDTH = 520;
const DEFAULT_CONFIG_HEIGHT = 580;

/** Commands that count as "a sync is running" for cancellation. Each gets an
 *  AbortController for the duration of the call, so a CANCEL_SYNC arriving
 *  while one is in flight can stop it. */
const SYNC_CMDS = new Set([HOST_CMD.SYNC_ACCOUNT, HOST_CMD.SYNC_FOLDER]);

/** The code to report for a thrown error.
 *
 *  `err.code` is only ours when it is one of our `E:` strings. A
 *  DOMException carries a *numeric* legacy `code` - 20 for AbortError - so
 *  reading it first sent `20` across the port and the host stamped the
 *  folder with "The operation was aborted." instead of recognising a
 *  cancellation. An aborted fetch is a cancellation, not a fault: reporting
 *  it as one puts "Internal error" in front of someone who pressed
 *  Disconnect. */
function errorCodeFor(err) {
  if (typeof err?.code === "string" && err.code.startsWith("E:")) {
    return err.code;
  }
  if (err?.name === "AbortError") return ERR.CANCELLED;
  return ERR.PROVIDER_FAULT;
}

export class TbSyncProviderImplementation {
  #port = null;
  #pending = new Map(); // requestId → {resolve, reject, timer}
  // accountId → AbortController, for as long as a sync command is running.
  // The host may cancel at any time; this is what makes that possible.
  #syncAborts = new Map();
  #pendingSetups = new Map(); // setupToken → {resolve, reject, windowId}
  // accountId → Set<windowId>: every window this provider currently has
  // open on that account's behalf, whichever flow opened it. A Set rather
  // than a single id so a second window cannot displace the first, and so
  // closing one cannot orphan another - removal is by windowId.
  #pendingWindows = new Map();
  #firstConnect = false; // flips true on the first onConnectedToHost
  #onceConnectedCbs = []; // queue drained on first connect

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
  get isConnected() {
    return this.#port !== null;
  }

  // ── Entry point ─────────────────────────────────────────────────────────

  /** Attach every listener, then announce once. Call once, after constructing
   *  the subclass. Calling twice double-registers.
   *
   *  The announce goes last on purpose. It may reach a host that is already
   *  listening, in which case we are registered immediately; if it does not,
   *  the host will broadcast HOST_READY when it comes up and we announce
   *  again from the listener attached below. Listeners before the send is
   *  what makes those two cases exhaustive - whichever side starts later
   *  reaches the other - so nothing here needs a timer or a retry. Moving
   *  the announce above #attachHostReadyListener would silently reintroduce
   *  a startup race (TbSync#797). */
  init() {
    this.#attachPort();
    this.#attachHostReadyListener();
    this.#attachSetupCompletedListener();
    this.#attachSetupCancelListener();

    this.announce().catch((err) =>
      console.warn(`${this.#logPrefix} initial announce threw:`, err),
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
        /^(moz-extension|https?):/.test(path)
          ? path
          : browser.runtime.getURL(path),
      ]),
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
      // No receiving end: TbSync is absent, disabled, or has not attached its
      // discovery listener yet. Not an error - it broadcasts HOST_READY when
      // it does, and callers decide whether the miss is worth logging.
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
    } catch (err) {
      // Host already gone — common at uninstall.
      console.debug(`${this.#logPrefix} unannounce send failed:`, err);
    }
  }

  // ── Outbound: RPC provider → host ───────────────────────────────────────

  registerAccount(args) {
    return this.#sendCmd(PROVIDER_CMD.REGISTER_ACCOUNT, args);
  }
  updateAccount(args) {
    return this.#sendCmd(PROVIDER_CMD.UPDATE_ACCOUNT, args);
  }
  updateFolder(args) {
    return this.#sendCmd(PROVIDER_CMD.UPDATE_FOLDER, args);
  }
  pushFolderList(args) {
    return this.#sendCmd(PROVIDER_CMD.PUSH_FOLDER_LIST, args);
  }
  /** Accounts owned by this provider, scoped on the host side. */
  listAccounts() {
    return this.#sendCmd(PROVIDER_CMD.LIST_ACCOUNTS);
  }
  /** `{account, folders}` for one account, or `null` if it doesn't exist
   *  or isn't owned by this provider. */
  getAccount(accountId) {
    return this.#sendCmd(PROVIDER_CMD.GET_ACCOUNT, { accountId });
  }
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
   *    - `"event"` / `"task"` : accepted and ignored. A provider supplies
   *                         its own calendars and reports edits to them
   *                         itself, so the host does not observe those
   *                         resources and has nothing to suppress.
   *  Must be awaited BEFORE the actual TB API call so the tag is
   *  durable before the event fires. */
  changelogMarkServerWrite(args) {
    return this.#sendCmd(PROVIDER_CMD.CHANGELOG_MARK_SERVER_WRITE, args);
  }
  /** Record a user edit for a resource this provider supplies itself, e.g.
   *  a calendar of its own type whose edits arrive as provider hooks rather
   *  than through the host's observer.
   *
   *  `parentId` is the resource (the calendar's id); the host resolves which
   *  folder that is. `op` is "created" | "updated" | "deleted" and is folded
   *  into whatever is already queued for the item. `detail` is stored
   *  verbatim and handed back on the changelog entry - for calendars it
   *  carries the item's previous version, the one thing that cannot be
   *  re-derived once the edit has been written. */
  changelogRecordUserEdit(args) {
    return this.#sendCmd(PROVIDER_CMD.CHANGELOG_RECORD_USER_EDIT, args);
  }
  /** Ask the host to sync one of this provider's folders, identified by the
   *  local resource it is bound to.
   *
   *  For when something outside the host's schedule asks for a sync - a user
   *  pressing Reload on a calendar the provider supplies, say. The host still
   *  decides: it runs its normal account prologue first, syncs only that
   *  folder, and defers the request if the account is already syncing rather
   *  than dropping it.
   *
   *  Resolves when the sync it asked for has finished, so a caller answering
   *  a platform hook can report a real outcome. */
  requestSync(args) {
    return this.#sendCmd(PROVIDER_CMD.REQUEST_SYNC, args);
  }
  /** Report that the local resource behind one of this provider's folders is
   *  gone - the user deleted the calendar or address book it was bound to.
   *  The host clears the binding and deselects the folder, leaving the row so
   *  it can be enabled again later.
   *
   *  Only for resources the provider supplies itself. A provider watching its
   *  own targets must satisfy itself that the resource is really gone before
   *  calling: the platform also announces a removal when a provider's own
   *  extension is restarting, and reporting that would deselect the folder on
   *  every update. */
  folderTargetRemoved(args) {
    return this.#sendCmd(PROVIDER_CMD.FOLDER_TARGET_REMOVED, args);
  }
  /** Remove the queued user edit for `(parentId, itemId, kind)`. Called
   *  after successfully pushing a `*_by_user` entry. `kind` is required -
   *  a changelog row's identity is the triple, and the host refuses the
   *  call without it. `*_by_server` rows are never touched. */
  changelogRemove(args) {
    return this.#sendCmd(PROVIDER_CMD.CHANGELOG_REMOVE, args);
  }
  /** Move the supplied changelog entries to the tail of the queue
   *  (preserving content + timestamps). Used after a partial-push
   *  failure so the next sync attempts non-failing items first.
   *  args: `{accountId, folderId, items: [{parentId, itemId, kind}, …]}` -
   *  `kind` is required on every item; the host refuses the call
   *  otherwise. */
  changelogMoveToTail(args) {
    return this.#sendCmd(PROVIDER_CMD.CHANGELOG_MOVE_TO_TAIL, args);
  }

  /** Provider-scoped upgrade lock. While `locked: true`, the host
   *  refuses every user-initiated RPC against any account belonging to
   *  this provider and skips autosync ticks - the manager surfaces the
   *  state as "Provider is performing one-time upgrade work…". The
   *  upgrade itself is exempt: provider→host commands like
   *  `updateAccount` / `changelogMarkServerWrite` continue to flow.
   *  Always pair a `true` call with a `false` call (use try/finally). */
  setProviderUpgradeLock(locked) {
    return this.#sendCmd(PROVIDER_CMD.SET_PROVIDER_UPGRADE_LOCK, {
      locked: !!locked,
    });
  }

  /** Report that this provider has finished converting the imported data
   *  of one account, clearing its `legacyMigrationPending` flag and making
   *  it serviceable again. Args: `{accountId}`.
   *
   *  Accounts carrying that flag came from the host's legacy importer with
   *  their `custom` copied over verbatim, so they are in whatever shape the
   *  legacy add-on left them in. Check for it whenever a port opens - the
   *  importer runs on the host's boot and re-runs whenever host storage has
   *  been cleared, neither of which produces an event on this side. Call
   *  this only for accounts that converted cleanly; an account left flagged
   *  stays blocked and comes back on the next boot. */
  legacyMigrationDone(args) {
    return this.#sendCmd(PROVIDER_CMD.LEGACY_MIGRATION_DONE, args);
  }

  // ── Outbound: notifications ─────────────────────────────────────────────

  reportSyncState(payload) {
    this.#notify(PROVIDER_NOTIFY.REPORT_SYNC_STATE, payload);
  }
  reportProgress(payload) {
    this.#notify(PROVIDER_NOTIFY.REPORT_PROGRESS, payload);
  }
  /** Append a line to the host's event log. `payload.level` is REQUIRED and
   *  MUST be one of "error" | "warning" | "info" | "debug"; a plain Error
   *  is thrown at the call site if it's missing or bogus (fail-fast, not a
   *  wire error). */
  reportEventLog(payload) {
    const level = payload?.level;
    if (
      level !== "error" &&
      level !== "warning" &&
      level !== "info" &&
      level !== "debug"
    ) {
      throw new Error(
        `reportEventLog: level must be "error" | "warning" | "info" | "debug" (got ${JSON.stringify(level)})`,
      );
    }
    this.#notify(PROVIDER_NOTIFY.REPORT_EVENT_LOG, payload);
  }

  // ── Virtual hooks - subclass overrides ──────────────────────────────────

  /** Sync a whole account. Host calls this before walking selected folders. */
  async onSyncAccount(_args) {
    throw this.#notImplemented("onSyncAccount");
  }
  /** Sync one folder. Host calls this per selected folder after onSyncAccount. */
  async onSyncFolder(_args) {
    throw this.#notImplemented("onSyncFolder");
  }
  /** Cooperative cancel for an in-flight sync.
   *
   *  Implemented here rather than left to each provider: aborting the
   *  controller is the whole contract, and everything a subclass has to do
   *  follows from consuming `syncSignal` / `throwIfCancelled`. Override only
   *  if a provider has something else to unwind, and call `super` if you do.
   *
   *  The host does not wait for the sync to finish unwinding - it settles
   *  the in-flight commands itself the moment it has sent this - but
   *  answering means the provider stops on its own terms, with its
   *  persistent state intact. */
  async onCancelSync({ accountId } = {}) {
    if (accountId == null) {
      for (const held of this.#syncAborts.values()) held.controller.abort();
    } else {
      this.#syncAborts.get(accountId)?.controller.abort();
    }
    return null;
  }

  /** The `AbortSignal` for this account's running sync, or null.
   *
   *  Hand it to anything that accepts one - `fetch` above all, so a cancel
   *  drops a request in flight instead of waiting out a server that may
   *  never answer. */
  syncSignal(accountId) {
    return this.#syncAborts.get(accountId)?.controller.signal ?? null;
  }

  /** Throw if this account's sync has been cancelled.
   *
   *  Call at loop boundaries, and always *before* a write rather than
   *  between a write and the changelog entry that covers it: unwinding
   *  half-way through an acknowledged push is the one way to lose a user
   *  edit. Re-running the whole batch is free by comparison. */
  throwIfCancelled(accountId) {
    if (this.#syncAborts.get(accountId)?.controller.signal.aborted) {
      throw withCode(new Error("Sync cancelled"), ERR.CANCELLED);
    }
  }

  async onAccountEnabled(_args) {
    return null;
  }
  async onAccountDisabled(_args) {
    return null;
  }
  async onAccountDeleted(_args) {
    return null;
  }
  async onFolderEnabled(_args) {
    return null;
  }
  async onFolderDisabled(_args) {
    return null;
  }

  async onGetSortedFolders(_args) {
    throw this.#notImplemented("onGetSortedFolders");
  }

  async onReauthenticate(_args) {
    throw this.#notImplemented("onReauthenticate");
  }

  /** Called each time the host opens a port to us (initial boot + every
   *  reconnect after a host restart). Safe place for startup work that
   *  needs to read host state - listAccounts, getAccount, etc. - since the
   *  port is live from this point. Must be idempotent. */
  async onConnectedToHost() {
    return null;
  }

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
    if (!this.#setupPath)
      throw this.#notImplemented("onOpenSetupPopup (no setupPath)");
    const { setupToken } = args;
    if (!setupToken) {
      throw withCode(
        new Error("openSetupPopup: args.setupToken is required"),
        ERR.UNKNOWN_COMMAND,
      );
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

    const { accountName, icon, initialFolders, custom } = await new Promise(
      (resolve, reject) => {
        this.#pendingSetups.set(setupToken, {
          resolve,
          reject,
          windowId: win.id,
        });
      },
    );

    // `custom` - if present - seeds the new account's opaque provider blob
    // atomically with the host row creation. `icon` - if present - seeds
    // the per-account icon override. See protocol.mjs PROVIDER_CMD.
    const { accountId } = await this.registerAccount({
      setupToken,
      accountName,
      icon,
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
  async onRegisterSuccessful(_args) {
    return null;
  }

  /** Bring an in-flight setup popup to the front. Manager calls this when
   *  the user clicks the same provider while its setup is already open;
   *  resolves quickly if no popup is in flight. */
  async onFocusSetupPopup() {
    for (const { windowId } of this.#pendingSetups.values()) {
      if (windowId == null) continue;
      try {
        await browser.windows.update(windowId, { focused: true });
      } catch (err) {
        console.debug(
          `${this.#logPrefix} focus setup popup ${windowId} failed:`,
          err,
        );
      }
    }
    return null;
  }

  /** Open the config popup with `accountId`, `readOnly`, and `mode` URL
   *  params. Resolves when the popup closes. */
  async onOpenConfigPopup(args) {
    if (!this.#configPath)
      throw this.#notImplemented("onOpenConfigPopup (no configPath)");
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
    // Register the windowId so onFocusAccountPopup can raise this window
    // if the manager re-issues the click while it's still open.
    this.registerAccountWindow(args.accountId, win.id);
    try {
      await waitForWindowClose(win.id);
    } finally {
      this.unregisterAccountWindow(args.accountId, win.id);
    }
    return null;
  }

  /** Bring whatever this provider currently has open for `args.accountId`
   *  to the front - the config popup, or a consent window a subclass drove
   *  itself. The manager sends this when the user clicks a button whose
   *  window is already open, so the answer is "raise it", not "open a
   *  second one".
   *
   *  Quick no-op when nothing is open, which is the normal case for
   *  subclasses that delegate to `browser.identity.launchWebAuthFlow`
   *  (e.g. Google): the browser owns that window and never tells us its
   *  id, so there is nothing to raise. */
  async onFocusAccountPopup(args) {
    for (const windowId of this.#pendingWindows.get(args.accountId) ?? []) {
      try {
        await browser.windows.update(windowId, { focused: true });
      } catch (err) {
        console.debug(
          `${this.#logPrefix} focus account popup ${windowId} failed:`,
          err,
        );
      }
    }
    return null;
  }

  /** Subclass hook - track a window opened on an account's behalf so
   *  `onFocusAccountPopup` can raise it. Always pair with
   *  `unregisterAccountWindow` in a finally block.
   *
   *  `onOpenConfigPopup` does this for you; a subclass only needs to call
   *  these when it drives its own window (e.g. EAS's nativeclient consent
   *  flow, whose id comes back through `startAuth`'s `onWindowCreated`). */
  registerAccountWindow(accountId, windowId) {
    if (windowId == null) return;
    let ids = this.#pendingWindows.get(accountId);
    if (!ids) this.#pendingWindows.set(accountId, (ids = new Set()));
    ids.add(windowId);
  }

  /** Removal is by windowId, never by account: two windows can be open at
   *  once, and clearing the account would leave the survivor unreachable
   *  from `onFocusAccountPopup`. */
  unregisterAccountWindow(accountId, windowId) {
    const ids = this.#pendingWindows.get(accountId);
    if (!ids) return;
    ids.delete(windowId);
    if (ids.size === 0) this.#pendingWindows.delete(accountId);
  }

  // ── Private: port + dispatch ────────────────────────────────────────────

  #attachPort() {
    browser.runtime.onConnectExternal.addListener((incoming) => {
      if (incoming.sender?.id !== TBSYNC_ID) return;
      if (incoming.name !== PORT_NAME) return;
      if (this.#port) {
        try {
          this.#port.disconnect();
        } catch (err) {
          console.debug(
            `${this.#logPrefix} prior port.disconnect failed:`,
            err,
          );
        }
      }
      this.#port = incoming;
      incoming.onMessage.addListener((msg) => this.#onPortMessage(msg));
      incoming.onDisconnect.addListener(() => {
        if (this.#port === incoming) this.#port = null;
        this.#rejectAllPending(ERR.PORT_CLOSED, "host disconnected");
      });
      // Fire the subclass hook so startup work that needs the port
      // (provider→host reads via listAccounts/getAccount) runs at the
      // right moment. Warn-not-throw keeps a buggy subclass from poisoning
      // the fresh port.
      this.onConnectedToHost().catch((err) =>
        console.warn(`${this.#logPrefix} onConnectedToHost failed:`, err),
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
          try {
            cb();
          } catch (err) {
            console.warn(
              `${this.#logPrefix} onceConnectedToHost callback threw:`,
              err,
            );
          }
        }
      }
    });
  }

  /** Announce whenever the host tells us it has started listening - either
   *  because it booted after us and our first announce was lost, or because
   *  it was restarted, enabled or installed mid-session. This is the only
   *  recovery path there is, and the only one there needs to be.
   *
   *  The ack is not read by the host; it exists so its sendMessage resolves
   *  instead of raising "no response". */
  #attachHostReadyListener() {
    browser.runtime.onMessageExternal.addListener((msg, sender) => {
      if (sender?.id !== TBSYNC_ID) return;
      if (msg?.type !== DISCOVERY.HOST_READY) return;
      this.announce().catch((err) =>
        console.debug(`${this.#logPrefix} announce on host-ready failed:`, err),
      );
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
      else
        entry.reject(
          withCode(
            new Error(msg.error ?? "host error"),
            msg.errorCode ?? ERR.UNKNOWN_COMMAND,
            msg.errorDetails ?? null,
          ),
        );
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
    const syncing = SYNC_CMDS.has(msg.cmd) ? (msg.args?.accountId ?? null) : null;
    // One controller per account, owned by the command that created it.
    //
    // Ownership matters because the host does not wait for us: it settles a
    // cancelled SYNC_FOLDER and moves on, so its next command can arrive
    // while our handler is still unwinding. Without the owner check, that
    // handler's `finally` would delete the *new* command's controller
    // (making the new sync uncancellable), and an aborted controller left
    // in the map would be handed to the new sync, which would then fail
    // every request instantly.
    if (syncing != null) {
      const held = this.#syncAborts.get(syncing);
      if (!held || held.controller.signal.aborted) {
        this.#syncAborts.set(syncing, {
          controller: new AbortController(),
          owner: msg.requestId,
        });
      }
    }
    try {
      const result = await this.#callHostCmdHandler(msg.cmd, msg.args ?? {});
      if (this.#port === activePort) {
        activePort.postMessage({
          requestId: msg.requestId,
          ok: true,
          result: result ?? null,
        });
      }
    } catch (err) {
      if (this.#port === activePort) {
        activePort.postMessage({
          requestId: msg.requestId,
          ok: false,
          error: err.message ?? "unknown error",
          errorCode: errorCodeFor(err),
          // Only `message` crosses the port, so a programming error inside a
          // provider used to arrive with no origin at all - and the host's
          // own stack points at the wrapper it just built, not at the fault.
          // One reproduction with this in place located a TypeError that had
          // been unfindable by reading code.
          errorDetails: err.details ?? err.stack ?? null,
        });
      }
    } finally {
      // Only if it is still ours - see the ownership note above.
      if (syncing != null) {
        const held = this.#syncAborts.get(syncing);
        if (held?.owner === msg.requestId) this.#syncAborts.delete(syncing);
      }
    }
  }

  /** Map HOST_CMD to the on* hook. Adding a new command = one case here
   *  plus one override in the subclass. */
  #callHostCmdHandler(cmd, args) {
    switch (cmd) {
      case HOST_CMD.SYNC_ACCOUNT:
        return this.onSyncAccount(args);
      case HOST_CMD.SYNC_FOLDER:
        return this.onSyncFolder(args);
      case HOST_CMD.CANCEL_SYNC:
        return this.onCancelSync(args);
      case HOST_CMD.OPEN_SETUP_POPUP:
        return this.onOpenSetupPopup(args);
      case HOST_CMD.FOCUS_SETUP_POPUP:
        return this.onFocusSetupPopup(args);
      case HOST_CMD.OPEN_CONFIG_POPUP:
        return this.onOpenConfigPopup(args);
      case HOST_CMD.FOCUS_ACCOUNT_POPUP:
        return this.onFocusAccountPopup(args);
      case HOST_CMD.REAUTHENTICATE:
        return this.onReauthenticate(args);
      case HOST_CMD.ACCOUNT_ENABLED:
        return this.onAccountEnabled(args);
      case HOST_CMD.ACCOUNT_DISABLED:
        return this.onAccountDisabled(args);
      case HOST_CMD.ACCOUNT_DELETED:
        return this.onAccountDeleted(args);
      case HOST_CMD.FOLDER_ENABLED:
        return this.onFolderEnabled(args);
      case HOST_CMD.FOLDER_DISABLED:
        return this.onFolderDisabled(args);
      case HOST_CMD.GET_SORTED_FOLDERS:
        return this.onGetSortedFolders(args);
      // Answered here rather than by a subclass hook: the work is identical
      // for every provider and there is nothing one could usefully do
      // differently.
      case HOST_CMD.RELOAD:
        return this.#reloadSelf();
      default:
        throw withCode(
          new Error(`Unknown command: ${cmd}`),
          ERR.UNKNOWN_COMMAND,
        );
    }
  }

  /** Reload this add-on, so a rebuilt `dev/` tree takes effect without a
   *  reinstall.
   *
   *  Only meaningful for a temporarily installed add-on: `runtime.reload()`
   *  re-installs one from its source bundle, but merely disables and
   *  re-enables a permanently installed one, which restarts identical code.
   *  Refusing is better than reporting success for a reload that changed
   *  nothing - and worse, dropped the host's port on the way.
   *
   *  `management.getSelf()` needs no permission (the schema gates the
   *  management API per function, and this one declares none), and
   *  `installType` is "development" exactly when the add-on is temporarily
   *  installed - the same flag reload() branches on.
   *
   *  Resolves *before* reloading. The caller's reply is posted after this
   *  returns, and a background page that has already torn itself down cannot
   *  post it: the host would see E:TIMEOUT for a reload that worked. */
  async #reloadSelf() {
    const { installType } = await browser.management.getSelf();
    if (installType !== "development") {
      throw withCode(
        new Error(
          `reload needs a temporarily installed add-on (this one is ` +
            `"${installType}") - a reload would restart the same code`,
        ),
        ERR.NOT_TEMPORARY,
      );
    }
    setTimeout(() => browser.runtime.reload(), RELOAD_DELAY_MS);
    return { reloading: true, installType };
  }

  #sendCmd(cmd, args = {}) {
    if (!this.#port) {
      return Promise.reject(
        withCode(new Error("host not connected"), ERR.PORT_CLOSED),
      );
    }
    const requestId = `${this.#shortName}-request-${crypto.randomUUID()}`;
    const activePort = this.#port;
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      if (!NO_TIMEOUT_CMDS.has(cmd)) {
        entry.timer = setTimeout(() => {
          this.#pending.delete(requestId);
          reject(
            withCode(new Error(`Timeout waiting for ${cmd}`), ERR.TIMEOUT),
          );
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
    } catch (err) {
      // Port races with disconnect; expected during shutdown.
      console.debug(
        `${this.#logPrefix} #notify(${type}) postMessage failed:`,
        err,
      );
    }
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
    browser.runtime.onMessage.addListener((msg) => {
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
  completeSetup({ setupToken, accountName, icon, initialFolders, custom }) {
    const entry = this.#pendingSetups.get(setupToken);
    if (!entry) return false;
    this.#pendingSetups.delete(setupToken);
    entry.resolve({
      accountName,
      icon: icon ?? null,
      initialFolders: initialFolders ?? [],
      custom: custom ?? {},
    });
    return true;
  }

  /** Reject the pending setup promise when the window is closed. 500 ms
   *  grace period because the completion message races window.close(). */
  #attachSetupCancelListener() {
    browser.windows.onRemoved.addListener((winId) => {
      for (const [token, entry] of this.#pendingSetups) {
        if (entry.windowId !== winId) continue;
        setTimeout(() => {
          const still = this.#pendingSetups.get(token);
          if (!still) return;
          this.#pendingSetups.delete(token);
          still.reject(
            Object.assign(new Error("setup cancelled"), {
              code: ERR.CANCELLED,
            }),
          );
        }, 500);
      }
    });
  }

  // ── Private: helpers ────────────────────────────────────────────────────

  #notImplemented(which) {
    return withCode(
      new Error(`${which} not implemented by provider`),
      ERR.UNKNOWN_COMMAND,
    );
  }
}

/** Resolve when `windows.onRemoved` fires for `windowId`. */
function waitForWindowClose(windowId) {
  return new Promise((resolve) => {
    const listener = (closedId) => {
      if (closedId !== windowId) return;
      browser.windows.onRemoved.removeListener(listener);
      resolve();
    };
    browser.windows.onRemoved.addListener(listener);
  });
}
