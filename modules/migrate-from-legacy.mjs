/**
 * Pure migration functions: legacy TbSync data shape → new
 * `browser.storage.local` shape.
 *
 * Each function takes a single legacy data object as input and writes
 * the corresponding `tbsync.*` storage key. No I/O reads beyond
 * `browser.storage.local` itself, no Thunderbird Experiment calls, no
 * lifecycle markers, no archive logic.
 *
 * Designed for reuse: an updated legacy TbSync version can import this
 * module and call any subset of these functions whenever it writes its
 * own legacy data, dual-writing into local storage. Users on dual-write
 * legacy then upgrade to new TbSync without ever needing the
 * one-shot migration runner - local-storage is already populated.
 *
 * Translation rules in detail are documented inline alongside each
 * function. The high-level contract:
 *   - Standard host fields are translated (renames, value coercions).
 *   - All other keys (provider data) pass through verbatim into `custom`.
 *   - Per-record host fields without legacy equivalents get sensible
 *     defaults (warning/error: null, etc.).
 */

import { KEYS } from "./storage-keys.mjs";
import { serialize } from "./storage-queue.mjs";

/** Legacy account fields that are TbSync host-owned. Anything outside
 *  this set is provider data and passes through verbatim into `custom`. */
const LEGACY_HOST_ACCOUNT_KEYS = new Set([
  "accountID",
  "accountname",
  "provider",
  "lastsynctime",
  "autosync",
  "status",
  "noAutosyncUntil",
]);

/** Same for folder rows. `target` / `targetName` were a legacy convention
 *  that every provider happened to use for the bound Thunderbird artifact's
 *  URI + display-name. The host now lifts them to the top-level `targetID`
 *  / `targetName` fields and strips them from `custom`, making
 *  host-owned binding state the contract - providers only ever read
 *  `folder.targetID` / `folder.targetName`. */
const LEGACY_HOST_FOLDER_KEYS = new Set([
  "accountID",
  "foldername",
  "targetType",
  "selected",
  "lastsynctime",
  "status",
  "downloadonly",
  "cached",
  "target",
  "targetName",
]);

/** Map legacy `targetType` values to the new value space. Unknown values
 *  pass through verbatim (provider's step-2 can correct if needed). */
const TARGET_TYPE_TRANSLATION = {
  addressbook: "contacts",
  calendar: "calendars",
};

// ── migrateAccounts ──────────────────────────────────────────────────────

/**
 * @param {{ sequence: number, data: Record<string, object> }} legacyAccounts68
 * @returns {Promise<{ count: number, sequence: number }>}
 */
export async function migrateAccounts(legacyAccounts68) {
  const legacyData = legacyAccounts68?.data ?? {};
  const data = {};
  let maxId = Number.isFinite(legacyAccounts68?.sequence)
    ? legacyAccounts68.sequence
    : 0;

  for (const [legacyId, legacyRow] of Object.entries(legacyData)) {
    const accountId = String(legacyId);
    const numericId = Number(legacyId);
    if (Number.isFinite(numericId) && numericId > maxId) maxId = numericId;

    const custom = {};
    for (const [k, v] of Object.entries(legacyRow ?? {})) {
      if (!LEGACY_HOST_ACCOUNT_KEYS.has(k)) custom[k] = v;
    }

    data[accountId] = {
      accountId,
      accountName: String(legacyRow.accountname ?? ""),
      provider: legacyRow.provider ?? "",
      enabled: legacyRow.status !== "disabled",
      error: null,
      lastSyncTime: Number(legacyRow.lastsynctime ?? 0) || 0,
      autoSyncIntervalMinutes: Number(legacyRow.autosync ?? 0) || 0,
      noAutosyncUntil: Number(legacyRow.noAutosyncUntil ?? 0) || 0,
      custom,
    };
  }

  const sequence = Math.max(maxId, 0);
  await serialize(() =>
    browser.storage.local.set({ [KEYS.ACCOUNTS]: { sequence, data } })
  );
  return { count: Object.keys(data).length, sequence };
}

// ── migrateFolders ───────────────────────────────────────────────────────

/**
 * @param {Record<string, Record<string, object>>} legacyFolders68
 * @returns {Promise<{ count: number }>}
 */
export async function migrateFolders(legacyFolders68) {
  const out = {};
  let count = 0;

  for (const [accountID, bucket] of Object.entries(legacyFolders68 ?? {})) {
    const accountId = String(accountID);
    const newBucket = {};
    let orderIndex = 0;
    for (const [folderID, legacyRow] of Object.entries(bucket ?? {})) {
      const folderId = String(folderID);
      const custom = {};
      for (const [k, v] of Object.entries(legacyRow ?? {})) {
        if (!LEGACY_HOST_FOLDER_KEYS.has(k)) custom[k] = v;
      }

      const legacyTargetType = String(legacyRow.targetType ?? "");
      const targetType = TARGET_TYPE_TRANSLATION[legacyTargetType] ?? legacyTargetType;

      newBucket[folderId] = {
        folderId,
        accountId,
        targetType,
        displayName: String(legacyRow.foldername ?? folderId),
        selected: !!legacyRow.selected,
        readOnly: !!legacyRow.downloadonly,
        warning: null,
        error: null,
        status: null,
        lastSyncTime: Number(legacyRow.lastsynctime ?? 0) || 0,
        orderIndex: orderIndex++,
        // `target` / `targetName` are a cross-provider legacy convention
        // for the bound Thunderbird artifact. Lifted into the host's
        // top-level binding fields so providers only read host-owned
        // state, never `custom.target`.
        targetID:   legacyRow.target     ? String(legacyRow.target)     : null,
        targetName: legacyRow.targetName ? String(legacyRow.targetName) : null,
        // Host-owned per-folder change queue. Default to empty array; the
        // legacy importer's migrateChangelog pass populates entries by
        // URI-prefix match against targetID after this runs.
        changelog: [],
        custom,
      };
      count++;
    }
    if (Object.keys(newBucket).length) out[accountId] = newBucket;
  }

  await serialize(() =>
    browser.storage.local.set({ [KEYS.FOLDERS]: out })
  );
  return { count };
}

// ── migrateChangelog ─────────────────────────────────────────────────────

/**
 * Distribute legacy changelog entries into each folder's host-owned
 * `folder.changelog` array by matching `parentId` against each folder's
 * `targetID` URI prefix. Reads the current `tbsync.folders` from storage
 * (assumes `migrateFolders` has run, which lifts the legacy
 * `custom.target` → top-level `targetID`), modifies in place, writes
 * back. Entries that match no folder are silently dropped - counted in
 * the return value so the caller can surface an info-log.
 *
 * @param {Array<{parentId: string, itemId: string, timestamp: number, status: string}>} legacyChangelog68
 * @returns {Promise<{ matched: number, unmatched: number }>}
 */
export function migrateChangelog(legacyChangelog68) {
  const entries = Array.isArray(legacyChangelog68) ? legacyChangelog68 : [];
  if (!entries.length) return Promise.resolve({ matched: 0, unmatched: 0 });

  return serialize(async () => {
    const rv = await browser.storage.local.get({ [KEYS.FOLDERS]: {} });
    const folders = rv[KEYS.FOLDERS] ?? {};
    let matched = 0;
    let unmatched = 0;

    outer: for (const entry of entries) {
      if (!entry?.parentId) { unmatched++; continue; }
      for (const bucket of Object.values(folders)) {
        for (const folder of Object.values(bucket)) {
          const target = folder?.targetID;
          if (target && entry.parentId.startsWith(target)) {
            if (!Array.isArray(folder.changelog)) folder.changelog = [];
            folder.changelog.push({
              parentId: entry.parentId,
              itemId:   entry.itemId,
              timestamp: entry.timestamp,
              status:    entry.status,
            });
            matched++;
            continue outer;
          }
        }
      }
      unmatched++;
    }

    await browser.storage.local.set({ [KEYS.FOLDERS]: folders });
    return { matched, unmatched };
  });
}

// ── migratePrefs ─────────────────────────────────────────────────────────

/**
 * @param {{ userdatalevel?: number }} legacyPrefValues
 * @returns {Promise<{ applied: string[] }>}
 */
export async function migratePrefs(legacyPrefValues) {
  const applied = [];
  const next = {};

  if (legacyPrefValues && Number.isFinite(legacyPrefValues.userdatalevel)) {
    // Legacy: 0 = off, 1 = errors, 2 = full, 3 = extra.
    // New:    1 = errors only, 2 = errors + warnings, 3 = + debug.
    // Map "off" up to "errors only" since the new gate has no off-state.
    const v = Math.max(1, Math.min(3, Math.trunc(legacyPrefValues.userdatalevel) || 1));
    next.logLevel = v;
    applied.push("logLevel");
  }

  await serialize(() =>
    browser.storage.local.set({ [KEYS.SETTINGS]: next })
  );
  return { applied };
}
