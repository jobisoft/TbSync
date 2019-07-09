/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { tbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncMessenger = {

  onInject: function (window) {
    Services.obs.addObserver(tbSyncMessenger.updateSyncstateObserver, "tbsync.observer.manager.updateSyncstate", false);
  },

  onRemove: function (window) {
    Services.obs.removeObserver(tbSyncMessenger.updateSyncstateObserver, "tbsync.observer.manager.updateSyncstate");
  },
  
  updateSyncstateObserver: {
    observe: function (aSubject, aTopic, aData) {
      let accountID = aData;            
      if (accountID) {
        let syncdata = tbSync.core.getSyncDataObject(accountID);
        let syncstate = syncdata.getSyncState();
        if (syncstate == "accountdone") {
          let status = tbSync.db.getAccountProperty(accountID, "status");
          switch (status) {
            case "401":
              syncdata.accountData.authPrompt();
              break;
          }
        }
      }
    }
  }

};
