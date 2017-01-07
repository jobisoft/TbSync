/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */  
"use strict";

Components.utils.import("chrome://tzpush/content/tzpush.jsm");

var tzMessenger = {

    onload: function () {
        tzMessenger.syncTimer.start();

        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.addObserver(tzMessenger.syncstateObserver, "tzpush.changedSyncstate", false);
        observerService.addObserver(tzMessenger.setPasswordObserver, "tzpush.setPassword", false);

        tzMessenger.addressbookListener.add();
        tzPush.sync.resetSync();
    },    

    openPrefs: function () {
        // check, if a window is already open and just put it in focus
        if (tzPush.prefWindowObj === null) tzPush.prefWindowObj = window.open("chrome://tzpush/content/prefManager.xul", "TzPushPrefWindow", "chrome,centerscreen,toolbar");
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
    

    setBookModified : function (folder) {
        if (folder.status == "OK") {
            tzPush.db.setAccountSetting(folder.account, "status", "notsyncronized");
            tzPush.db.setFolderSetting(folder.account, folder.folderID, "status", "modified");
            //notify settings gui to update status
            let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
            observerService.notifyObservers(null, "tzpush.changedSyncstate", folder.account);
        }
    },


    addressbookListener: {

        //if a contact in one of the synced books is modified, update status of target and account
        onItemPropertyChanged: function addressbookListener_onItemPropertyChanged(aItem, aProperty, aOldValue, aNewValue) {
            if (aItem instanceof Components.interfaces.nsIAbCard) {
                let aParentDirURI = tzPush.getUriFromPrefId(aItem.directoryId.split("&")[0]);
                let folders = tzPush.db.findFoldersWithSetting("target", aParentDirURI);
                if (folders.length > 0) tzMessenger.setBookModified(folders[0]);
            }
        },

        onItemRemoved: function addressbookListener_onItemRemoved (aParentDir, aItem) {
            if (aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            }

            /* * *
             * If a card is removed from the addressbook we are syncing, keep track of the
             * deletions and log them to a file in the profile folder
             */
            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                let folders = tzPush.db.findFoldersWithSetting("target", aParentDir.URI);
                if (folders.length > 0) {
                    let cardId = aItem.getProperty("ServerId", "");
                    if (cardId) tzPush.db.addCardToDeleteLog(aParentDir.URI, cardId);
                    tzMessenger.setBookModified(folders[0]);
                }
            }

            /* * *
             * If the entire book we are currently syncing is deleted, remove it from sync and
             * clean up delete log
             */
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                let folders =  tzPush.db.findFoldersWithSetting("target", aItem.URI);
                //It should not be possible to link a book to two different accounts, so we just take the first target found
                if (folders.length > 0) {
                    folders[0].target="";
                    folders[0].synckey="";
                    folders[0].lastsynctime= "";
                    folders[0].status= "";
                    tzPush.db.setFolder(folders[0]);
                    tzPush.db.setAccountSetting(folders[0].account, "status", "notsyncronized");
                    //not needed - tzPush.db.setAccountSetting(owner[0], "policykey", ""); //- this is identical to tzPush.sync.resync() without the actual sync

                    tzPush.db.clearDeleteLog(aItem.URI);

                    //update settings window, if open
                    let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                    observerService.notifyObservers(null, "tzpush.changedSyncstate", folders[0].account);
                }
            }
        },

        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {
            //if a new book is added, get its prefId (which we need to get the parentDir of a modified card)
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                tzPush.scanPrefIdsOfAddressBooks();
            }
            
            if (aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            }

            /* * *
             * If cards get moved between books or if the user imports new cards, we always have to strip the serverID (if present). The only valid option
             * to introduce a new card with a serverID is during sync, when the server pushes a new card. To catch this, the sync code is adjusted to 
             * actually add the new card without serverID and modifies it right after addition, so this addressbookListener can safely strip any serverID 
             * off added cards, because they are introduced by user actions (move, copy, import) and not by a sync. */
            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                let ServerId = aItem.getProperty("ServerId", "");
                if (ServerId != "") {
                    aItem.setProperty("ServerId", "");
                    aParentDir.modifyCard(aItem);
                }
                //also update target status
                let folders = tzPush.db.findFoldersWithSetting("target", aParentDir.URI);
                if (folders.length > 0) tzMessenger.setBookModified(folders[0]);                
            }

        },

        add: function addressbookListener_add () {
            let flags = Components.interfaces.nsIAbListener;
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .addAddressBookListener(tzMessenger.addressbookListener, flags.all);
        },

        remove: function addressbookListener_remove () {
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .removeAddressBookListener(tzMessenger.addressbookListener);
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
