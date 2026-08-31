import { ERR, HOST_CMD, PREDEFINED_ERROR_CODES } from "../vendor/tbsync/protocol.mjs";
import { STATUS_TYPES } from "../vendor/tbsync/status.mjs";
import * as accounts from "./accounts.mjs";
import * as folders from "./folders.mjs";
import * as eventLog from "./event-log.mjs";
import * as ui from "./messaging-ui.mjs";
import * as router from "./router.mjs";
import {
  syncingAccounts,
  cancellingAccounts,
  busyFolders,
  pendingWork,
  maintainingAccounts,
  settingUpAccounts,
  WORK,
} from "./transient.mjs";

/** Remember work for an account that is busy, in that kind's one slot.
 *
 *  Merging `sync` is a join, because a full account sync and a per-folder
 *  one are not independent: a full sync covers every folder, so it replaces
 *  a pending folder list, and a folder request arriving against a pending
 *  full sync is absorbed by it. Two folder requests union. Anything else
 *  would sync the same folder twice for no reason.
 *
 *  The slot keeps the `at` it was first filled with. The drain runs the
 *  oldest slot first, so a kind that refreshed its own timestamp on every
 *  merge could hold the queue forever - `sync` is exactly the kind that
 *  arrives often enough to do it.
 */
function enqueueWork(accountId, kind, payload = null) {
  const kinds = pendingWork.get(accountId) ?? new Map();
  const held = kinds.get(kind);
  let next = payload;
  if (held && kind === WORK.SYNC) {
    next = {
      full: held.payload.full || payload.full,
      folderIds: new Set([...held.payload.folderIds, ...payload.folderIds]),
    };
    if (next.full) next.folderIds = new Set();
  }
  kinds.set(kind, { at: held?.at ?? Date.now(), payload: next });
  pendingWork.set(accountId, kinds);
}

/** Offer an account its housekeeping slot.
 *
 *  The same refusals a sync makes, for the same reasons: an account that is
 *  disconnected, mid-teardown, still being prepared, locked out on
 *  credentials or held back as a legacy import has nothing a provider
 *  should be tidying, and several of those states mean the provider is not
 *  in a position to answer.
 *
 *  A sync in progress defers this rather than queueing behind it - the tick
 *  comes round again in a minute and the work is due once a day, so waiting
 *  is free and holding a slot for it would only delay the syncs behind it.
 *  The reverse is not symmetrical: a sync asked for while this runs *is*
 *  remembered, because somebody asked for that on purpose.
 *
 *  Answers whether the provider was actually asked. False means the account
 *  was busy or ineligible and nothing happened, so the caller should offer
 *  again shortly rather than counting this as the account's turn - an
 *  account that is syncing whenever the offer arrives would otherwise never
 *  be maintained at all, and the busiest accounts are the likeliest to be.
 *
 *  The account is locked while it runs and the manager says so. That is the
 *  point rather than a side effect: the alternative was accepting a Sync
 *  click and silently making the user wait for it.
 */
export async function maintainAccount(accountId) {
  if (syncingAccounts.has(accountId)) return false;
  if (maintainingAccounts.has(accountId)) return false;
  if (cancellingAccounts.has(accountId)) return false;
  if (settingUpAccounts.has(accountId)) return false;
  const acc = await accounts.get(accountId);
  if (!acc || !acc.enabled) return false;
  if (acc.error === ERR.AUTH) return false;
  if (acc.legacyImported) return false;

  maintainingAccounts.add(accountId);
  ui.broadcast({ type: "accounts-changed", accountId });
  try {
    await router.sendCmd(acc.provider, HOST_CMD.MAINTAIN, { accountId });
  } catch (err) {
    // Housekeeping nobody asked for, so a failure is worth a line and
    // nothing more: no account error, no folder status, no retry. The next
    // tick offers the slot again.
    await eventLog
      .append({
        accountId,
        folderId: null,
        level: "info",
        message: `Maintenance did not complete: ${err?.message ?? err}`,
      })
      .catch(() => {});
  } finally {
    maintainingAccounts.delete(accountId);
    ui.broadcast({ type: "accounts-changed", accountId });
  }
  await drainPendingWork(accountId);
  // Asked, whatever came back. A provider that answered "nothing due", or
  // could not be reached at all, has still had its turn - retrying either
  // every minute would only fill the log.
  return true;
}

/** Take the slot that has waited longest, or null. */
function takeOldestWork(accountId) {
  const kinds = pendingWork.get(accountId);
  if (!kinds?.size) return null;
  let pick = null;
  for (const [kind, slot] of kinds) {
    if (!pick || slot.at < pick.slot.at) pick = { kind, slot };
  }
  kinds.delete(pick.kind);
  if (!kinds.size) pendingWork.delete(accountId);
  return pick;
}

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
    pendingWork.delete(accountId);
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


export async function syncAccount(
  accountId,
  { syncList = true, only = null } = {},
) {
  if (syncingAccounts.has(accountId) || maintainingAccounts.has(accountId)) {
    // Something asked for this on purpose and we are busy. Remember it
    // rather than dropping it - the drain below runs it once we settle.
    //
    // Including an unscoped request, which used to be dropped as "what is
    // already happening". It is not: the run in progress may be maintenance
    // rather than a sync, and even against a sync the request may come from
    // a user who has just edited something the pass has already gone past.
    // One slot per kind bounds any number of them to a single extra run.
    enqueueWork(accountId, WORK.SYNC, {
      full: !only,
      folderIds: new Set(only ? [only] : []),
    });
    return;
  }
  // Mid-abort: the account is on its way out, and starting here would race
  // the teardown for the same targets.
  if (cancellingAccounts.has(accountId)) return;
  // Registered but not prepared yet - the provider is still finding out
  // what the server supports, and a sync now would run on guesses.
  if (settingUpAccounts.has(accountId)) return;
  const acc = await accounts.get(accountId);
  if (!acc || !acc.enabled) return;
  // An account whose credentials the server rejected stays enabled, so
  // `enabled` alone does not hold syncing back. Refusing here covers every
  // caller at once; without it each autosync tick would present the same
  // rejected credentials again, which is how servers decide to lock an
  // account out. Cleared by authenticating, or by disabling the account.
  if (acc.error === ERR.AUTH) return;
  // An account set up by an older version does not sync at all. Its local
  // calendars and books were made by code that addressed them differently,
  // and any queued edit was written by a changelog this version does not
  // own - syncing into that would duplicate items rather than repair them.
  // The account keeps its settings and its resources so the user can read
  // them and copy anything out; connecting it afresh is the way forward,
  // and disconnecting is one of the two things that clear the flag (see
  // `liftLegacyLock`).
  //
  // Refused here rather than at each caller, and silently, exactly like the
  // rejected-credentials guard above: the manager states the condition and
  // offers the remedy, so an autosync tick has nothing to add.
  if (acc.legacyImported) return;
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
  // The account-level call itself came back as an error. Distinct from a
  // folder failure: no folder ever ran, so there is nothing for
  // `recomputeAccountError` to aggregate and the account would otherwise
  // finish looking freshly synced.
  let accountFailed = false;
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
        accountFailed = true;
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
    if (accountFailed) {
      // No folder ran, so `recomputeAccountError` has nothing to find and
      // would clear the error it is meant to surface. Write it here, and
      // leave `lastSyncTime` alone for the same reason a cancelled sync
      // does: this sync did not complete.
      const acc = await accounts.get(accountId);
      if (acc && acc.error !== ERR.AUTH && acc.error !== "E:ACCOUNT_SYNC_FAILED") {
        await accounts.update(accountId, { error: "E:ACCOUNT_SYNC_FAILED" });
      }
    } else if (!authFailed && !cancelled) {
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
  if (!cancelled) await drainPendingWork(accountId);
}

/** Run whatever was asked for while this account was busy.
 *
 *  Deliberately after the `finally`, so a deferred run starts from a settled
 *  account: the lock is clear, residual folder statuses are resolved and the
 *  account error recomputed. The set is taken before anything runs, so a
 *  request arriving during the deferred sync is deferred again rather than
 *  lost.
 */
async function drainPendingWork(accountId) {
  for (;;) {
    const next = takeOldestWork(accountId);
    if (!next) return;
    if (next.kind === WORK.MAINTAIN) {
      await maintainAccount(accountId);
      continue;
    }
    if (next.payload?.full ?? next.slot.payload.full) {
      await syncAccount(accountId);
      continue;
    }
    for (const folderId of next.slot.payload.folderIds) {
      await syncAccount(accountId, { only: folderId });
    }
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
  // Unconditional. A provider that reports a failure without wording it
  // used to leave no trace at all, which is the one case where a log line
  // matters most - the user sees a failed sync and the log has nothing to
  // say about it.
  await eventLog.append({
    accountId,
    folderId: null,
    level,
    message:
      statusData?.message ||
      `The account sync failed without a message (${statusData?.type ?? "no status"}).`,
    details: statusData?.details ?? null,
  });
}
