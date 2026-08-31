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
 * simply not copying it: `beta/` is applied to the beta xpi and never to
 * the ATN xpi. Its whole footprint in `src/` is two dynamic imports
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
 * The Bridge tab stores one account, and one resource per kind - contacts,
 * events, tasks. One grant each rather than one grant total, because a verb
 * needs a resource of the right kind, and a single grant meant re-picking it
 * in the UI between a contacts test and a calendar one. Every verb that
 * changes something, or that reads a resource's *data* rather than TbSync's
 * own configuration, is scoped to them and refuses otherwise - including when
 * nothing has been chosen at all, so the failure mode of an unconfigured
 * bridge is "no", not "anything".
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
import { syncAccount, maintainAccount } from "./sync-coordinator.mjs";
import { HOST_CMD } from "../vendor/tbsync/protocol.mjs";
import { buildZip } from "./zip.mjs";

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
const EXPECTED_HELPER_VERSION = 2;

const ENABLED_KEY = "tbsync-bridge-enabled";
const TARGET_KEY = "tbsync-bridge-target";
/** Opt-in for the `setTarget` verb: scripts may re-point the grant to any
 *  account and resource. Toggled only from the Bridge tab - a mode the
 *  bridge could switch on for itself would make the scope system
 *  decorative - and protected from the storage verbs like the other two
 *  bridge keys, for the same reason. */
const UNRESTRICTED_KEY = "tbsync-bridge-unrestricted";

/** The whole surface. `scope` is what the command may touch:
 *
 *    undefined  unscoped - TbSync's own configuration, or a global knob
 *    "account"  args.accountId must be the target account
 *    "folder"   args.accountId and args.folderId must be the target's
 *    "calendar" the caller passes no calendar at all; the target's is
 *               supplied. A substitution rather than a check, so there is
 *               no argument left to get wrong. `args.resource` picks the
 *               events grant (default) or the tasks one - which of *our*
 *               grants to use, never an arbitrary resource.
 *    "book"     the same, for the address book behind a contacts folder.
 *
 * The last two also require the granted folder to still be of that kind, so
 * asking for a card in a calendar is refused here rather than by the platform
 * complaining about an id the caller never chose.
 *
 * `run` is omitted for the commands that are just a manager RPC under
 * another name; those go through `ui.invokeRpc`.
 */
const COMMANDS = {
  getState: {
    summary: "Accounts, providers, settings and the event log - everything the manager renders.",
    args: "{}",
  },

  /** Which Thunderbird this actually is - name, version, buildID - straight
   *  from `runtime.getBrowserInfo()`.
   *
   *  Here because the alternative is guessing. Inspecting the process list
   *  finds whichever binary matches first, which on a machine with several
   *  installs is not necessarily the one running this profile; reading the
   *  wrong `omni.ja` then yields platform source that looks authoritative and
   *  is not. Unscoped: it says nothing about any account. */
  getBrowserInfo: {
    summary: "Which Thunderbird this is: name, version, buildID.",
    args: "{}",
    run: () => browser.runtime.getBrowserInfo(),
  },
  getFolders: {
    summary: "The folder rows of one account, as stored.",
    args: "{ accountId }",
  },
  setLogLevel: {
    summary: "Set the event log's capture threshold. 0 errors ... 3 debug.",
    args: "{ level }",
  },
  clearEventLog: {
    summary: "Empty the event log.",
    args: "{}",
  },

  /** What is still queued for a folder.
   *
   *  Only the provider can answer: it owns every queue and keeps them in
   *  its own storage, so the folder row's `changelog` is empty except as an
   *  import inbox. Reading the row would report "nothing pending" for a
   *  folder holding a dozen unpushed edits.
   *
   *  Asking the provider fails loudly when the provider cannot answer. A
   *  suite asserting "the queue drained" must never be handed an empty
   *  list by a provider that was not there: that turns the single most
   *  common breakage into a pass. */
  getChangelog: {
    summary: "What a provider still has queued for a folder. Read-only.",
    args: "{ accountId, folderId }",
    scope: "folder",
    async run({ folderId }, { accountId }) {
      const row = await folders.get(accountId, folderId);
      if (!row) throw new Error(`unknown folder ${folderId}`);
      const acc = await accounts.get(accountId);
      if (!acc) throw new Error("unknown account");
      if (!router.isProviderConnected(acc.provider)) {
        throw new Error(`provider ${acc.provider} is not connected`);
      }
      const entries = await router.sendCmd(
        acc.provider,
        HOST_CMD.GET_CHANGELOG,
        { accountId, folderId },
      );
      if (entries == null) {
        throw new Error(
          `provider ${acc.provider} owns the changes of ${folderId} ` +
            `but keeps no queue for it`,
        );
      }
      return { owner: acc.provider, entries };
    },
  },

  /** Only what is new since `sinceSeq`. Entries carry a per-process
   *  monotonic seq, so "what did this sync produce" is exact instead of
   *  guessed from timestamps, and watching the wire is a tight loop rather
   *  than a repeated pull of the whole state. */
  getEventLog: {
    summary: "Event-log entries, oldest first; `sinceSeq` reads only what is new.",
    args: "{ sinceSeq? }",
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
  /** Offer the account its housekeeping slot now, instead of waiting for
   *  the hourly tick.
   *
   *  The same call the tick makes, so it exercises the real path rather
   *  than a private one - including stepping aside for an account that is
   *  syncing, which is what `asked: false` reports.
   *
   *  Deliberately no way to force the work. What is due is the provider's
   *  policy and the host neither knows nor asks; a `force` here would put
   *  that policy back in the host. A caller that wants the work to actually
   *  happen clears whatever the provider stamps to record its last run -
   *  `custom` is writable through `storage.restore` - and then calls this. */
  maintainAccount: {
    summary: "Offer an account its maintenance slot now, and wait for it.",
    args: "{ accountId }",
    scope: "account",
    async run(_args, { accountId }) {
      const asked = await maintainAccount(accountId);
      return { accountId, asked };
    },
  },

  syncAccount: {
    summary: "Sync one account and resolve when it has finished.",
    args: "{ accountId }",
    scope: "account",
    // The account comes from the resolved scope, not from args: the grant is
    // what a caller relies on when it omits accountId, and reading args here
    // meant syncing `undefined` - which resolves immediately, reports no
    // folders and looks like a sync that found nothing to do. An explicit
    // accountId still works; the scope check has already refused it unless it
    // is the granted one.
    async run(_args, { accountId }) {
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

  setFolderSelected: {
    summary: "Enable or disable one folder. Disabling deletes its local resource.",
    args: "{ accountId, folderId, selected }",
    scope: "folder",
  },
  setAutoSyncInterval: {
    summary: "Set an account's autosync interval in minutes. 0 disables it.",
    args: "{ accountId, minutes }",
    scope: "account",
  },

  /** Connect or disconnect the granted account.
   *
   *  Disconnecting is the recovery path the manager's button drives: it
   *  aborts a running sync, settles whatever the provider still owes, and
   *  tears down the local resources. Scriptable because that path is worth
   *  testing - in particular that the account can be connected again
   *  afterwards, which is what says the sync lock is really gone. */
  setAccountEnabled: {
    summary: "Connect or disconnect an account. Disconnecting deletes its resources.",
    args: "{ accountId, enabled }",
    scope: "account",
  },

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
    summary: "Browser-console messages captured for this profile.",
    args: "{ sinceSeq? }",
    run: ({ sinceSeq }) => browser.tbsyncConsole.getMessages({ sinceSeq }),
  },
  clearConsole: {
    summary: "Drop the captured console messages.",
    args: "{}",
    run: () => browser.tbsyncConsole.clear(),
  },

  /** Reload TbSync itself, so a rebuilt xpi takes effect without a
   *  reinstall. Unscoped: it touches no account data, like setLogLevel.
   *
   *  Answers before reloading, and has to. The reload takes the native port
   *  with it, the helper dies with the port, and the HTTP response in flight
   *  dies with the helper - so a caller would see a timeout for a reload that
   *  worked. It should expect the endpoint to disappear and come back:
   *  `initBackground` reconnects on restart and spawns a fresh helper, so
   *  poll /health rather than assuming the next request lands. */
  reloadHost: {
    summary: "Reload TbSync itself. Needs a temporarily installed add-on.",
    args: "{}",
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
      setTimeout(() => {
        // Close the native link cleanly before reloading. Both observed
        // reload stalls were spawns issued into conduits the reload had
        // torn ("sendRemoveListener on closed conduit" in the console); an
        // orderly disconnect first is the best shot at the fresh instance
        // starting from a clean slate. The enabled flag survives in
        // storage, so the fresh instance reconnects on its own.
        teardownLink();
        browser.runtime.reload();
      }, RELOAD_DELAY_MS);
      return { reloading: true, installType };
    },
  },

  /* ── Storage ──────────────────────────────────────────────────────────
   *
   * The add-on's whole persistent state, so a test can put the profile into
   * a chosen starting condition and put it back afterwards. What this is
   * for: a fresh-install state. The legacy importer only runs when
   * `tbsync.accounts` is absent, so there is no way to exercise migration -
   * or any first-run path - without emptying storage first.
   *
   * These are the most destructive verbs here by a wide margin: clearing
   * takes every account with it, including the credentials and OAuth
   * refresh token needed to reach the server again. That is why `clear`
   * hands back what it removed and `restore` puts it back verbatim - the
   * damage is meant to be undoable from a file on disk, not from memory.
   * A test should snapshot to disk *before* clearing and restore in a
   * `finally`.
   *
   * They are scopeless because storage is not per-account and a partial
   * wipe would be a worse thing to offer: it would leave a half-state no
   * real installation can be in, which is the opposite of what these are
   * for. Beta-only, like everything in this file.
   */
  /** What a previous version's changelog says is owed, and the card
   *  properties the contacts API does not return.
   *
   *  Both exist because the rescue reads two things a test cannot see any
   *  other way: a file outside the add-on, and a per-card property the
   *  WebExtension API hides. Every silent bug in this area so far was found
   *  by looking at these rather than by reasoning about them - a card
   *  reported as gone when it was merely keyed differently, and a rescue
   *  that cleared itself after placing nothing.
   *
   *  Read-only, and unscoped like the storage commands: neither touches an
   *  account. */
  "legacy.changelog": {
    summary: "The previous version's changelog file, verbatim.",
    args: "{}",
    async run() {
      const path = "TbSync/changelog68.json";
      if (!(await browser.ProfileFiles.exists(path))) return null;
      return browser.ProfileFiles.readJSON(path);
    },
  },
  "legacy.cardProps": {
    summary: "Every property of every card in an address book.",
    args: "{ bookUid }",
    run: ({ bookUid }) => browser.LegacyData.readCardProperties(bookUid),
  },

  "storage.snapshot": {
    summary: "The add-on's whole extension storage, verbatim.",
    args: "{}",
    run: () => browser.storage.local.get(null),
  },
  "storage.clear": {
    summary: "Erase the add-on's storage, keeping the bridge's own keys. Returns what it removed - snapshot to a file first.",
    args: "{}",
    async run() {
      const all = await browser.storage.local.get(null);
      // Everything except the bridge's own two keys. Wiping those would
      // switch the bridge off and forget its target, so the next reload
      // would come back with the port closed - and the caller, mid-test,
      // would have no way left to restore what it just removed. The
      // importer's gate is `tbsync.accounts`, which these are not, so
      // keeping them does not affect what is being tested.
      const keep = new Set([ENABLED_KEY, TARGET_KEY, UNRESTRICTED_KEY]);
      const removed = {};
      for (const [k, v] of Object.entries(all)) {
        if (!keep.has(k)) removed[k] = v;
      }
      await browser.storage.local.remove(Object.keys(removed));
      return { removed, kept: [...keep].filter((k) => k in all) };
    },
  },
  /** Re-point the grant to another account, its first folder of every
   *  kind - or an exact target via `exact`. Refused unless the user has
   *  switched the Bridge tab's unrestricted mode on: by default the grant
   *  is the user's choice and scripts stay inside it. With the mode on, a
   *  test run can move between accounts without a human in the loop -
   *  which is the whole point, and why the mode is opt-in and loud. */
  setTarget: {
    summary: "Re-point the bridge's grant. Needs unrestricted mode (Bridge tab).",
    args: "{ accountId } | { exact }",
    async run({ accountId, exact }) {
      const rv = await browser.storage.local.get({
        [UNRESTRICTED_KEY]: false,
      });
      if (!rv[UNRESTRICTED_KEY]) {
        throw withCode(
          new Error(
            "setTarget requires unrestricted mode - switch it on in " +
              "TbSync's Bridge tab. `status` reports whether it is on.",
          ),
          "E:RESTRICTED",
        );
      }
      if (exact && typeof exact === "object") {
        await browser.storage.local.set({ [TARGET_KEY]: exact });
        note("info", `target set (exact) for account ${exact.accountId}`);
        return exact;
      }
      const acc = await accounts.get(accountId);
      if (!acc) throw new Error("unknown account");
      const rows = await folders.listForAccount(accountId);
      const resources = {};
      for (const kind of RESOURCE_KINDS) {
        const row = rows.find((f) => f.targetType === kind);
        resources[kind] = {
          folderId: row?.folderId ?? "",
          folderName: row?.displayName ?? "",
        };
      }
      const target = { accountId, accountName: acc.accountName, resources };
      await browser.storage.local.set({ [TARGET_KEY]: target });
      note("info", `target set to account ${accountId} (${acc.accountName})`);
      return target;
    },
  },

  "storage.restore": {
    summary: "Write a snapshot back. The bridge's own keys are never restored.",
    args: "{ data }",
    async run({ data }) {
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("storage.restore needs a `data` object");
      }
      // The bridge's own keys are never written back. A snapshot contains
      // them, and restoring one verbatim would let a script hand itself a
      // different target - which is the whole scope system, undone by a
      // verb that looks like housekeeping. They are also the two keys
      // `clear` refuses to remove, so nothing needs them restored.
      const skipped = [];
      const write = {};
      for (const [k, v] of Object.entries(data)) {
        if (k === ENABLED_KEY || k === TARGET_KEY || k === UNRESTRICTED_KEY)
          skipped.push(k);
        else write[k] = v;
      }
      await browser.storage.local.set(write);
      return { keys: Object.keys(write), skipped };
    },
  },

  /** Reload the provider that owns the target account. Scoped to it, so the
   *  bridge can reload the provider it was granted and no other - the caller
   *  never names one. The provider does the same check on its own side and
   *  refuses if it is permanently installed. */
  /** Wipe the target account's provider's own storage - test-only, for
   *  migration tests that need the provider in its never-ran state.
   *  Destructive, so it demands unrestricted mode like setTarget; the
   *  provider hands back what it removed, and that object is returned so
   *  the caller can save it to disk before going on. */
  "providerStorage.clear": {
    summary: "Erase the owning provider's storage for the target account.",
    args: "{ accountId }",
    scope: "account",
    async run(_args, { accountId }) {
      const rv = await browser.storage.local.get({
        [UNRESTRICTED_KEY]: false,
      });
      if (!rv[UNRESTRICTED_KEY]) {
        throw withCode(
          new Error(
            "providerStorage.clear requires unrestricted mode - switch it on in " +
              "TbSync's Bridge tab. `status` reports whether it is on.",
          ),
          "E:RESTRICTED",
        );
      }
      const acc = await accounts.get(accountId);
      if (!acc) throw new Error("unknown account");
      if (!router.isProviderConnected(acc.provider)) {
        throw new Error(`provider ${acc.provider} is not connected`);
      }
      const result = await router.sendCmd(
        acc.provider,
        "test.clearStorage",
        {},
      );
      return { provider: acc.provider, ...result };
    },
  },

  /** Companion writer to providerStorage.clear - same guard, relays
   *  test.setStorage with the given data object. */
  "providerStorage.set": {
    summary: "Write keys into the owning provider's storage.",
    args: "{ accountId, data }",
    scope: "account",
    async run({ data }, { accountId }) {
      const rv = await browser.storage.local.get({
        [UNRESTRICTED_KEY]: false,
      });
      if (!rv[UNRESTRICTED_KEY]) {
        throw withCode(
          new Error(
            "providerStorage.set requires unrestricted mode - switch it on in " +
              "TbSync's Bridge tab. `status` reports whether it is on.",
          ),
          "E:RESTRICTED",
        );
      }
      const acc = await accounts.get(accountId);
      if (!acc) throw new Error("unknown account");
      if (!router.isProviderConnected(acc.provider)) {
        throw new Error(`provider ${acc.provider} is not connected`);
      }
      const result = await router.sendCmd(acc.provider, "test.setStorage", {
        data,
      });
      return { provider: acc.provider, ...result };
    },
  },

  /** Unscoped, like `reloadHost`: restarting an add-on reads and writes no
   *  mailbox content, and the grant exists to protect content. Holding it to
   *  the target would also make the verb useless for its main job - picking
   *  up a rebuilt provider that the grant does not happen to point at.
   *
   *  Takes a providerId; accountId is accepted as a convenience and means
   *  "whichever provider owns this account", which is what the account
   *  scoped version used to do. */
  reloadProvider: {
    summary: "Reload a provider add-on. Any of them, not only the target's.",
    args: "{ providerId } or { accountId }",
    async run({ providerId, accountId }) {
      let id = providerId;
      if (!id) {
        if (!accountId) {
          throw withCode(
            new Error("reloadProvider needs a providerId or an accountId"),
            "E:BAD_ARGS",
          );
        }
        const acc = await accounts.get(accountId);
        if (!acc) throw new Error("unknown account");
        id = acc.provider;
      }
      if (!router.isProviderConnected(id)) {
        throw new Error(`provider ${id} is not connected`);
      }
      const result = await router.sendCmd(id, HOST_CMD.RELOAD, {});
      return { provider: id, ...result };
    },
  },

  /** Refresh the target calendar, as the Reload button in the calendar list
   *  does.
   *
   *  For a provider-backed calendar this is the only way to reach
   *  `calendar.provider.onSync` from a script: it runs
   *  `calCachedCalendar.refresh()`, the same entry point the button and the
   *  platform's own refresh timer use. */
  "calendars.synchronize": {
    summary: "Refresh the target calendar, as the Reload button does.",
    args: "{ resource? }",
    scope: "calendar",
    run: (_args, { calendarId }) =>
      messenger.calendar.calendars.synchronize([calendarId]),
  },
  /** Rename the target calendar. The provider watches for this and mirrors
   *  the new name into its folder row, so it is the only way to drive that
   *  path from a script. */
  "calendars.rename": {
    summary: "Rename the target calendar.",
    args: "{ name, resource? }",
    scope: "calendar",
    run: ({ name }, { calendarId }) =>
      messenger.calendar.calendars.update(calendarId, { name }),
  },
  /** Delete the target calendar, as the Remove button in the calendar list
   *  does. The folder row is left pointing at it; the provider is expected to
   *  notice and clear the binding. */
  "calendars.remove": {
    summary: "Delete the target calendar. The folder row is left pointing at it.",
    args: "{ resource? }",
    scope: "calendar",
    run: (_args, { calendarId }) =>
      messenger.calendar.calendars.remove(calendarId),
  },
  /** The target calendar as the platform sees it - name, colour, readOnly and
   *  the rest of `Calendar`. The way to check what a sync or a provider hook
   *  actually did to the calendar, rather than to the folder row.
   *
   *  `capabilities` comes back null here and that is not a bug: the Experiment
   *  fills it only for the extension that owns the calendar type, and these
   *  calendars belong to the provider, not to TbSync. Read it provider-side. */
  "calendars.get": {
    summary: "The target calendar as the platform sees it.",
    args: "{ resource? }",
    scope: "calendar",
    run: (_args, { calendarId }) =>
      messenger.calendar.calendars.get(calendarId),
  },
  /** Recolour the target calendar, as the colour picker in its properties
   *  does. The provider watches for this and mirrors the colour into its
   *  folder row, so - like `calendars.rename` - it is the only way to drive
   *  that path from a script. */
  "calendars.setColor": {
    summary: "Set the target calendar's colour.",
    args: "{ color, resource? }",
    scope: "calendar",
    run: ({ color }, { calendarId }) =>
      messenger.calendar.calendars.update(calendarId, { color }),
  },
  /** Minutes between Thunderbird's own refreshes of the calendar, 0 meaning
   *  it does not refresh on its own. The value is read back by
   *  `calendars.get`, which omits it entirely when the calendar has never
   *  been given one - the host then falls back to 30.
   *
   *  Providers that run their own schedule set 0, so this is what lets a
   *  test put an interval back and watch the provider remove it again.
   *  Rejected here rather than at the platform, which answers a bad value
   *  with a schema error naming neither the verb nor the argument. */
  "calendars.setRefreshInterval": {
    summary: "Set the target calendar's refresh interval in minutes. 0 disables it.",
    args: "{ minutes, resource? }",
    scope: "calendar",
    run: ({ minutes }, { calendarId }) => {
      if (!Number.isInteger(minutes) || minutes < 0) {
        throw withCode(
          new Error(
            `calendars.setRefreshInterval needs minutes as an integer >= 0 (got ${JSON.stringify(minutes)})`,
          ),
          "E:BAD_ARGS",
        );
      }
      return messenger.calendar.calendars.update(calendarId, {
        refreshInterval: minutes,
      });
    },
  },
  "items.query": {
    summary: "Items in the target calendar. Extra keys pass through to the platform query.",
    args: "{ resource?, ... }",
    scope: "calendar",
    // `resource` is stripped: it picks which granted target to act on and is
    // meaningless to the platform, which rejects options it does not know.
    run: ({ resource, ...args }, { calendarId }) =>
      messenger.calendar.items.query({
        ...args,
        calendarId,
        returnFormat: "ical",
      }),
  },
  "items.get": {
    summary: "One item of the target calendar, as iCalendar.",
    args: "{ id, resource? }",
    scope: "calendar",
    run: ({ id }, { calendarId }) =>
      messenger.calendar.items.get(calendarId, id, { returnFormat: "ical" }),
  },
  "items.create": {
    summary: "Create an item from iCalendar text. `id` forces the item id.",
    args: "{ ical, type?, id?, resource? }",
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
    summary: "Replace an item with iCalendar text.",
    args: "{ id, ical, resource? }",
    scope: "calendar",
    run: ({ id, ical }, { calendarId }) =>
      messenger.calendar.items.update(calendarId, id, {
        format: "ical",
        item: ical,
        returnFormat: "ical",
      }),
  },
  "items.remove": {
    summary: "Delete one item from the target calendar.",
    args: "{ id, resource? }",
    scope: "calendar",
    run: ({ id }, { calendarId }) =>
      messenger.calendar.items.remove(calendarId, id),
  },

  /* ── Address books ────────────────────────────────────────────────────
   *
   * Counterparts to the calendar verbs rather than a shared vocabulary,
   * because the two APIs are not the same shape: `mailingLists` has
   * addMember / listMembers / removeMember and nothing in `calendar.items`
   * answers to those. A verb naming an operation the authorised resource
   * cannot serve is refused by scope, with the mismatch named.
   *
   * These exist so the contacts half of the queue can be driven from a
   * script at all. It is the half with the special cases in it - the ghost
   * gate that swallows PopularityIndex writes, the content hashes behind
   * it, and the list-by-name pre-tag - and without them it is reachable
   * only by a person clicking in the address book.
   *
   * vCard is the payload throughout, as iCal is for calendar items: it is
   * what the platform stores and what the EAS codec reads, so a fixture can
   * be written down and compared literally.
   */
  "contacts.query": {
    summary: "Every card in the target address book.",
    args: "{}",
    scope: "book",
    run: (_args, { bookId }) => messenger.contacts.list(bookId),
  },
  "contacts.get": {
    summary: "One card.",
    args: "{ id }",
    scope: "book",
    run: ({ id }, { bookId }) => requireInBook("card", id, bookId),
  },
  /** `id` is optional and worth passing: it makes the created card's id
   *  predictable, which is what lets a caller assert on the changelog entry
   *  the create produces rather than hunting for it afterwards. */
  "contacts.create": {
    summary: "Create a card from vCard text. `id` forces the card id.",
    args: "{ vCard, id? }",
    scope: "book",
    run: ({ vCard, id }, { bookId }) =>
      messenger.contacts.create(bookId, id ?? null, { vCard }),
  },
  "contacts.update": {
    summary: "Replace a card with vCard text.",
    args: "{ id, vCard }",
    scope: "book",
    async run({ id, vCard }, { bookId }) {
      await requireInBook("card", id, bookId);
      return messenger.contacts.update(id, { vCard });
    },
  },
  "contacts.remove": {
    summary: "Delete one card.",
    args: "{ id }",
    scope: "book",
    async run({ id }, { bookId }) {
      await requireInBook("card", id, bookId);
      return messenger.contacts.delete(id);
    },
  },

  "lists.query": {
    summary: "Every mailing list in the target address book.",
    args: "{}",
    scope: "book",
    run: (_args, { bookId }) => messenger.mailingLists.list(bookId),
  },
  "lists.get": {
    summary: "One mailing list.",
    args: "{ id }",
    scope: "book",
    run: ({ id }, { bookId }) => requireInBook("mailing list", id, bookId),
  },
  /** A list is properties, not a vCard - the platform has no vCard
   *  representation for one. */
  "lists.create": {
    summary: "Create a mailing list.",
    args: "{ name, nickName?, description? }",
    scope: "book",
    run: ({ name, nickName, description }, { bookId }) =>
      messenger.mailingLists.create(bookId, {
        name,
        ...(nickName ? { nickName } : {}),
        ...(description ? { description } : {}),
      }),
  },
  "lists.update": {
    summary: "Patch a mailing list's properties.",
    args: "{ id, ... }",
    scope: "book",
    async run({ id, ...properties }, { bookId }) {
      await requireInBook("mailing list", id, bookId);
      return messenger.mailingLists.update(id, properties);
    },
  },
  "lists.remove": {
    summary: "Delete one mailing list.",
    args: "{ id }",
    scope: "book",
    async run({ id }, { bookId }) {
      await requireInBook("mailing list", id, bookId);
      return messenger.mailingLists.delete(id);
    },
  },
  "lists.addMember": {
    summary: "Put a card into a mailing list.",
    args: "{ id, contactId }",
    scope: "book",
    // Both ids are checked: a card from another book would otherwise be
    // copied into a granted list, which reaches outside the grant just as
    // surely as writing to the other book directly.
    async run({ id, contactId }, { bookId }) {
      await requireInBook("mailing list", id, bookId);
      await requireInBook("card", contactId, bookId);
      return messenger.mailingLists.addMember(id, contactId);
    },
  },
  "lists.removeMember": {
    summary: "Take a card out of a mailing list.",
    args: "{ id, contactId }",
    scope: "book",
    async run({ id, contactId }, { bookId }) {
      await requireInBook("mailing list", id, bookId);
      return messenger.mailingLists.removeMember(id, contactId);
    },
  },
  "lists.listMembers": {
    summary: "The cards in a mailing list.",
    args: "{ id }",
    scope: "book",
    async run({ id }, { bookId }) {
      await requireInBook("mailing list", id, bookId);
      return messenger.mailingLists.listMembers(id);
    },
  },

  /** What this bridge can do, read off the table above.
   *
   *  A projection, never a second copy: a verb added without a `summary`
   *  still appears here, unexplained and visibly so, which is a prompt to
   *  describe it. A hand-written list would instead go quietly out of date,
   *  which is the failure mode of every stale doc there has ever been.
   *
   *  `help` alone lists everything; `help {verb}` answers for one. The
   *  argument is `verb` and not `cmd` because `cmd` is what the client
   *  takes positionally - `rpc("help", cmd=...)` collides with it. */
  help: {
    summary: "Every verb, its scope and its arguments. `help {verb}` for one.",
    args: "{ verb? }",
    run({ verb }) {
      const describe = (name) => ({
        cmd: name,
        scope: COMMANDS[name].scope ?? null,
        args: COMMANDS[name].args ?? null,
        summary: COMMANDS[name].summary ?? null,
      });
      if (verb) {
        if (!COMMANDS[verb]) throw new Error(`no such command: ${verb}`);
        return describe(verb);
      }
      return {
        scopes: SCOPE_HELP,
        commands: Object.keys(COMMANDS).sort().map(describe),
      };
    },
  },

  /** Why a scoped verb would be refused right now, in one call.
   *
   *  The target is a stored account id plus folder ids, and every part of it
   *  can go stale on its own: the account can be deleted, a folder
   *  deselected, a resource unbound. Each produces a different refusal from
   *  a different place, and answering "what is the bridge pointed at" by
   *  dumping `storage.snapshot` and matching ids by eye is the archaeology
   *  this verb exists to end. */
  status: {
    summary: "What the bridge is pointed at, and whether it still resolves.",
    args: "{}",
    async run() {
      const target = await readTarget();
      const rv = await browser.storage.local.get({ [UNRESTRICTED_KEY]: false });
      const account = target.accountId
        ? await accounts.get(target.accountId)
        : null;
      const resources = {};
      for (const [kind, grant] of Object.entries(target.resources ?? {})) {
        if (!grant?.folderId) continue;
        const row = await folders.get(target.accountId, grant.folderId);
        resources[kind] = {
          folderId: grant.folderId,
          folderName: grant.folderName ?? null,
          exists: !!row,
          selected: !!row?.selected,
          targetType: row?.targetType ?? null,
          bound: !!row?.targetID,
        };
      }
      return {
        helperVersion: EXPECTED_HELPER_VERSION,
        unrestricted: !!rv[UNRESTRICTED_KEY],
        target: {
          accountId: target.accountId ?? null,
          accountName: target.accountName ?? null,
          // The stored id can name an account that no longer exists - a
          // rebuilt profile mints new ones - and every scoped verb then
          // refuses for a reason that reads like a permission problem.
          exists: !!account,
        },
        resources,
      };
    },
  },
};

/** What each `scope` means, for `help`. Beside the table it describes, for
 *  the same reason the summaries are. */
const SCOPE_HELP = {
  unscoped: "TbSync's own configuration; no mailbox content",
  account: "args.accountId must be the bridge's target account",
  folder: "args.accountId and args.folderId must be the target's",
  calendar:
    "acts on the target's calendar; `resource` picks calendars (default) or tasks",
  book: "acts on the target's address book",
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

/** The link's honest state. `port` alone cannot tell the truth:
 *  `connectNative` returns a Port object synchronously whether or not a
 *  helper ever spawns, and a spawn issued into a conduit torn by
 *  `runtime.reload()` neither completes nor fails - the tab then reads
 *  "running" off a zombie Port for as long as nobody toggles it. "up"
 *  therefore means the helper said hello and answers pings; everything
 *  else says what is actually known. */
let linkState = "off"; // "off" | "starting" | "up" | "failed"
let lastPong = 0; // ms epoch of the last pong (0 = none yet)
let helperListening = null; // the pong's report about the HTTP socket
let restartAttempts = 0; // failed starts since the last successful hello
let helloTimer = null; // spawn watchdog
let heartbeatTimer = null;
let restartTimer = null;
let pingSeq = 0;
let lastPingAnswered = true;

const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 15_000;
const RESTART_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000];
const MAX_RESTART_ATTEMPTS = 5;

function clearTimers() {
  if (helloTimer) clearTimeout(helloTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (restartTimer) clearTimeout(restartTimer);
  helloTimer = heartbeatTimer = restartTimer = null;
}

/** Tear the link down and, while the user still has the bridge enabled, try
 *  again on a backoff - which is exactly what the manual disable/enable
 *  fix did, automated. Capped: a helper that keeps failing to *start* is
 *  retried five times and then declared failed, because past that point
 *  the retries are respawning a broken install, and the tab should say so
 *  instead of flickering. Any successful hello resets the count. */
async function failAndMaybeRestart(why) {
  note("error", why);
  teardownLink();
  if (!(await isEnabled())) {
    linkState = "off";
    return;
  }
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    linkState = "failed";
    note(
      "error",
      `giving up after ${restartAttempts} failed starts - use Disable/Enable to try again, or reinstall the helper`,
    );
    return;
  }
  const delay =
    RESTART_BACKOFF_MS[
      Math.min(restartAttempts, RESTART_BACKOFF_MS.length - 1)
    ];
  restartAttempts++;
  linkState = "starting";
  note(
    "info",
    `restarting the helper in ${delay / 1000}s (attempt ${restartAttempts})`,
  );
  restartTimer = setTimeout(() => {
    restartTimer = null;
    connect().catch((err) =>
      note("error", `restart failed: ${err?.message ?? err}`),
    );
  }, delay);
}

/** Drop the port and every timer, without touching the enabled flag. */
function teardownLink() {
  clearTimers();
  if (port) {
    try {
      port.disconnect();
    } catch (err) {
      console.debug("[tbsync] bridge: disconnect failed:", err);
    }
  }
  port = null;
  endpoint = null;
  lastPong = 0;
  helperListening = null;
  lastPingAnswered = true;
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  lastPingAnswered = true;
  heartbeatTimer = setInterval(() => {
    if (!port) return;
    if (!lastPingAnswered) {
      // Two intervals without an answer: the previous ping is still
      // unanswered when the next one is due. The pipe is dead or the
      // helper is wedged - either way, what a real request would hit.
      failAndMaybeRestart("helper stopped answering pings");
      return;
    }
    lastPingAnswered = false;
    try {
      port.postMessage({ type: "ping", id: ++pingSeq });
    } catch (err) {
      failAndMaybeRestart(`ping failed: ${err?.message ?? err}`);
    }
  }, HEARTBEAT_MS);
}

/** Attach the bridge to the background runtime. Call once from
 *  background.mjs, after `ui.init()` - the RPC handlers registered here go
 *  into the same table the manager uses. */
export async function initBackground() {
  ui.setManagerRpcHandler("bridgeGetStatus", async () => ({
    // "connected" kept for compatibility, but it now tells the truth: the
    // helper said hello and has been answering pings. A zombie Port is
    // "starting", a capped-out restart schedule is "failed".
    connected: linkState === "up",
    linkState,
    lastPongAgeMs: lastPong ? Date.now() - lastPong : null,
    helperListening,
    restartAttempts,
    enabled: await isEnabled(),
    unrestricted: (
      await browser.storage.local.get({ [UNRESTRICTED_KEY]: false })
    )[UNRESTRICTED_KEY],
    endpoint,
    activity: activity.slice(-ACTIVITY_LIMIT),
    target: await readTarget(),
    allowed: Object.keys(COMMANDS),
  }));

  ui.setManagerRpcHandler("bridgeSetEnabled", async ({ enabled }) => {
    await browser.storage.local.set({ [ENABLED_KEY]: !!enabled });
    if (enabled) {
      restartAttempts = 0;
      await connect();
    } else {
      disconnect();
    }
    return { connected: linkState === "up" };
  });

  ui.setManagerRpcHandler("bridgeSetUnrestricted", async ({ unrestricted }) => {
    await browser.storage.local.set({ [UNRESTRICTED_KEY]: !!unrestricted });
    return { unrestricted: !!unrestricted };
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

/** The resource kinds the bridge can be granted, keyed by the `targetType`
 *  the host stores on a folder row. One grant per kind, because a verb needs
 *  a resource of the *right* kind and juggling a single grant meant
 *  re-picking it in the UI between a contacts test and a calendar one.
 *
 *  These are host knowledge: a provider declares `targetType` when it pushes
 *  its folder list, and `getFolders` hands it back, so both the selects and
 *  the scope check read the same field. */
const RESOURCE_KINDS = ["contacts", "calendars", "tasks"];

/** The account, and one resource per kind, normalized so the tab can read
 *  every field without guarding. Identity only - the Thunderbird book or
 *  calendar a resource is bound to is looked up when needed, never stored:
 *  deselecting a folder destroys that object and reselecting makes a new one,
 *  so a stored id survives it by minutes. */
async function readTarget() {
  const rv = await browser.storage.local.get({ [TARGET_KEY]: {} });
  const t = rv[TARGET_KEY] ?? {};
  const resources = {};
  for (const kind of RESOURCE_KINDS) {
    const r = t.resources?.[kind] ?? {};
    resources[kind] = {
      folderId: r.folderId ?? "",
      folderName: r.folderName ?? "",
    };
  }
  return {
    accountId: t.accountId ?? "",
    accountName: t.accountName ?? "",
    resources,
  };
}

/** Every folder the bridge has been granted, as `folderId -> kind`. */
function grantedFolders(target) {
  const out = new Map();
  for (const kind of RESOURCE_KINDS) {
    const id = target.resources[kind].folderId;
    if (id) out.set(id, kind);
  }
  return out;
}

async function connect() {
  if (port) return;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  linkState = "starting";
  try {
    port = browser.runtime.connectNative(NATIVE_APP);
  } catch (err) {
    port = null;
    await failAndMaybeRestart(
      `could not start the helper app: ${err?.message ?? err}`,
    );
    return;
  }
  const thisPort = port;
  port.onMessage.addListener(onNativeMessage);
  port.onDisconnect.addListener((p) => {
    if (port !== thisPort) return;
    // An unexpected death while enabled goes through the restart path. A
    // helper that keeps dying after a successful hello IS a broken install,
    // which is what the attempt cap is for - but a link that dies once, to
    // a reload race or a killed process, only needs reconnecting, and the
    // user should not have to be the retry loop.
    failAndMaybeRestart(
      `helper app disconnected: ${p.error?.message ?? "closed"}`,
    );
  });
  // The spawn watchdog. `connectNative` handing back a Port object proves
  // nothing; only the helper's hello does. A spawn issued into a torn
  // conduit hangs forever with no error and no disconnect - the zombie
  // that showed "Bridge running" for forty minutes.
  helloTimer = setTimeout(() => {
    helloTimer = null;
    failAndMaybeRestart("helper did not say hello - spawn presumed stuck");
  }, HELLO_TIMEOUT_MS);
  note("info", "helper app starting");
}

function disconnect() {
  teardownLink();
  linkState = "off";
  restartAttempts = 0;
  note("info", "helper app stopped");
}

/** One command from the helper: `{requestId, cmd, args}`. Always answers,
 *  including on rejection - the HTTP caller on the far end is holding a
 *  socket open until it hears back. */
async function onNativeMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "pong") {
    lastPong = Date.now();
    lastPingAnswered = true;
    helperListening = msg.listening !== false;
    return;
  }

  // The helper's opening message, carrying the address it settled on. No
  // requestId, which is what tells it apart from a command.
  if (msg.type === "hello") {
    if (helloTimer) {
      clearTimeout(helloTimer);
      helloTimer = null;
    }
    if (msg.error) {
      // The helper started but could not listen - almost always the port
      // already being in use. It exits right after telling us; the retry
      // schedule below is what heals the in-use race a reload can leave.
      failAndMaybeRestart(msg.error);
      return;
    }
    linkState = "up";
    restartAttempts = 0;
    lastPong = Date.now();
    startHeartbeat();
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
    const scope = await applyScope(command.scope, args ?? {}, cmd);
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

/** Which granted resource a scope uses, and what it is called when saying so.
 *
 *  A `tasks` folder binds to a calendar exactly as an events folder does - one
 *  calendar type serves both - so the calendar verbs work on either, and which
 *  of the two they act on is the caller's choice via `args.resource`. */
const SCOPE_KINDS = {
  calendar: { kinds: ["calendars", "tasks"], noun: "a calendar" },
  book: { kinds: ["contacts"], noun: "an address book" },
};

/** Hold a command to the account and resources chosen in the Bridge tab.
 *
 *  Throws for anything outside them, and for anything at all when nothing has
 *  been chosen: an unconfigured bridge should refuse, not roam. Returns what
 *  the command needs from the target - which for the resource verbs is the
 *  calendar or book id they are given rather than allowed to name. */
async function applyScope(scope, args, cmd) {
  if (!scope) return {};
  const target = await readTarget();

  if (!target.accountId) {
    throw withCode(
      new Error(
        "no target selected - choose an account and a resource in the " +
          "Bridge tab. `status` reports the grant, `help` lists the verbs.",
      ),
      "E:NO_TARGET",
    );
  }
  if (args.accountId && args.accountId !== target.accountId) {
    throw withCode(
      new Error(
        `account ${args.accountId} is not the bridge's target ` +
          `(${target.accountId}${target.accountName ? ` "${target.accountName}"` : ""}). ` +
          `Call status to see the whole grant, or setTarget to move it ` +
          `- which needs unrestricted mode, in the Bridge tab.`,
      ),
      "E:OUT_OF_SCOPE",
    );
  }

  if (scope === "account") return { accountId: target.accountId };

  const granted = grantedFolders(target);
  if (!granted.size) {
    throw withCode(
      new Error("no resource selected in the Bridge tab"),
      "E:NO_TARGET",
    );
  }

  // A folder-scoped verb names its folder, and may name any of the granted
  // ones - they are all the caller's to touch.
  if (scope === "folder") {
    if (!args.folderId) {
      throw withCode(new Error(`${cmd} needs a folderId`), "E:OUT_OF_SCOPE");
    }
    if (!granted.has(args.folderId)) {
      throw withCode(
        new Error(
          `resource ${args.folderId} is not one of the bridge's targets ` +
            `(${[...granted.keys()].join(", ")})`,
        ),
        "E:OUT_OF_SCOPE",
      );
    }
    return { accountId: target.accountId, folderId: args.folderId };
  }

  // "calendar" or "book". Both hand the caller an id rather than accept one,
  // so `args.resource` picks only *which grant* to use, never an arbitrary
  // resource. Defaults to the scope's first kind, which is what makes
  // `items.query` mean the events folder unless asked otherwise.
  const { kinds, noun } = SCOPE_KINDS[scope];
  const kind = args.resource ?? kinds[0];
  if (!kinds.includes(kind)) {
    throw withCode(
      new Error(
        `${cmd} takes resource ${kinds.join(" or ")} (got ${JSON.stringify(args.resource)})`,
      ),
      "E:OUT_OF_SCOPE",
    );
  }
  const { folderId, folderName } = target.resources[kind];
  if (!folderId) {
    throw withCode(
      new Error(`no ${kind} resource selected in the Bridge tab`),
      "E:NO_TARGET",
    );
  }

  // Read from the folder row every time rather than from the stored target:
  // `setFolderSelected(false)` deletes the Thunderbird resource and
  // reselecting creates a fresh one, so any id we held would be stale the
  // moment a clean resync ran - and a clean resync is one of the things this
  // bridge exists to do.
  const row = await folders.get(target.accountId, folderId);
  if (!row?.targetID) {
    throw withCode(
      new Error(
        `resource "${folderName}" is not bound to ${noun} yet - sync it once`,
      ),
      "E:NO_TARGET",
    );
  }
  // The row, not the select, is the authority on what a folder is: a provider
  // can re-push its folder list with a different targetType between the grant
  // and the call.
  if (row.targetType !== kind) {
    throw withCode(
      new Error(
        `resource "${folderName}" is a ${row.targetType ?? "unknown"} folder, ` +
          `not ${kind}; re-pick it in the Bridge tab`,
      ),
      "E:OUT_OF_SCOPE",
    );
  }
  return scope === "book"
    ? { bookId: row.targetID }
    : { calendarId: row.targetID };
}

/**
 * Hold a card or mailing-list id to the granted address book.
 *
 * Book-scoped verbs are handed a `bookId`, but the platform addresses cards
 * and lists by ids that are unique across every book - so an id belonging to
 * another book resolves perfectly well, and the grant only looks enforced.
 * The calendar verbs have no such gap: `messenger.calendar.items.*` take the
 * calendar id alongside the item id, so the platform scopes the lookup for
 * them.
 *
 * Returns the node, because the callers that only need to read it want it
 * anyway and a second fetch would be wasted. An unknown id raises the
 * platform's own "not found" rather than a scope error: it is not a grant
 * problem, and saying so would be misleading.
 */
async function requireInBook(noun, id, bookId) {
  const api = noun === "card" ? messenger.contacts : messenger.mailingLists;
  const node = await api.get(id);
  if (node?.parentId !== bookId) {
    throw withCode(
      new Error(
        `${noun} ${id} is not in the bridge's address book (${bookId})`,
      ),
      "E:OUT_OF_SCOPE",
    );
  }
  return node;
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
  const unrestrictedEl = $("bridge-unrestricted");
  unrestrictedEl.addEventListener("change", () => {
    rpc("bridgeSetUnrestricted", {
      unrestricted: unrestrictedEl.checked,
    }).catch((err) =>
      console.debug("[tbsync] bridge: set unrestricted failed:", err),
    );
    refresh();
  });
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
  // One select per resource kind, each offering only folders of that kind.
  const resourceEls = new Map(
    RESOURCE_KINDS.map((kind) => [kind, $(`bridge-target-${kind}`)]),
  );

  // Rows behind the selects, so a stored target can carry the display names
  // alongside the ids without a second lookup.
  let accountRows = [];
  let folderRows = [];

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
    await loadResources({});
    saveTarget();
  });
  for (const select of resourceEls.values()) {
    select.addEventListener("change", () => saveTarget());
  }

  /** Fill every select from live state, preselecting whatever is stored.
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
    await loadResources(status.target.resources ?? {});
  }

  /** One select per kind, each offering only the folders of that kind.
   *  `targetType` is the host's own field on the folder row, so the filter
   *  needs nothing from the provider and cannot disagree with the scope
   *  check, which reads the same field. */
  async function loadResources(preselect) {
    folderRows = [];
    if (accountEl.value) {
      try {
        const rv = await rpc("getFolders", { accountId: accountEl.value });
        folderRows = rv.folders ?? [];
      } catch (err) {
        console.warn("[tbsync] bridge: could not list resources:", err);
      }
    }
    for (const [kind, select] of resourceEls) {
      fill(
        select,
        folderRows
          .filter((f) => f.targetType === kind)
          .map((f) => ({
            value: f.folderId,
            label: f.displayName ?? f.folderId,
          })),
        preselect[kind]?.folderId ?? "",
      );
    }
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
    const resources = {};
    for (const [kind, select] of resourceEls) {
      const row = folderRows.find((f) => f.folderId === select.value);
      resources[kind] = {
        folderId: row?.folderId ?? "",
        folderName: row?.displayName ?? "",
      };
    }
    rpc("bridgeSetTarget", {
      target: {
        accountId: account?.accountId ?? "",
        accountName: account?.accountName ?? "",
        resources,
      },
    }).catch((err) =>
      console.warn("[tbsync] bridge: could not store the target:", err),
    );
  }

  // The tab's own view of the helper's HTTP socket - fetched from here, a
  // genuinely external client, not relayed through the link under test.
  // Throttled below the 2s refresh cadence; null until the first probe.
  let healthOk = null;
  let lastHealthProbe = 0;
  const HEALTH_PROBE_MS = 6000;

  async function probeHealth(endpoint) {
    if (!endpoint?.url) {
      healthOk = null;
      return;
    }
    if (Date.now() - lastHealthProbe < HEALTH_PROBE_MS) return;
    lastHealthProbe = Date.now();
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const resp = await fetch(`${endpoint.url}/health`, {
        headers: { Authorization: `Bearer ${endpoint.token}` },
        signal: ctl.signal,
      });
      clearTimeout(t);
      healthOk = resp.ok;
    } catch {
      healthOk = false;
    }
  }

  async function refresh() {
    let status;
    try {
      status = await rpc("bridgeGetStatus");
    } catch {
      // Background not ready, or an ATN-shaped build somehow reaching here.
      return;
    }
    await probeHealth(status.endpoint);

    // Headline: running only when both halves are proven - the helper said
    // hello and answers pings (link), and this page reached its HTTP
    // socket (app). The in-between states say what is actually known
    // instead of guessing "running" off a Port object.
    const linkUp = status.linkState === "up";
    const appUp = healthOk === true;
    let headlineKey, detailKey;
    if (linkUp && (appUp || healthOk === null)) {
      headlineKey = "manager.bridge.status.on";
      detailKey = null;
    } else if (status.linkState === "starting") {
      headlineKey = "manager.bridge.status.starting";
      detailKey = null;
    } else if (status.linkState === "failed") {
      headlineKey = "manager.bridge.status.failed";
      detailKey = "manager.bridge.detail.failed";
    } else if (linkUp && healthOk === false) {
      // Link answers, socket does not - the helper thread died or the
      // port is blocked. A real client would hang; say so.
      headlineKey = "manager.bridge.status.degraded";
      detailKey = "manager.bridge.detail.socketDead";
    } else if (!linkUp && appUp) {
      // The inverse zombie: the local app answers HTTP but the native
      // link is down - its requests are going nowhere.
      headlineKey = "manager.bridge.status.degraded";
      detailKey = "manager.bridge.detail.linkDead";
    } else {
      headlineKey = "manager.bridge.status.off";
      detailKey = null;
    }
    statusEl.textContent = browser.i18n.getMessage(headlineKey);
    const detailEl = $("bridge-link-detail");
    detailEl.textContent = detailKey ? browser.i18n.getMessage(detailKey) : "";
    detailEl.toggleAttribute("hidden", !detailKey);
    statusEl.classList.toggle("bridge-on", linkUp && appUp !== false);
    statusEl.classList.toggle(
      "bridge-err",
      status.linkState === "failed" ||
        (linkUp && healthOk === false) ||
        (!linkUp && appUp),
    );
    isOn = status.connected || status.enabled;
    unrestrictedEl.checked = !!status.unrestricted;
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
    hintEl.toggleAttribute("hidden", linkUp);
    downloadEl.toggleAttribute("hidden", linkUp && !stale);
    uninstallEl.toggleAttribute("hidden", !linkUp || stale);
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
      !status.connected ||
        RESOURCE_KINDS.some((k) => status.target.resources?.[k]?.folderId),
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
      el("span", { id: "bridge-link-detail", class: "bridge-hint" }),
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
    el("div", { class: "bridge-row" }, [
      el("label", { class: "bridge-hint" }, [
        el("input", { type: "checkbox", id: "bridge-unrestricted" }),
        i18n("span", "manager.bridge.unrestricted"),
      ]),
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
        i18n("span", "manager.bridge.target.contacts"),
        el("select", { id: "bridge-target-contacts" }),
      ]),
      el("label", {}, [
        i18n("span", "manager.bridge.target.events"),
        el("select", { id: "bridge-target-calendars" }),
      ]),
      el("label", {}, [
        i18n("span", "manager.bridge.target.tasks"),
        el("select", { id: "bridge-target-tasks" }),
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
