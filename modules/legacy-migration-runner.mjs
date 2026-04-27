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

import { KEYS } from "./storage-keys.mjs";
import * as eventLog from "./event-log.mjs";
import {
  migrateAccounts,
  migrateFolders,
  migrateChangelog,
  migratePrefs,
} from "./migrate-from-legacy.mjs";

const LEGACY_DIR = "TbSync";
const LEGACY_PREF_LOG_LEVEL = "extensions.tbsync.log.userdatalevel";

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
  if (!await browser.ProfileFiles.exists(LEGACY_DIR)) return;
  if (!await browser.ProfileFiles.exists(`${LEGACY_DIR}/accounts68.json`)) return;

  let result;
  try {
    const accounts68 = await browser.ProfileFiles.readJSON(`${LEGACY_DIR}/accounts68.json`);
    const folders68 = (await browser.ProfileFiles.exists(`${LEGACY_DIR}/folders68.json`))
      ? await browser.ProfileFiles.readJSON(`${LEGACY_DIR}/folders68.json`)
      : {};
    const changelog68 = (await browser.ProfileFiles.exists(`${LEGACY_DIR}/changelog68.json`))
      ? await browser.ProfileFiles.readJSON(`${LEGACY_DIR}/changelog68.json`)
      : [];
    const userdatalevel = await browser.LegacyPrefs.getUserPref(LEGACY_PREF_LOG_LEVEL);

    const acc = await migrateAccounts(accounts68);
    const fld = await migrateFolders(folders68);
    const chg = await migrateChangelog(changelog68);
    const prf = await migratePrefs({ userdatalevel: userdatalevel ?? null });

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
    level: "warning",  // surfaces in the manager so the user sees it
    message:
      `Migrated ${result.acc.count} account(s) and ${result.fld.count} folder(s) from legacy TbSync. ` +
      `Changelog: ${result.chg.matched} matched, ${result.chg.unmatched} dropped. ` +
      `Settings applied: ${result.prf.applied.join(", ") || "none"}.`,
  });
}
