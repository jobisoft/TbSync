/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */  
"use strict";

Components.utils.import("chrome://tzpush/content/tzpush.jsm");

var tzMessenger = {

    onload: function () {
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.addObserver(tzMessenger.syncstateObserver, "tzpush.changedSyncstate", false);
        observerService.addObserver(tzMessenger.setPasswordObserver, "tzpush.setPassword", false);

        tzPush.init();
        tzMessenger.syncTimer.start();
    },

    openPrefs: function () {
        // check, if a window is already open and just put it in focus
        if (tzPush.prefWindowObj === null) tzPush.prefWindowObj = window.open("chrome://tzpush/content/prefManager.xul", "TzPushPrefWindow", "chrome,centerscreen,toolbar,resizable");
        tzPush.prefWindowObj.focus();
    },


    /* * *
    * Observer to catch setPassword requests
    */
    setPasswordObserver: {
        observe: function (aSubject, aTopic, aData) {
            let dot = aData.indexOf(".");
            let account = aData.substring(0,dot);
            let newpassword = aData.substring(dot+1);
            tzPush.setPassword(account, newpassword);
            tzPush.db.setAccountSetting(account, "state", "connecting");
            tzPush.sync.addAccountToSyncQueue("resync", account);
        }
    },



    /* * *
    * Observer to catch changing syncstate and to update the status bar.
    */
    syncstateObserver: {
        observe: function (aSubject, aTopic, aData) {
            //update status bar
            let status = document.getElementById("tzstatus");
            if (status && aData == "") { //only observe true notifications from setSyncState()
                
                let data = tzPush.sync.currentProzess;
                let target = "";
                let accounts = tzPush.db.getAccounts().data;

                if (accounts.hasOwnProperty(data.account)) {
                    target = accounts[data.account].accountname
                    
                    if (data.folderID !== "" && data.state != "done") { //if "Done" do not print folder info in status bar
                        target = target + "/" + tzPush.db.getFolderSetting(data.account, data.folderID, "name");
                    }
                    
                    target = " [" + target + "]";
                }
                    
                status.label = "TzPush: " + tzPush.getLocalizedMessage("syncstate." + data.state) + target;
                
                //TODO check if error and print in status
            }
        }
    },



    syncTimer: {
        timer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

        start: function () {
            this.timer.cancel();
            this.timer.initWithCallback(this.event, 60000, 3); //run timer every 60s
        },

        event: {
            notify: function (timer) {
                //get all accounts and check, which one needs sync (accounts array is without order, extract keys (ids) and loop over them)
                let accounts = tzPush.db.getAccounts();
                for (let i=0; i<accounts.IDs.length; i++) {
                    let syncInterval = accounts.data[accounts.IDs[i]].autosync * 60 * 1000;
                    let lastsynctime = accounts.data[accounts.IDs[i]].lastsynctime;
                    
                    if (accounts.data[accounts.IDs[i]].state == "connected" && (syncInterval > 0) && ((Date.now() - lastsynctime) > syncInterval) ) {
                        tzPush.sync.addAccountToSyncQueue("sync",accounts.IDs[i]);
                    }
                }
            }
        }
    }
};

window.addEventListener("load", tzMessenger.onload, false);
