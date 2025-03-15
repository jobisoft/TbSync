/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

// Using a closure to not leak anything but the API to the outside world.
(function (exports) {

  var { AddonManager } = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs"
  );
  var { ExtensionParent } = ChromeUtils.importESModule(
    "resource://gre/modules/ExtensionParent.sys.mjs"
  );
  
  var tbsyncExtension = ExtensionParent.GlobalManager.getExtension(
    "tbsync@jobisoft.de"
  );
  var { TbSync: TbSyncModule } = ChromeUtils.importESModule(
    `chrome://tbsync/content/tbsync.sys.mjs?${tbsyncExtension.manifest.version}`
  );
  
  let defaults = Services.prefs.getDefaultBranch("extensions.tbsync.");
  defaults.setBoolPref("debug.testoptions", false);
  defaults.setBoolPref("log.toconsole", false);
  defaults.setIntPref("log.userdatalevel", 0); //0 - off   1 - userdata only on errors   2 - including full userdata,  3 - extra infos

  var TbSync = class extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
      return {
        TbSync: {
          async load() {
            if (!TbSyncModule.enabled) {
              let addon = await AddonManager.getAddonByID(context.extension.id);
              TbSyncModule.load(addon, context.extension);
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
      TbSyncModule.enabled = false;
      TbSyncModule.unload();
    }
  };
  exports.TbSync = TbSync;
})(this);