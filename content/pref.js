/* Copyright (c) 2012 Mark Nethersole
See the file LICENSE.txt for licensing information. */
"use strict";

Components.utils.import("chrome://tzpush/content/tzcommon.jsm");

var tzprefs = {

    onload: function () {
        tzcommon.checkDeviceId(); 
        this.loadSettings();
        this.updateLabels();
        this.updateConnectionState(false);
        this.addressbookListener.add();
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.addObserver(this.syncStatusObserver, "tzpush.syncStatus", false);
    },

    onunload: function () {
        this.addressbookListener.remove();
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.removeObserver(this.syncStatusObserver, "tzpush.syncStatus");
    },


    /* * *
    * Run through all defined TzPush settings and if there is a corresponding
    * field in the settings dialog, fill it with the stored value.
    */
    loadSettings: function () {
        let settings = tzcommon.charSettings.concat(tzcommon.intSettings);
        for (let i=0; i<settings.length;i++) {
            if (document.getElementById("tzprefs." + settings[i])) document.getElementById("tzprefs." + settings[i]).value = tzcommon.getSetting(settings[i]);
        }

        settings = tzcommon.boolSettings;
        for (let i=0; i<settings.length;i++) {
            if (document.getElementById("tzprefs." + settings[i])) {
                if(tzcommon.getSetting(settings[i])) document.getElementById("tzprefs." + settings[i]).checked = true;
                else document.getElementById("tzprefs." + settings[i]).checked = false;
            }
        }
    },


    /* * *
    * Run through all defined TzPush settings and if there is a corresponding
    * field in the settings dialog, store its current value.
    */
    saveSettings: function () {
        let settings = tzcommon.charSettings.concat(tzcommon.intSettings);
        for (let i=0; i<settings.length;i++) {
            if (document.getElementById("tzprefs." + settings[i])) tzcommon.setSetting(settings[i], document.getElementById("tzprefs." + settings[i]).value);
        }

        settings = tzcommon.boolSettings;
        for (let i=0; i<settings.length;i++) {
            if (document.getElementById("tzprefs." + settings[i])) {
                if (document.getElementById("tzprefs." + settings[i]).checked) tzcommon.setSetting(settings[i],true);
                else tzcommon.setSetting(settings[i],false);
            }
        }
    },


    /* * *
    * Some fields are not protected and can be changed even if the account is connected. Since we
    * do not have (want) another save button for these, they are saved upon change.
    */
    instantSaveSetting: function (field) {
        let setting = field.id.replace("tzprefs.","");
        tzcommon.setSetting(setting, field.value);
    },


    /* * *
    * The settings dialog has some static info labels, which needs to be updated
    * from time to time.
    */
    updateLabels: function () {
        //SyncTarget (print last error, if present)
        let lastError = tzcommon.getSetting("lastError");
        let target = tzcommon.getSyncTarget();

        if (lastError === "") {
            if (target.name === null) {
                document.getElementById('abname').value = tzcommon.getLocalizedMessage("not_syncronized");
            } else {
                document.getElementById('abname').value = target.name + " (" + target.uri + ")";
            }
        } else {
            document.getElementById('abname').value = tzcommon.getLocalizedMessage("error." + lastError);
        }

        //DeviceId
        document.getElementById('deviceId').value = tzcommon.getSetting("deviceId");

        //LastSyncTime is stored as string for historic reasons
        let LastSyncTime = parseInt(tzcommon.getSetting("LastSyncTime"));
        if (isNaN(LastSyncTime) || LastSyncTime == 0) {
            document.getElementById('LastSyncTime').value = "-";
        } else {
            let d = new Date(parseInt(LastSyncTime));
            document.getElementById('LastSyncTime').value = d.toString();
        }
    },

    
    /* * *
    * This function is executed, when the user hits the connect/disconnet button. On disconnect, all
    * sync targets are deleted and the settings can be changed again. On connect, the settings are
    * stored and a new sync is initiated.
    * This function can also be used to initialize the locked state of settings (toggle = false).
    */
    updateConnectionState: function (toggle) {
        let connected = tzcommon.getSetting("connected");
        if (toggle) {
            connected = !connected;
            tzcommon.setSetting("connected", connected);
            if (!connected) {
                //we are no longer connected, delete all sync targets
                tzcommon.removeBook(tzcommon.getSyncTarget().uri);
            } else {
                //we just connected, so save settings and init sync
                tzprefs.saveSettings();
                tzcommon.requestSync();
            }
        }
        
        if (connected) {
            document.getElementById('tzprefs.connectbtn').label = tzcommon.getLocalizedMessage("disconnect_account"); //we are connected and the option is to disconnect
        } else {
            document.getElementById('tzprefs.connectbtn').label = tzcommon.getLocalizedMessage("connect_account");
        }
        
        let protectedFields = ["accountname", "asversion", "host", "https", "user", "prov", "birthday", "seperator", "displayoverride"];
        for (let i=0; i<protectedFields.length;i++) {
            document.getElementById("tzprefs." + protectedFields[i]).disabled = connected;
        }
    },
    
    
    /* * *
    * Observer to catch syncs and to update the info labels.
    */
    syncStatusObserver: {
        observe: function (aSubject, aTopic, aData) {
            //aData is of the following type
            // <accountId>.<syncstate>
            let data = aData.split(".");
            let account = data[0];
            let state = data[1];

            switch (state) {

                case "error": // = alldone with error
                    //Disconnect on error TODO: Only on initial connection, not due to temp server errors
                    if (tzcommon.getSetting("connected")) tzprefs.updateConnectionState(true);
                case "alldone":
                    tzprefs.updateLabels();
                    break;

                default:
                    //use one of the labels to print sync status
                    document.getElementById('abname').value = tzcommon.getLocalizedMessage("syncstate." + state);
                    break;


/*               case "syncstate": //update button to inform user
                    if (tzcommon.getSyncState() == "alldone") {
                        document.getElementById("tzprefs.resyncbtn").disabled = false;
                        document.getElementById("tzprefs.resyncbtn").label = tzcommon.getLocalizedMessage("resync_from_scratch");
                    } else {
                        document.getElementById("tzprefs.resyncbtn").disabled = true;
                        document.getElementById("tzprefs.resyncbtn").label = "Busy: " + tzcommon.getLocalizedMessage(tzcommon.getSyncState());
                    } */
            }
        }
    },


    /* * *
    * Address book listener to catch if the synced address book (sync target) has been renamed,
    * created or deleted, so the corresponding labels can be updated.
    */
    addressbookListener: {

        onItemPropertyChanged: function addressbookListener_onItemPropertyChanged(aItem, aProperty, aOldValue, aNewValue) {
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                tzprefs.updateLabels();
            }
        },

        onItemRemoved: function addressbookListener_onItemRemoved (aParentDir, aItem) {
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                tzprefs.updateLabels();
            }
        },

        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                tzprefs.updateLabels();
            }
        },

        add: function addressbookListener_add () {
            if (Components.classes["@mozilla.org/abmanager;1"]) { // Thunderbird 3
                Components.classes["@mozilla.org/abmanager;1"]
                    .getService(Components.interfaces.nsIAbManager)
                    .addAddressBookListener(tzprefs.addressbookListener, Components.interfaces.nsIAbListener.all);
            } else { // Thunderbird 2
                Components.classes["@mozilla.org/addressbook/services/session;1"]
                    .getService(Components.interfaces.nsIAddrBookSession)
                    .addAddressBookListener(tzprefs.addressbookListener, Components.interfaces.nsIAbListener.all);
            }
        },

        remove: function addressbookListener_remove () {
            if (Components.classes["@mozilla.org/abmanager;1"]) // Thunderbird 3
                Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .removeAddressBookListener(tzprefs.addressbookListener);
            else // Thunderbird 2
                Components.classes["@mozilla.org/addressbook/services/session;1"]
                .getService(Components.interfaces.nsIAddrBookSession)
                .removeAddressBookListener(tzprefs.addressbookListener);
        }
    },

    
    cape: function () {
        function openTBtab(tempURL) {
            var tabmail = null;
            var mail3PaneWindow =
                Components.classes["@mozilla.org/appshell/window-mediator;1"]
                .getService(Components.interfaces.nsIWindowMediator)
                .getMostRecentWindow("mail:3pane");
            if (mail3PaneWindow) {
                tabmail = mail3PaneWindow.document.getElementById("tabmail");
                mail3PaneWindow.focus();
                tabmail.openTab("contentTab", {
                    contentPage: tempURL
                });
            }
            return (tabmail != null);
        }

        openTBtab("http://www.c-a-p-e.co.uk");
    },

    notes: function () {
        function openTBtab(tempURL) {
            var tabmail = null;
            var mail3PaneWindow =
                Components.classes["@mozilla.org/appshell/window-mediator;1"]
                .getService(Components.interfaces.nsIWindowMediator)
                .getMostRecentWindow("mail:3pane");
            if (mail3PaneWindow) {
                tabmail = mail3PaneWindow.document.getElementById("tabmail");
                mail3PaneWindow.focus();
                tabmail.openTab("contentTab", {
                    contentPage: tempURL
                });
            }
            return (tabmail != null);
        }

        openTBtab("chrome://tzpush/content/notes.html");
    },

};
