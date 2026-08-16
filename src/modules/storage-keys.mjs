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

/** How many entries the session buffer keeps.
 *
 *  Sized for the log a real diagnosis needs, not for the quiet case. The
 *  buffer is a ring, so once it rolls it discards the OLDEST entries -
 *  the account setup and the first syncs, exactly the part a report about
 *  "it did not sync at first" turns on. Measured against one such report:
 *  setup plus a first sync of three collections is 25 entries, but the
 *  sync that finally succeeds pulls every item at a window of 25, two
 *  entries per page - so a mailbox of a few thousand items spends several
 *  hundred entries on its own and carries the interesting part away.
 *
 *  A test run reads the buffer too: a section asserting on what was sent
 *  reads it back, and once it rolls the missing command reads as "never
 *  sent" rather than "no longer recorded".
 *
 *  Not a setting. It was one, and that made it unreachable: the record is
 *  seeded once from DEFAULT_SETTINGS and never revisited, so every profile
 *  kept whatever value was current the day it was created, and raising this
 *  reached only new installs. There is no UI to change it either. A
 *  constant the code reads directly takes effect for everyone on update,
 *  which is the whole point of raising it. */
export const EVENT_LOG_MAX = 5000;

export const DEFAULT_SETTINGS = {
  // Event-log capture gate. 0 = errors only, 1 = errors + warnings,
  // 2 = errors + warnings + info, 3 = errors + warnings + info debug.
  // Entries with a higher level than this are dropped on append, never
  // enter the buffer, and are therefore never part of a bug report.
  logLevel: 2,
};
