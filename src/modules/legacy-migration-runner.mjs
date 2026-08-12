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
import { serialize } from "../vendor/tbsync/storage-queue.mjs";
import { KEYS } from "./storage-keys.mjs";
import * as eventLog from "./event-log.mjs";

const LEGACY_DIR = "TbSync";

export async function runIfNeeded() {
  // Two questions, and they are not the same one.
  //
  // `tbsync.migration` says a migration RAN TO COMPLETION. It is written
  // last, once every step has succeeded, so a run that dies half way is
  // retried on the next boot rather than remembered as done. The steps
  // are safe to repeat: each writes its whole key from the legacy files
  // instead of appending to what is already there.
  //
  // `tbsync.accounts` says only that user data exists - a previous
  // migration, or an updated-legacy that wrote local storage directly.
  // On its own it cannot mean "finished", because the first step writes
  // it: gating on it alone left an account with no folders, permanently,
  // if any later step threw.
  const local = await browser.storage.local.get([
    KEYS.MIGRATION,
    KEYS.ACCOUNTS,
  ]);
  if (local[KEYS.MIGRATION]?.done) return;
  if (KEYS.ACCOUNTS in local) {
    // Data exists and we have no record of migrating it: not a partial
    // run of ours, just a profile that already has its own storage.
    // Remember the decision so it is made once.
    await browser.storage.local.set({
      [KEYS.MIGRATION]: { done: true, migrated: false },
    });
    return;
  }

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
    const acc = await migrateAccounts(accounts68);
    const fld = await migrateFolders(folders68);
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

    result = { acc, fld, prf };
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
      `Migrated ${result.acc.count} account(s) and ${result.fld.count} folder(s) ` +
      `from legacy TbSync. These accounts keep their settings but do not sync: ` +
      `disconnect and reconnect each one to rebuild it from the server. ` +
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
      // `custom` above is the legacy row verbatim, so this account is only
      // half converted - the provider's own data still has whatever shape
      // the legacy add-on wrote. Flag it so the host refuses to service the
      // account until its provider reports back via LEGACY_MIGRATION_DONE.
      // Set unconditionally, including for providers that aren't installed
      // right now: the flag simply waits until one turns up.
      legacyMigrationPending: true,
      // Permanent, unlike the flag above: it records where this account came
      // from long after the conversion finished. A migration carries what it
      // can recognise, and this release cannot promise that was everything -
      // pending edits it could not classify stay pending, and only the user
      // can decide whether to trust the result or set the account up afresh.
      // The manager says so on the account, which it can only do if the
      // account still remembers.
      legacyImported: true,
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
        // Nothing is owed to the server yet: the legacy add-on's pending
        // edits are not carried over. They name items in local resources
        // this version will not sync and that reconnecting replaces
        // wholesale, so keeping them would only queue pushes against
        // copies that no longer exist.
        localChanges: 0,
        custom,
      };
      count++;
    }
    if (Object.keys(newBucket).length) out[accountId] = newBucket;
  }

  await serialize(() => browser.storage.local.set({ [KEYS.FOLDERS]: out }));
  return { count };
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
