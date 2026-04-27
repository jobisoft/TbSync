/**
 * Single source of truth for every top-level `browser.storage.local` key used
 * by tbsync-new. Keeping these in one place prevents stringly-typed drift.
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

export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = {
  // Event-log capture gate. 1 = errors only, 2 = errors + warnings,
  // 3 = errors + warnings + debug. Entries with a higher level than this
  // are dropped on append, never enter the buffer, and are therefore never
  // part of a bug report.
  logLevel: 1,
};

export const EVENT_LOG_MAX = 500;
