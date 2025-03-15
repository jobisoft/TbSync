/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

// Using a closure to not leak anything but the API to the outside world.
(function (exports) {

  var { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  var { TbSync: TbSyncModule } = ChromeUtils.importESModule("chrome://tbsync/content/tbsync.sys.mjs");

  let defaults = Services.prefs.getDefaultBranch("extensions.tbsync.");
  defaults.setBoolPref("debug.testoptions", false);
  defaults.setBoolPref("log.toconsole", false);
  defaults.setIntPref("log.userdatalevel", 0); //0 - off   1 - userdata only on errors   2 - including full userdata,  3 - extra infos

  var TbSync = class extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
      return {
        TbSync: {
          async load(windowId) {
            let { window } = context.extension.windowManager.get(windowId);
            let { TbSync } = ChromeUtils.importESModule("chrome://tbsync/content/tbsync.sys.mjs");
            if (!TbSync.enabled) {
              let addon = await AddonManager.getAddonByID(context.extension.id);
              TbSync.load(window, addon, context.extension);
            }
          },
          openManagerWindow() {
            TbSyncModule.manager.openManagerWindow();
          }
        },
      };
    }

    onShutdown(isAppShutdown) {
      if (isAppShutdown) {
        return; // the application gets unloaded anyway
      }
    }
  };
  exports.TbSync = TbSync;
})(this);