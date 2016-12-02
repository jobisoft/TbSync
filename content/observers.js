/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */  
"use strict";

if (typeof tzpush === "undefined") {
    var tzpush = {};
}

// Everytime a preference is changed, this observer is called.
tzpush.myPrefObserver = {
        prefs: Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush."),

        register: function() {
            this.prefs.addObserver("", this, false);
        },

        unregister: function() {
            this.prefs.removeObserver("", this);
        },

        observe: function(aSubject, aTopic, aData) {
            switch (aData) {
                case "syncstate": //update status bar to inform user
                    let status = document.getElementById("tzstatus");
                    if (status) status.label = "TzPush is: " + this.prefs.getCharPref("syncstate");
                    break;
/*                case "autosync": not needed anymore: timer runs every 10 sec and checks for each account, if lastsync is older than autosync and executes sync if needed, no need to update timer on pref changes
                    tzpush.Timer.auto();
                    break; */
/*                case "selectseperator":
                    tzpush.changesep();
                    break; */
                case "go":
                    switch (tzpush.prefs.getCharPref("go")) {
                        case "0":
                        case "1":
                            tzpush.checkgo();
                            break;
                        case "resync":
                            tzpush.prefs.setCharPref("polkey", "0");
                            tzpush.prefs.setCharPref("folderID", "");
                            tzpush.prefs.setCharPref("synckey", "");
                            tzpush.prefs.setCharPref("LastSyncTime", "0");
                            if (tzpush.prefs.getCharPref("syncstate") === "alldone") {
                                tzpush.prefs.setCharPref("go", "firstsync");
                            }
                            break;
                        case "firstsync":
                            tzpush.go();
                            break;
                        case "alldone":
                            tzpush.prefs.setCharPref("LastSyncTime", Date.now());
                            break;
                    }
            }
        }
};




tzpush.AbListener = {

        // If a card is removed from the addressbook we are syncing, keep track of the deletions and log them to a file in the profile folder
        onItemRemoved: function AbListener_onItemRemoved(aParentDir, aItem) {
            aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);

            if (aParentDir.URI === tzpush.prefs.getCharPref("abname")) {
                if (aItem instanceof Components.interfaces.nsIAbCard) {
                    let deleted = aItem.getProperty("ServerId", "").replace(":", "COLON"); // So the ServerId can be used as a filename...

                    Components.utils.import("resource://gre/modules/FileUtils.jsm");
                    // Create directory "DeletedCards" in profile folder and later get file inside that folder with name $deleted
                    FileUtils.getDir("ProfD", ["DeletedCards"], true);
                    let file = FileUtils.getFile("ProfD", ["DeletedCards"]);
                    file.append(deleted);
                    // Create file, but do not add any content - just "log" deletion
                    file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, FileUtils.PERMS_FILE);
                }
            }
        },

        // If a card is added to a book, but not to the one we are syncing, and that card has a ServerId, remove that ServerId from the first card found in that book - Does not look too right (TODO)
        onItemAdded: function AbListener_onItemAdded(aParentDir, aItem) {
            function removeSId(aParent, ServerId) {
                let acard = aParentDir.getCardFromProperty("ServerId", ServerId, false);
                if (acard instanceof Components.interfaces.nsIAbCard) {
                    acard.setProperty("ServerId", "");
                    aParentDir.modifyCard(acard);
                }
            }
            let ServerId = "";
            aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            if (aParentDir.URI !== tzpush.prefs.getCharPref("abname")) {

                if (aItem instanceof Components.interfaces.nsIAbCard) {
                    ServerId = aItem.getProperty("ServerId", "");
                    if (ServerId !== "") {
                        removeSId(aParentDir, ServerId);
                    }
                }

            }
        },

        add: function AbListener_add() {
            var flags;
            var flags1;
            if (Components.classes["@mozilla.org/abmanager;1"]) { // Thunderbird 3
                flags = Components.interfaces.nsIAbListener.directoryItemRemoved;
                flags1 = Components.interfaces.nsIAbListener.itemAdded;
                Components.classes["@mozilla.org/abmanager;1"]
                    .getService(Components.interfaces.nsIAbManager)
                    .addAddressBookListener(tzpush.AbListener, flags | flags1);
            } else { // Thunderbird 2
                flags = Components.interfaces.nsIAddrBookSession.directoryItemRemoved;
                Components.classes["@mozilla.org/addressbook/services/session;1"]
                    .getService(Components.interfaces.nsIAddrBookSession)
                    .addAddressBookListener(tzpush.AbListener, flags);
            }
        },

        remove: function AbListener_remove() {
            if (Components.classes["@mozilla.org/abmanager;1"]) // Thunderbird 3
                Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .removeAddressBookListener(tzpush.AbListener);
            else // Thunderbird 2
                Components.classes["@mozilla.org/addressbook/services/session;1"]
                .getService(Components.interfaces.nsIAddrBookSession)
                .removeAddressBookListener(tzpush.AbListener);
        }
};




tzpush.Timer = {
    timer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

    start: function() {
        this.timer.cancel();
        tzpush.prefs.setCharPref("syncstate", "alldone");
        tzpush.prefs.setCharPref("LastSyncTime", "0");
        this.timer.initWithCallback(this.event, 10000, 3); //run timer every 10s
    },

    event: {
        notify: function(timer) {
            let prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush.");
            //prepared for multi account mode, simply ask every account
            let syncInterval = tzpush.prefs.getIntPref("autosync") * 60 * 1000;

            if ((syncInterval > 0) && ((Date.now() - prefs.getCharPref("LastSyncTime")) > syncInterval)) {
                tzpush.checkgo();
            }
        }
    }
};


tzpush.Timer.start();
tzpush.myPrefObserver.register();
tzpush.AbListener.add();