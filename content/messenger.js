"use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncMessenger = {

    onload: function () {
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.addObserver(tbSyncMessenger.syncstateObserver, "tbsync.changedSyncstate", false);
        observerService.addObserver(tbSyncMessenger.setPasswordObserver, "tbsync.setPassword", false);

        tbSync.init();
        tbSyncMessenger.syncTimer.start();
    },

    openAccountManager: function () {
        // check, if a window is already open and just put it in focus
        if (tbSync.prefWindowObj === null) tbSync.prefWindowObj = window.open("chrome://tbsync/content/accountManager.xul", "TbSyncAccountManagerWindow", "chrome,centerscreen,toolbar,resizable");
        tbSync.prefWindowObj.focus();
    },

    popupNotEnabled: function () {
        alert(tbSync.getLocalizedMessage("error.init"));
    },

    /* * *
    * Observer to catch setPassword requests
    */
    setPasswordObserver: {
        observe: function (aSubject, aTopic, aData) {
            let dot = aData.indexOf(".");
            let account = aData.substring(0,dot);
            let newpassword = aData.substring(dot+1);
            tbSync.setPassword(account, newpassword);
            tbSync.db.setAccountSetting(account, "state", "connecting");
            tbSync.addAccountToSyncQueue("resync", account);
            let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
            observerService.notifyObservers(null, "tbsync.updateAccountSettingsGui", account);
        }
    },



    /* * *
    * Observer to catch changing syncstate and to update the status bar.
    */
    syncstateObserver: {
        observe: function (aSubject, aTopic, aData) {
            //update status bar
            let status = document.getElementById("tbsync.status");
            if (status && aData == "") { //only observe true notifications from setSyncState()
                
                let data = tbSync.currentProzess;
                let target = "";
                let accounts = tbSync.db.getAccounts().data;

                if (accounts.hasOwnProperty(data.account)) {
                    target = accounts[data.account].accountname
                    
                    if (data.folderID !== "" && data.state != "done") { //if "Done" do not print folder info in status bar
                        target = target + "." + tbSync.db.getFolderSetting(data.account, data.folderID, "name");
                    }
                    
                    target = " [" + target + "]";
                }
                    
                status.label = "TbSync: " + tbSync.getLocalizedMessage("syncstate." + data.state) + target;
                
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
                if (tbSync.enabled) {
                    //get all accounts and check, which one needs sync (accounts array is without order, extract keys (ids) and loop over them)
                    let accounts = tbSync.db.getAccounts();
                    for (let i=0; i<accounts.IDs.length; i++) {
                        let syncInterval = accounts.data[accounts.IDs[i]].autosync * 60 * 1000;
                        let lastsynctime = accounts.data[accounts.IDs[i]].lastsynctime;
                        
                        if (accounts.data[accounts.IDs[i]].state == "connected" && (syncInterval > 0) && ((Date.now() - lastsynctime) > syncInterval) ) {
                        tbSync.addAccountToSyncQueue("sync",accounts.IDs[i]);
                        }
                    }
                }
            }
        }
    }
};

window.addEventListener("load", tbSyncMessenger.onload, false);
for (let i=0;i<tbSync.syncProviderList.length;i++) {
    window.addEventListener("beforeunload", tbSync[tbSync.syncProviderList[i]].unload, false);
}
