/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
"use strict";

var { ExtensionParent } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionParent.sys.mjs"
);

var tbsyncExtension = ExtensionParent.GlobalManager.getExtension(
  "tbsync@jobisoft.de"
);
var { TbSync } = ChromeUtils.importESModule(
  `chrome://tbsync/content/tbsync.sys.mjs?${tbsyncExtension.manifest.version}`
);

var tbSyncMessenger = {

  onInject: function (window) {
    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);
  },

  onRemove: function (window) {
  },

};
