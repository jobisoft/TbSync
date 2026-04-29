/**
 * StatusData result shape that providers must use when responding to
 * syncAccount / syncFolder RPCs. Account + folder *display* status are
 * derived at render time on the host; no persistent status enums live here.
 *
 * **MIRRORED INTO EVERY PROVIDER ADD-ON** - see the header of
 * `./protocol.mjs` for the sync rule.
 */

export const STATUS_TYPES = {
  SUCCESS: "success",
  WARNING: "warning",
  ERROR: "error",
  // Signals "the per-folder sync stopped because the FolderSync state is
  // stale; restart the entire account sync from FolderSync". The host's
  // sync-coordinator loops on this with a small iteration cap so a server
  // stuck in a hierarchy-changed state can't spin forever. Mirrors legacy
  // TbSync.StatusData.ACCOUNT_RERUN.
  ACCOUNT_RERUN: "account_rerun",
};

/** Build a StatusData-compatible payload (the return shape for sync RPCs). */
export function ok(message = "", details = "") {
  return { type: STATUS_TYPES.SUCCESS, message, details };
}

export function warning(message, details = "") {
  return { type: STATUS_TYPES.WARNING, message, details };
}

export function error(message, details = "") {
  return { type: STATUS_TYPES.ERROR, message, details };
}

export function accountRerun(message, details = "") {
  return { type: STATUS_TYPES.ACCOUNT_RERUN, message, details };
}
