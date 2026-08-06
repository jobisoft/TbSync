import { ERR, HOST_CMD, PREDEFINED_ERROR_CODES } from "../tbsync/protocol.mjs";
import { STATUS_TYPES } from "../tbsync/status.mjs";
import * as accounts from "./accounts.mjs";
import * as folders from "./folders.mjs";
import * as eventLog from "./event-log.mjs";
import * as ui from "./messaging-ui.mjs";
import * as router from "./router.mjs";
import {
  syncingAccounts,
  cancellingAccounts,
  busyFolders,
  pendingSyncRequests,
} from "./transient.mjs";

/** Drive an account sync over the port: syncAccount, then syncFolder per
 *  selected folder. The host owns the universal sync-status fields
 *  (folder.status, folder.warning, folder.error, folder.lastSyncTime,
 *  account.error, account.lastSyncTime) and writes them from the RPC
 *  outcome. Providers only write fields they genuinely own (custom.*,
 *  targetID, targetName) via updateFolder / updateAccount. Transient
 *  "in progress" state lives in the shared `syncingAccounts` set the
 *  manager reads via getState. */

// Legacy parity (TbSync4 core.js:90, 138): a per-folder Sync command that
// returns Status 12 ("folder hierarchy out of date") triggers an account-
// level rerun (re-FolderSync + re-iterate folders). Capped so a server
// stuck in a hierarchy-changed state doesn't spin forever.
const MAX_ACCOUNT_RERUNS = 2;
const RERUN_BACKOFF_MS = 5_000;

/** Re-aggregate `account.error` from per-folder errors. Called from
 *  the syncAccount finally block (so the toolbar badge reflects sync
 *  outcomes the moment a sync ends) and from `setFolderSelected` (so
 *  deselecting the only failing folder drops the badge immediately
 *  rather than waiting for the next sync).
 *
 *  Filtering to `f.selected` mirrors the manager's account-row
 *  severity computation at manager.mjs:375 so badge and manager rows
 *  stay consistent. The auth-failed path is preserved verbatim —
 *  `flagAccountForReauth` stamps `error: ERR.AUTH`; we don't overwrite
 *  that. */
export async function recomputeAccountError(accountId) {
  const acc = await accounts.get(accountId);
  if (!acc) return;
  if (acc.error === ERR.AUTH) return;
  const folderRows = await folders.listForAccount(accountId);
  const hasError = folderRows.some((f) => f.selected && f.error);
  const next = hasError ? "E:FOLDER_SYNC_FAILED" : null;
  if (acc.error === next) return; // dedupe to avoid noisy broadcasts
  await accounts.update(accountId, { error: next });
  ui.broadcast({ type: "accounts-changed", accountId });
}

/** Stop whatever this account is doing, and make sure it is stoppable.
 *
 *  Three steps, in order, none of which may depend on the provider being
 *  healthy - this is the recovery path for the case where it is not:
 *
 *  1. Mark the account cancelling, so the sync loop unwinds at its next await
 *     instead of moving on to the next folder. The mark is released by
 *     `endAccountCancel`, not here.
 *  2. Ask the provider to stop - sent, never awaited. Waiting would mean
 *     waiting out the RPC timeout in precisely the case this exists for.
 *  3. Settle its in-flight commands. This is what actually frees the
 *     account: `SYNC_FOLDER` has no timeout, so without it a dead provider
 *     keeps the sync suspended forever. Only needed while the port is up -
 *     a dropped port already rejects everything pending on it.
 *
 *  Safe to call when nothing is syncing - every step is a no-op then. */
export async function abortAccountSync(accountId) {
  const acc = await accounts.get(accountId);
  if (!acc) return;

  cancellingAccounts.add(accountId);
  const wasSyncing = syncingAccounts.has(accountId);
  try {
    if (router.isProviderConnected(acc.provider)) {
      // Sent, not awaited. Waiting for the acknowledgement would mean
      // waiting out `DEFAULT_RPC_TIMEOUT_MS` in exactly the case this
      // exists for - a provider that has stopped answering - so the button
      // would appear to hang for thirty seconds. The provider gets the
      // message either way; what frees the account is the line below.
      router
        .sendCmd(acc.provider, HOST_CMD.CANCEL_SYNC, { accountId })
        .catch((err) =>
          eventLog
            .append({
              accountId,
              folderId: null,
              level: "info",
              message: `Provider did not acknowledge the cancel: ${err?.message ?? err}`,
            })
            .catch(() => {}),
        );
      // Rejecting the in-flight commands is what actually ends the sync:
      // `syncAccount` is awaiting one of them, so this makes it throw and
      // run its own `finally`. Note what is *not* here - `syncingAccounts`
      // is left to that finally. Releasing another coroutine's lock on its
      // behalf lets a second sync start while the first is still unwinding,
      // and the first one's finally would then clear the second one's lock.
      router.abortAccount(acc.provider, accountId);
    }
    pendingSyncRequests.delete(accountId);
    if (wasSyncing) {
      await eventLog.append({
        accountId,
        folderId: null,
        level: "info",
        message: "Sync cancelled.",
      });
    }
  } finally {
    ui.broadcast({ type: "accounts-changed", accountId });
  }
}

/** Release the mark `abortAccountSync` left behind.
 *
 *  Deliberately the caller's job. Between the abort and the account record
 *  being written `enabled: false` there is a moment where the account still
 *  looks syncable - the old sync has been released from `syncingAccounts`,
 *  and an autosync tick or a provider `requestSync` arriving right then
 *  would start a fresh sync into a teardown. Holding the mark across the
 *  whole disconnect is what closes that window. */
export function endAccountCancel(accountId) {
  if (cancellingAccounts.delete(accountId)) {
    ui.broadcast({ type: "accounts-changed", accountId });
  }
}

/** Whether this sync may still touch the account.
 *
 *  Re-read rather than trusting the `acc` captured when the sync started: a
 *  disconnect can land at any await, and the cancel mark is released as soon
 *  as it is over. A coroutine parked in the rerun backoff, or awaiting a
 *  command registered after the abort swept the pending map, wakes into a
 *  world where the mark is gone and the account is disabled - and would
 *  otherwise sync a disconnected account, which makes the provider re-create
 *  the very targets the teardown just deleted. */
async function stillRunnable(accountId) {
  if (cancellingAccounts.has(accountId)) return false;
  const acc = await accounts.get(accountId);
  return !!acc?.enabled;
}

export async function syncAllAccounts() {
  const all = await accounts.list();
  for (const acc of all) {
    if (!acc.enabled) continue;
    await syncAccount(acc.accountId).catch((err) => {
      console.warn(`[tbsync] syncAccount(${acc.accountId}) failed:`, err);
    });
  }
}

export async function syncAccount(
  accountId,
  { syncList = true, only = null } = {},
) {
  if (syncingAccounts.has(accountId)) {
    // Something asked for this on purpose and we are busy. Remember it rather
    // than dropping it - the `finally` below runs it once this sync settles.
    // Only a scoped request survives: an unscoped one is what is already
    // happening.
    if (only) {
      const pending = pendingSyncRequests.get(accountId) ?? new Set();
      pending.add(only);
      pendingSyncRequests.set(accountId, pending);
    }
    return;
  }
  // Mid-abort: the account is on its way out, and starting here would race
  // the teardown for the same targets.
  if (cancellingAccounts.has(accountId)) return;
  const acc = await accounts.get(accountId);
  if (!acc || !acc.enabled) return;
  // An account whose credentials the server rejected stays enabled, so
  // `enabled` alone no longer holds syncing back. Refusing here covers every
  // caller at once; without it each autosync tick would present the same
  // rejected credentials again, which is how servers decide to lock an
  // account out. Cleared by authenticating, or by disabling the account.
  if (acc.error === ERR.AUTH) return;
  if (!router.isProviderConnected(acc.provider)) {
    await eventLog.append({
      accountId,
      folderId: null,
      level: "warning",
      message: "Provider not available - sync skipped.",
    });
    ui.broadcast({ type: "accounts-changed", accountId });
    return;
  }

  syncingAccounts.add(accountId);
  ui.broadcast({ type: "accounts-changed", accountId });

  let authFailed = false;
  let cancelled = false;
  try {
    let accountRuns = 0;
    let accountRerunRequested;
    do {
      accountRerunRequested = false;
      if (!(await stillRunnable(accountId))) {
        cancelled = true;
        break;
      }
      if (accountRuns > MAX_ACCOUNT_RERUNS) {
        // Match legacy "resync-loop" bail-out (TbSync4 core.js:114-117).
        await eventLog.append({
          accountId,
          folderId: null,
          level: "error",
          message:
            "Resync loop detected - giving up after repeated ACCOUNT_RERUN",
        });
        break;
      }
      if (accountRuns > 0) {
        // Match legacy 5 s cool-down between rerun iterations.
        await new Promise((r) => setTimeout(r, RERUN_BACKOFF_MS));
        // Five seconds is long enough for a whole disconnect to happen.
        if (!(await stillRunnable(accountId))) {
          cancelled = true;
          break;
        }
      }
      accountRuns++;

      const statusData = await router.sendCmd(
        acc.provider,
        HOST_CMD.SYNC_ACCOUNT,
        {
          accountId,
          syncJob: "sync",
          syncList,
          syncFolders: null,
        },
      );
      if (statusData.type === STATUS_TYPES.ERROR) {
        await logAccountOutcome(accountId, statusData, "error");
        return;
      }

      const folderDescriptors = await router.sendCmd(
        acc.provider,
        HOST_CMD.GET_SORTED_FOLDERS,
        { accountId },
      );
      if (Array.isArray(folderDescriptors) && folderDescriptors.length) {
        await folders.replaceAccountFolders(accountId, folderDescriptors);
      }

      // Folders being toggled right now skip this pass - the provider may
      // be mid-book-delete on deselect.
      const toSync = (await folders.listForAccount(accountId)).filter(
        (f) =>
          f.selected &&
          !busyFolders.has(f.folderId) &&
          (!only || f.folderId === only),
      );
      for (const folder of toSync) {
        // Checked per folder rather than per request: a folder sync is one
        // provider round trip, and the abort has already settled it if the
        // provider was not going to answer.
        if (!(await stillRunnable(accountId))) {
          cancelled = true;
          break;
        }
        const outcome = await syncFolderOnce(acc, folder);
        if (outcome?.type === STATUS_TYPES.ACCOUNT_RERUN) {
          accountRerunRequested = true;
          break;
        }
      }
    } while (accountRerunRequested);
  } catch (err) {
    // The rejection the abort forced, or the provider unwinding on its own.
    if (err?.code === ERR.CANCELLED) cancelled = true;
    if (err?.code === ERR.AUTH) {
      authFailed = true;
      await flagAccountForReauth(acc, err);
    } else if (cancelled) {
      // Nothing to report: `abortAccountSync` already logged the cancel,
      // and "Sync failed: ..." at error level for a deliberate stop is how
      // a recovery path ends up looking like a bug.
    } else {
      await eventLog.append({
        accountId,
        folderId: null,
        level: "error",
        message: `Sync failed: ${err.message}`,
        details: err.details ?? null,
      });
    }
  } finally {
    syncingAccounts.delete(accountId);
    cancelled = cancelled || cancellingAccounts.has(accountId);
    // Any folder still in "pending" after the sync loop terminated early
    // (auth failure, cancellation) is downgraded to "aborted" - legacy
    // TbSync's finishAccountSync did the same. Folders that reached an
    // outcome already hold "success" / "warning" / "error".
    const residual = await folders.listForAccount(accountId);
    for (const f of residual) {
      if (f.status === "pending") {
        await folders.update(accountId, f.folderId, { status: "aborted" });
      }
    }
    if (!authFailed && !cancelled) {
      // flagAccountForReauth already wrote the account record with
      // error: ERR.AUTH; don't overwrite it here. A cancelled sync gets no
      // stamp either: it did not complete, and "last synced: just now"
      // would both mislead the user and push the next autosync tick a full
      // interval out.
      await accounts.update(accountId, { lastSyncTime: Date.now() });
      // Aggregate per-folder errors into account.error so the toolbar
      // badge and the manager's account-row status cell reflect any
      // folder-level failures from this sync. The helper preserves
      // ERR.AUTH and dedupes when the value is unchanged.
      await recomputeAccountError(accountId);
    }
    ui.broadcast({ type: "accounts-changed", accountId });
  }

  // A cancelled sync does not get to start another one. The abort emptied
  // the deferred set, but a request can arrive between the abort and this
  // line, and honouring it would restart exactly what the user asked us to
  // stop.
  if (!cancelled) await drainPendingSyncRequests(accountId);
}

/** Run whatever was asked for while this account was busy.
 *
 *  Deliberately after the `finally`, so a deferred run starts from a settled
 *  account: the lock is clear, residual folder statuses are resolved and the
 *  account error recomputed. The set is taken before anything runs, so a
 *  request arriving during the deferred sync is deferred again rather than
 *  lost.
 */
async function drainPendingSyncRequests(accountId) {
  const pending = pendingSyncRequests.get(accountId);
  if (!pending?.size) return;
  pendingSyncRequests.delete(accountId);
  for (const folderId of pending) {
    await syncAccount(accountId, { only: folderId });
  }
}

/** The server rejected our credentials. Stamp `error: "E:AUTH"` so the
 *  manager offers the Authenticate button, and leave everything else alone.
 *
 *  The stamp is all that is needed to stop syncing: `syncAccount` refuses an
 *  account carrying it, autosync skips it, and the manager greys out Sync.
 *  Nothing is torn down - the account stays connected, its folder rows keep
 *  their selection, target mappings and sync keys, and the Thunderbird
 *  address books and calendars stay where they are.
 *
 *  Tearing down is what a user asking to disconnect means, not what an
 *  expired password means. Doing it here cost people their local calendars
 *  and a full re-download every time a password rotated. */
async function flagAccountForReauth(acc, err) {
  const accountId = acc.accountId;
  await accounts.update(accountId, { error: ERR.AUTH });
  await eventLog.append({
    accountId,
    folderId: null,
    level: "error",
    message:
      "The server rejected this account's credentials - syncing is paused until you authenticate again.",
    details: err?.message ?? null,
  });
  ui.broadcast({ type: "accounts-changed", accountId });
}

async function syncFolderOnce(acc, folder) {
  // Stamp the lifecycle status up-front so the manager shows "Synchronizing…"
  // immediately, instead of flashing a stale "Synchronized" derived from the
  // prior lastSyncTime. Clear the prior outcome's warning/error so a clean
  // run doesn't show stale text. The provider's reportSyncState paints over
  // this cell once it starts sending live progress.
  await folders.update(acc.accountId, folder.folderId, {
    status: "pending",
    warning: null,
    error: null,
  });
  ui.broadcast({ type: "folders-changed", accountId: acc.accountId });

  try {
    const result = await router.sendCmd(acc.provider, HOST_CMD.SYNC_FOLDER, {
      accountId: acc.accountId,
      folderId: folder.folderId,
      syncJob: "sync",
    });
    if (result.type === STATUS_TYPES.ACCOUNT_RERUN) {
      // The folder didn't actually finish syncing - the provider stopped
      // because the FolderSync state went stale (Status 12). Leave
      // folder.status at "pending"; the outer syncAccount loop will rerun
      // FolderSync and re-enter syncFolderOnce, which will repaint pending
      // and produce a real outcome.
      if (result.message) {
        await eventLog.append({
          accountId: acc.accountId,
          folderId: folder.folderId,
          level: "warning",
          message: result.message,
          details: result.details ?? null,
        });
      }
      return result;
    }
    const status = statusFromResult(result.type);
    const patch = { status };
    if (result.type === STATUS_TYPES.SUCCESS) {
      patch.lastSyncTime = Date.now();
    } else if (result.type === STATUS_TYPES.WARNING) {
      patch.lastSyncTime = Date.now();
      patch.warning = result.message ?? null;
    } else {
      patch.error = result.message ?? "Sync failed";
    }
    await folders.update(acc.accountId, folder.folderId, patch);
    if (result.type !== STATUS_TYPES.SUCCESS && result.message) {
      await eventLog.append({
        accountId: acc.accountId,
        folderId: folder.folderId,
        level: result.type === STATUS_TYPES.WARNING ? "warning" : "error",
        message: result.message,
        details: result.details ?? null,
      });
    }
    return result;
  } catch (err) {
    // Auth errors are account-wide - bubble up so syncAccount can disable
    // the whole account. We leave folder.status at "pending" here and let
    // syncAccount's finally downgrade it to "aborted".
    if (err?.code === ERR.AUTH) throw err;
    // A cancel is what the user asked for, not a failure. Left "pending" so
    // syncAccount's finally downgrades it to "aborted" - the status that
    // already means "stopped before it finished" - instead of painting a
    // red row and an error-level log line for a button press.
    if (err?.code === ERR.CANCELLED) throw err;
    // Prefer the host-localizable code when the host actually has a
    // translation for it; otherwise fall back to the provider's free-text
    // message (which the manager renders verbatim) so the user sees
    // something readable instead of a raw "E:HTTP" / "E:PROVIDER_FOO"
    // identifier the host doesn't know how to localize.
    const code = err?.code;
    const errorText =
      code && PREDEFINED_ERROR_CODES.has(code)
        ? code
        : (err?.message ?? code ?? "Sync failed");
    await folders.update(acc.accountId, folder.folderId, {
      status: "error",
      error: errorText,
    });
    await eventLog.append({
      accountId: acc.accountId,
      folderId: folder.folderId,
      level: "error",
      message: `Folder sync failed: ${err.message}`,
      details: err.details ?? null,
    });
  }
}

function statusFromResult(type) {
  switch (type) {
    case STATUS_TYPES.SUCCESS:
      return "success";
    case STATUS_TYPES.WARNING:
      return "warning";
    case STATUS_TYPES.ERROR:
      return "error";
    default:
      return "error";
  }
}

async function logAccountOutcome(accountId, statusData, level) {
  if (statusData?.message) {
    await eventLog.append({
      accountId,
      folderId: null,
      level,
      message: statusData.message,
      details: statusData.details ?? null,
    });
  }
}
