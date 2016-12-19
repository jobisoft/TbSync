/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */  
"use strict";

Components.utils.import("chrome://tzpush/content/tzcommon.jsm");
Components.utils.import("chrome://tzpush/content/tzsync.jsm");

var tzpush = {

    openPrefs: function () {
        window.open("chrome://tzpush/content/prefManager.xul", "", "chrome,centerscreen,toolbar", null, null);
    },

    /* * *
    * Observer to catch syncsRequests. The two values "sync" and "resync" will be send by
    * tzcommon.requestSync/requestResync() only if the current syncstate was alldone
    */
    syncRequestObserver: {
        observe: function (aSubject, aTopic, aData) {
            let data = aData.split(".");
            let account = data[0];
            let command = data[1];
            switch (command) {
                case "sync":
                    tzsync.sync(account);
                    break;
                case "resync":
                    tzsync.resync(account);
                    break;
            }
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
            tzcommon.connectAccount(account);
            tzcommon.requestReSync(account);
        }
    },


    /* * *
    * Observer to watch the syncstate and to update the status bar.
    */
    syncStatusObserver: {
        observe: function (aSubject, aTopic, aData) {
            //aData is of the following type
            // <accountId>.<syncstate>
            let data = aData.split(".");
            let account = data[0];
            let state = data[1];

            //dump into log (account -1 if initial reset)
            if (account == -1) tzcommon.dump("syncstate", tzcommon.getLocalizedMessage("syncstate." + state));
            else tzcommon.dump("syncstate set by account #"+account, tzcommon.getLocalizedMessage("syncstate." + state));

            //update status bar to inform user - for now we do not want errors reported in statusbar
            if (state == "error") state = "alldone";
            let status = document.getElementById("tzstatus");
            if (status) status.label = "TzPush: " + tzcommon.getLocalizedMessage("syncstate." + state);
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
                let owner = tzcommon.findAccountsWithSetting("abname", aParentDir.URI);
                if (owner.length > 0) {
                    let cardId = aItem.getProperty("ServerId", "");
                    if (cardId) tzcommon.addCardToDeleteLog(aParentDir.URI, cardId);
                }
            }

            /* * *
             * If the entire book we are currently syncing is deleted, remove it from sync and
             * clean up delete log
             */
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                let owner = tzcommon.findAccountsWithSetting("abname", aItem.URI);
                //At the moment we do not care, if the book is linked to two accounts (which should never happen), just take the first account found - TODO
                if (owner.length > 0) {
                    tzcommon.setAccountSetting(owner[0], "abname","");
                    tzcommon.setAccountSetting(owner[0], "polkey", "0"); //- this is identical to tzsync.resync() without the actual sync
                    tzcommon.setAccountSetting(owner[0], "folderID", "");
                    tzcommon.setAccountSetting(owner[0], "synckey", "");
                    tzcommon.setAccountSetting(owner[0], "LastSyncTime", "0");

                    tzcommon.clearDeleteLog(aItem.URI);
                }
            }
        },

        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {
            if (aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            }

            /* * *
             * If a card is added to a book, but not to the to one we are syncing, and that card
             * has a ServerId, remove that ServerId from the first card found in that book
             * (Why not directly from the card? TODO)
             * This cleans up cards, that get moved from an EAS book to a standard book. - IS THIS STILL WORKING WITH MULTI ACCOUNT MODE - DISABLE FOR NOW
             */
//            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory && aParentDir.URI !== tzcommon.getSetting("abname")) {
//                let ServerId = aItem.getProperty("ServerId", "");
//                if (ServerId !== "") tzcommon.removeSId(aParentDir, ServerId);
//            }
                
        },

        add: function addressbookListener_add () {
            if (Components.classes["@mozilla.org/abmanager;1"]) { // Thunderbird 3
                let flags = Components.interfaces.nsIAbListener;
                Components.classes["@mozilla.org/abmanager;1"]
                    .getService(Components.interfaces.nsIAbManager)
                    .addAddressBookListener(tzpush.addressbookListener, flags.directoryItemRemoved | flags.itemAdded | flags.directoryRemoved);
            } else { // Thunderbird 2
                let flags = Components.interfaces.nsIAddrBookSession;
                Components.classes["@mozilla.org/addressbook/services/session;1"]
                    .getService(Components.interfaces.nsIAddrBookSession)
                    .addAddressBookListener(tzpush.addressbookListener, flags.directoryItemRemoved | flags.itemAdded | flags.directoryRemoved);
            }
        },

        remove: function addressbookListener_remove () {
            if (Components.classes["@mozilla.org/abmanager;1"]) // Thunderbird 3
                Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .removeAddressBookListener(tzpush.addressbookListener);
            else // Thunderbird 2
                Components.classes["@mozilla.org/addressbook/services/session;1"]
                .getService(Components.interfaces.nsIAddrBookSession)
                .removeAddressBookListener(tzpush.addressbookListener);
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
                let accounts = tzcommon.getAccounts();
                if (accounts === null) return;

                let accountIDs = Object.keys(accounts).sort();

                for (let i=0; i<accountIDs.length; i++) {
                    let syncInterval = tzcommon.getAccountSetting(accountIDs[i], "autosync") * 60 * 1000;

                    if (tzcommon.getAccountSetting(accountIDs[i], "connected") && (syncInterval > 0) && ((Date.now() - tzcommon.getAccountSetting(accountIDs[i], "LastSyncTime")) > syncInterval)) {
                        tzcommon.requestSync(accountIDs[i]);
                    }
                }
            }
        }
    }
};

tzpush.syncTimer.start();

let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
observerService.addObserver(tzpush.syncRequestObserver, "tzpush.syncRequest", false);
observerService.addObserver(tzpush.syncStatusObserver, "tzpush.syncStatus", false);
observerService.addObserver(tzpush.setPasswordObserver, "tzpush.setPassword", false);

tzpush.addressbookListener.add();
tzcommon.resetSync();
