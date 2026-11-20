/**
 * The decisions of the in-place migration, as plain functions.
 *
 * `background.mjs` cannot be loaded outside the browser, so everything it
 * has to decide while migrating a carried-over account is asked here, of
 * plain objects: what is held, which folders still have to be rebuilt, and
 * whether the rebuild worked.
 */

import { ERR } from "../vendor/tbsync/protocol.mjs";

/** How many entries a rescue holds. Derived, never stored: a tally of the
 *  record is not a fact about it. Context entries only name a member of a
 *  list for the backup and are not owed to anybody. */
export function countHeld(rescue) {
  let n = 0;
  for (const folder of rescue?.folders ?? []) {
    for (const entry of folder.items ?? []) {
      if (entry.op !== "context") n++;
    }
  }
  return n;
}

/** What is owed per folder, for the dialog: the folders of a rescue that hold
 *  something, with how many changes each holds. Context entries are not
 *  counted, as in `countHeld`. */
export function heldByFolder(rescue) {
  const out = [];
  for (const folder of rescue?.folders ?? []) {
    const count = (folder.items ?? []).filter((e) => e.op !== "context").length;
    if (count) out.push({ folderId: folder.folderId, count });
  }
  return out;
}

/** Whether a folder has been pulled from the server since the account was
 *  carried over. Derived from the row: the importer writes `status: null` for
 *  every carried-over folder, and deselecting one clears it again, so only a
 *  sync that finished can make this true. */
export function hasComeBack(row) {
  return (
    !!row?.selected &&
    !!row.targetID &&
    (row.status === "success" || row.status === "warning")
  );
}

/** The folders of the original selection that the rebuild still has to do:
 *  every recorded folder whose row has not come back. That includes one a
 *  failed attempt left without a resource, and one a crash left deselected
 *  between its deselect and its reselect. A recorded folder whose row is gone
 *  is dropped. */
export function foldersToRebuild(selectedFolderIds, rows) {
  const byId = new Map((rows ?? []).map((row) => [row.folderId, row]));
  return (selectedFolderIds ?? []).filter((folderId) => {
    const row = byId.get(folderId);
    return !!row && !hasComeBack(row);
  });
}

/** What went wrong with the rebuild, or null when it worked.
 *
 *  Every selected row is looked at, not only the ones the rebuild visited:
 *  a folder nobody touched but which never came back is as much a failure.
 *  A rejected login comes first, because it is the one thing the user can
 *  fix from outside the migration. */
export function findFailure({ account, rows }) {
  if (account?.error === ERR.AUTH) {
    return {
      code: ERR.AUTH,
      message: "The server rejected the login.",
    };
  }
  for (const row of rows ?? []) {
    if (!row?.selected || hasComeBack(row)) continue;
    const why = row.error || row.warning || "no answer from the server";
    return {
      code: null,
      message: `"${row.displayName}" could not be downloaded from the server (${why}).`,
    };
  }
  return null;
}

/** What the boot still has to do for an account, given how far it got.
 *
 *  `legacyMigrationPending` records the last boot step that finished:
 *  "imported" is where the importer leaves it, "frozen" follows the freeze and
 *  "rescued" the rescue, whatever that found. Anything else - "rescued",
 *  the boolean an earlier build wrote, a cleared flag - leaves nothing for the
 *  host to do, so a later boot freezes and reads nothing again. */
export function bootStepsFrom(step) {
  if (step === "imported") return ["freeze", "rescue"];
  if (step === "frozen") return ["rescue"];
  return [];
}
