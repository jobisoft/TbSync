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
  MIGRATION: "tbsync.migration",
  // The edits a previous version queued and never sent, read out of an
  // account's resources while it is locked, before anything can replace
  // them. Written once per account and never amended.
  LEGACY_RESCUE: "tbsync.legacyRescue",
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

/** How many entries the log keeps, unless the user lifts the limit.
 *
 *  Sized for the log a real diagnosis needs, not for the quiet case. The
 *  log rolls, so once it is full it discards the OLDEST entries - the
 *  account setup and the first syncs, exactly the part a report about "it
 *  did not sync at first" turns on. Measured against one such report:
 *  setup plus a first sync of three collections is 25 entries, but the
 *  sync that finally succeeds pulls every item at a window of 25, two
 *  entries per page - so a mailbox of a few thousand items spends several
 *  hundred entries on its own and carries the interesting part away.
 *
 *  A test run reads the log too: a section asserting on what was sent
 *  reads it back, and once it rolls the missing command reads as "never
 *  sent" rather than "no longer recorded".
 *
 *  This is the default, not a stored setting: the record is seeded once
 *  from DEFAULT_SETTINGS and never revisited, so a stored number would
 *  freeze every profile at whatever was current the day it was created.
 *  What IS stored is the user's choice to lift the limit entirely. */
export const EVENT_LOG_MAX = 5000;

/** How many entries the manager shows at once. The log itself may be far
 *  longer with the limit lifted; a bug report and the downloaded file get
 *  all of it, but a table builds one DOM row per entry and there is no
 *  reading a hundred thousand of them. */
export const EVENT_LOG_DISPLAY_MAX = 5000;

export const DEFAULT_SETTINGS = {
  // Event-log capture gate. 0 = errors only, 1 = errors + warnings,
  // 2 = errors + warnings + info, 3 = errors + warnings + info debug.
  // Entries with a higher level than this are dropped on append, never
  // enter the log, and are therefore never part of a bug report.
  logLevel: 2,
  // Keep every entry of this session instead of the newest EVENT_LOG_MAX.
  // For reproducing a fault that takes longer than the log is deep: the
  // store is on disk and dies with the session either way.
  eventLogUnlimited: false,
};
