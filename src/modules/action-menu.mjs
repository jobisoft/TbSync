/**
 * Right-click context menu on the toolbar action button. Surfaces a
 * "Sync now" submenu listing every account, with a localized status
 * suffix on the entry name (`(Synchronizing…)`, `(Error)`,
 * `(Local modifications)`) reflecting the account's current state.
 *
 * Triggers `syncAccount` directly — the manager UI doesn't need to be
 * open. Rebuilds on `accounts-changed` and `folders-changed` so the
 * suffix stays in sync; `removeAll` + recreate is cheaper than tracking
 * per-item state, and a JSON-snapshot dirty check skips no-op rebuilds.
 */

import { accountIconUrl } from "./account-icons.mjs";
import * as accounts from "./accounts.mjs";
import * as folders from "./folders.mjs";
import * as providers from "./providers.mjs";
import * as router from "./router.mjs";
import * as ui from "./messaging-ui.mjs";
import { syncingAccounts, upgradeAccounts } from "./transient.mjs";
import { syncAccount } from "./sync-coordinator.mjs";

const PARENT_ID = "tbsync-sync-now";
const CHILD_PREFIX = "tbsync-sync-account-";

let lastSnapshot = "";

export async function init() {
  browser.menus.onClicked.addListener(onMenuClicked);
  await rebuild();
  ui.onInternalEvent((event) => {
    const type = event?.type;
    if (
      type !== "accounts-changed" &&
      type !== "folders-changed" &&
      type !== "providers-changed"
    ) {
      return;
    }
    rebuild().catch((err) =>
      console.warn("[tbsync] action-menu rebuild failed:", err?.message ?? err),
    );
  });
}

async function rebuild() {
  const list = await accounts.list();
  const needsSync = await folders.needsSyncMap();
  const providerList = await providers.list();

  const rows = list.map((acc) => ({
    accountId: acc.accountId,
    accountName: acc.accountName,
    syncing: syncingAccounts.has(acc.accountId),
    error: !!acc.error,
    needsSync: !!needsSync[acc.accountId],
    canSync: canSync(acc),
    iconUrl: accountIconUrl(acc, providerList),
  }));

  const snapshot = JSON.stringify(rows);
  if (snapshot === lastSnapshot) return;
  lastSnapshot = snapshot;

  await browser.menus.removeAll();
  if (rows.length === 0) return;

  browser.menus.create({
    id: PARENT_ID,
    title: browser.i18n.getMessage("actionMenu.syncNow"),
    contexts: ["browser_action"],
  });

  for (const row of rows) {
    browser.menus.create({
      id: CHILD_PREFIX + row.accountId,
      parentId: PARENT_ID,
      contexts: ["browser_action"],
      title: row.accountName + statusSuffix(row),
      enabled: row.canSync,
      icons: { "16": row.iconUrl },
    });
  }
}

function statusSuffix({ syncing, error, needsSync, canSync }) {
  if (syncing) {
    return ` (${browser.i18n.getMessage("account.status.syncing")})`;
  }
  if (error) {
    return ` (${browser.i18n.getMessage("account.status.error")})`;
  }
  if (!canSync) {
    return ` (${browser.i18n.getMessage("account.status.disabled")})`;
  }
  if (needsSync) {
    return ` (${browser.i18n.getMessage("folder.status.modified")})`;
  }
  return "";
}

/** Mirror the manager's `canSync` from
 *  [manager.mjs:445](TbSync/manager/manager.mjs#L445). The menu entry
 *  stays visible (so the user can see the account exists) but is
 *  disabled when the click would be a no-op anyway. */
function canSync(acc) {
  if (!acc.enabled) return false;
  if (upgradeAccounts.has(acc.accountId)) return false;
  if (syncingAccounts.has(acc.accountId)) return false;
  if (acc.error === "E:AUTH") return false;
  if (!router.isProviderConnected(acc.provider)) return false;
  return true;
}

function onMenuClicked(info) {
  if (typeof info.menuItemId !== "string") return;
  if (!info.menuItemId.startsWith(CHILD_PREFIX)) return;
  const accountId = info.menuItemId.slice(CHILD_PREFIX.length);
  syncAccount(accountId).catch((err) =>
    console.warn("[tbsync] action-menu sync failed:", err?.message ?? err),
  );
}
