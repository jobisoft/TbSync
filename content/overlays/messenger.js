/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncMessenger = {

    onInject: function (window) {
        Services.obs.addObserver(tbSyncMessenger.updateSyncstateObserver, "tbsync.updateSyncstate", false);
    },

    onRemove: function (window) {
        Services.obs.removeObserver(tbSyncMessenger.updateSyncstateObserver, "tbsync.updateSyncstate");
    },
    
    updateSyncstateObserver: {
        observe: function (aSubject, aTopic, aData) {
            let account = aData;            
            if (account) {
                let syncstate = tbSync.getSyncData(account, "syncstate");
                if (syncstate == "accountdone") {
                    let status = tbSync.db.getAccountSetting(account, "status");
                    switch (status) {
                        case "401":
                            //only popup one password prompt window
                            if (!tbSync.passWindowObj.hasOwnProperty[account] || tbSync.passWindowObj[account] === null) {
                                tbSync.passWindowObj[account] = tbSync.window.openDialog("chrome://tbsync/content/manager/password.xul", "passwordprompt", "centerscreen,chrome,resizable=no", tbSync.db.getAccount(account), function() {tbSync.syncAccount("sync", account);});
                            }
                            break;
                    }
                }
            }
        }
    }

};
