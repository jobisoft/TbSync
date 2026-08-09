/**
 * Wire protocol between TbSync (host) and provider add-ons.
 *
 * This module is the single source of truth for message names, port name, and
 * version numbers.
 *
 * **THIS FILE IS VENDORED INTO EVERY CONSUMER** - each provider and TbSync
 * itself, under `src/vendor/tbsync/`. The copy in `TbSync/common/protocol/` is
 * authoritative and all the others MUST match it byte-for-byte. Edit it
 * there, then re-vendor and verify in one step:
 *     TbSync/common/vendor.sh
 * See `TbSync/common/README.md`.
 */

/**
 * Bumped whenever host and providers must be upgraded together. The host
 * rejects a mismatched announce outright, so a stale provider fails to
 * connect rather than misbehaving quietly - which is the whole point when
 * the incompatibility is behavioural rather than a change to the messages
 * themselves.
 *
 *   1.1  `legacyMigrationPending` + PROVIDER_CMD.LEGACY_MIGRATION_DONE.
 *   1.2  An E:AUTH account is no longer torn down (see the error-code notes
 *        below). Its folders, sync keys and local resources survive, so
 *        recovery resumes from the existing sync state instead of pulling
 *        everything fresh. A provider that cannot re-match server items to
 *        local ones when a sync key is rejected would duplicate the whole
 *        folder on the first such recovery, so those must not pair with a
 *        1.2 host.
 *
 *        FOCUS_CONFIG_POPUP and FOCUS_REAUTH_POPUP also replaced by the
 *        single FOCUS_ACCOUNT_POPUP. They only ever differed in which
 *        internal map the provider looked in, and nothing consumed the
 *        distinction.
 *
 *   1.3  Discovery is driven by the host instead of guessed at by the
 *        provider. A 1.3 provider announces exactly once, when it is ready,
 *        and otherwise waits to be told the host is listening. Against a
 *        host that never broadcasts HOST_READY it fails to register on
 *        every start it loses the race for, which is why this is a version
 *        bump and not a drop-in change.
 *
 *   2    The version this tree speaks. 5.0.13 shipped 1.3, so 2 is not yet
 *        released and stays open until it is: anything landing before then
 *        belongs in this entry, since every peer that will speak 2 is built
 *        from this tree.
 *
 *        HOST_CMD.RELOAD: the host can ask a provider to reload itself. No
 *        extension can reload another - runtime.reload() takes no id and
 *        management.setEnabled() is themes-only - so this is the only shape
 *        available, and a 1.3 provider has no handler for it.
 *
 *        Folder rows carry `sessionId`, and a provider may keep its own
 *        change queue namespaced by it (see the field's notes below). That
 *        is the second reason 2 cannot pair with 1.3: those rows have no
 *        session, so nothing tells such a provider that a folder it still
 *        holds a queue for has been torn down and re-created, and edits
 *        belonging to a dead binding would be pushed into a live one.
 *        HOST_CMD.GET_CHANGELOG reads those queues.
 *
 *        Versions are integers from here on: the dotted form implied minor
 *        bumps a peer could tolerate, and the host refuses any provider
 *        whose version is not exactly its own.
 */
export const PROTOCOL_VERSION = 2;

/** Name used for the persistent runtime.connect port.
 *
 *  The "v5" is the add-on generation, not the protocol version, and does not
 *  move when PROTOCOL_VERSION does. TbSync 4 spoke to its providers by an
 *  entirely different mechanism, so the name says which era of TbSync is
 *  calling and nothing more.
 *
 *  It deliberately does *not* carry the protocol version. The version is
 *  agreed before any port exists - the host refuses a mismatched ANNOUNCE
 *  and only opens a port to a provider it has already accepted - so a
 *  version in this name could never disagree with it and never fire.
 *
 *  Encoding it here would only make failures quieter: a name mismatch is
 *  answered with a bare `return` in the provider's onConnectExternal
 *  listener - no error, no log - while the version check writes the reason
 *  to the event log. A future bump that updated one constant and forgot the
 *  other would produce a silent, unexplainable disconnect.
 *
 *  What guards this port is the sender check beside it - only TbSync's own
 *  extension id is accepted. The name just distinguishes this port from any
 *  other the extension may receive. */
export const PORT_NAME = "tbsync-v5";

/** Discovery message types (runtime.onMessageExternal, one-shot).
 *
 *  ANNOUNCE / UNANNOUNCE travel provider → host and carry the handshake.
 *  HOST_READY travels host → provider and carries nothing: it is a
 *  fire-and-forget "I am listening now", sent once to every enabled
 *  extension, and its only effect is to make a provider that is already
 *  running announce itself. The reply is ignored.
 *
 *  Between them they cover both startup orders without either side timing
 *  anything, provided each attaches its listener before it sends. */
export const DISCOVERY = {
  ANNOUNCE: "tbsync-provider-announce",
  HOST_READY: "tbsync-host-ready",
  UNANNOUNCE: "tbsync-provider-unannounce",
};

/** TbSync → Provider command names. */
export const HOST_CMD = {
  SYNC_ACCOUNT: "syncAccount",
  SYNC_FOLDER: "syncFolder",
  /** `{ accountId }` - stop this account's sync now.
   *
   *  The provider must abort its in-flight requests (not merely stop
   *  looping between them: the case this exists for is a server that has
   *  stopped answering), unwind, and let the outstanding SYNC_ACCOUNT /
   *  SYNC_FOLDER settle with `ERR.CANCELLED`. Persistent state must be left
   *  consistent - no changelog entry consumed and no sync key advanced for
   *  work that did not complete.
   *
   *  Answer promptly: this is not in `NO_TIMEOUT_CMDS`. The host does not
   *  depend on the answer - it rejects the outstanding sync command itself
   *  the moment it has sent this, because a provider that has stopped
   *  answering is exactly what a cancel has to survive - but a provider
   *  that answers stops on its own terms rather than having its work
   *  declared lost.
   *
   *  The base class implements all of this; a subclass only has to consume
   *  `syncSignal()` / `throwIfCancelled()`. */
  CANCEL_SYNC: "cancelSync",
  OPEN_SETUP_POPUP: "openSetupPopup",
  FOCUS_SETUP_POPUP: "focusSetupPopup",
  OPEN_CONFIG_POPUP: "openConfigPopup",
  REAUTHENTICATE: "reauthenticate",
  // Raise whatever window the provider currently has open for this
  // account, whichever flow opened it. Setup keeps its own command
  // because it runs before an account exists.
  FOCUS_ACCOUNT_POPUP: "focusAccountPopup",
  ACCOUNT_ENABLED: "accountEnabled",
  /** `{ accountId }` - the account is being disconnected.
   *
   *  Stop everything for it and drop provider-side state: auth caches,
   *  runtime directories, sync continuation keys - so the next enable
   *  starts clean. **Never delete Thunderbird resources**: the host owns
   *  target deletion in every flow and performs it right after this
   *  returns, whether or not it returns - a provider that cannot answer is
   *  skipped, which is what makes Disconnect a recovery path. */
  ACCOUNT_DISABLED: "accountDisabled",
  /** `{ accountId }` - the account is being removed.
   *
   *  Same contract as ACCOUNT_DISABLED: stop, clean provider state, do not
   *  touch resources. The host deletes the targets (unless the user chose
   *  to keep them) and then forgets the account entirely; by the time this
   *  settles, host RPCs about the account will answer "unknown account".
   *  The former `purgeTargets` argument is gone - keeping or purging is
   *  the host's decision now. */
  ACCOUNT_DELETED: "accountDeleted",
  FOLDER_ENABLED: "folderEnabled",
  FOLDER_DISABLED: "folderDisabled",
  GET_SORTED_FOLDERS: "getSortedFolders",
  // Ask the provider to reload itself. Answered by the base class, not by a
  // subclass hook - the work is identical everywhere and there is nothing a
  // provider could usefully do differently. Only useful for a temporarily
  // installed provider, which is the only kind whose reload re-reads its
  // source; the base class refuses otherwise rather than restarting the same
  // code and reporting success.
  RELOAD: "reload",
  /** `{ accountId, folderId }` → the provider's own pending change queue
   *  for that folder, as changelog rows, or `null` if it keeps none.
   *
   *  The read side of a provider's queue, and the only one: the folder
   *  row's `changelog` is an import inbox, not a record of what is pending.
   *  The host needs this for diagnostics and the bridge's test suites read
   *  it after every sync. A provider that keeps no queue answers `null`.
   *
   *  Read-only: answering must not consume, re-order, or repair anything. */
  GET_CHANGELOG: "getChangelog",
};

/** Provider → TbSync command names (RPC).
 *
 * ## Row shape contract (accounts and folders)
 *
 * Both row kinds carry **flat universal fields** plus one opaque
 * `custom: {}` object the host never interprets.
 *
 * Account universal fields (host-authored or host-interpreted):
 *   accountId, accountName, provider, enabled,
 *   error, lastSyncTime, autoSyncIntervalMinutes, noAutosyncUntil, icon,
 *   legacyMigrationPending, custom
 *
 * `legacyMigrationPending` marks a row the legacy importer produced. The
 * importer lifts the host-owned fields out of the legacy JSON but copies
 * every provider field into `custom` verbatim, so the row is only half
 * converted: whatever reshaping the provider's own data needs has not
 * happened yet. The host cannot do that reshaping - it does not know what
 * shape any provider's `custom` should have - so it flags the row instead
 * and refuses to service the account until the owning provider reports
 * back via LEGACY_MIGRATION_DONE.
 *
 * The flag exists because the importer can run more than once. Its only
 * guard is the absence of the host's own account storage, and the legacy
 * JSON on disk is never consumed, so anything that clears host storage
 * (reinstalling TbSync) makes the next boot re-import the legacy snapshot
 * over rows a provider had already finished converting. Providers cannot
 * detect that on their own: no provider event fires, and a provider's own
 * install/update state says nothing about what the host just did.
 *
 * `icon` is an optional per-account icon override: a size-keyed map of
 * **relative** paths within the provider extension, e.g.
 * `{ "16": "icons/foo16.png", "32": "icons/foo32.png" }`. The host
 * resolves them at render time against the provider's announced URL
 * prefix; absolute URLs are rejected at the wire boundary so nothing
 * `moz-extension://…` ever lands in persistent storage (the UUID is
 * not stable across profile copies / reinstalls). When null/absent,
 * the manager's account row falls back to the provider's announced
 * icon set. Provider-authored at register time (REGISTER_ACCOUNT.icon)
 * and patchable via UPDATE_ACCOUNT. The provider list (separate from
 * the account list) always uses the provider's announced icons; this
 * field affects the account row only.
 *
 * Folder universal fields:
 *   folderId, accountId, targetType, displayName, selected, readOnly,
 *   downloadOnly, hidden, status, warning, error, lastSyncTime, orderIndex,
 *   targetID, targetName, targetColor, changelog, sessionId, custom
 *
 * `sessionId` names the current *binding* of this folder - one generation
 * of "this row, this local resource, this sync state". The host mints it,
 * never reuses one, and replaces it whenever that generation ends: the
 * folder is deselected, or its local resource is deleted. The row itself
 * survives; what it was is over.
 *
 * It exists so a provider can keep per-folder state of its own - a change
 * queue, most of all - without the host having to reach into that state to
 * clean it up. The provider namespaces everything it stores by the session
 * it saw; the host ends a generation by changing the id, which is a
 * host-side fact needing no live provider (that is the point: Disconnect
 * and Remove have to work when a provider is broken or gone). Next time the
 * provider is asked anything, the session it holds data under is no longer
 * one the host names, and it purges it.
 *
 * A provider MUST therefore:
 *   - read `sessionId` from the folder row, never cache it across a sync;
 *   - key everything it persists per folder by it;
 *   - drop, on sight, anything stored under a session no folder row names.
 * A provider that ignores it would push edits belonging to a binding the
 * user has already thrown away.
 *
 * `changelog` is an inbox, not a queue. The host writes it in exactly one
 * situation - importing a TbSync 4 profile, whose pending edits have to
 * land somewhere - and a provider empties it (patch `changelog: []` via
 * UPDATE_FOLDER) once it has taken the contents into its own storage.
 * Nothing else writes it and it is empty in normal operation;
 * HOST_CMD.GET_CHANGELOG is how anyone reads what is actually pending.
 *
 * `readOnly` is server-announced (provider-authored from the server's ACL).
 * `downloadOnly` is the user override surfaced as the manager's ACL toggle;
 * it is only meaningful when `readOnly` is false. The effective read-only
 * state for sync gating and the manager icon is `readOnly || downloadOnly`.
 *
 * `hidden` is provider-authored on every push. Rows with `hidden: true`
 * are kept in storage but excluded from the manager UI's folder list.
 *
 * `targetID` / `targetName` identify the local Thunderbird artifact bound
 * to the remote resource (address-book id, calendar id, task-list id, …).
 * They are null until the provider's first sync creates the local artifact
 * and writes them back via UPDATE_FOLDER.
 *
 * `targetName` and `targetColor` describe how the user has that artifact
 * set up, and outlive it on purpose. Unbinding a resource destroys the
 * calendar or book, so a provider that clears these along with `targetID`
 * throws away the name the user chose and the colour they picked, with
 * nothing anywhere able to recover them - no sync protocol carries either.
 * Clear `targetID` when the binding goes; keep these two, and pass them
 * back when the resource is bound again. `targetColor` is a CSS hex colour
 * and only meaningful for calendar-shaped targets.
 *
 * `custom` is opaque to the host and lets each provider stash its own
 * per-row configuration without host-schema changes. The host stores and
 * round-trips it unchanged. All reads never need to check presence - the
 * host defaults `custom` to `{}` on create and across pushes.
 *
 * ## RPC semantics
 *
 * REGISTER_ACCOUNT { accountName, icon?, custom?, initialFolders? }
 *   → creates a host account row in the disabled state. `custom` seeds
 *   the opaque blob atomically. `icon` seeds the per-account icon
 *   override (see "Account universal fields" above). `initialFolders`
 *   descriptors can carry `targetID`, `targetName`, `custom` on a
 *   per-folder basis. The user clicks Connect in the manager when ready;
 *   that fires ACCOUNT_ENABLED and is the provider's first chance to
 *   talk to the server (folder discovery, version negotiation, etc.).
 *
 * UPDATE_ACCOUNT { accountId, patch }
 *   → patches top-level writable fields (`accountName`, `noAutosyncUntil`,
 *   `icon`) and shallow-merges `patch.custom` into the existing `custom`
 *   blob. Drop a `custom` key by patching it to `null` - there is no
 *   explicit delete op; same convention applies to `icon` (patch null to
 *   clear and fall back to the provider icon). Other top-level fields
 *   are host-authored. Set `noAutosyncUntil` to a future epoch-ms
 *   timestamp to suppress autosync ticks (e.g. after a soft failure /
 *   rate limit); manual sync from the manager bypasses the gate.
 *
 * UPDATE_FOLDER { accountId, folderId, patch }
 *   → patches top-level writable fields (`displayName`, `targetType`,
 *   `readOnly`, `downloadOnly`, `targetID`, `targetName`, `changelog` -
 *   the last only to empty the import inbox described above) and shallow-merges
 *   `patch.custom` like UPDATE_ACCOUNT. `warning` / `error` / `lastSyncTime`
 *   / `status` are host-authored from the sync RPC outcome - see "Authoring"
 *   below. `downloadOnly` is also writable via the host's
 *   `setFolderDownloadOnly` manager RPC; providers don't normally set it
 *   themselves.
 *
 * PUSH_FOLDER_LIST { accountId, folders: [descriptor…] }
 *   → replaces the account's folder list. `selected`, `downloadOnly`,
 *   `lastSyncTime`, `targetID`, `targetName`, and `custom` are preserved
 *   from prior rows when the descriptor omits them, so the provider can
 *   re-push folder lists freely without wiping locally-bound state.
 *   `hidden` is taken straight from the descriptor (default `false` if
 *   omitted).
 *
 * LEGACY_MIGRATION_DONE { accountId }
 *   → clears `legacyMigrationPending`, making the account serviceable
 *   again. Send it once the provider has finished converting that
 *   account's imported `custom` (and any folder state hanging off it) to
 *   the shape the current code expects. Per-account on purpose: one
 *   account failing to convert must not unblock the rest.
 *
 *   Send it only for accounts that actually converted. Leaving the flag
 *   set is the failure path - the account stays blocked and the provider
 *   is asked again on the next boot, which is why per-account conversion
 *   work has to be idempotent.
 */
export const PROVIDER_CMD = {
  REGISTER_ACCOUNT: "registerAccount",
  UPDATE_ACCOUNT: "updateAccount",
  UPDATE_FOLDER: "updateFolder",
  PUSH_FOLDER_LIST: "pushFolderList",
  // Read-side: the host is the source of truth for account + folder rows,
  // so the provider pulls its context at the top of each on* handler that
  // needs it. Both are scoped to the caller's providerId.
  LIST_ACCOUNTS: "listAccounts",
  GET_ACCOUNT: "getAccount",
  FOLDER_TARGET_REMOVED: "folderTargetRemoved",
  /** `{ targets: [{ targetID, targetType }] }` - resources this provider
   *  has stopped syncing and cannot resume.
   *
   *  Sent when a provider sweeps state belonging to a binding the host no
   *  longer names. Normally that binding's resource is already gone, since
   *  the host deletes targets in every teardown flow - so a resource that
   *  still exists here is one nothing will ever sync again. The usual way
   *  to get one is reinstalling TbSync: its rows go, the provider's queues
   *  reference ids that no longer resolve, and the calendars and books are
   *  left behind, silently, looking exactly like working ones.
   *
   *  The host renames each to mark it, and disables it where the platform
   *  has a notion of disabled (calendars do; address books do not). It does
   *  not delete: the data is the user's, the name is reversible, and a
   *  provider's belief that it has been orphaned is not grounds for
   *  destroying a calendar.
   *
   *  The provider says *which*; the host decides *what to do with a
   *  resource*, as it already does for creation and deletion. */
  REPORT_ORPHANED_TARGETS: "reportOrphanedTargets",
  REQUEST_SYNC: "requestSync",
  // Provider-scoped upgrade lock. While locked, the host treats every
  // account belonging to the provider as "upgrading" - refuses every
  // user-initiated RPC and skips autosync ticks. Used by the provider's
  // one-shot upgrade runner so user-visible actions don't race with
  // upgrade work. Args: { locked: boolean }.
  SET_PROVIDER_UPGRADE_LOCK: "setProviderUpgradeLock",
  // Clears `legacyMigrationPending` for one account. Args: { accountId }.
  // The host sets that flag on every row its legacy importer produces and
  // treats a flagged account as unserviceable; this is the only way to
  // clear it. See the account-field notes above.
  LEGACY_MIGRATION_DONE: "legacyMigrationDone",
};

/** Provider → TbSync notification types (no response).
 *
 *  REPORT_EVENT_LOG { level, message, accountId?, folderId?, details? }
 *    Appends an entry to the host's session-scoped event log. `level` is
 *    REQUIRED and MUST be one of "error" | "warning" | "info" | "debug"; the host
 *    rejects payloads without a valid level. The host applies its own
 *    capture gate from `settings.logLevel` before persisting.
 */
export const PROVIDER_NOTIFY = {
  REPORT_SYNC_STATE: "reportSyncState",
  REPORT_PROGRESS: "reportProgress",
  REPORT_EVENT_LOG: "reportEventLog",
};

/**
 * Sync-state protocol - the status cell's wire format.
 *
 * A provider emits REPORT_SYNC_STATE { accountId, folderId, syncState, label? }
 * during any sync phase it wants visible in the manager.
 *
 * ## Base syncstates (localised on the host)
 * The host ships `syncstate.*` translations for these four bases only:
 *   - syncstate.sync          - generic active sync
 *   - syncstate.prepare       - preparation phase (may be extended)
 *   - syncstate.send          - awaiting network response (may be extended)
 *   - syncstate.eval          - processing response (may be extended)
 *
 * ## Extended syncstates (provider-granular)
 * A provider may extend `send`, `eval`, or `prepare` with a dot-suffix, e.g.
 * `"send.request.folders"`. The suffix is provider-internal; the host does
 * NOT interpret it.
 *
 * ## Display resolution (in order)
 *   1. If `label` is present, show it.
 *   2. Else if `syncState` is an exact base key, show its host translation.
 *   3. Else if `syncState`'s first segment is a base key, show
 *      "{localised-base} ({suffix})" - the suffix appears verbatim in
 *      parentheses as a diagnostic hint.
 *   4. Else show the raw `syncState`.
 *
 * ## Decorations (independent of display; driven by `syncState` structure)
 *   - `syncState` starts with "send." or equals "send" AND the provider's
 *     capabilities.connectionTimeoutMs is set → countdown "(Xs)" appears
 *     2 s into the state and refreshes every second.
 *   - Any state when REPORT_PROGRESS is live for the folder → counter
 *     "(done/total)" is appended.
 *
 * ## When should a provider send `label`?
 * If the provider has richer internal localisation (like EAS's 39 translated
 * states), it should pre-resolve via its own browser.i18n.getMessage and send
 * the result as `label`. The user sees high-quality phase-level text without
 * the host having to grow a vocabulary.
 *
 * ## When should a provider stick to bare base states?
 * If one of the four base states communicates enough (like Google's simple
 * contacts sync), emit the bare base state and omit `label`. The host
 * translates.
 */
export const SYNCSTATE_BASE_KEYS = new Set(["sync", "prepare", "send", "eval"]);

/**
 * Warning / error messages on accounts + folders - the provider's channel
 * for surfacing persistent, visible state (distinct from transient syncstate
 * or one-shot event-log entries).
 *
 * ## Wire shape
 * A message is just `string | null` on the respective `warning` or `error`
 * field of an account record, a folder record, or any of the descriptors
 * pushed via PUSH_FOLDER_LIST / UPDATE_ACCOUNT / UPDATE_FOLDER.
 *
 * `null` means "no message". A non-null string is resolved for display in
 * this order:
 *   1. `browser.i18n.getMessage("error." + s)` - host-shipped predefined
 *      error code.
 *   2. `browser.i18n.getMessage("warning." + s)` - predefined warning code.
 *   3. Raw `s` - verbatim free-text fallback.
 *
 * The provider picks one or the other per message: a predefined code for
 * the common localised cases, or a free-text string when context is more
 * valuable than localisation.
 *
 * ## Host-predefined codes
 * These are the codes the host currently ships translations for. Send any
 * of them as-is in a `warning` / `error` field and the UI will render the
 * localised label.
 *
 * Each code in this list lives in the shared `ERR` enum below - provider-
 * specific codes belong in the provider's own `_locales/`, not here.
 *
 *   error.E:AUTH                  - Authentication failed. Special-cased
 *                                    on the account: stamps the record
 *                                    when a sync throws with `code:
 *                                    ERR.AUTH`, and the manager swaps in
 *                                    the Authenticate button. The stamp
 *                                    is all that happens - the account
 *                                    stays connected and keeps its
 *                                    folders and local resources, and
 *                                    the host simply refuses to sync it
 *                                    until the error is cleared.
 *   error.E:NETWORK               - Could not reach the server.
 *   error.E:TIMEOUT               - Operation timed out.
 *   error.E:CANCELLED             - Operation cancelled. Also what an
 *                                   aborted sync settles with, so it is
 *                                   never a failure the user has to read.
 *   error.E:PROVIDER_UNAVAILABLE  - Provider extension is not available.
 *   error.E:PROTOCOL_VERSION      - Provider protocol version mismatch.
 *   error.E:UNKNOWN_ACCOUNT       - Unknown account.
 *   error.E:UNKNOWN_FOLDER        - Unknown folder.
 *   error.E:UNKNOWN_COMMAND       - Unsupported command.
 *   error.E:PORT_CLOSED           - Disconnected from the provider.
 *   error.E:QUOTA                 - Storage quota exceeded.
 *   error.E:NOT_TEMPORARY         - Reload asked of a permanent install.
 *
 * No warning codes are predefined yet. Providers may return any free-text
 * warning via the `warning(...)` StatusData helper; the UI renders it
 * verbatim until the host adds a key.
 *
 * As providers emerge with shared failure modes, we add more entries here
 * - additive, no wire change.
 *
 * ## Authoring
 * The host owns these fields. Providers signal status through the RPC
 * return shape: `ok(message)` / `warning(message, details)` /
 * `error(message, details)` from `tbsync/status.mjs`, or by throwing with
 * `code: ERR.*` for hard failures. The host writes the corresponding
 * `folder.warning` / `folder.error` / `folder.lastSyncTime` /
 * `account.error` from that signal; providers should not write any of
 * these fields directly.
 *
 * ## Aggregation
 * The account's visible status is derived from the aggregate: any selected
 * folder with a non-null `error` (or the account's own `error`) → the
 * account pill is red. Any selected folder with a non-null `warning`
 * → yellow. `error: "E:AUTH"` on an account record is special-cased by
 * the manager: the pill reads "Authentication failed" and the primary
 * button becomes Authenticate. Sync is held back while it stands;
 * connecting and disconnecting stay available.
 */
/** Shared error codes. */
export const ERR = {
  PORT_CLOSED: "E:PORT_CLOSED",
  PROTOCOL_VERSION: "E:PROTOCOL_VERSION",
  AUTH: "E:AUTH",
  NETWORK: "E:NETWORK",
  CANCELLED: "E:CANCELLED",
  QUOTA: "E:QUOTA",
  PROVIDER_UNAVAILABLE: "E:PROVIDER_UNAVAILABLE",
  UNKNOWN_ACCOUNT: "E:UNKNOWN_ACCOUNT",
  UNKNOWN_FOLDER: "E:UNKNOWN_FOLDER",
  UNKNOWN_COMMAND: "E:UNKNOWN_COMMAND",
  // The provider threw something that is not one of the codes below - a
  // TypeError, a failed assertion, a bug. Distinct from UNKNOWN_COMMAND,
  // which says the *command* was wrong and would send whoever reads it
  // after the caller when the fault is inside the provider. The message is
  // deliberately not shown to the user; it is a stack or a JS error string,
  // and the event log is where it belongs.
  PROVIDER_FAULT: "E:PROVIDER_FAULT",
  TIMEOUT: "E:TIMEOUT",
  // Asked to reload while permanently installed. Not a malfunction - the
  // reload would have restarted identical code and reported success, which
  // is worse than refusing.
  NOT_TEMPORARY: "E:NOT_TEMPORARY",
};

export const PREDEFINED_ERROR_CODES = new Set([
  ERR.AUTH,
  ERR.NETWORK,
  ERR.CANCELLED,
  ERR.QUOTA,
  ERR.TIMEOUT,
  ERR.PORT_CLOSED,
  ERR.PROTOCOL_VERSION,
  ERR.PROVIDER_UNAVAILABLE,
  ERR.UNKNOWN_ACCOUNT,
  ERR.UNKNOWN_FOLDER,
  ERR.UNKNOWN_COMMAND,
  ERR.PROVIDER_FAULT,
  ERR.NOT_TEMPORARY,
]);
export const PREDEFINED_WARNING_CODES = new Set();

/**
 * Attach an error code (and optional details) to an Error object without
 * clobbering any existing code. Returns the same Error for chaining.
 * Every host↔provider-speaking module uses this to stamp the code that gets
 * serialized onto the wire as `errorCode`.
 */
export function withCode(err, code, details = null) {
  if (!err.code) err.code = code;
  if (details != null && !err.details) err.details = details;
  return err;
}

/** Default timeout for host→provider RPCs in milliseconds. */
export const DEFAULT_RPC_TIMEOUT_MS = 30_000;

/** Long-running RPCs (sync, popups) that should not be timed out. */
export const NO_TIMEOUT_CMDS = new Set([
  HOST_CMD.SYNC_ACCOUNT,
  HOST_CMD.SYNC_FOLDER,
  HOST_CMD.OPEN_SETUP_POPUP,
  HOST_CMD.OPEN_CONFIG_POPUP,
  HOST_CMD.REAUTHENTICATE,
]);
