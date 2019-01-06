/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("resource://gre/modules/Services.jsm");

var tbSyncMessenger = {

    onInjectIntoMessenger: function (window) {
        Services.obs.addObserver(tbSyncMessenger.updateSyncstateObserver, "tbsync.updateSyncstate", false);
    },

    onRemoveFromMessenger: function (window) {
        Services.obs.removeObserver(tbSyncMessenger.updateSyncstateObserver, "tbsync.updateSyncstate");
    },
    
    updateSyncstateObserver: {
        observe: function (aSubject, aTopic, aData) {
            let account = aData;            
            let syncstate = tbSync.getSyncData(account,"syncstate");
            let status = tbSync.db.getAccountSetting(account, "status");
            Services.console.logStringMessage("[TbSyncMessenger] " + syncstate + " : " + status);
        }
    },
    
    
};
