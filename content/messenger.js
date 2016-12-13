/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */  
"use strict";

Components.utils.import("chrome://tzpush/content/tzcommon.jsm");
Components.utils.import("chrome://tzpush/content/tzsync.jsm");

var tzpush = {

    openPrefs: function () {
        window.open("chrome://tzpush/content/pref.xul", "", "chrome,centerscreen,resizable,toolbar", null, null);
    },


    /* * *
    * Observer to catch syncsRequests.
    */
    syncRequestObserver: {
        observe: function (aSubject, aTopic, aData) {
            switch (aData) {
                case "sync":
                    tzsync.sync(window);
                    break;
                case "resync":
                    tzsync.resync(window);
                    break;
            }
        }
    },


    /* * *
     * This preference observer is used to watch the syncstate and to update the status bar
     * and to actually trigger the sync. The two values "syncrequest" and "resyncrequest" will
     * be set by tzcommon.requestSync/requestResync() only if the current syncstate is alldone
     */
    prefObserver: {

        register: function () {
            tzcommon.prefs.addObserver("", this, false);
        },

        unregister: function () {
            tzcommon.prefs.removeObserver("", this);
        },

        observe: function (aSubject, aTopic, aData) {
            switch (aData) {
                case "syncstate": //update status bar to inform user
                    let status = document.getElementById("tzstatus");
                    if (status) status.label = "TzPush: " + tzcommon.getLocalizedMessage("syncstate." + tzcommon.getSyncState());
                    tzcommon.dump("syncstate", tzcommon.getLocalizedMessage("syncstate." + tzcommon.getSyncState()));
            }
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
            let abname = tzcommon.getSetting("abname");
            if (aItem instanceof Components.interfaces.nsIAbCard && abname !== "" && aParentDir instanceof Components.interfaces.nsIAbDirectory && aParentDir.URI === abname) {
                let deleted = aItem.getProperty("ServerId", "");
                if (deleted) tzcommon.addCardToDeleteLog(deleted);
            }

            /* * *
             * If the entire book we are currently syncing is deleted, remove it from sync and
             * clean up delete log
             */
            if (aItem instanceof Components.interfaces.nsIAbDirectory && abname !== "" && aItem.URI === tzcommon.getSetting("abname")) {
                tzcommon.setSetting("abname","");

                tzcommon.setSetting("polkey", "0"); //- this is identical to tzsync.resync() without the actual sync
                tzcommon.setSetting("folderID", "");
                tzcommon.setSetting("synckey", ""); 
                tzcommon.setSetting("LastSyncTime", "0");

                tzcommon.clearDeleteLog();
            }
        },

        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {
            if (aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            }

            /* * *
             * If a card is added to a book, but not to the one we are syncing, and that card has a
             * ServerId, remove that ServerId from the first card found in that book
             * (Why not directly from the card? TODO)
             * This cleans up cards, that get moved from an EAS book to a standard book.
             */
            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory && aParentDir.URI !== tzcommon.getSetting("abname")) {
                let ServerId = aItem.getProperty("ServerId", "");
                if (ServerId !== "") tzcommon.removeSId(aParentDir, ServerId);
            }    
                
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
            this.timer.initWithCallback(this.event, 10000, 3); //run timer every 10s
        },

        event: {
            notify: function (timer) {
                let prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush.");
                //prepared for multi account mode, simply ask every account
                let syncInterval = tzcommon.getSetting("autosync") * 60 * 1000;

                if ((syncInterval > 0) && ((Date.now() - getSetting("LastSyncTime")) > syncInterval)) {
                    tzcommon.requestSync();
                }
            }
        }
    }
};

tzpush.syncTimer.start();
tzpush.prefObserver.register();

let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
observerService.addObserver(tzpush.syncRequestObserver, "tzpush.syncRequest", false);

tzpush.addressbookListener.add();
tzcommon.resetSync();
