/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */  
"use strict";

Components.utils.import("chrome://tzpush/content/tzsync.jsm");
Components.utils.import("chrome://tzpush/content/tzcommon.jsm");

//TODO: loop over all properties when card copy
//TODO: maybe disable sync buttons, if not connected (in settings)
//TODO: maybe include connect / disconnect image on button
//TODO: Sometimes account gets disconnect on error, which should not happen
//TODO: Fix conceptional error, which does not allow fields to be cleared, because empty props are ignored

/* 
 - explizitly use if (error !== "") not if (error) - fails on "0"
 - check "resync account folder" - maybe rework it

 - create tzpush.contactsync
 - create tzpush.calendersync
 
 - do not use PENDING 
- further empty tzcommon
 
*/

var tzMessenger = {

    openPrefs: function () {
        window.open("chrome://tzpush/content/prefManager.xul", "", "chrome,centerscreen,toolbar", null, null);
    },


    onload: function () {
        tzMessenger.syncTimer.start();

        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.addObserver(tzMessenger.syncRequestObserver, "tzpush.syncRequest", false);
        observerService.addObserver(tzMessenger.setStatusBarObserver, "tzpush.setStatusBar", false);
        observerService.addObserver(tzMessenger.setPasswordObserver, "tzpush.setPassword", false);

        tzMessenger.addressbookListener.add();
        tzSync.resetSync();
    },



    /* * *
    * Observer to catch syncRequests. The job requests will be send by
    * tzpref.requestSync and tzpref.requestResync()
    */
    syncRequestObserver: {
        observe: function (aSubject, aTopic, aData) {
            let data = aData.split(".");
            tzSync.addAccountToSyncQueue(data[0], data[1]);
        }
    },



    /* * *
    * Observer to catch setPassword requests
    */
    setPasswordObserver: {
        observe: function (aSubject, aTopic, aData) {
            let dot = aData.indexOf(".");
            let account = aData.substring(0,dot);
            let newpassword = aData.substring(dot+1);
            tzcommon.setPassword(account, newpassword);
            tzSync.addAccountToSyncQueue("resync", account);
        }
    },



    /* * *
    * Observer to catch changing syncstate and to update the status bar.
    */
    setStatusBarObserver: {
        observe: function (aSubject, aTopic, aData) {
            //update status bar
            let status = document.getElementById("tzstatus");
            if (status) status.label = "TzPush: " + aData;
            
            //TODO check if error and print in status
        }
    },
    



    addressbookListener: {

        onItemRemoved: function addressbookListener_onItemRemoved (aParentDir, aItem) {
            if (aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            }

            /* * *
             * If a card is removed from the addressbook we are syncing, keep track of the
             * deletions and log them to a file in the profile folder
             */
            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                let folders = tzcommon.db.findFoldersWithSetting("target", aParentDir.URI);
                if (folders.length > 0) {
                    let cardId = aItem.getProperty("ServerId", "");
                    if (cardId) tzcommon.db.addCardToDeleteLog(aParentDir.URI, cardId);
                }
            }

            /* * *
             * If the entire book we are currently syncing is deleted, remove it from sync and
             * clean up delete log
             */
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                let folders =  tzcommon.db.findFoldersWithSetting("target", aItem.URI);
                //It should not be possible to link a book to two different accounts, so we just take the first target found
                if (folders.length > 0) {
                    folders[0].target="";
                    folders[0].synckey="";
                    folders[0].lastsynctime= "";
                    folders[0].status= "";
                    tzcommon.db.setFolder(folders[0]);
                    //not needed - tzcommon.db.setAccountSetting(owner[0], "policykey", ""); //- this is identical to tzSync.resync() without the actual sync

                    tzcommon.db.clearDeleteLog(aItem.URI);
                }
            }
        },

        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {
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
            }

        },

        add: function addressbookListener_add () {
            let flags = Components.interfaces.nsIAbListener;
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .addAddressBookListener(tzMessenger.addressbookListener, flags.directoryItemRemoved | flags.itemAdded | flags.directoryRemoved);
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
                let accounts = tzcommon.db.getAccounts();
                for (let i=0; i<accounts.IDs.length; i++) {
                    let syncInterval = accounts.data[accounts.IDs[i]].autosync * 60 * 1000;

                    if (accounts.data[accounts.IDs[i]].state == "connected" && (syncInterval > 0)  && ((Date.now() - accounts.data[accounts.IDs[i]].LastSyncTime) > syncInterval) ) {
                        tzSync.addAccountToSyncQueue("sync",accounts.IDs[i]);
                    }
                }
            }
        }
    }
};

window.addEventListener("load", tzMessenger.onload, false);
