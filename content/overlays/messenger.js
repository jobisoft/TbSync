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
        Services.obs.addObserver(tbSyncMessenger.updateSyncstateObserver, "tbsync.observer.manager.updateSyncstate", false);
    },

    onRemove: function (window) {
        Services.obs.removeObserver(tbSyncMessenger.updateSyncstateObserver, "tbsync.observer.manager.updateSyncstate");
    },
    
    updateSyncstateObserver: {
        observe: function (aSubject, aTopic, aData) {
            let account = aData;            
            if (account) {
                let syncstate = tbSync.core.getSyncData(account, "syncstate");
                if (syncstate == "accountdone") {
                    let status = tbSync.db.getAccountSetting(account, "status");
                    switch (status) {
                        case "401":
                            //only popup one password prompt window
                            if (!tbSync.manager.passWindowObjs.hasOwnProperty[account] || tbSync.manager.passWindowObjs[account] === null) {
                                tbSync.manager.passWindowObjs[account] = tbSync.window.openDialog("chrome://tbsync/content/manager/password.xul", "passwordprompt", "centerscreen,chrome,resizable=no", tbSync.db.getAccount(account), function() {tbSync.core.syncAccount("sync", account);});
                            }
                            break;
                    }
                }
            }
        }
    }

};
