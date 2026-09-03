/**
 * Install an add-on from a file. Beta builds only.
 *
 * A provider installed as an ordinary add-on cannot be reloaded - asking it
 * to restart runs the same code again - so trying a change out meant a human
 * clicking through the add-on manager between every build. This puts the
 * freshly built xpi in front of a running Thunderbird instead.
 *
 * It is an Experiment because `AddonManager` is chrome-only; there is no
 * other route. It ships in `beta/`, so no ATN build contains it.
 *
 * The one thing it refuses is replacing an add-on that is installed
 * temporarily, which would turn it into a normal install and take its
 * reload away.
 *
 * Replacing the add-on it is running in is allowed, and is the only way for
 * a caller to put a new host build in front of Thunderbird without a human.
 * The install goes through, but the caller will not hear how it went: the
 * bridge goes down with the old copy mid-call. Expect no answer, wait, and
 * ask `list` afterwards.
 */

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs",
);
var { AddonManager } = ChromeUtils.importESModule(
  "resource://gre/modules/AddonManager.sys.mjs",
);
var { FileUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/FileUtils.sys.mjs",
);
var { ExtensionUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs",
);
// Not globals here: an experiment's scope is chrome, not a window.
var { setTimeout, clearTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs",
);

// Only an ExtensionError reaches the caller with its text intact - anything
// else is reported as "An unexpected error occurred", which tells a caller
// nothing about which of the refusals below it hit.
var { ExtensionError } = ExtensionUtils;

/** Long enough for a large xpi on a slow disk, short enough that a caller
 *  waiting on an install that will never settle finds out. */
const INSTALL_TIMEOUT_MS = 120_000;

/** What a caller needs to tell one build from another. */
function describe(addon) {
  return {
    id: addon.id,
    name: addon.name,
    version: addon.version,
    // A "normal" one cannot be reloaded, which is the whole reason this
    // exists - and the field a caller should assert before believing that
    // the code it just built is the code that is running.
    installType: addon.temporarilyInstalled ? "temporary" : "normal",
    enabled: !addon.userDisabled && !addon.appDisabled,
  };
}

var installAddon = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    const fail = (message) => {
      throw new ExtensionError(message);
    };

    return {
      installAddon: {
        async install(path) {
          const file = new FileUtils.File(path);
          if (!file.exists() || !file.isFile()) fail(`no file at ${path}`);

          const install = await AddonManager.getInstallForFile(file);
          if (!install) fail(`not an add-on: ${path}`);

          // Read before installing: afterwards this names the add-on that
          // has just replaced the old one, and by then refusing is too late.
          const incoming = install.addon?.id;
          if (!incoming) fail(`could not read an add-on id from ${path}`);

          // Never over a temporary install. Installing would replace it with
          // a normal one, and a normal one cannot be reloaded - so the very
          // workflow the caller is in the middle of would be gone, and
          // getting it back means a human at about:debugging. A temporary
          // add-on already has the cheaper way to pick up a new build.
          const existing = await AddonManager.getAddonByID(incoming);
          if (existing?.temporarilyInstalled) {
            fail(
              `${incoming} is installed temporarily - installing over it ` +
                `would make it a normal install and take the reload away. ` +
                `Reload it instead: a temporary add-on re-reads its source.`,
            );
          }

          // Settled by whichever comes first. The timeout is not a guess at
          // how long an install takes - it is there because an install that
          // neither ends nor fails would otherwise leave the caller waiting
          // on nothing at all, with no way to tell that from a slow one.
          let listener = null;
          let timer = null;
          const finished = new Promise((resolve, reject) => {
            listener = {
              onInstallEnded: (_install, addon) => resolve(addon),
              onInstallFailed: (i) =>
                reject(new ExtensionError(`install failed (error ${i.error})`)),
              onDownloadFailed: (i) =>
                reject(
                  new ExtensionError(
                    `could not read the file (error ${i.error})`,
                  ),
                ),
            };
            install.addListener(listener);
            timer = setTimeout(
              () =>
                reject(
                  new ExtensionError(
                    `the install of ${path} neither finished nor failed ` +
                      `within ${INSTALL_TIMEOUT_MS / 1000}s`,
                  ),
                ),
              INSTALL_TIMEOUT_MS,
            );
          });

          try {
            install.install();
            return describe(await finished);
          } finally {
            // However this ended, including the timeout: the listener would
            // otherwise outlive the call and hold the closure with it.
            clearTimeout(timer);
            install.removeListener(listener);
          }
        },

        async list() {
          const all = await AddonManager.getAllAddons();
          return all
            .filter((addon) => addon.type === "extension")
            .map(describe);
        },
      },
    };
  }
};
