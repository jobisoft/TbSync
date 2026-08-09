/**
 * Single source of truth for every top-level extension-storage key used
 * by tbsync-new. Keeping these in one place prevents stringly-typed drift.
 *
 * Every key is backed by `browser.storage.local` except `PROVIDERS`,
 * which is session-scoped: ProviderMeta is rebuilt from announces each
 * browser session and must not survive across sessions.
 */

export const KEYS = {
  SCHEMA_VERSION: "tbsync.schemaVersion",
  SETTINGS: "tbsync.settings",
  ACCOUNTS: "tbsync.accounts",
  FOLDERS: "tbsync.folders",
  PROVIDERS: "tbsync.providers",
  EVENT_LOG: "tbsync.eventLog",
  MIGRATION: "tbsync.migration",
};

/** Bumped when stored data needs a one-off fixup on the way in.
 *
 *   2  Every folder row carries a `sessionId` - the id of its current
 *      binding, which providers namespace their own per-folder state by.
 *      Rows written before it exists get one stamped on (folders.mjs
 *      `backfillSessionIds`); a row without one would leave a provider
 *      keeping state it can never be told to drop.
 */
export const CURRENT_SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS = {
  // Event-log capture gate. 0 = errors only, 1 = errors + warnings,
  // 2 = errors + warnings + info, 3 = errors + warnings + info debug.
  // Entries with a higher level than this are dropped on append, never
  // enter the buffer, and are therefore never part of a bug report.
  logLevel: 2,
};

export const EVENT_LOG_MAX = 500;
