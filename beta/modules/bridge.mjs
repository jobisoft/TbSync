/**
 * TbSync Bridge - beta builds only.
 *
 * Exposes TbSync's internal manager RPC table on a loopback HTTP socket, so
 * a script can drive TbSync from the shell instead of a human driving it
 * through the UI. The point is test automation: import a fixture, sync, read
 * the wire log back, assert, without a rebuild-install-paste cycle per step.
 *
 *     shell --HTTP--> native host --native messaging--> this --> RPC table
 *
 * ## Why this file is alone in `beta/`
 *
 * Everything the feature needs lives here, so the build can leave it out by
 * simply not copying it: `beta/` is applied to the beta xpi and to `dev/`,
 * never to the ATN xpi. Its whole footprint in `src/` is two dynamic imports
 * inside try/catch - one in background.mjs, one in manager/manager.mjs - which
 * throw harmlessly when the file is absent. Feature presence is file presence;
 * there is no flag to get wrong.
 *
 * That also means: do not import this from anywhere in `src/` statically, and
 * do not let anything in `src/` reference its exports by name.
 *
 * ## Why it is off by default
 *
 * `nativeMessaging` and `downloads` are added to the manifest by the same
 * overlay, so only a beta install carries them at all. Even there the port
 * stays closed until someone switches the bridge on in the Bridge tab: the
 * helper is a process this add-on spawns, and that should be a decision, not
 * a side effect of installing an update.
 *
 * ## Command table
 *
 * `COMMANDS` is the entire surface. It is both the allow-list and the scope
 * declaration, so those two cannot drift apart, and the Bridge tab renders
 * its keys - the panel documents whatever the table currently says.
 *
 * Account lifecycle (add / delete / edit / authenticate) is absent on
 * purpose: no test needs it, and a scripting mistake must not be able to
 * reach it.
 *
 * ## Scope
 *
 * The Bridge tab stores one account and one resource that the bridge may
 * touch. Every verb that changes something, or that reads calendar *data*
 * rather than TbSync's own configuration, is scoped to them and refuses
 * otherwise - including when nothing has been chosen at all, so the failure
 * mode of an unconfigured bridge is "no", not "anything".
 *
 * `getState` and `getFolders` stay unscoped: they are how a caller discovers
 * what the target could be, and they expose configuration rather than
 * mailbox content.
 */

// Only the background half uses these, but this file is loaded by the
// manager page too. Safe: nothing in that graph executes at import time, so
// the page pays a few module loads and nothing else. Keep it that way -
// a top-level side effect in any of them would start running in a context
// that has no business running it.
import * as ui from "./messaging-ui.mjs";
import * as eventLog from "./event-log.mjs";
import * as accounts from "./accounts.mjs";
import * as folders from "./folders.mjs";
import * as router from "./router.mjs";
import { syncAccount } from "./sync-coordinator.mjs";
import { HOST_CMD } from "../tbsync/protocol.mjs";

const NATIVE_APP = "tbsync_bridge_host";

/** The helper version this build expects, matching `VERSION` in
 *  tbsync_bridge_host.py. The helper is installed outside the xpi - it has to
 *  be, since Thunderbird launches it by path - so updating the add-on cannot
 *  update it, and the two can silently disagree. Raise this whenever the
 *  helper changes in a way that needs reinstalling; the tab then says so
 *  instead of leaving a bridge that looks installed and behaves oddly.
 *
 *  Adding commands never needs it: the helper forwards `cmd` as an opaque
 *  string and knows nothing about the vocabulary. */
const EXPECTED_HELPER_VERSION = 1;

const ENABLED_KEY = "tbsync-bridge-enabled";
const TARGET_KEY = "tbsync-bridge-target";

/** The whole surface. `scope` is what the command may touch:
 *
 *    undefined  unscoped - TbSync's own configuration, or a global knob
 *    "account"  args.accountId must be the target account
 *    "folder"   args.accountId and args.folderId must be the target's
 *    "calendar" the caller passes no calendar at all; the target's is
 *               supplied. A substitution rather than a check, so there is
 *               no argument left to get wrong.
 *
 * `run` is omitted for the commands that are just a manager RPC under
 * another name; those go through `ui.invokeRpc`.
 */
const COMMANDS = {
  getState: {},

  /** Which Thunderbird this actually is - name, version, buildID - straight
   *  from `runtime.getBrowserInfo()`.
   *
   *  Here because the alternative is guessing. Inspecting the process list
   *  finds whichever binary matches first, which on a machine with several
   *  installs is not necessarily the one running this profile; reading the
   *  wrong `omni.ja` then yields platform source that looks authoritative and
   *  is not. Unscoped: it says nothing about any account. */
  getBrowserInfo: {
    run: () => browser.runtime.getBrowserInfo(),
  },
  getFolders: {},
  setLogLevel: {},
  clearEventLog: {},

  /** Only what is new since `sinceSeq`. Entries carry a per-process
   *  monotonic seq, so "what did this sync produce" is exact instead of
   *  guessed from timestamps, and watching the wire is a tight loop rather
   *  than a repeated pull of the whole state. */
  getEventLog: {
    async run({ sinceSeq }) {
      const all = await eventLog.list();
      const from = Number.isFinite(sinceSeq) ? sinceSeq : -1;
      const entries = all.filter((e) => e.seq > from);
      return {
        entries,
        lastSeq: all.length ? all[all.length - 1].seq : from,
        dropped: all.length && from >= 0 && all[0].seq > from + 1,
      };
    },
  },

  /** Blocking, unlike the manager's RPC of the same name: the coordinator's
   *  `syncAccount` resolves when the sync is over, and the manager only
   *  declines to await it because the UI follows broadcasts instead. A
   *  caller here wants to know when it can look at the result.
   *
   *  It also returns early and silently for an account that is disabled,
   *  already syncing, holding E:AUTH, or whose provider is not connected,
   *  so the folder rows come back too - they are how you tell "synced
   *  cleanly" from "did nothing at all". */
  syncAccount: {
    scope: "account",
    async run({ accountId }) {
      const before = Date.now();
      await syncAccount(accountId);
      const rows = await folders.listForAccount(accountId);
      return {
        ranFor: Date.now() - before,
        folders: rows.map((f) => ({
          folderId: f.folderId,
          displayName: f.displayName,
          selected: f.selected,
          status: f.status,
          error: f.error,
          lastSyncTime: f.lastSyncTime,
        })),
      };
    },
  },

  setFolderSelected: { scope: "folder" },
  setAutoSyncInterval: { scope: "account" },

  /** Thunderbird's own console, which the event log never sees. A platform
   *  error - a TypeError inside a calendar module, an iCal parse complaint,
   *  a script that failed to load in a content process - is invisible to
   *  every other command here, and is routinely the only place the real
   *  cause of a failure is written down.
   *
   *  Same `sinceSeq` shape as getEventLog, and seeded from the platform's
   *  backlog on first use, so it also covers what happened before anyone
   *  thought to look. */
  getConsole: {
    run: ({ sinceSeq }) => browser.tbsyncConsole.getMessages({ sinceSeq }),
  },
  clearConsole: {
    run: () => browser.tbsyncConsole.clear(),
  },

  /** Reload TbSync itself, so a rebuilt `dev/` tree takes effect without a
   *  reinstall. Unscoped: it touches no account data, like setLogLevel.
   *
   *  Answers before reloading, and has to. The reload takes the native port
   *  with it, the helper dies with the port, and the HTTP response in flight
   *  dies with the helper - so a caller would see a timeout for a reload that
   *  worked. It should expect the endpoint to disappear and come back:
   *  `initBackground` reconnects on restart and spawns a fresh helper, so
   *  poll /health rather than assuming the next request lands. */
  reloadHost: {
    async run() {
      const { installType } = await browser.management.getSelf();
      if (installType !== "development") {
        throw withCode(
          new Error(
            `reload needs a temporarily installed add-on (TbSync is ` +
              `"${installType}") - a reload would restart the same code`,
          ),
          "E:NOT_TEMPORARY",
        );
      }
      setTimeout(() => browser.runtime.reload(), RELOAD_DELAY_MS);
      return { reloading: true, installType };
    },
  },

  /** Reload the provider that owns the target account. Scoped to it, so the
   *  bridge can reload the provider it was granted and no other - the caller
   *  never names one. The provider does the same check on its own side and
   *  refuses if it is permanently installed. */
  reloadProvider: {
    scope: "account",
    async run(_args, { accountId }) {
      const acc = await accounts.get(accountId);
      if (!acc) throw new Error("unknown account");
      if (!router.isProviderConnected(acc.provider)) {
        throw new Error(`provider ${acc.provider} is not connected`);
      }
      const result = await router.sendCmd(acc.provider, HOST_CMD.RELOAD, {});
      return { provider: acc.provider, ...result };
    },
  },

  /** Rename the target calendar. The provider watches for this and mirrors
   *  the new name into its folder row, so it is the only way to drive that
   *  path from a script. */
  "calendars.rename": {
    scope: "calendar",
    run: ({ name }, { calendarId }) =>
      messenger.calendar.calendars.update(calendarId, { name }),
  },
  /** Delete the target calendar, as the Remove button in the calendar list
   *  does. The folder row is left pointing at it; the provider is expected to
   *  notice and clear the binding. */
  "calendars.remove": {
    scope: "calendar",
    run: (_args, { calendarId }) =>
      messenger.calendar.calendars.remove(calendarId),
  },
  "items.query": {
    scope: "calendar",
    run: (args, { calendarId }) =>
      messenger.calendar.items.query({
        ...args,
        calendarId,
        returnFormat: "ical",
      }),
  },
  "items.get": {
    scope: "calendar",
    run: ({ id }, { calendarId }) =>
      messenger.calendar.items.get(calendarId, id, { returnFormat: "ical" }),
  },
  "items.create": {
    scope: "calendar",
    run: ({ ical, type = "event", id }, { calendarId }) =>
      messenger.calendar.items.create(calendarId, {
        ...(id ? { id } : {}),
        type,
        format: "ical",
        item: ical,
        returnFormat: "ical",
      }),
  },
  "items.update": {
    scope: "calendar",
    run: ({ id, ical }, { calendarId }) =>
      messenger.calendar.items.update(calendarId, id, {
        format: "ical",
        item: ical,
        returnFormat: "ical",
      }),
  },
  "items.remove": {
    scope: "calendar",
    run: ({ id }, { calendarId }) =>
      messenger.calendar.items.remove(calendarId, id),
  },
};

/** Long enough for the reply to reach the caller before the background page
 *  goes away with it. Matches the provider side. */
const RELOAD_DELAY_MS = 250;

/** How many recent commands the Bridge tab shows. */
const ACTIVITY_LIMIT = 50;

/** Helper files, shipped inside the xpi, saved into the user's download
 *  folder on request. Kept in one place because the tab lists them and the
 *  download loop walks them. */
const HELPER_DIR = "native-messaging-app";
/** Where they land, relative to the user's download folder. */
const DOWNLOAD_DIR = "tbsync-bridge-helper";
const HELPER_FILES = {
  common: ["tbsync_bridge_host.py", "tbsync_bridge_host.json"],
  win: ["install.bat", "uninstall.bat"],
  other: ["install.sh", "uninstall.sh"],
};

/* ── Background ─────────────────────────────────────────────────────────── */

let port = null;
/** Where the running helper is listening, as it reported at startup:
 *  `{url, token}`, or null whenever the port is down. */
let endpoint = null;
const activity = [];

/** Attach the bridge to the background runtime. Call once from
 *  background.mjs, after `ui.init()` - the RPC handlers registered here go
 *  into the same table the manager uses. */
export async function initBackground() {
  ui.setManagerRpcHandler("bridgeGetStatus", async () => ({
    connected: !!port,
    enabled: await isEnabled(),
    endpoint,
    activity: activity.slice(-ACTIVITY_LIMIT),
    target: await readTarget(),
    allowed: Object.keys(COMMANDS),
  }));

  ui.setManagerRpcHandler("bridgeSetEnabled", async ({ enabled }) => {
    await browser.storage.local.set({ [ENABLED_KEY]: !!enabled });
    if (enabled) await connect();
    else disconnect();
    return { connected: !!port };
  });

  ui.setManagerRpcHandler("bridgeSetTarget", async ({ target }) => {
    await browser.storage.local.set({ [TARGET_KEY]: target ?? {} });
    return await readTarget();
  });

  if (await isEnabled()) await connect();
}

async function isEnabled() {
  const rv = await browser.storage.local.get({ [ENABLED_KEY]: false });
  return !!rv[ENABLED_KEY];
}

/** The account and resource the bridge may touch, normalized so the tab can
 *  read every field without guarding. Identity only - the Thunderbird
 *  calendar the resource is bound to is looked up when it is needed, never
 *  stored: deselecting a folder destroys that calendar and reselecting makes
 *  a new one, so a stored id survives its object by minutes. */
async function readTarget() {
  const rv = await browser.storage.local.get({ [TARGET_KEY]: {} });
  const t = rv[TARGET_KEY] ?? {};
  return {
    accountId: t.accountId ?? "",
    accountName: t.accountName ?? "",
    folderId: t.folderId ?? "",
    folderName: t.folderName ?? "",
  };
}

async function connect() {
  if (port) return;
  try {
    port = browser.runtime.connectNative(NATIVE_APP);
  } catch (err) {
    port = null;
    note("error", `could not start the helper app: ${err?.message ?? err}`);
    return;
  }
  port.onMessage.addListener(onNativeMessage);
  port.onDisconnect.addListener((p) => {
    port = null;
    endpoint = null;
    // Deliberately no reconnect loop. If the helper is missing or crashing,
    // retrying just respawns a failing process forever; the tab shows the
    // state and the user decides.
    note("error", `helper app disconnected: ${p.error?.message ?? "closed"}`);
  });
  note("info", "helper app started");
}

function disconnect() {
  if (!port) return;
  try {
    port.disconnect();
  } catch (err) {
    console.debug("[tbsync] bridge: disconnect failed:", err);
  }
  port = null;
  endpoint = null;
  note("info", "helper app stopped");
}

/** One command from the helper: `{requestId, cmd, args}`. Always answers,
 *  including on rejection - the HTTP caller on the far end is holding a
 *  socket open until it hears back. */
async function onNativeMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  // The helper's opening message, carrying the address it settled on. No
  // requestId, which is what tells it apart from a command.
  if (msg.type === "hello") {
    if (msg.error) {
      // The helper started but could not listen - almost always the port
      // already being in use. It exits right after telling us.
      endpoint = null;
      note("error", msg.error);
      return;
    }
    // A helper predating the version field reports 0, which is exactly the
    // case worth catching: it is old enough not to know it should say.
    const version = msg.version ?? 0;
    endpoint = {
      url: `http://127.0.0.1:${msg.port}`,
      token: msg.token ?? "",
      version,
      stale: version !== EXPECTED_HELPER_VERSION,
    };
    if (endpoint.stale) {
      note(
        "error",
        `helper app is version ${version}, this build expects ` +
          `${EXPECTED_HELPER_VERSION} - download it again and re-run the ` +
          `install script`,
      );
    } else {
      note("info", `listening on ${endpoint.url}`);
    }
    return;
  }

  if (!msg.requestId) return;
  const { requestId, cmd, args } = msg;

  const command = COMMANDS[cmd];
  if (!command) {
    note("error", `${cmd} (refused: not in the command table)`);
    reply({
      requestId,
      ok: false,
      error: `command not allowed: ${cmd}`,
      errorCode: "E:NOT_ALLOWED",
    });
    return;
  }

  try {
    const scope = await applyScope(command.scope, args ?? {});
    const result = command.run
      ? await command.run(args ?? {}, scope)
      : await ui.invokeRpc(cmd, args ?? {});
    note("info", cmd);
    reply({ requestId, ok: true, result: result ?? null });
  } catch (err) {
    note("error", `${cmd}: ${err?.message ?? err}`);
    reply({
      requestId,
      ok: false,
      error: err?.message ?? String(err),
      errorCode: err?.code ?? null,
    });
  }
}

/** Hold a command to the account and resource chosen in the Bridge tab.
 *
 *  Throws for anything outside them, and for anything at all when no target
 *  has been chosen: an unconfigured bridge should refuse, not roam. Returns
 *  what the command needs from the target - which for calendar verbs is the
 *  calendarId they are given rather than allowed to name. */
async function applyScope(scope, args) {
  if (!scope) return {};
  const target = await readTarget();

  if (!target.accountId) {
    throw withCode(
      new Error(
        "no target selected - choose an account and a resource in the Bridge tab",
      ),
      "E:NO_TARGET",
    );
  }
  if (args.accountId && args.accountId !== target.accountId) {
    throw withCode(
      new Error(`account ${args.accountId} is not the bridge's target`),
      "E:OUT_OF_SCOPE",
    );
  }

  if (scope === "account") return { accountId: target.accountId };

  if (!target.folderId) {
    throw withCode(
      new Error("no resource selected in the Bridge tab"),
      "E:NO_TARGET",
    );
  }
  if (scope === "folder") {
    if (args.folderId && args.folderId !== target.folderId) {
      throw withCode(
        new Error(`resource ${args.folderId} is not the bridge's target`),
        "E:OUT_OF_SCOPE",
      );
    }
    return { accountId: target.accountId, folderId: target.folderId };
  }

  // "calendar". Read from the folder row every time rather than from the
  // stored target: `setFolderSelected(false)` deletes the Thunderbird
  // calendar and reselecting creates a fresh one, so any id we held would be
  // stale the moment a clean resync ran - and a clean resync is one of the
  // things this bridge exists to do.
  const row = await folders.get(target.accountId, target.folderId);
  if (!row?.targetID) {
    throw withCode(
      new Error(
        `resource "${target.folderName}" is not bound to a calendar yet - sync it once`,
      ),
      "E:NO_TARGET",
    );
  }
  return { calendarId: row.targetID };
}

function withCode(err, code) {
  err.code = code;
  return err;
}

function reply(message) {
  if (!port) return;
  try {
    port.postMessage(message);
  } catch (err) {
    console.debug("[tbsync] bridge: postMessage failed:", err);
  }
}

/** Rolling record of what the bridge has been asked to do, so the tab can
 *  show it. Not the event log: this is high-frequency, low-value traffic
 *  that would drown the log a bug report is built from. */
function note(level, text) {
  activity.push({ at: Date.now(), level, text });
  if (activity.length > ACTIVITY_LIMIT * 2) {
    activity.splice(0, activity.length - ACTIVITY_LIMIT);
  }
}

/* ── Manager tab ────────────────────────────────────────────────────────── */

/** Build the Bridge tab and wire it up.
 *
 *  `localizeSubtree` and `rpc` are passed in rather than imported: neither is
 *  exported from manager.mjs, and injected markup needs the localizer
 *  explicitly because the vendor pass only walks the document once at boot.
 */
export function initManagerTab({ localizeSubtree, rpc }) {
  const tabBar = document.querySelector(".tab-bar");
  const panels = document.querySelectorAll(".tab-panel");
  if (!tabBar || !panels.length) return;

  // Styles live here rather than in manager.css for the same reason the
  // markup does: nothing about this feature may exist in `src/`.
  document.head.append(el("style", {}, [PANEL_CSS]));

  const button = el("button", { class: "tab-button", type: "button" });
  button.dataset.tab = "bridge";
  button.append(
    el("img", { src: TAB_ICON, alt: "" }),
    i18n("span", "manager.tab.bridge"),
  );
  tabBar.append(button);

  const panel = buildPanel();
  panels[panels.length - 1].after(panel);

  localizeSubtree(panel);
  localizeSubtree(button);

  const $ = (id) => panel.querySelector(`#${id}`);
  const statusEl = $("bridge-status");
  const toggleEl = $("bridge-toggle");
  const endpointEl = $("bridge-endpoint");
  const hintEl = $("bridge-download-hint");
  const warningEl = $("bridge-target-warning");
  const staleEl = $("bridge-stale");
  const usageEl = $("bridge-usage");
  const exampleEl = $("bridge-example");
  const allowedEl = $("bridge-allowed");
  const activityEl = $("bridge-activity");

  // Needed to write the example in a shell the reader actually has. Resolved
  // once; nobody changes operating system mid-session.
  let platform = "linux";
  browser.runtime
    .getPlatformInfo()
    .then((info) => {
      platform = info.os;
    })
    .catch(() => {});
  const accountEl = $("bridge-target-account");
  const resourceEl = $("bridge-target-resource");

  // Rows behind the two selects, so a stored target can carry the display
  // names and the targetID alongside the ids without a second lookup.
  let accountRows = [];
  let resourceRows = [];

  let timer = null;
  // Mirrors what the last refresh saw, so the click handler does not have to
  // ask the background what it is toggling away from.
  let isOn = false;

  toggleEl.addEventListener("click", async () => {
    toggleEl.disabled = true;
    try {
      await rpc("bridgeSetEnabled", { enabled: !isOn });
    } finally {
      toggleEl.disabled = false;
      refresh();
    }
  });

  const messageEl = $("bridge-message");
  const downloadEl = $("bridge-download");

  const uninstallEl = $("bridge-uninstall");

  downloadEl.addEventListener("click", () => offer(downloadEl, downloadHelper));
  uninstallEl.addEventListener("click", () =>
    offer(uninstallEl, downloadUninstaller),
  );

  /** Run one of the save-a-file actions behind its button. Says nothing on
   *  success: the save dialog already showed the user where the file went,
   *  and a line repeating it back is one more thing to read and dismiss.
   *  Only a failure is worth interrupting for. */
  async function offer(buttonEl, action) {
    buttonEl.disabled = true;
    say("");
    try {
      await action();
    } catch (err) {
      const text = err?.message ?? String(err);
      console.warn("[tbsync] bridge: download failed:", err);
      say(
        browser.i18n.getMessage("manager.bridge.download.failed", [text]),
        true,
      );
    } finally {
      buttonEl.disabled = false;
    }
  }

  /** The manager page's console is not somewhere anyone thinks to look, so
   *  anything worth knowing about a click is said in the panel itself. */
  function say(text, isError = false) {
    messageEl.textContent = text;
    messageEl.classList.toggle("bridge-err", isError);
    messageEl.toggleAttribute("hidden", !text);
  }

  accountEl.addEventListener("change", async () => {
    await loadResources("");
    saveTarget();
  });
  resourceEl.addEventListener("change", () => saveTarget());

  /** Fill both selects from live state, preselecting whatever is stored.
   *  Called when the panel appears rather than on the status poll: the
   *  account and folder lists barely change, and rebuilding a `<select>`
   *  under someone who is using it is its own kind of rude. */
  async function loadTarget() {
    let status, state;
    try {
      [status, state] = await Promise.all([
        rpc("bridgeGetStatus"),
        rpc("getState"),
      ]);
    } catch {
      return;
    }
    accountRows = state.accounts ?? [];
    fill(
      accountEl,
      accountRows.map((a) => ({ value: a.accountId, label: a.accountName })),
      status.target.accountId,
    );
    await loadResources(status.target.folderId);
  }

  async function loadResources(preselect) {
    resourceRows = [];
    if (accountEl.value) {
      try {
        const rv = await rpc("getFolders", { accountId: accountEl.value });
        resourceRows = rv.folders ?? [];
      } catch (err) {
        console.warn("[tbsync] bridge: could not list resources:", err);
      }
    }
    fill(
      resourceEl,
      resourceRows.map((f) => ({
        value: f.folderId,
        label: f.displayName ?? f.folderId,
      })),
      preselect,
    );
  }

  /** Options plus a leading "no target" entry, with `selected` restored only
   *  when it is still one of the choices - an account or folder that has gone
   *  away must clear the scope rather than silently point at nothing. */
  function fill(select, options, selected) {
    select.replaceChildren(
      el("option", { value: "" }, [
        browser.i18n.getMessage("manager.bridge.target.none"),
      ]),
      ...options.map((o) => el("option", { value: o.value }, [o.label])),
    );
    select.value = options.some((o) => o.value === selected) ? selected : "";
  }

  function saveTarget() {
    const account = accountRows.find((a) => a.accountId === accountEl.value);
    const resource = resourceRows.find((f) => f.folderId === resourceEl.value);
    rpc("bridgeSetTarget", {
      target: {
        accountId: account?.accountId ?? "",
        accountName: account?.accountName ?? "",
        folderId: resource?.folderId ?? "",
        folderName: resource?.displayName ?? "",
      },
    }).catch((err) =>
      console.warn("[tbsync] bridge: could not store the target:", err),
    );
  }

  async function refresh() {
    let status;
    try {
      status = await rpc("bridgeGetStatus");
    } catch {
      // Background not ready, or an ATN-shaped build somehow reaching here.
      return;
    }
    statusEl.textContent = browser.i18n.getMessage(
      status.connected
        ? "manager.bridge.status.on"
        : "manager.bridge.status.off",
    );
    statusEl.classList.toggle("bridge-on", status.connected);
    isOn = status.connected || status.enabled;
    toggleEl.textContent = browser.i18n.getMessage(
      isOn ? "manager.bridge.disable" : "manager.bridge.enable",
    );
    // One download offer at a time, whichever the state calls for: how to
    // get the helper while none is running, how to be rid of it once one
    // is. The install instructions belong to the first and go with it.
    // Three states, and each shows exactly one download button:
    //
    //   stopped   "get the helper" + how to install it
    //   stale     "get the helper" + why (the stale notice). No install hint:
    //             a stale helper is running, so telling the user the bridge
    //             "needs a small helper app" contradicts the panel above it.
    //             No uninstaller either - removing it is not the fix.
    //   running   "get the uninstaller", nothing else
    const stale = !!status.endpoint?.stale;
    hintEl.toggleAttribute("hidden", status.connected);
    downloadEl.toggleAttribute("hidden", status.connected && !stale);
    uninstallEl.toggleAttribute("hidden", !status.connected || stale);
    staleEl.toggleAttribute("hidden", !stale);

    // The address the helper reported when it started, which is the only
    // way this side could know it - the port is ephemeral. Hidden rather
    // than emptied while the bridge is down, so nothing stray is left behind.
    endpointEl.textContent = status.endpoint
      ? browser.i18n.getMessage("manager.bridge.endpoint", [
          status.endpoint.url,
        ])
      : "";
    endpointEl.toggleAttribute("hidden", !status.endpoint);

    // Something to paste, with this bridge's own port and token path in it.
    // The whole point of the feature is that it is driven from a shell, and
    // a reader who has to assemble the first call from prose will assemble
    // it wrong.
    usageEl.toggleAttribute("hidden", !status.endpoint);
    // Scoped commands refuse without a target, so an unset one is worth
    // pointing at while the bridge is up rather than leaving the first
    // refusal to explain it.
    warningEl.toggleAttribute(
      "hidden",
      !status.connected || !!status.target.folderId,
    );
    if (status.endpoint) {
      exampleEl.textContent = exampleFor(platform, status.endpoint);
      allowedEl.textContent = browser.i18n.getMessage(
        "manager.bridge.allowed",
        [status.allowed.join(", ")],
      );
    }

    activityEl.replaceChildren();
    if (!status.activity.length) {
      activityEl.append(
        el("li", { class: "bridge-empty" }, [
          browser.i18n.getMessage("manager.bridge.activity.empty"),
        ]),
      );
    } else {
      for (const entry of [...status.activity].reverse()) {
        const time = new Date(entry.at).toLocaleTimeString();
        activityEl.append(
          el("li", { class: entry.level === "error" ? "bridge-err" : "" }, [
            `${time}  ${entry.text}`,
          ]),
        );
      }
    }
  }

  // Poll only while the panel is on screen: the activity list is the one
  // thing here that changes on its own, and nobody is watching it from
  // another tab.
  const observer = new MutationObserver(() => {
    const visible = !panel.hasAttribute("hidden");
    if (visible && !timer) {
      loadTarget();
      refresh();
      timer = setInterval(refresh, 2000);
    } else if (!visible && timer) {
      clearInterval(timer);
      timer = null;
    }
  });
  observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] });

  refresh();
}

/** Offer the helper app as a single zip through a save dialog, so the user
 *  picks where it lands and the install script arrives with the siblings it
 *  expects beside it. The uninstaller is in there too - it is needed most
 *  when this add-on is being removed, which is exactly when it would no
 *  longer be downloadable. */
async function downloadHelper() {
  const { os } = await browser.runtime.getPlatformInfo();
  const names = [
    ...HELPER_FILES.common,
    ...(os === "win" ? HELPER_FILES.win : HELPER_FILES.other),
  ];
  const entries = [];
  for (const name of names) {
    entries.push({ name, data: new Uint8Array(await packaged(name)) });
  }
  const suffix = os === "win" ? "windows" : os === "mac" ? "mac" : "linux";
  return await save(buildZip(entries), `${DOWNLOAD_DIR}-${suffix}.zip`);
}

/** The uninstall script on its own, for someone who kept no copy of the
 *  bundle and now wants the helper off their machine. */
async function downloadUninstaller() {
  const { os } = await browser.runtime.getPlatformInfo();
  const name = os === "win" ? "uninstall.bat" : "uninstall.sh";
  return await save(new Blob([await packaged(name)]), name);
}

/** Read one of the helper files out of the xpi. */
async function packaged(name) {
  const path = `${HELPER_DIR}/${name}`;
  const resp = await fetch(browser.runtime.getURL(path));
  if (!resp.ok) throw new Error(`${path}: ${resp.status}`);
  return await resp.arrayBuffer();
}

/** Put `blob` through a save dialog.
 *
 *  Returns the file name written, null if the dialog was dismissed, and
 *  throws with something worth reading if it failed: this runs in the
 *  manager page, whose console is not where anyone thinks to look. */
async function save(blob, filename) {
  if (!browser.downloads) {
    throw new Error(
      "the downloads permission is missing - this build predates it, rebuild the beta xpi",
    );
  }
  const url = URL.createObjectURL(blob);
  let id;
  try {
    id = await browser.downloads.download({ url, filename, saveAs: true });
  } catch (err) {
    URL.revokeObjectURL(url);
    // Dismissing the save dialog rejects; that is a choice, not a fault.
    if (/cancel/i.test(err?.message ?? "")) return null;
    throw new Error(err?.message ?? String(err));
  }
  // `download()` resolves once the transfer has *started*. Revoking here
  // would pull the blob out from under it, so wait for the download to
  // settle - and surface an interrupted one, which is otherwise the
  // quietest failure of the lot.
  const state = await settled(id);
  URL.revokeObjectURL(url);
  if (state !== "complete") throw new Error(`download ${state}`);
  return filename;
}

/* ── ZIP builder ─────────────────────────────────────────────────────────
 *
 * Stored (uncompressed) entries only: this packs four small text files,
 * and a deflate implementation would be larger than what it compresses.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (const b of data) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** @param {Array<{name: string, data: Uint8Array}>} entries */
function buildZip(entries) {
  const enc = new TextEncoder();
  const u16 = (v, dv, o) => dv.setUint16(o, v, true);
  const u32 = (v, dv, o) => dv.setUint32(o, v, true);

  const localParts = [];
  const centralParts = [];
  let dataOffset = 0;

  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    u32(0x04034b50, lv, 0); // signature
    u16(20, lv, 4); // version needed
    u16(0, lv, 8); // compression: STORE
    u32(crc, lv, 14);
    u32(data.length, lv, 18); // compressed size
    u32(data.length, lv, 22); // uncompressed size
    u16(nameBytes.length, lv, 26);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    u32(0x02014b50, cv, 0); // signature
    u16(20, cv, 4); // version made by
    u16(20, cv, 6); // version needed
    u16(0, cv, 10); // compression: STORE
    u32(crc, cv, 16);
    u32(data.length, cv, 20);
    u32(data.length, cv, 24);
    u16(nameBytes.length, cv, 28);
    u32(dataOffset, cv, 42); // local header offset
    cd.set(nameBytes, 46);
    centralParts.push(cd);

    dataOffset += local.length + data.length;
  }

  const cdSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  u32(0x06054b50, ev, 0); // signature
  u16(entries.length, ev, 8); // entries on this disk
  u16(entries.length, ev, 10); // total entries
  u32(cdSize, ev, 12);
  u32(dataOffset, ev, 16); // central directory offset

  return new Blob([...localParts, ...centralParts, eocd], {
    type: "application/zip",
  });
}

/** Resolve once download `id` is no longer in progress. */
function settled(id) {
  return new Promise((resolve) => {
    const done = (state) => {
      browser.downloads.onChanged.removeListener(onChanged);
      resolve(state);
    };
    function onChanged(delta) {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current !== "in_progress") done(delta.state.current);
    }
    browser.downloads.onChanged.addListener(onChanged);
    // Already finished before the listener attached - four small files from
    // a blob is fast enough that this is the common case, not the edge one.
    browser.downloads
      .search({ id })
      .then(([item]) => {
        if (item && item.state !== "in_progress") done(item.state);
      })
      .catch(() => done("interrupted"));
  });
}

/* ── Small DOM helpers ──────────────────────────────────────────────────── */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

/** A copy-and-run first call, in a shell the reader is likely to have.
 *
 *  `/health` is deliberately first. The helper answers it alone, so it
 *  separates "the bridge is up" from "TbSync answered" - and it is the
 *  nearest thing to a hello anyone can send by hand, the real one being the
 *  helper's own announcement to the add-on at startup. */
function exampleFor(os, { url, token }) {
  const auth = `Authorization: Bearer ${token}`;
  if (os === "win") {
    return [
      `$h = @{ Authorization = "Bearer ${token}" }`,
      `Invoke-RestMethod ${url}/health -Headers $h`,
      `Invoke-RestMethod ${url}/rpc -Method Post -Headers $h \``,
      `  -ContentType 'application/json' -Body '{"cmd":"getState"}'`,
    ].join("\n");
  }
  return [
    `curl -H "${auth}" ${url}/health`,
    `curl -H "${auth}" -d '{"cmd":"getState"}' ${url}/rpc`,
  ].join("\n");
}

/** An element whose text `localizeSubtree` fills in from `key`. */
function i18n(tag, key, attrs = {}) {
  return el(tag, { ...attrs, "data-i18n-content": key });
}

/** Tab icon: a terminal window with a prompt, in the flat black-on-accent
 *  idiom of the existing tab icons (see src/icons/tab-eventlog.svg). What
 *  the feature does is let a shell drive TbSync, so a console says it more
 *  directly than anything pictorial. Inline rather than a file in
 *  src/icons, because nothing about this feature may live in `src/`, and an
 *  <img> picks up the 32x32 sizing the tab bar already applies. */
const TAB_ICON =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
       <rect x="3" y="6" width="26" height="20" rx="2.5"
             fill="none" stroke="#000" stroke-width="2"/>
       <path d="M3 12 H29" stroke="#000" stroke-width="2"/>
       <circle cx="6.8" cy="9" r="1.1" fill="#4A90D9"/>
       <circle cx="10.4" cy="9" r="1.1" fill="#4A90D9"/>
       <path d="M8.5 16.5 L12.5 19.5 L8.5 22.5" fill="none" stroke="#4A90D9"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
       <path d="M15.5 22.5 H23.5" stroke="#000" stroke-width="2"
             stroke-linecap="round"/>
     </svg>`,
  );

/** Built node by node rather than from a markup string: assigning innerHTML
 *  is a review finding even when the string is a constant, and this is not
 *  enough markup to be worth arguing about. */
function buildPanel() {
  const panel = el("div", { class: "tab-panel", hidden: "" });
  panel.dataset.panel = "bridge";
  panel.append(
    i18n("p", "manager.bridge.intro"),
    el("div", { class: "bridge-row" }, [
      el("strong", { id: "bridge-status" }),
      el("button", { id: "bridge-toggle", type: "button" }),
      i18n("button", "manager.bridge.download", {
        id: "bridge-download",
        class: "btn-ghost",
        type: "button",
      }),
      i18n("button", "manager.bridge.uninstall", {
        id: "bridge-uninstall",
        class: "btn-ghost",
        type: "button",
        hidden: "",
      }),
    ]),
    i18n("p", "manager.bridge.downloadHint", {
      id: "bridge-download-hint",
      class: "bridge-hint",
    }),
    el("p", { id: "bridge-message", class: "bridge-hint", hidden: "" }),
    i18n("p", "manager.bridge.stale", {
      id: "bridge-stale",
      class: "bridge-hint bridge-err",
      hidden: "",
    }),
    el("p", { id: "bridge-endpoint", class: "bridge-hint", hidden: "" }),
    el("div", { id: "bridge-usage", hidden: "" }, [
      i18n("p", "manager.bridge.example", { class: "bridge-hint" }),
      el("pre", { id: "bridge-example", class: "bridge-example" }),
      el("p", { id: "bridge-allowed", class: "bridge-hint" }),
    ]),
    el("fieldset", { class: "bridge-target" }, [
      i18n("legend", "manager.bridge.target"),
      i18n("p", "manager.bridge.target.none.hint", {
        id: "bridge-target-warning",
        class: "bridge-hint bridge-err",
        hidden: "",
      }),
      el("label", {}, [
        i18n("span", "manager.bridge.target.account"),
        el("select", { id: "bridge-target-account" }),
      ]),
      el("label", {}, [
        i18n("span", "manager.bridge.target.resource"),
        el("select", { id: "bridge-target-resource" }),
      ]),
    ]),
    i18n("h3", "manager.bridge.activity"),
    el("ul", { id: "bridge-activity", class: "bridge-activity" }),
  );
  return panel;
}

const PANEL_CSS = `
  .bridge-row { display: flex; align-items: center; gap: .75em; margin: 1em 0 .5em; }
  .bridge-row #bridge-status { min-width: 12em; }
  .bridge-row #bridge-status.bridge-on { color: #157a3a; }
  .bridge-hint { margin: .25em 0; opacity: .8; font-size: .9em; }
  .bridge-target { margin: 1.5em 0; padding: .5em 1em 1em; }
  .bridge-target label { display: flex; align-items: center; gap: .5em; margin-top: .5em; }
  .bridge-target label span { min-width: 12em; }
  .bridge-target input { flex: 1; }
  .bridge-activity { max-height: 20em; overflow-y: auto; margin: 0; padding: 0; list-style: none;
                     font-family: monospace; font-size: .85em; }
  .bridge-activity li { padding: .15em 0; border-bottom: 1px solid rgba(128,128,128,.2); }
  .bridge-activity li.bridge-err { color: #b3261e; }
  .bridge-activity li.bridge-empty { opacity: .7; font-family: inherit; }
  .bridge-example { margin: .25em 0 .75em; padding: .6em .8em; overflow-x: auto;
                    font-family: monospace; font-size: .85em; white-space: pre;
                    user-select: text; border-radius: 4px;
                    background: rgba(128,128,128,.12); }
`;
