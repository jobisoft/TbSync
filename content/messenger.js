/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */  
"use strict";

Components.utils.import("chrome://tzpush/content/tzcommon.jsm");
Components.utils.import("chrome://tzpush/content/tzsync.jsm");

var tzpush = {

    openPrefs: function () {
        window.open("chrome://tzpush/content/pref.xul", "", "chrome,centerscreen,resizable,toolbar", null, null);
    },

    
    
    requestSync: function () {
        if (tzcommon.prefs.getCharPref("syncstate") === "alldone")
            tzsync.go();
    },
    
    
    
    // If there has been an error during sync and TZPush is not returning to "alldone", one can enforce it
    resetStatus: function () {
        tzcommon.prefs.setCharPref("syncstate", "alldone");
    },
   
    
    
    // Everytime a preference is changed, this observer is called.
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
                    if (status) status.label = "TzPush is: " + tzcommon.prefs.getCharPref("syncstate");
                    break;
                case "go":
                    switch (tzcommon.prefs.getCharPref("go")) {
                        case "sync":
                            tzpush.requestSync();
                            break;
                        case "resync":
                            tzcommon.prefs.setCharPref("polkey", "0");
                            tzcommon.prefs.setCharPref("folderID", "");
                            tzcommon.prefs.setCharPref("synckey", "");
                            tzcommon.prefs.setCharPref("LastSyncTime", "0");
                            if (tzcommon.prefs.getCharPref("syncstate") === "alldone") { // if firstsync is something special, it should not be optional
                                tzcommon.prefs.setCharPref("go", "firstsync");
                            }
                            break;
                        case "firstsync": //Get rid of firstsync and just call requestSync in "resync"
                            tzsync.go();  //need to get rid of firstsync in tzsync.jsm
                            break;
                        case "alldone":
                            tzcommon.prefs.setCharPref("LastSyncTime", Date.now());
                            break;
                    }
            }
        }
    },

    

    addressbookListener : {

        // If a card is removed from the addressbook we are syncing, keep track of the deletions and log them to a file in the profile folder
        onItemRemoved: function addressbookListener_onItemRemoved (aParentDir, aItem) {
            aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);

            if (aParentDir.URI === tzcommon.prefs.getCharPref("abname")) {
                if (aItem instanceof Components.interfaces.nsIAbCard) {
                    let deleted = aItem.getProperty("ServerId", "");

                    if (deleted) {
                        tzcommon.addCardToDeleteLog(deleted);
                    }
                }
            }
        },

        // If a card is added to a book, but not to the one we are syncing, and that card has a ServerId, remove that ServerId from the first card found in that book - Does not look too right (TODO)
        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {
            function removeSId(aParent, ServerId) {
                let acard = aParentDir.getCardFromProperty("ServerId", ServerId, false);
                if (acard instanceof Components.interfaces.nsIAbCard) {
                    acard.setProperty("ServerId", "");
                    aParentDir.modifyCard(acard);
                }
            }
            let ServerId = "";
            aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            if (aParentDir.URI !== tzcommon.prefs.getCharPref("abname")) { //MÖP - do not assume, delete item is a card, it could also be a book!

                if (aItem instanceof Components.interfaces.nsIAbCard) {
                    ServerId = aItem.getProperty("ServerId", "");
                    if (ServerId !== "") {
                        removeSId(aParentDir, ServerId);
                    }
                }

            }
        },

        add: function addressbookListener_add () {
            var flags;
            var flags1;
            if (Components.classes["@mozilla.org/abmanager;1"]) { // Thunderbird 3
                flags = Components.interfaces.nsIAbListener.directoryItemRemoved;
                flags1 = Components.interfaces.nsIAbListener.itemAdded;
                Components.classes["@mozilla.org/abmanager;1"]
                    .getService(Components.interfaces.nsIAbManager)
                    .addAddressBookListener(tzpush.addressbookListener, flags | flags1);
            } else { // Thunderbird 2
                flags = Components.interfaces.nsIAddrBookSession.directoryItemRemoved;
                Components.classes["@mozilla.org/addressbook/services/session;1"]
                    .getService(Components.interfaces.nsIAddrBookSession)
                    .addAddressBookListener(tzpush.addressbookListener, flags);
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
            tzcommon.prefs.setCharPref("syncstate", "alldone");
            tzcommon.prefs.setCharPref("LastSyncTime", "0");
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
