import { ERR, HOST_CMD, PREDEFINED_ERROR_CODES } from "../tbsync/protocol.mjs";
import { STATUS_TYPES } from "../tbsync/status.mjs";
import * as accounts from "./accounts.mjs";
import * as folders from "./folders.mjs";
import * as eventLog from "./event-log.mjs";
import * as ui from "./messaging-ui.mjs";
import * as router from "./router.mjs";
import { syncingAccounts, busyFolders } from "./transient.mjs";

/** Drive an account sync over the port: syncAccount, then syncFolder per
 *  selected folder. The host owns the universal sync-status fields
 *  (folder.status, folder.warning, folder.error, folder.lastSyncTime,
 *  account.error, account.lastSyncTime) and writes them from the RPC
 *  outcome. Providers only write fields they genuinely own (custom.*,
 *  targetID, targetName) via updateFolder / updateAccount. Transient
 *  "in progress" state lives in the shared `syncingAccounts` set the
 *  manager reads via getState. */

export async function syncAllAccounts() {
  const all = await accounts.list();
  for (const acc of all) {
    if (!acc.enabled) continue;
    await syncAccount(acc.accountId).catch((err) => {
      console.warn(`[tbsync] syncAccount(${acc.accountId}) failed:`, err);
    });
  }
}

export async function syncAccount(accountId, { syncList = true } = {}) {
  if (syncingAccounts.has(accountId)) return;
  const acc = await accounts.get(accountId);
  if (!acc || !acc.enabled) return;
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
  try {
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

    // Folders being toggled right now skip this pass - the provider may be
    // mid-book-delete on deselect.
    const toSync = (await folders.listForAccount(accountId)).filter(
      (f) => f.selected && !busyFolders.has(f.folderId),
    );
    for (const folder of toSync) {
      await syncFolderOnce(acc, folder);
    }
  } catch (err) {
    if (err?.code === ERR.AUTH) {
      authFailed = true;
      await disableAccountForReauth(acc, err);
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
    if (!authFailed) {
      // disableAccountForReauth already wrote the account record with
      // error: ERR.AUTH; don't overwrite it here.
      await accounts.update(accountId, {
        lastSyncTime: Date.now(),
        error: null,
      });
    }
    ui.broadcast({ type: "accounts-changed", accountId });
  }
}

/** Refresh token is gone or revoked: tell the provider to tear down its
 *  Thunderbird resources, drop the folder list on the host side, and disable
 *  the account. Stamp `error: "E:AUTH"` onto the account so the manager
 *  shows the "Sign in again" button. */
async function disableAccountForReauth(acc, err) {
  const accountId = acc.accountId;
  await router
    .sendCmd(acc.provider, HOST_CMD.ACCOUNT_DISABLED, { accountId })
    .catch((rpcErr) => {
      return eventLog.append({
        accountId,
        level: "warning",
        message:
          "Provider refused ACCOUNT_DISABLED during reauth (it may already be gone)",
        details: rpcErr?.message ?? null,
      });
    });
  await folders.clearAccount(accountId);
  await accounts.update(accountId, {
    enabled: false,
    lastSyncTime: 0,
    error: ERR.AUTH,
  });
  await eventLog.append({
    accountId,
    folderId: null,
    level: "error",
    message:
      "The provider refused the refresh token - account disabled, sign in again to resume.",
    details: err?.message ?? null,
  });
  ui.broadcast({ type: "folders-changed", accountId });
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
  } catch (err) {
    // Auth errors are account-wide - bubble up so syncAccount can disable
    // the whole account. We leave folder.status at "pending" here and let
    // syncAccount's finally downgrade it to "aborted".
    if (err?.code === ERR.AUTH) throw err;
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
