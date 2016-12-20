/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */  
"use strict";

Components.utils.import("chrome://tzpush/content/tzcommon.jsm");
Components.utils.import("chrome://tzpush/content/tzsync.jsm");

//TODO: on double click open prefs and jump to log
//TODO: remove slash and http(s):// from server (if https, enable https if not done
//TODO: check bug with empty passwords on login manager if CANCEL pressed
//TODO: loop over all properties when card copy
//TODO: maybe disable sync buttons, if not connected (in settings)

var tzpush = {

    openPrefs: function () {
        window.open("chrome://tzpush/content/prefManager.xul", "", "chrome,centerscreen,toolbar", null, null);
    },


    onload: function () {
        tzpush.syncTimer.start();

        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.addObserver(tzpush.syncRequestObserver, "tzpush.syncRequest", false);
        observerService.addObserver(tzpush.syncStatusObserver, "tzpush.syncStatus", false);
        observerService.addObserver(tzpush.setPasswordObserver, "tzpush.setPassword", false);

        tzpush.addressbookListener.add();
        tzcommon.resetSync();

        //document.getElementById("tzpushStatusMenuSyncPopup").addEventListener("popupshowing", tzpush.updateSyncMenu, false);
        //document.getElementById("tzpushMainMenuSyncPopup").addEventListener("popupshowing", tzpush.updateSyncMenu, false);
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

            //dump into log
            tzcommon.dump("syncstate set by account #"+account, tzcommon.getLocalizedMessage("syncstate." + state));

            let status = document.getElementById("tzstatus");
            if (status) status.label = "TzPush: " + tzcommon.getLocalizedMessage("syncstate." + state);
        }
    },
    

    //this is probably too much, user usually just wants to sync all possible accounts
    //no need to allow to sync individually here (it is possible in settings gui)
    /*
    updateSyncMenu : function (e) {
        //window.alert( e.target.id );
        let popup = e.target;
        //empty menu
        while (popup.lastChild) {
            popup.removeChild(popup.lastChild);
        }

        let accounts = tzcommon.getAccounts();
        if (accounts !== null) {
            //accounts is unordered, loop over keys
            let accountIDs = Object.keys(accounts).sort();

            for (let i=0; i<accountIDs.length; i++) {
                let newItem = document.createElement("menuitem");
                newItem.setAttribute("label", accounts[accountIDs[i]]);
                newItem.setAttribute("value", accountIDs[i]);
                newItem.setAttribute("disabled", tzcommon.getAccountSetting(accountIDs[i], "connected") == false);
                newItem.addEventListener("click", function () {tzcommon.requestSync(accountIDs[i]);}, false);
                popup.appendChild(newItem);
            }
            let newItem = document.createElement("menuseparator");
            popup.appendChild(newItem);
        }
        let newItem = document.createElement("menuitem");
        newItem.setAttribute("label", "sync all accounts");
        newItem.setAttribute("value", -1);
        newItem.addEventListener("click", function () {tzcommon.requestSync();}, false);
        popup.appendChild(newItem);
    },*/


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
                .addAddressBookListener(tzpush.addressbookListener, flags.directoryItemRemoved | flags.itemAdded | flags.directoryRemoved);
        },

        remove: function addressbookListener_remove () {
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
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

window.addEventListener("load", tzpush.onload, false);
