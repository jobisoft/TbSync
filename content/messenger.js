/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */  
"use strict";

Components.utils.import("chrome://tzpush/content/tzcommon.jsm");
Components.utils.import("chrome://tzpush/content/tzsync.jsm");

var tzpush = {

    openPrefs: function () {
        window.open("chrome://tzpush/content/pref.xul", "", "chrome,centerscreen,resizable,toolbar", null, null);
    },

    // XUL does not know about tzcommon, so here are some simple wrapper
    requestSync: function () { return tzcommon.requestSync(); },
    requestReSync: function () { return tzcommon.requestReSync(); },
    resetSync: function () { return tzcommon.resetSync(); },

    // Everytime a preference is changed, this observer is called. It is used to manage sync processes.
    prefObserver : {

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
                    if (status) status.label = "TzPush is: " + tzcommon.getLocalizedMessage(tzcommon.prefs.getCharPref("syncstate"));
                    tzcommon.dump("status", tzcommon.getLocalizedMessage(tzcommon.prefs.getCharPref("syncstate")));

                    switch (tzcommon.prefs.getCharPref("syncstate")) {
                        case "syncrequest":
                            tzsync.sync(window);
                            break;
                        case "resyncrequest":
                            tzsync.resync(window);
                            break;
                    }
            }
        }
    },

    

    addressbookListener : {

        // If a card is removed from the addressbook we are syncing, keep track of the deletions and log them to a file in the profile folder
        onItemRemoved: function addressbookListener_onItemRemoved (aParentDir, aItem) {
            if (aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            }

            let abname = tzcommon.prefs.getCharPref("abname");
            if (aItem instanceof Components.interfaces.nsIAbCard && abname !== "" && aParentDir instanceof Components.interfaces.nsIAbDirectory && aParentDir.URI === abname) {
                let deleted = aItem.getProperty("ServerId", "");
                if (deleted) tzcommon.addCardToDeleteLog(deleted);
            }

            // if the book we are currently syncing is deleted, remove it from sync and clean up delete log
            if (aItem instanceof Components.interfaces.nsIAbDirectory && abname !== "" && aItem.URI === tzcommon.prefs.getCharPref("abname")) {
                tzcommon.prefs.setCharPref("abname","");

                tzcommon.prefs.setCharPref("polkey", "0"); //- this is identical to tzsync.resync() without the actual sync
                tzcommon.prefs.setCharPref("folderID", "");
                tzcommon.prefs.setCharPref("synckey", ""); 
                tzcommon.prefs.setCharPref("LastSyncTime", "0");

                /* Cleanup of cards marked for deletion */
                /*  - the file "DeletedCards" inside the ZPush folder in the users profile folder contains a list of ids of deleted cards, which still need to be deleted from server */
                /*  - after a reset, no further action should be pending  -> clear that log! */
                tzcommon.clearDeleteLog();
            }
        },

        // If a card is added to a book, but not to the one we are syncing, and that card has a ServerId, remove that ServerId from the first card found in that book - Why not directly from the card? TODO
        // This should clean up cards, that get moved from an EAS book to a standard book
        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {
            if (aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            }

            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory && aParentDir.URI !== tzcommon.prefs.getCharPref("abname")) {
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

    

    syncTimer : {
        timer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

        start: function () {
            this.timer.cancel();
            this.timer.initWithCallback(this.event, 10000, 3); //run timer every 10s
        },

        event: {
            notify: function (timer) {
                let prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush.");
                //prepared for multi account mode, simply ask every account
                let syncInterval = tzcommon.prefs.getIntPref("autosync") * 60 * 1000;

                if ((syncInterval > 0) && ((Date.now() - prefs.getCharPref("LastSyncTime")) > syncInterval)) {
                    tzpush.requestSync();
                }
            }
        }
    }
};

tzpush.syncTimer.start();
tzpush.prefObserver.register();
tzpush.addressbookListener.add();
tzcommon.resetSync(true);
