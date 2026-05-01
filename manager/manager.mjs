/**
 * Account manager popup controller.
 *
 * Connects to the background via a "tbsync-manager" port, pulls state via
 * `getState`/`getFolders` RPCs, and rerenders on broadcast events like
 * `accounts-changed`, `folders-changed`, `providers-changed`.
 */

import { PROVIDER_NOTIFY, SYNCSTATE_BASE_KEYS } from "../tbsync/protocol.mjs";
import { FOLDER_TYPES } from "../modules/folder-types.mjs";
import { createManagerClient } from "../modules/manager-client.mjs";
import { EVENT_LOG_MAX } from "../modules/storage-keys.mjs";
import { localizeDocument } from "../vendor/i18n/i18n.mjs";

// ── i18n helper ───────────────────────────────────────────────────────────

/** Look up a localized message, falling back to the inline default if the
 *  key is missing. `||` (not `??`) because `getMessage` returns "" for
 *  unknown keys, not null. Optional third arg is the substitutions array
 *  forwarded to `getMessage` for placeholder-bearing keys. */
const i18n = (key, fallback, substitutions) =>
  browser.i18n.getMessage(key, substitutions) || fallback;

// ── DOM helpers ───────────────────────────────────────────────────────────

/** Clone a template's first element. For templates whose <template> wraps
 *  a single root element (row templates, install-icon). */
function cloneTpl(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

/** Clone a template's full fragment. For templates with multiple top-level
 *  children (e.g. tpl-detail with three <section>s). */
function cloneTplFragment(id) {
  return document.getElementById(id).content.cloneNode(true);
}

/** Localize `data-i18n-content` attributes inside a subtree. The vendor
 *  localizeDocument only walks the live document once at boot, so cloned
 *  template content needs this pass before insertion. */
function localizeSubtree(root) {
  for (const el of root.querySelectorAll("[data-i18n-content]")) {
    const key = el.dataset.i18nContent;
    el.textContent = browser.i18n.getMessage(key) || key;
  }
}

/** Build an `<img>` with the given attributes. Callers that only need
 *  `src`/`alt`/`title`/`class` use this instead of template boilerplate. */
function makeImg({ src, alt = "", title, className }) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  if (title != null) img.title = title;
  if (className) img.className = className;
  return img;
}

// Per-folder transient cache populated by REPORT_SYNC_STATE and
// REPORT_PROGRESS. Cleared on folders-changed for the owning account.
// See SYNCSTATE_BASE_KEYS doc in protocol.mjs for the rendering contract.
const folderSyncCache = new Map(); // folderId -> {syncState, label, itemsDone, itemsTotal, startedAt}
const countdownTimers = new Map(); // folderId -> interval handle

const state = {
  accounts: [],
  providers: [],
  folders: new Map(), // accountId -> folders[]
  selectedAccountId: null,
  // Set of providerIds currently mid-setup. Each provider can have at
  // most one in-flight setup at a time; concurrent setups for *different*
  // providers are allowed.
  setupsInFlight: new Set(),
  // accountIds whose config popup is open right now. Lets btn-settings
  // route a re-click to focusConfigPopup instead of staying greyed out.
  configsOpen: new Set(),
  // accountIds whose reauth popup is open right now. Same logic as
  // configsOpen for the "Sign in again" button.
  reauthsOpen: new Set(),
  eventLog: [],
  settings: { logLevel: 0 },
  // Host-derived transient sets, snapshotted per getState call.
  transient: {
    syncingAccounts: new Set(),
    busyAccounts: new Set(),
    busyFolders: new Set(),
    upgradeAccounts: new Set(),
  },
};

const { rpc } = createManagerClient({
  onEvent: handleEvent,
  onReconnect: () =>
    refreshState().catch((err) =>
      console.debug("[tbsync] manager: refreshState on reconnect failed:", err),
    ),
});

// ── Event dispatch from background ────────────────────────────────────────

function handleEvent(event) {
  switch (event.type) {
    case "accounts-changed":
    case "providers-changed":
      refreshState();
      break;
    case "folders-changed":
      if (event.accountId) {
        clearFolderSyncCacheForAccount(event.accountId);
        refreshFolders(event.accountId);
        // A folder change can flip `acc.needsSync` (new pending edit, or
        // last pending edit cleared by sync) - refresh the whole account
        // list so the sidebar status icon updates.
        refreshState();
      }
      break;
    case PROVIDER_NOTIFY.REPORT_SYNC_STATE:
    case PROVIDER_NOTIFY.REPORT_PROGRESS:
      updateInlineSyncState(event);
      break;
    case PROVIDER_NOTIFY.REPORT_EVENT_LOG:
      // Router already persisted + stamped the entry before broadcasting;
      // just mirror it into the UI's in-memory buffer.
      appendEventLogEntry(event.payload);
      break;
    case "event-log-cleared":
      state.eventLog = [];
      renderEventLog();
      break;
    case "settings-changed":
      refreshState();
      break;
  }
}

// ── Data loaders ──────────────────────────────────────────────────────────

async function refreshState() {
  const s = await rpc("getState");
  state.accounts = s.accounts;
  state.providers = s.providers;
  state.eventLog = s.eventLog ?? [];
  state.settings = s.settings ?? state.settings;
  const prevSyncing = state.transient.syncingAccounts;
  state.transient.syncingAccounts = new Set(s.transient?.syncingAccounts ?? []);
  state.transient.busyAccounts = new Set(s.transient?.busyAccounts ?? []);
  state.transient.busyFolders = new Set(s.transient?.busyFolders ?? []);
  state.transient.upgradeAccounts = new Set(s.transient?.upgradeAccounts ?? []);

  // Wipe stale per-folder sync cache when an account toggles in or out of
  // syncing. On entry: clear leftovers from the previous run that
  // `folders-changed` may not have caught. On exit: clear any trailing
  // notifications that arrived between the last folders-changed wipe and
  // the account leaving syncingAccounts. With this guarantee the cache
  // only ever holds entries from the current run, and `isCurrentlySyncing`
  // can derive directly from it without a parallel marker map.
  for (const accId of prevSyncing) {
    if (!state.transient.syncingAccounts.has(accId))
      clearFolderSyncCacheForAccount(accId);
  }
  for (const accId of state.transient.syncingAccounts) {
    if (!prevSyncing.has(accId)) clearFolderSyncCacheForAccount(accId);
  }
  syncVerbositySelect();

  // Invariant: exactly one account is selected whenever any exist.
  if (
    state.selectedAccountId &&
    !state.accounts.some((a) => a.accountId === state.selectedAccountId)
  ) {
    state.selectedAccountId = null;
  }
  if (!state.selectedAccountId && state.accounts.length) {
    state.selectedAccountId = state.accounts[0].accountId;
  }

  renderSidebar();
  renderDetail();
  renderEventLog();
  if (state.selectedAccountId) refreshFolders(state.selectedAccountId);
}

async function refreshFolders(accountId) {
  const { folders } = await rpc("getFolders", { accountId });
  state.folders.set(accountId, folders);
  // Sidebar pill is derived from aggregated folder state, so it needs a
  // redraw whenever any folder changes - not just the detail card.
  renderSidebar();
  if (accountId === state.selectedAccountId) renderDetail();
}

// ── Rendering ─────────────────────────────────────────────────────────────

/** Resolve a Message string (from folder.warning / folder.error / account.*)
 *  for display. See the contract in protocol.mjs: predefined code → host
 *  locale, else free-text verbatim. */
function messageText(msg) {
  if (!msg) return "";
  return (
    browser.i18n.getMessage("error." + msg) ||
    browser.i18n.getMessage("warning." + msg) ||
    msg
  );
}

/** True iff the folder's changelog has any user-authored entries waiting
 *  to be pushed on the next sync. Server pre-tag entries don't count. */
function hasPendingUserEntries(folder) {
  const log = folder?.changelog;
  if (!Array.isArray(log) || log.length === 0) return false;
  return log.some(
    (e) =>
      e.status === "added_by_user" ||
      e.status === "modified_by_user" ||
      e.status === "deleted_by_user",
  );
}

/** Derive the account-level status name (one of the keys in
 *  `STATUS_ICON_FILE`) appropriate for this folder, so the per-folder
 *  status icon can reuse `statusIconEl` and look identical to the
 *  account-row icon. The `"syncing"` value triggers `.syncing` →
 *  the rotation keyframe in manager.css. Returns null when the cell
 *  should stay empty (deselected, or a never-synced folder). Mirrors
 *  the priority of `row1StatusText` so icon and text agree on every
 *  render. */
function folderResultStatus(f) {
  if (isCurrentlySyncing(f)) return "syncing";
  if (!f.selected) return null;
  if (
    !state.transient.syncingAccounts.has(f.accountId) &&
    hasPendingUserEntries(f)
  ) {
    return "needs-sync";
  }
  switch (f.status) {
    case "pending":
      return state.transient.syncingAccounts.has(f.accountId)
        ? null
        : "notsyncronized";
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "error";
    case "aborted":
      return "notsyncronized";
    default:
      return null;
  }
}

/** Text for the main folder row's `col-status` cell. The row is the
 *  steady-state identity for this folder: the user-visible name of the
 *  bound local resource. Until the first sync binds a target,
 *  "Waiting to be synchronized" stands in for the absent name. */
function row1StatusText(f) {
  if (!f.selected) return "";
  return f.targetName ?? i18n("folder.status.pending", "Waiting to be synchronized");
}

/** True when notifications are currently arriving for this folder.
 *  Derived directly from `folderSyncCache`: an entry with `syncState`
 *  set means `updateInlineSyncState` recorded a notification for this
 *  folder during the *current* sync run (the cache is wiped on every
 *  syncingAccounts toggle, both directions). No parallel marker map. */
function isCurrentlySyncing(f) {
  if (!state.transient.syncingAccounts.has(f.accountId)) return false;
  return !!folderSyncCache.get(f.folderId)?.syncState;
}

/** Live progress text for the sync row. Only called when
 *  `isCurrentlySyncing(f)` is true, so the cache entry is guaranteed
 *  to exist with `syncState` set. */
function syncRowText(f) {
  const acc = state.accounts.find((a) => a.accountId === f.accountId);
  const provider = acc
    ? state.providers.find((p) => p.providerId === acc.provider)
    : null;
  return syncStateCellText(folderSyncCache.get(f.folderId), provider);
}

/** Up to two stacked entries for the message row: an informational
 *  "Local modifications" line that's present whenever the changelog
 *  carries user-authored entries (cleared automatically when the
 *  changelog drains), and the highest-priority post-sync outcome
 *  (error / warning / aborted) when applicable. Returns an empty
 *  array when no message row should render. */
function row2Messages(f) {
  const out = [];
  if (hasPendingUserEntries(f)) {
    out.push({
      text: i18n("folder.status.modified", "Local modifications"),
      severity: "info",
    });
  }
  if (f.status === "error" && f.error) {
    out.push({ text: messageText(f.error), severity: "error" });
  } else if (f.status === "warning" && f.warning) {
    out.push({ text: messageText(f.warning), severity: "warning" });
  } else if (f.status === "aborted") {
    out.push({
      text: i18n("account.status.aborted", "Synchronization aborted"),
      severity: "aborted",
    });
  }
  return out;
}

/**
 * Derive the UI-facing state of an account. Priority, top to bottom:
 *   1. Provider inactive → "provider-unavailable" (locked).
 *   2. Auth broken → "needs-reauth".
 *   3. Sync in progress → "syncing" (locked).
 *   4. UI RPC in flight → "busy" (locked).
 *   5. User-disabled → "disabled".
 *   6. Else aggregate over the account + its selected folders' error /
 *      warning / lastSyncTime.
 */
function effectiveAccountState(acc) {
  const provider = state.providers.find((p) => p.providerId === acc.provider);
  const providerActive = provider?.state === "active";
  if (!providerActive)
    return { status: "provider-unavailable", interactive: false };
  // Provider has declared this account locked for one-time upgrade work.
  // Highest priority because no other action can run while it's set.
  if (state.transient.upgradeAccounts.has(acc.accountId))
    return { status: "upgrading", interactive: false };
  if (state.transient.syncingAccounts.has(acc.accountId))
    return { status: "syncing", interactive: false };
  // Transient-busy locks interactive UI (buttons) while a UI-initiated RPC
  // is in flight, but the *display* stays at the underlying status - no
  // icon flash in the sidebar, no "Working…" flash in the Status section.
  const interactive = !state.transient.busyAccounts.has(acc.accountId);
  if (acc.error === "E:AUTH") return { status: "needs-reauth", interactive };
  if (!acc.enabled) return { status: "disabled", interactive };
  return { status: deriveAccountResultStatus(acc), interactive };
}

// Single-slot Status section content. Transient/terminal labels always win
// (they describe what the UI is doing *now*). Otherwise prefer the account's
// own error/warning text; fall back to the severity label when only a folder
// carries the condition (acc.error/warning empty).
function statusSlot(acc, eff) {
  const labelStates = new Set([
    "syncing",
    "busy",
    "provider-unavailable",
    "disabled",
    "success",
    "notsyncronized",
    "needs-sync",
    "upgrading",
  ]);
  if (labelStates.has(eff.status)) {
    return {
      severity: null,
      text: i18n(`account.status.${eff.status}`, eff.status),
    };
  }
  if (acc.error) {
    return { severity: "error", text: messageText(acc.error) };
  }
  return {
    severity: null,
    text: i18n(`account.status.${eff.status}`, eff.status),
  };
}

/**
 * Single source of truth for which account-level actions are currently
 * available. Buttons in the detail pane and items in the sidebar context
 * menu both read from this so the two stay aligned.
 *
 * Removal is special-cased: it stays available for accounts whose provider
 * is missing (uninstalled / not active), because the host can forget the
 * record locally without the provider's cleanup hook. All other actions
 * require an active provider port.
 */
function accountActions(acc) {
  const provider = state.providers.find((p) => p.providerId === acc.provider);
  const providerActive = provider?.state === "active";
  const upgrading = state.transient.upgradeAccounts.has(acc.accountId);
  const syncing = state.transient.syncingAccounts.has(acc.accountId);
  const busy = state.transient.busyAccounts.has(acc.accountId);
  const transientLocked = upgrading || syncing || busy;
  const isReauth = acc.error === "E:AUTH";
  const reauthOpen = state.reauthsOpen.has(acc.accountId);
  const configOpen = state.configsOpen.has(acc.accountId);

  // Removal works without the provider; only an in-flight transient state
  // (own sync, upgrade, busy RPC) holds it back.
  const canRemove = !transientLocked;

  const baseEnabled = providerActive && !transientLocked;

  return {
    canRemove,
    canSync: baseEnabled && !!acc.enabled && !isReauth,
    canConnect: baseEnabled && !acc.enabled && !isReauth,
    canDisconnect: baseEnabled && !!acc.enabled && !isReauth,
    // Re-clicks while the popup is open should focus it, even if the
    // account is currently transient-busy from the popup's own RPC.
    canReauth: providerActive && isReauth && (!transientLocked || reauthOpen),
    canEditSettings: providerActive && (!transientLocked || configOpen),
    canChangeAutosync: baseEnabled && !!acc.enabled,
    canEditFolders: baseEnabled && !!acc.enabled,
  };
}

function deriveAccountResultStatus(acc) {
  const folderList = state.folders.get(acc.accountId) ?? [];
  const selected = folderList.filter((f) => f.selected);
  if (acc.error || selected.some((f) => f.error)) return "error";
  if (selected.some((f) => f.warning)) return "warning";
  // Local edits made since the last sync - at least one folder carries
  // a `_by_user` changelog entry waiting to be pushed. Computed
  // host-side and surfaced via `acc.needsSync` so the sidebar shows the
  // right icon for every account, not just the selected one.
  if (acc.needsSync) return "needs-sync";
  if (selected.length === 0) return "notsyncronized";
  if (selected.some((f) => !f.lastSyncTime)) return "notsyncronized";
  return "success";
}

function emptyRow(colSpan, text) {
  const row = cloneTpl("tpl-empty-row");
  const td = row.firstElementChild;
  td.colSpan = colSpan;
  td.textContent = text;
  return row;
}

function renderSidebar() {
  const accBody = document.getElementById("account-list-body");
  if (!state.accounts.length) {
    accBody.replaceChildren(
      emptyRow(3, i18n("manager.noAccounts", "No accounts yet.")),
    );
  } else {
    const rows = state.accounts.map((a) => {
      const eff = effectiveAccountState(a);
      const row = cloneTpl("tpl-account-row");
      row.dataset.accountId = a.accountId;
      if (a.accountId === state.selectedAccountId)
        row.classList.add("selected");
      if (!a.enabled) row.classList.add("disabled");

      row
        .querySelector(".col-provider-icon")
        .appendChild(makeImg({ src: accountIconUrl(a) }));
      row.querySelector(".col-account-name").textContent = a.accountName;
      row.querySelector(".col-status").appendChild(statusIconEl(eff.status));
      return row;
    });
    accBody.replaceChildren(...rows);
    // Click is delegated on the table once at boot - see init block below.
  }

  const provBody = document.getElementById("provider-list-body");
  if (!state.providers.length) {
    provBody.replaceChildren(
      emptyRow(3, browser.i18n.getMessage("manager.noProviders")),
    );
  } else {
    const rows = state.providers.map((p) => {
      const canAdd =
        !state.setupsInFlight.has(p.providerId) &&
        p.state === "active" &&
        p.capabilities?.folderTypes?.length;
      // Installable means the provider isn't installed yet, not "addable
      // is unavailable for any reason" - otherwise an active provider's
      // plus icon would morph into the install arrow while setup is in
      // flight.
      const canInstall = p.state !== "active" && !!p.installUrl;
      const stateLabel = i18n(`provider.state.${p.state}`, p.state);

      const row = cloneTpl("tpl-provider-row");
      row.classList.add(
        p.state,
        canAdd ? "addable" : canInstall ? "installable" : "not-addable",
      );
      // Active providers always carry data-provider-id so the click
      // handler can route - addable ones launch a new setup, not-addable
      // ones (set-up-in-flight) ask the provider to focus its popup.
      // Inactive providers only get the id when they're installable.
      if (canAdd || canInstall || p.state === "active")
        row.dataset.providerId = p.providerId;
      if (canInstall) row.dataset.installUrl = p.installUrl;
      row.title = canAdd
        ? i18n("manager.addAccount", "Add account")
        : canInstall
          ? i18n(
              "manager.provider.install",
              "Install from addons.thunderbird.net",
            )
          : p.state === "active"
            ? i18n(
                "manager.provider.focusSetup",
                "Bring the setup window to the front",
              )
            : "";

      row
        .querySelector(".col-provider-icon")
        .appendChild(makeImg({ src: providerIconUrl(p.providerId) }));
      row.querySelector(".name").textContent = p.providerName;
      row.querySelector(".sub").textContent = stateLabel;
      row
        .querySelector(".col-status")
        .appendChild(
          canInstall ? cloneTpl("tpl-install-icon") : cloneTpl("tpl-add-icon"),
        );
      return row;
    });
    provBody.replaceChildren(...rows);
    // Click delegated on the <table> - see init block below.
  }
}

function renderDetail() {
  const host = document.getElementById("account-detail");
  const acc = state.accounts.find(
    (a) => a.accountId === state.selectedAccountId,
  );
  if (!acc) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  host.hidden = false;
  const eff = effectiveAccountState(acc);
  const actions = accountActions(acc);
  const folderList = state.folders.get(acc.accountId) ?? [];
  const isNeedsReauth = acc.error === "E:AUTH";

  // Primary action button:
  //   acc.error === E:AUTH  → Sign in again  (signInAgain → provider runs OAuth)
  //   !acc.enabled          → Connect        (setAccountEnabled true)
  //   acc.enabled           → Disconnect     (setAccountEnabled false)
  // Enabled-ness for each variant comes from `actions` so the context menu
  // and these buttons stay in lockstep.
  let primaryLabel, primaryAction, primaryEnabled;
  if (isNeedsReauth) {
    primaryLabel = i18n("manager.account.signInAgain", "Sign in again");
    primaryAction = "reauth";
    primaryEnabled = actions.canReauth;
  } else if (acc.enabled) {
    primaryLabel = i18n("manager.account.disconnect", "Disconnect");
    primaryAction = "disconnect";
    primaryEnabled = actions.canDisconnect;
  } else {
    primaryLabel = i18n("manager.account.connect", "Connect");
    primaryAction = "connect";
    primaryEnabled = actions.canConnect;
  }

  const status = statusSlot(acc, eff);

  const frag = cloneTplFragment("tpl-detail");
  localizeSubtree(frag);

  frag.querySelector(".val-provider").textContent = providerLabel(acc.provider);
  frag.querySelector(".val-last-sync").textContent = acc.lastSyncTime
    ? new Date(acc.lastSyncTime).toLocaleString()
    : "-";

  const btnPrimary = frag.querySelector("#btn-primary");
  btnPrimary.textContent = primaryLabel;
  btnPrimary.dataset.action = primaryAction;
  btnPrimary.disabled = !primaryEnabled;
  btnPrimary.addEventListener("click", () => {
    if (primaryAction === "reauth" && state.reauthsOpen.has(acc.accountId)) {
      rpc("focusReauthPopup", { accountId: acc.accountId }).catch((err) =>
        console.debug("[tbsync] manager: focusReauthPopup failed:", err),
      );
      return;
    }
    if (primaryAction === "connect") {
      markBusyLocally();
      rpc("setAccountEnabled", {
        accountId: acc.accountId,
        enabled: true,
      }).catch(showError);
    } else if (primaryAction === "disconnect") {
      markBusyLocally();
      rpc("setAccountEnabled", {
        accountId: acc.accountId,
        enabled: false,
      }).catch(showError);
    } else if (primaryAction === "reauth") {
      state.reauthsOpen.add(acc.accountId);
      markBusyLocally();
      rpc("signInAgain", { accountId: acc.accountId })
        .catch(showError)
        .finally(() => state.reauthsOpen.delete(acc.accountId));
    }
  });

  const btnSettings = frag.querySelector("#btn-settings");
  btnSettings.disabled = !actions.canEditSettings;
  btnSettings.addEventListener("click", () => {
    if (state.configsOpen.has(acc.accountId)) {
      rpc("focusConfigPopup", { accountId: acc.accountId }).catch((err) =>
        console.debug("[tbsync] manager: focusConfigPopup failed:", err),
      );
      return;
    }
    state.configsOpen.add(acc.accountId);
    markBusyLocally();
    rpc("editAccount", { accountId: acc.accountId })
      .catch(showError)
      .finally(() => state.configsOpen.delete(acc.accountId));
  });

  const btnRemove = frag.querySelector("#btn-remove");
  btnRemove.disabled = !actions.canRemove;
  btnRemove.addEventListener("click", () => {
    confirmAndDeleteAccount(acc.accountId, markBusyLocally);
  });

  const statusText = frag.querySelector(".status-text");
  statusText.textContent = status.text;
  if (status.severity) statusText.classList.add(status.severity);

  if (acc.enabled) {
    const resources = frag.querySelector(".resources-section");
    resources.hidden = false;
    // Resource table is always rendered when the account is connected;
    // an empty resource list shows a single placeholder row instead of
    // hiding the table.
    frag.querySelector(".folder-table-wrap").hidden = false;
    const table = frag.querySelector(".folder-table");
    const visibleFolders = folderList.filter((f) => !f.hidden);
    if (visibleFolders.length) {
      for (const f of visibleFolders) {
        const isBusy = state.transient.busyFolders.has(f.folderId);
        const folderLock = isBusy || !actions.canEditFolders;
        const tbody = cloneTpl("tpl-folder-group");
        if (!f.selected) tbody.classList.add("unselected");
        const row = tbody.querySelector("tr.folder-main");

        const cb = row.querySelector("input[type=checkbox]");
        cb.dataset.folderId = f.folderId;
        cb.checked = !!f.selected;
        cb.disabled = folderLock;
        cb.addEventListener("change", () => {
          rpc("setFolderSelected", {
            accountId: acc.accountId,
            folderId: f.folderId,
            selected: cb.checked,
          }).catch(showError);
        });

        const typeIcon = folderTypeIconEl(f.targetType);
        if (typeIcon) row.querySelector(".col-type-icon").appendChild(typeIcon);
        row.querySelector(".col-acl").appendChild(
          aclSelectEl(f, {
            disabled: folderLock,
            onChange: (downloadOnly) => {
              rpc("setFolderDownloadOnly", {
                accountId: acc.accountId,
                folderId: f.folderId,
                downloadOnly,
              }).catch(showError);
            },
          }),
        );
        row.querySelector(".col-name").textContent = f.displayName;
        const iconStatus = folderResultStatus(f);
        if (iconStatus) {
          row.querySelector(".col-status-icon").appendChild(statusIconEl(iconStatus));
        }
        row.querySelector(".col-status").textContent = row1StatusText(f);

        if (isCurrentlySyncing(f)) {
          const syncRow = cloneTpl("tpl-folder-sync-row");
          syncRow.querySelector(".col-sync-status").textContent = syncRowText(f);
          tbody.appendChild(syncRow);
        }

        const messages = row2Messages(f);
        if (messages.length) {
          const msgRow = cloneTpl("tpl-folder-message-row");
          const cell = msgRow.querySelector(".col-message");
          for (const m of messages) {
            const line = document.createElement("div");
            line.className = `folder-message ${m.severity}`;
            line.textContent = m.text;
            cell.appendChild(line);
          }
          tbody.appendChild(msgRow);
        }

        table.appendChild(tbody);
      }
    } else {
      const emptyTbody = cloneTpl("tpl-folder-empty");
      emptyTbody.querySelector("td").textContent =
        i18n("manager.resources.empty", "No resources yet.");
      table.appendChild(emptyTbody);
    }

    // Footer (auto-sync interval + Sync button) is always shown for
    // enabled accounts. The Sync button doesn't require a selected
    // folder up-front - the sync itself can populate / refresh the
    // resource list.
    frag.querySelector(".resources-footer").hidden = false;

    const autosync = frag.querySelector("#autosync-minutes");
    autosync.value = String(acc.autoSyncIntervalMinutes ?? 0);
    autosync.title = i18n(
      "manager.account.autosync.tooltip",
      "0 disables auto-sync",
    );
    autosync.disabled = !actions.canChangeAutosync;
    autosync.addEventListener("change", (e) => {
      const minutes = Math.max(0, parseInt(e.currentTarget.value, 10) || 0);
      e.currentTarget.value = String(minutes);
      rpc("setAutoSyncInterval", { accountId: acc.accountId, minutes }).catch(
        showError,
      );
    });

    const btnSync = frag.querySelector("#btn-sync");
    btnSync.disabled = !actions.canSync;
    btnSync.addEventListener("click", () => {
      rpc("syncAccount", { accountId: acc.accountId }).catch(showError);
    });
  }

  host.replaceChildren(frag);

  // Optimistic busy flip so the UI locks the buttons immediately on click,
  // without waiting for the host's accounts-changed round trip. The next
  // broadcast will either keep the busy state (host took it) or clear it
  // (RPC settled). We don't track the flip locally.
  function markBusyLocally() {
    state.transient.busyAccounts.add(acc.accountId);
    renderSidebar();
    renderDetail();
  }
}

/** Render the transient status-cell text for a folder from the cached
 *  entry + the owning provider's meta. See the contract in protocol.mjs. */
function syncStateCellText(entry, provider) {
  let text;
  if (entry.label) {
    text = entry.label;
  } else {
    const dot = entry.syncState.indexOf(".");
    const head = dot === -1 ? entry.syncState : entry.syncState.slice(0, dot);
    const tail = dot === -1 ? "" : entry.syncState.slice(dot + 1);
    const localised = browser.i18n.getMessage("syncstate." + head);
    if (localised && SYNCSTATE_BASE_KEYS.has(head)) {
      text = tail ? `${localised} (${tail})` : localised;
    } else {
      text = entry.syncState;
    }
  }

  if (typeof entry.itemsTotal === "number") {
    text += ` (${entry.itemsDone ?? 0}/${entry.itemsTotal})`;
  }

  const prefix = entry.syncState.split(".")[0];
  const timeoutMs = provider?.capabilities?.connectionTimeoutMs;
  if (prefix === "send" && timeoutMs) {
    const elapsed = Date.now() - (entry.startedAt ?? Date.now());
    if (elapsed > 2000) {
      const remainingSec = Math.max(
        0,
        Math.round((timeoutMs - elapsed) / 1000),
      );
      text += ` (${remainingSec}s)`;
    }
  }
  return text;
}

function stopCountdownTimer(folderId) {
  const handle = countdownTimers.get(folderId);
  if (handle !== undefined) {
    clearInterval(handle);
    countdownTimers.delete(folderId);
  }
}

function ensureCountdownTimer(folderId, provider) {
  if (countdownTimers.has(folderId)) return;
  if (!provider?.capabilities?.connectionTimeoutMs) return;
  const handle = setInterval(() => {
    const entry = folderSyncCache.get(folderId);
    if (!entry || entry.syncState.split(".")[0] !== "send") {
      stopCountdownTimer(folderId);
      return;
    }
    renderDetail();
  }, 1000);
  countdownTimers.set(folderId, handle);
}

// A folder sync is "done" once the account has left the syncing set - any
// trailing notifications that arrive after folders-changed must not
// resurrect a "Synchronizing…" label.
function updateInlineSyncState({ type, accountId, folderId, payload }) {
  if (!folderId) return;
  if (!state.transient.syncingAccounts.has(accountId)) {
    folderSyncCache.delete(folderId);
    stopCountdownTimer(folderId);
    return;
  }
  const acc = state.accounts.find((a) => a.accountId === accountId);
  const provider = acc
    ? state.providers.find((p) => p.providerId === acc.provider)
    : null;

  const prior = folderSyncCache.get(folderId) ?? {};
  const entry = { ...prior };

  if (type === PROVIDER_NOTIFY.REPORT_SYNC_STATE && payload?.syncState) {
    const changed = prior.syncState !== payload.syncState;
    entry.syncState = payload.syncState;
    entry.label = payload.label ?? null;
    if (changed) entry.startedAt = Date.now();
  } else if (type === PROVIDER_NOTIFY.REPORT_PROGRESS) {
    entry.itemsDone = payload?.itemsDone;
    entry.itemsTotal = payload?.itemsTotal;
  } else {
    return;
  }

  folderSyncCache.set(folderId, entry);

  if (accountId === state.selectedAccountId && entry.syncState) {
    renderDetail();
  }

  const prefix = entry.syncState?.split(".")[0];
  if (prefix === "send") {
    ensureCountdownTimer(folderId, provider);
  } else {
    stopCountdownTimer(folderId);
  }
}

/** Drop cached sync-state entries for all folders of an account (and stop
 *  their countdown timers). Call on `folders-changed` so the next render
 *  falls back to the derived folder cell (based on error, warning and
 *  lastSyncTime). */
function clearFolderSyncCacheForAccount(accountId) {
  const folderIds = (state.folders.get(accountId) ?? []).map((f) => f.folderId);
  for (const id of folderIds) {
    folderSyncCache.delete(id);
    stopCountdownTimer(id);
  }
}

// ── Event log ─────────────────────────────────────────────────────────────

function renderEventLog() {
  const body = document.getElementById("event-log-rows");
  if (!body) return;
  // Newest first: walk the chronological state array in reverse.
  const rows = [];
  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    rows.push(eventLogRow(state.eventLog[i]));
  }
  body.replaceChildren(...rows);
  updateEventLogEmptyState();
}

function appendEventLogEntry(entry) {
  state.eventLog.push(entry);
  if (state.eventLog.length > EVENT_LOG_MAX) {
    state.eventLog.splice(0, state.eventLog.length - EVENT_LOG_MAX);
  }
  const body = document.getElementById("event-log-rows");
  if (body) {
    body.prepend(eventLogRow(entry));
    while (body.rows.length > EVENT_LOG_MAX)
      body.deleteRow(body.rows.length - 1);
  }
  updateEventLogEmptyState();
}

function eventLogRow(entry) {
  const acc = entry.accountId
    ? state.accounts.find((a) => a.accountId === entry.accountId)
    : null;
  const row = cloneTpl("tpl-event-log-row");
  row.className = entry.level;
  row.querySelector(".time").textContent = new Date(
    entry.timestamp ?? Date.now(),
  ).toLocaleString();
  row.querySelector(".sev").textContent = entry.level;
  // Source = entry's filer. Provider-emitted entries carry `providerId`;
  // host-emitted entries (e.g. router warnings) don't, so they read as
  // "TbSync Manager" to match the bug-report component label.
  row.querySelector(".src").textContent = entry.providerId
    ? providerLabel(entry.providerId)
    : "TbSync Manager";
  row.querySelector(".acct").textContent =
    acc?.accountName ?? entry.accountId ?? "";
  row.querySelector(".msg-text").textContent = entry.message ?? "";
  if (entry.details) {
    const details = row.querySelector(".details");
    details.textContent = entry.details;
    details.hidden = false;
  }
  return row;
}

function updateEventLogEmptyState() {
  const empty = document.getElementById("event-log-empty");
  if (!empty) return;
  empty.classList.toggle("visible", state.eventLog.length === 0);
}

// ── Interactions ──────────────────────────────────────────────────────────

function selectAccount(accountId) {
  if (state.selectedAccountId === accountId) return;
  state.selectedAccountId = accountId;
  renderSidebar();
  renderDetail();
  refreshFolders(accountId);
}

function providerLabel(providerId) {
  return (
    state.providers.find((p) => p.providerId === providerId)?.providerName ??
    providerId
  );
}

function providerIconUrl(providerId) {
  const hit = state.providers.find((p) => p.providerId === providerId);
  return (
    hit?.icons?.["16"] ??
    hit?.icons?.["32"] ??
    browser.runtime.getURL("icons/provider16.png")
  );
}

/** Icon URL for an account row. Prefers the per-account icon override
 *  (provider-authored at register time, persisted as `account.icon`)
 *  over the provider-wide announced icons. Falls through to
 *  `providerIconUrl` when the account has no override. */
function accountIconUrl(account) {
  const icon = account?.icon;
  if (icon && typeof icon === "object") {
    return icon["16"] ?? icon["32"] ?? Object.values(icon)[0];
  }
  return providerIconUrl(account.provider);
}

// Status → icon filename. Matches the legacy TbSync mapping:
// success → tick, disabled → disabled, warning → warning, notsyncronized
// / needs-sync → info (informational state, not active work), syncing →
// sync (animated), upgrading → spinner (active background work, distinct
// from sync), everything else → error.
const STATUS_ICON_FILE = {
  success: "status-tick16.png",
  disabled: "status-disabled16.png",
  warning: "status-warning16.png",
  notsyncronized: "status-info16.png",
  "needs-sync": "status-info16.png",
  syncing: "status-sync16.png",
  upgrading: "spinner.gif",
};

/** Icon for the Status column. Tooltip carries the localised status label
 *  for hover + screen-reader users. Unknown / failure-ish statuses fall back
 *  to the error icon. The `syncing` status gets a `.syncing` class so the
 *  CSS rotation keyframe kicks in while sync is active. */
function statusIconEl(status) {
  const file = STATUS_ICON_FILE[status] ?? "status-error16.png";
  const label = browser.i18n.getMessage(`account.status.${status}`) || status;
  return makeImg({
    src: browser.runtime.getURL(`icons/${file}`),
    alt: label,
    title: label,
    className: status === "syncing" ? "status-icon syncing" : "status-icon",
  });
}

function folderTypeIconEl(targetType) {
  const spec = FOLDER_TYPES[targetType];
  if (!spec) return null;
  const label = i18n(spec.labelKey, targetType);
  return makeImg({
    src: browser.runtime.getURL(spec.icon),
    alt: label,
    title: label,
    className: "folder-type-icon",
  });
}

// Read-only / read-write selector per folder.
//
// Two flags decide the rendered state:
//   - `folder.readOnly`     - server-announced ACL, immutable for the user.
//   - `folder.downloadOnly` - user override; only meaningful when readOnly
//                              is false.
//
// Closed state:
//   - server-RO: a static <img> of the read-only icon (tooltip explains).
//   - otherwise: a small <button> showing the active-state icon + chevron.
//
// Open state (button only): a popup <ul role="listbox"> with two
// <li role="option"> rows, each "icon + text". Strings ported verbatim
// from legacy TbSync (acl.readonly / acl.readwrite). Click outside or
// Escape closes the popup.
function aclSelectEl(folder, { onChange, disabled = false } = {}) {
  const labelRW = i18n(
    "folder.acl.option.readWrite",
    "Read from and write to server",
  );
  const labelRO = i18n(
    "folder.acl.option.downloadOnly",
    "Read-only server access (revert local changes)",
  );

  // Server-imposed RO: render as a static icon. No menu, no choice.
  if (folder.readOnly) {
    const tip = i18n(
      "folder.acl.serverReadOnly",
      "Read-only server access (server-enforced)",
    );
    return makeImg({
      src: browser.runtime.getURL("icons/acl-ro16.png"),
      alt: tip,
      title: tip,
      className: "folder-acl-icon folder-acl-icon-static",
    });
  }

  const wrap = document.createElement("div");
  wrap.className = "folder-acl-dropdown";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "folder-acl-trigger";
  trigger.dataset.state = folder.downloadOnly ? "ro" : "rw";
  trigger.disabled = !!disabled;
  trigger.title = folder.downloadOnly ? labelRO : labelRW;
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute(
    "aria-label",
    folder.downloadOnly ? labelRO : labelRW,
  );
  // DOM children (not background-image) so no UA hover/active style can
  // drop the icon, and so flexbox can vertically centre the bits cleanly.
  const triggerIcon = document.createElement("img");
  triggerIcon.className = "folder-acl-trigger-icon";
  triggerIcon.alt = "";
  triggerIcon.src = browser.runtime.getURL(
    folder.downloadOnly ? "icons/acl-ro16.png" : "icons/acl-rw16.png",
  );
  const triggerSep = document.createElement("span");
  triggerSep.className = "folder-acl-trigger-sep";
  triggerSep.setAttribute("aria-hidden", "true");
  const triggerChevron = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  triggerChevron.setAttribute("viewBox", "0 0 8 5");
  triggerChevron.setAttribute("class", "folder-acl-trigger-chevron");
  triggerChevron.setAttribute("aria-hidden", "true");
  const chevronPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  chevronPath.setAttribute("d", "M0 0h8L4 5z");
  triggerChevron.appendChild(chevronPath);
  trigger.append(triggerIcon, triggerSep, triggerChevron);

  const popup = document.createElement("ul");
  popup.className = "folder-acl-popup";
  popup.setAttribute("role", "listbox");
  popup.hidden = true;

  const options = [
    { value: "rw", label: labelRW, icon: "icons/acl-rw16.png" },
    { value: "ro", label: labelRO, icon: "icons/acl-ro16.png" },
  ];
  for (const opt of options) {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.dataset.value = opt.value;
    const isSelected =
      (opt.value === "ro") === !!folder.downloadOnly;
    li.setAttribute("aria-selected", String(isSelected));
    if (isSelected) li.classList.add("selected");

    const img = document.createElement("img");
    img.src = browser.runtime.getURL(opt.icon);
    img.alt = "";
    img.className = "folder-acl-option-icon";
    const span = document.createElement("span");
    span.textContent = opt.label;
    li.append(img, span);

    li.addEventListener("click", () => {
      closePopup();
      const next = opt.value === "ro";
      trigger.dataset.state = next ? "ro" : "rw";
      trigger.title = next ? labelRO : labelRW;
      trigger.setAttribute("aria-label", next ? labelRO : labelRW);
      triggerIcon.src = browser.runtime.getURL(
        next ? "icons/acl-ro16.png" : "icons/acl-rw16.png",
      );
      if (onChange) onChange(next);
    });
    popup.appendChild(li);
  }

  function positionPopup() {
    // `position: fixed`: coordinates are viewport-space. Pin the popup
    // just below the trigger by default; flip above when there isn't
    // enough room below. Reveal a measurable layout box first by
    // un-hiding so getBoundingClientRect() reports real dimensions.
    const r = trigger.getBoundingClientRect();
    popup.style.visibility = "hidden";
    popup.hidden = false;
    const popH = popup.offsetHeight;
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - r.bottom;
    const top =
      spaceBelow < popH + 4 && r.top > popH + 4
        ? r.top - popH - 2
        : r.bottom + 2;
    popup.style.top = top + "px";
    popup.style.left = r.left + "px";
    popup.style.visibility = "";
  }
  function openPopup() {
    closeAllAclDropdowns();
    positionPopup();
    trigger.setAttribute("aria-expanded", "true");
    // Defer attaching the dismiss listeners until after the click that
    // opened us has finished bubbling, otherwise they fire immediately.
    setTimeout(() => {
      document.addEventListener("click", outsideClick, true);
      document.addEventListener("keydown", escClose, true);
      // Capture-phase scroll so we catch any scroll container, not just
      // the window. We close rather than reposition - simpler, and the
      // popup is short-lived enough that drift-on-scroll is rare.
      document.addEventListener("scroll", scrollClose, true);
      window.addEventListener("resize", scrollClose);
    }, 0);
  }
  function closePopup() {
    popup.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", outsideClick, true);
    document.removeEventListener("keydown", escClose, true);
    document.removeEventListener("scroll", scrollClose, true);
    window.removeEventListener("resize", scrollClose);
  }
  function outsideClick(e) {
    // The popup is now a fixed-positioned sibling of the trigger but
    // still a DOM descendant of `wrap`, so wrap.contains() still works.
    if (!wrap.contains(e.target)) closePopup();
  }
  function escClose(e) {
    if (e.key === "Escape") {
      closePopup();
      trigger.focus();
    }
  }
  function scrollClose() {
    closePopup();
  }
  // Expose close for the global "close any other dropdown" handler.
  wrap._closeAclPopup = closePopup;

  trigger.addEventListener("click", () => {
    if (popup.hidden) openPopup();
    else closePopup();
  });

  wrap.append(trigger, popup);
  return wrap;
}

/** Close every other open ACL dropdown in the document. Used to enforce
 *  single-popup-at-a-time when a new trigger fires. */
function closeAllAclDropdowns() {
  for (const el of document.querySelectorAll(".folder-acl-dropdown")) {
    if (typeof el._closeAclPopup === "function") el._closeAclPopup();
  }
}

// ── Modal popover queue ──────────────────────────────────────────────────
//
// Both confirm and error popovers share one <dialog> element. Native
// <dialog>.showModal() throws if the element is already open, so we
// serialize requests through a FIFO queue: each entry waits for the
// previous one's `close` event before opening.
const modalQueue = [];
let modalBusy = false;

function enqueueModal(opts) {
  return new Promise((resolve) => {
    modalQueue.push({ opts, resolve });
    drainModalQueue();
  });
}

function drainModalQueue() {
  if (modalBusy) return;
  const entry = modalQueue.shift();
  if (!entry) return;
  modalBusy = true;

  const { opts, resolve } = entry;
  const dlg = document.getElementById("confirm-dialog");
  dlg.dataset.variant = opts.variant;
  document.getElementById("confirm-dialog-title").textContent = opts.title;
  document.getElementById("confirm-dialog-body").textContent = opts.body ?? "";
  if (opts.variant === "confirm") {
    document.getElementById("confirm-dialog-confirm").textContent =
      opts.confirmLabel;
    document.getElementById("confirm-dialog-cancel").textContent =
      opts.cancelLabel;
  } else if (opts.variant === "error") {
    document.getElementById("confirm-dialog-ok").textContent = opts.okLabel;
  } else if (opts.variant === "bugreport") {
    document.getElementById("confirm-dialog-send").textContent = opts.sendLabel;
    document.getElementById("confirm-dialog-cancel").textContent =
      opts.cancelLabel;
    opts.onOpen?.(dlg);
  }
  // Escape / backdrop → close event with returnValue === "".
  dlg.returnValue = "";

  const onClose = () => {
    dlg.removeEventListener("close", onClose);
    modalBusy = false;
    resolve(dlg.returnValue);
    drainModalQueue();
  };
  dlg.addEventListener("close", onClose);
  dlg.showModal();
}

/**
 * Promise-wrapped confirmation dialog backed by the shared modal queue.
 * Resolves `true` on confirm, `false` on cancel / Escape / backdrop.
 */
function confirmDialog({ title, body, confirmLabel, cancelLabel }) {
  return enqueueModal({
    variant: "confirm",
    title,
    body,
    confirmLabel,
    cancelLabel,
  }).then((v) => v === "confirm");
}

/** Error popover - single OK button. Resolves when dismissed. */
function errorDialog({ title, body, okLabel }) {
  return enqueueModal({ variant: "error", title, body, okLabel });
}

function showError(err) {
  console.error(err);
  errorDialog({
    title: i18n("manager.error.title", "Error"),
    body: err?.message ?? String(err),
    okLabel: i18n("manager.error.dismiss", "OK"),
  });
}

// ── Bug report ────────────────────────────────────────────────────────────

const CORE_COMPONENT_ID = "__core__";

/** Populate the component dropdown with "TbSync Manager" + every known
 *  provider, preselecting the provider of the currently-selected account
 *  when there is one. */
function populateBugReportComponents() {
  const select = document.getElementById("bug-report-component");
  select.replaceChildren();

  const coreOpt = document.createElement("option");
  coreOpt.value = CORE_COMPONENT_ID;
  // Brand-name-like literal - same in every locale, so no i18n key.
  coreOpt.textContent = "TbSync Manager";
  select.appendChild(coreOpt);

  for (const p of state.providers) {
    if (p.state === "uninstalled") continue;
    const opt = document.createElement("option");
    opt.value = p.providerId;
    opt.textContent = p.providerName ?? p.providerId;
    select.appendChild(opt);
  }

  // Preselect the provider of the selected account when possible.
  const selectedAcc = state.accounts.find(
    (a) => a.accountId === state.selectedAccountId,
  );
  if (
    selectedAcc?.provider &&
    select.querySelector(`option[value="${CSS.escape(selectedAcc.provider)}"]`)
  ) {
    select.value = selectedAcc.provider;
  } else {
    select.value = CORE_COMPONENT_ID;
  }
}

/** Open the bug-report modal; resolves with the form data on Send,
 *  or null on Cancel / Escape. */
function bugReportDialog() {
  return enqueueModal({
    variant: "bugreport",
    title: i18n("bugReport.title", "Create Bug Report"),
    sendLabel: i18n("bugReport.send", "Send"),
    cancelLabel: i18n("bugReport.cancel", "Cancel"),
    onOpen: () => {
      populateBugReportComponents();
      document.getElementById("bug-report-summary").value = "";
      document.getElementById("bug-report-description").value = "";
      // Defer focus to post-showModal paint so the field is actually focusable.
      setTimeout(
        () => document.getElementById("bug-report-summary").focus(),
        0,
      );
    },
  }).then((returnValue) => {
    if (returnValue !== "send") return null;
    return {
      component: document.getElementById("bug-report-component").value,
      summary: document.getElementById("bug-report-summary").value.trim(),
      description: document
        .getElementById("bug-report-description")
        .value.trim(),
    };
  });
}

/** Look up the maintainer address for a component. Core has a constant
 *  address shipped with the host; providers carry their own. */
function recipientForComponent(componentId) {
  if (componentId === CORE_COMPONENT_ID) return null; // handled by caller (host constant)
  return (
    state.providers.find((p) => p.providerId === componentId)
      ?.maintainerEmail ?? null
  );
}

/** Resolve the component's version string for the report header. */
async function versionForComponent(componentId) {
  if (componentId === CORE_COMPONENT_ID)
    return browser.runtime.getManifest().version;
  try {
    const info = await browser.management.get(componentId);
    return info?.version ?? "";
  } catch (err) {
    console.debug(
      `[tbsync] manager: management.get(${componentId}) failed:`,
      err,
    );
    return "";
  }
}

/** Plain-text report header + user description. The event log is
 *  attached separately (see renderEventLogAttachment). */
async function buildReportBody({ componentId, description }) {
  const host = browser.runtime.getManifest().version;
  const tb = await browser.runtime.getBrowserInfo();
  const plat = await browser.runtime.getPlatformInfo();
  const componentVersion = await versionForComponent(componentId);
  const componentLabel =
    componentId === CORE_COMPONENT_ID ? "TbSync Manager" : componentId;

  return [
    `TbSync ${host}`,
    `Thunderbird ${tb.version} (${tb.name} ${tb.buildID})`,
    `Platform: ${plat.os} / ${plat.arch}`,
    `Component: ${componentLabel}${componentVersion ? ` ${componentVersion}` : ""}`,
    "",
    "--- User description ---",
    description || "(none)",
    "",
  ].join("\n");
}

/** Render the session-scoped event log as plain text for the attachment.
 *  One entry per line, chronological (oldest first). */
function renderEventLogAttachment() {
  const lines = state.eventLog.map((e) => {
    const ts = new Date(e.timestamp ?? Date.now()).toISOString();
    const bits = [ts, `[${e.level}]`];
    // Source matches the UI's Source column: provider name, or "TbSync
    // Manager" for host-filed entries.
    const src = e.providerId
      ? (state.providers.find((p) => p.providerId === e.providerId)
          ?.providerName ?? e.providerId)
      : "TbSync Manager";
    bits.push(`{${src}}`);
    if (e.accountId) {
      const acc = state.accounts.find((a) => a.accountId === e.accountId);
      bits.push(`(${acc?.accountName ?? e.accountId})`);
    }
    bits.push(e.message ?? "");
    let line = bits.join(" ");
    if (e.details)
      line += `\n    ${String(e.details).replace(/\n/g, "\n    ")}`;
    return line;
  });
  return lines.join("\n") + "\n";
}

async function createBugReport() {
  const form = await bugReportDialog();
  if (!form) return;
  if (!form.summary) {
    // Summary is required for a meaningful subject; re-surface an error.
    showError(
      new Error(
        i18n("bugReport.error.summaryRequired", "Please enter a summary."),
      ),
    );
    return;
  }

  const hostVersion = browser.runtime.getManifest().version;
  const recipient =
    form.component === CORE_COMPONENT_ID
      ? await rpc("getCoreMaintainerEmail")
      : recipientForComponent(form.component);

  const body = await buildReportBody({
    componentId: form.component,
    description: form.description,
  });
  const logText = renderEventLogAttachment();
  const file = new File([logText], "tbsync-eventlog.txt", {
    type: "text/plain",
  });

  try {
    await messenger.compose.beginNew({
      to: recipient ? [recipient] : [],
      subject: `TbSync ${hostVersion} bug report: ${form.summary}`,
      isPlainText: true,
      plainTextBody: body,
      attachments: [{ file }],
    });
  } catch (err) {
    showError(err);
  }
}

async function confirmAndDeleteAccount(accountId, onConfirmed) {
  const acc = state.accounts.find((a) => a.accountId === accountId);
  if (!acc) return;
  const ok = await confirmDialog({
    title: i18n("manager.remove.confirmTitle", "Remove account"),
    body: i18n(
      "manager.remove.confirmBody",
      `Remove account “${acc.accountName}”? The Thunderbird address book for this account will also be deleted.`,
      acc.accountName,
    ),
    confirmLabel: i18n("manager.account.remove", "Remove"),
    cancelLabel: i18n("manager.remove.cancelLabel", "Cancel"),
  });
  if (!ok) return;
  onConfirmed?.();
  rpc("deleteAccount", { accountId }).catch(showError);
}

// ── Add-account launcher ──────────────────────────────────────────────────

async function launchSetup(providerId) {
  // Defensive: class-routing makes the row not-addable while this
  // provider's setup is open, so the click handler dispatches to
  // focusSetupPopup instead. This guard catches any path that bypasses
  // that - e.g. a programmatic call.
  if (state.setupsInFlight.has(providerId)) return;
  state.setupsInFlight.add(providerId);
  renderSidebar();
  let result = null;
  try {
    result = await rpc("addAccount", { providerId });
  } catch (err) {
    if (err.code !== "E:CANCELLED") showError(err);
  } finally {
    state.setupsInFlight.delete(providerId);
  }
  await refreshState();
  if (result?.accountId) selectAccount(result.accountId);
}

// ── Boot ──────────────────────────────────────────────────────────────────

// Vendored webext-support/i18n substitutes every `data-i18n-content` /
// `data-i18n-<attr>` / `__MSG_*__` site in the static document so nothing
// flashes English-then-translated.
localizeDocument();

// Tab switching - one listener on the tab bar.
document.querySelector(".tab-bar").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-button");
  if (!btn) return;
  selectTab(btn.dataset.tab);
});

function selectTab(tabName) {
  for (const btn of document.querySelectorAll(".tab-button")) {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.toggleAttribute("hidden", panel.dataset.panel !== tabName);
  }
}

document.getElementById("event-log-clear").addEventListener("click", () => {
  rpc("clearEventLog").catch(showError);
});

document
  .getElementById("event-log-verbosity")
  .addEventListener("change", (e) => {
    const level = Number(e.currentTarget.value);
    rpc("setLogLevel", { level }).catch(showError);
  });

function syncVerbositySelect() {
  const select = document.getElementById("event-log-verbosity");
  if (!select) return;
  const current = String(state.settings?.logLevel ?? 0);
  if (select.value !== current) select.value = current;
}

document.getElementById("btn-bug-report").addEventListener("click", () => {
  createBugReport().catch(showError);
});

// Open a URL inside Thunderbird and raise the window that holds the new tab -
// otherwise Thunderbird may create the tab in a background window and the user
// doesn't see their click land.
async function openThunderbirdTab(url) {
  const tab = await messenger.tabs.create({ url, active: true });
  if (tab?.windowId != null) {
    await messenger.windows.update(tab.windowId, { focused: true });
  }
}

// Routed external links: data-link-target="thunderbird" opens a Thunderbird
// content tab; data-link-target="browser" opens the system default browser.
document.body.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link-target]");
  if (!a) return;
  e.preventDefault();
  const url = a.getAttribute("href");
  if (a.dataset.linkTarget === "browser") {
    messenger.windows.openDefaultBrowser(url);
  } else {
    openThunderbirdTab(url).catch(showError);
  }
});

// Delegated sidebar clicks - one listener per list, independent of how many
// times the contents are re-rendered.
document.getElementById("account-list").addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-account-id]");
  if (!row) return;
  selectAccount(row.dataset.accountId);
});
document.getElementById("provider-list").addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-provider-id]");
  if (!row) return;
  const { providerId, installUrl } = row.dataset;
  if (installUrl) {
    openThunderbirdTab(installUrl).catch(showError);
    return;
  }
  // Class drives intent: addable rows start a new setup; not-addable
  // active rows ask the provider to focus its existing setup popup. The
  // provider returns silently if no popup is open, so the click is a
  // safe no-op for any state combination we didn't anticipate.
  if (row.classList.contains("addable")) {
    launchSetup(providerId);
  } else {
    rpc("focusSetupPopup", { providerId }).catch((err) =>
      console.debug("[tbsync] manager: focusSetupPopup failed:", err),
    );
  }
});

// ── Account-row context menu ──────────────────────────────────────────────

// Three slots, always visible: Sync, Connect↔Disconnect (toggle), Delete.
// `onShown` only updates the sync item's enabled state and the toggle item's
// title - no create/remove churn per right-click.
const MENU_IDS = {
  sync: "tbsync-account-sync",
  toggle: "tbsync-account-toggle",
  delete: "tbsync-account-delete",
  eventLog: "tbsync-show-event-log",
};

{
  const common = {
    contexts: ["all"],
    documentUrlPatterns: [browser.runtime.getURL("manager/manager.html")],
  };
  browser.menus.create({
    ...common,
    id: MENU_IDS.sync,
    title: i18n("manager.account.sync", "Synchronize Now"),
  });
  browser.menus.create({
    ...common,
    id: MENU_IDS.toggle,
    title: i18n("manager.account.connect", "Connect"),
  });
  browser.menus.create({
    ...common,
    id: MENU_IDS.delete,
    title: i18n("manager.account.remove", "Remove"),
  });
  browser.menus.create({
    ...common,
    id: MENU_IDS.eventLog,
    title: i18n("manager.menu.showEventLog", "Show event log"),
  });
}

// On the accounts tab we suppress the browser default menu so our items are
// the only ones shown - both for row clicks (account actions) and off-row
// clicks (event-log shortcut). Other tabs fall through to the default menu.
// `overrideContext` must be called synchronously from `contextmenu`.
document
  .querySelector('[data-panel="accounts"]')
  .addEventListener("contextmenu", () => {
    browser.menus.overrideContext({ showDefaults: false });
  });

browser.menus.onShown.addListener((info) => {
  const targetEl = info.targetElementId
    ? browser.menus.getTargetElement(info.targetElementId)
    : null;
  const inAccountsPanel = !!targetEl?.closest?.('[data-panel="accounts"]');

  if (!inAccountsPanel) {
    // Other tabs: keep our items out of the default menu.
    browser.menus.update(MENU_IDS.sync, { visible: false });
    browser.menus.update(MENU_IDS.toggle, { visible: false });
    browser.menus.update(MENU_IDS.delete, { visible: false });
    browser.menus.update(MENU_IDS.eventLog, { visible: false });
    browser.menus.refresh();
    return;
  }

  const row = targetEl.closest("tr[data-account-id]");
  const acc =
    row && state.accounts.find((a) => a.accountId === row.dataset.accountId);

  if (!acc) {
    // Accounts tab, off-row: only the event-log shortcut.
    browser.menus.update(MENU_IDS.sync, { visible: false });
    browser.menus.update(MENU_IDS.toggle, { visible: false });
    browser.menus.update(MENU_IDS.delete, { visible: false });
    browser.menus.update(MENU_IDS.eventLog, { visible: true });
    browser.menus.refresh();
    return;
  }

  // Accounts tab, on a row: the three account actions.
  const actions = accountActions(acc);
  browser.menus.update(MENU_IDS.sync, {
    visible: true,
    enabled: actions.canSync,
  });
  browser.menus.update(MENU_IDS.toggle, {
    visible: true,
    enabled: acc.enabled ? actions.canDisconnect : actions.canConnect,
    title: acc.enabled
      ? i18n("manager.account.disconnect", "Disconnect")
      : i18n("manager.account.connect", "Connect"),
  });
  browser.menus.update(MENU_IDS.delete, {
    visible: true,
    enabled: actions.canRemove,
  });
  browser.menus.update(MENU_IDS.eventLog, { visible: true });
  browser.menus.refresh();
});

browser.menus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_IDS.eventLog) {
    selectTab("eventLog");
    return;
  }

  const el = info.targetElementId
    ? browser.menus
        .getTargetElement(info.targetElementId)
        ?.closest?.("tr[data-account-id]")
    : null;
  if (!el) return;
  const accountId = el.dataset.accountId;
  const acc = state.accounts.find((a) => a.accountId === accountId);
  if (!acc) return;
  const markBusy = () => {
    state.transient.busyAccounts.add(accountId);
    renderSidebar();
    if (accountId === state.selectedAccountId) renderDetail();
  };

  switch (info.menuItemId) {
    case MENU_IDS.sync:
      rpc("syncAccount", { accountId }).catch(showError);
      break;
    case MENU_IDS.toggle:
      markBusy();
      rpc("setAccountEnabled", { accountId, enabled: !acc.enabled }).catch(
        showError,
      );
      break;
    case MENU_IDS.delete:
      confirmAndDeleteAccount(accountId, markBusy);
      break;
  }
});

refreshState();
