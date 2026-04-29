/**
 * One-shot orchestrator for the legacy-data import.
 *
 * Reads the legacy JSON files via the `ProfileFiles` Thunderbird
 * Experiment and the legacy log-level pref via `LegacyPrefs`, then
 * delegates the actual translation to the four pure functions exported
 * from `migrate-from-legacy.mjs`. After all four ran, the legacy
 * `<profile>/TbSync/` directory is left untouched (read-only Experiment).
 *
 * Idempotency lives in the presence of `tbsync.accounts` itself - once
 * any modern run has populated that key (whether by this runner, by
 * normal account creation, or by an updated-legacy version that uses
 * the migration module to dual-write), this runner short-circuits on
 * every subsequent boot.
 */
import { serialize } from "./storage-queue.mjs";
import { KEYS } from "./storage-keys.mjs";
import * as eventLog from "./event-log.mjs";

const LEGACY_DIR = "TbSync";

export async function runIfNeeded() {
  // Sole detection: tbsync.accounts present means user data already
  // exists. Either a previous migration ran, or they're on an
  // updated-legacy that wrote to local storage directly. Either way:
  // skip.
  const local = await browser.storage.local.get(KEYS.ACCOUNTS);
  if (KEYS.ACCOUNTS in local) return;

  // No legacy data on disk → nothing to migrate. Single existence
  // check on the directory; subsequent reads are gated on per-file
  // existence so missing optional files (folders / changelog) don't
  // throw.
  if (!(await browser.ProfileFiles.exists(LEGACY_DIR))) return;
  if (!(await browser.ProfileFiles.exists(`${LEGACY_DIR}/accounts68.json`)))
    return;

  let result;
  try {
    const accounts68 = await browser.ProfileFiles.readJSON(
      `${LEGACY_DIR}/accounts68.json`,
    );
    const folders68 = (await browser.ProfileFiles.exists(
      `${LEGACY_DIR}/folders68.json`,
    ))
      ? await browser.ProfileFiles.readJSON(`${LEGACY_DIR}/folders68.json`)
      : {};
    const changelog68 = (await browser.ProfileFiles.exists(
      `${LEGACY_DIR}/changelog68.json`,
    ))
      ? await browser.ProfileFiles.readJSON(`${LEGACY_DIR}/changelog68.json`)
      : [];

    const acc = await migrateAccounts(accounts68);
    const fld = await migrateFolders(folders68);
    const chg = await migrateChangelog(changelog68);
    const prf = await migratePref([
      {
        keys: {
          "extensions.tbsync.log.userdatalevel": "logLevel",
        },
        validate: (v) => typeof v === "number" && Number.isFinite(v),
        transform: (v) => {
          // Legacy: 0 = off, 1 = errors, 2 = full, 3 = extra.
          // New   : 0 = errors, 1 = warnings, 2 = info, 3 = debug.
          return Math.max(0, Math.min(3, Math.trunc(v) || 0));
        },
      },
    ]);

    result = { acc, fld, chg, prf };
  } catch (err) {
    await eventLog.append({
      level: "error",
      message: `Legacy TbSync migration failed: ${err?.message ?? err}`,
      details: err?.stack ?? null,
    });
    return;
  }

  await eventLog.append({
    level: "info", // surfaces in the manager so the user sees it
    message:
      `Migrated ${result.acc.count} account(s) and ${result.fld.count} folder(s) from legacy TbSync. ` +
      `Changelog: ${result.chg.matched} matched, ${result.chg.unmatched} dropped. ` +
      `Preferences migrated: ${result.prf.applied.join(", ") || "none"}.`,
  });
}

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
async function migrateAccounts(legacyAccounts68) {
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
    browser.storage.local.set({ [KEYS.ACCOUNTS]: { sequence, data } }),
  );
  return { count: Object.keys(data).length, sequence };
}

// ── migrateFolders ───────────────────────────────────────────────────────

/**
 * @param {Record<string, Record<string, object>>} legacyFolders68
 * @returns {Promise<{ count: number }>}
 */
async function migrateFolders(legacyFolders68) {
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
      const targetType =
        TARGET_TYPE_TRANSLATION[legacyTargetType] ?? legacyTargetType;

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
        targetID: legacyRow.target ? String(legacyRow.target) : null,
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

  await serialize(() => browser.storage.local.set({ [KEYS.FOLDERS]: out }));
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
function migrateChangelog(legacyChangelog68) {
  const entries = Array.isArray(legacyChangelog68) ? legacyChangelog68 : [];
  if (!entries.length) return Promise.resolve({ matched: 0, unmatched: 0 });

  return serialize(async () => {
    const rv = await browser.storage.local.get({ [KEYS.FOLDERS]: {} });
    const folders = rv[KEYS.FOLDERS] ?? {};
    let matched = 0;
    let unmatched = 0;

    outer: for (const entry of entries) {
      if (!entry?.parentId) {
        unmatched++;
        continue;
      }
      for (const bucket of Object.values(folders)) {
        for (const folder of Object.values(bucket)) {
          const target = folder?.targetID;
          if (target && entry.parentId.startsWith(target)) {
            if (!Array.isArray(folder.changelog)) folder.changelog = [];
            folder.changelog.push({
              parentId: entry.parentId,
              itemId: entry.itemId,
              timestamp: entry.timestamp,
              status: entry.status,
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

// ── migratePref ──────────────────────────────────────────────────────────

async function migratePref(entries) {
  const applied = [];
  await serialize(async () => {
    const local = await browser.storage.local.get({
      [KEYS.SETTINGS]: {},
    });

    for (let entry of entries) {
      const { keys, validate, transform } = entry;
      for (const [legacyKey, storageKey] of Object.entries(keys)) {
        const value = await browser.LegacyPrefs.getUserPref(legacyKey);
        if (!validate(value)) continue;

        const newValue = transform(value);
        local[KEYS.SETTINGS][storageKey] = newValue;
        applied.push(storageKey);
      }
    }

    await browser.storage.local.set({ [KEYS.SETTINGS]: local[KEYS.SETTINGS] });
  });

  return { applied };
}
