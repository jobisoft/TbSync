/**
 * Wire protocol between TbSync (host) and provider add-ons.
 *
 * This module is the single source of truth for message names, port name, and
 * version numbers.
 *
 * **THIS FILE IS MIRRORED INTO EVERY PROVIDER ADD-ON.** The copy in
 * `tbsync-new/tbsync/protocol.mjs` is authoritative; the copies shipped by
 * providers (e.g. `google-4-tbsync/vendor/tbsync/protocol.mjs`) MUST match
 * it byte-for-byte. When you change this file, re-copy it to every provider
 * and confirm with:
 *     diff -q tbsync-new/tbsync/protocol.mjs google-4-tbsync/vendor/tbsync/protocol.mjs
 */

export const PROTOCOL_VERSION = "1.0";

/** Name used for the persistent runtime.connect port. Includes major version so
 *  a breaking protocol bump leaves mismatched peers silently disconnected. */
export const PORT_NAME = "tbsync-v1";

/** Discovery message types (runtime.onMessageExternal, one-shot). */
export const DISCOVERY = {
  ANNOUNCE: "tbsync-provider-announce",
  PROBE: "tbsync-probe",
  UNANNOUNCE: "tbsync-provider-unannounce",
};

/** TbSync → Provider command names. */
export const HOST_CMD = {
  SYNC_ACCOUNT: "syncAccount",
  SYNC_FOLDER: "syncFolder",
  CANCEL_SYNC: "cancelSync",
  OPEN_SETUP_POPUP: "openSetupPopup",
  FOCUS_SETUP_POPUP: "focusSetupPopup",
  OPEN_CONFIG_POPUP: "openConfigPopup",
  FOCUS_CONFIG_POPUP: "focusConfigPopup",
  REAUTHENTICATE: "reauthenticate",
  FOCUS_REAUTH_POPUP: "focusReauthPopup",
  ACCOUNT_ENABLED: "accountEnabled",
  ACCOUNT_DISABLED: "accountDisabled",
  ACCOUNT_DELETED: "accountDeleted",
  FOLDER_ENABLED: "folderEnabled",
  FOLDER_DISABLED: "folderDisabled",
  GET_SORTED_FOLDERS: "getSortedFolders",
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
 *   error, lastSyncTime, autoSyncIntervalMinutes, noAutosyncUntil, custom
 *
 * Folder universal fields:
 *   folderId, accountId, targetType, displayName, selected, readOnly, hidden,
 *   status, warning, error, lastSyncTime, orderIndex, targetID, targetName,
 *   changelog, custom
 *
 * `hidden` is provider-authored on every push. Rows with `hidden: true`
 * are kept in storage but excluded from the manager UI's folder list.
 *
 * `targetID` / `targetName` identify the local Thunderbird artifact bound
 * to the remote resource (address-book id, calendar id, task-list id, …).
 * They are null until the provider's first sync creates the local artifact
 * and writes them back via UPDATE_FOLDER.
 *
 * `custom` is opaque to the host and lets each provider stash its own
 * per-row configuration without host-schema changes. The host stores and
 * round-trips it unchanged. All reads never need to check presence - the
 * host defaults `custom` to `{}` on create and across pushes.
 *
 * ## RPC semantics
 *
 * REGISTER_ACCOUNT { accountName, custom?, initialFolders? }
 *   → creates a host account row in the disabled state. `custom` seeds
 *   the opaque blob atomically. `initialFolders` descriptors can carry
 *   `targetID`, `targetName`, `custom` on a per-folder basis. The user
 *   clicks Connect in the manager when ready; that fires ACCOUNT_ENABLED
 *   and is the provider's first chance to talk to the server (folder
 *   discovery, version negotiation, etc.).
 *
 * UPDATE_ACCOUNT { accountId, patch }
 *   → patches top-level writable fields (`accountName`, `noAutosyncUntil`)
 *   and shallow-merges `patch.custom` into the existing `custom` blob.
 *   Drop a `custom` key by patching it to `null` - there is no explicit
 *   delete op. Other top-level fields are host-authored. Set
 *   `noAutosyncUntil` to a future epoch-ms timestamp to suppress autosync
 *   ticks (e.g. after a soft failure / rate limit); manual sync from the
 *   manager bypasses the gate.
 *
 * UPDATE_FOLDER { accountId, folderId, patch }
 *   → patches top-level writable fields (`displayName`, `targetType`,
 *   `readOnly`, `targetID`, `targetName`) and shallow-merges `patch.custom`
 *   like UPDATE_ACCOUNT. `warning` / `error` / `lastSyncTime` / `status`
 *   are host-authored from the sync RPC outcome - see "Authoring" below.
 *
 * PUSH_FOLDER_LIST { accountId, folders: [descriptor…] }
 *   → replaces the account's folder list. `selected`, `lastSyncTime`,
 *   `targetID`, `targetName`, and `custom` are preserved from prior rows
 *   when the descriptor omits them, so the provider can re-push folder
 *   lists freely without wiping locally-bound state. `hidden` is taken
 *   straight from the descriptor (default `false` if omitted).
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
  // Changelog mutations - the queue lives at `folder.changelog` and is
  // owned by the host's built-in Thunderbird-event observer. Providers
  // tag `*_by_server` entries before their own sync writes so the observer
  // skips the resulting TB events (all events within a 1500 ms window), and clear
  // `*_by_user` entries after successfully pushing them to the server.
  CHANGELOG_MARK_SERVER_WRITE: "changelogMarkServerWrite",
  CHANGELOG_REMOVE: "changelogRemove",
  // Provider-scoped upgrade lock. While locked, the host treats every
  // account belonging to the provider as "upgrading" - refuses every
  // user-initiated RPC and skips autosync ticks. Used by the provider's
  // one-shot upgrade runner so user-visible actions don't race with
  // upgrade work. Args: { locked: boolean }.
  SET_PROVIDER_UPGRADE_LOCK: "setProviderUpgradeLock",
};

/** Provider → TbSync notification types (no response).
 *
 *  REPORT_EVENT_LOG { level, message, accountId?, folderId?, details? }
 *    Appends an entry to the host's session-scoped event log. `level` is
 *    REQUIRED and MUST be one of "error" | "warning" | "debug"; the host
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
export const SYNCSTATE_BASE_KEYS = new Set([
  "sync", "prepare", "send", "eval",
]);

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
 * Each code in this list lives in the shared `ERR` enum below — provider-
 * specific codes belong in the provider's own `_locales/`, not here.
 *
 *   error.E:AUTH                  - Authentication failed. Special-cased
 *                                    on the account: stamps the record
 *                                    when a sync throws with `code:
 *                                    ERR.AUTH`, and the manager swaps in
 *                                    the Sign-in-again button.
 *   error.E:NETWORK               - Could not reach the server.
 *   error.E:TIMEOUT               - Operation timed out.
 *   error.E:CANCELLED             - Operation cancelled.
 *   error.E:PROVIDER_UNAVAILABLE  - Provider extension is not available.
 *   error.E:PROTOCOL_VERSION      - Provider protocol version mismatch.
 *   error.E:UNKNOWN_ACCOUNT       - Unknown account.
 *   error.E:UNKNOWN_FOLDER        - Unknown folder.
 *   error.E:UNKNOWN_COMMAND       - Unsupported command.
 *   error.E:PORT_CLOSED           - Disconnected from the provider.
 *   error.E:QUOTA                 - Storage quota exceeded.
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
 * the manager: the pill reads "Authentication failed" and the card
 * switches to Sign-in-again + Remove buttons.
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
  TIMEOUT: "E:TIMEOUT",
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
