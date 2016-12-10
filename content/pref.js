/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */
"use strict";

Components.utils.import("chrome://tzpush/content/tzcommon.jsm");
/*

 To reset a sync (current reset button) the user must delete the connected book/calender
 Options cannot be changed whenn connected. diaconnecting will delete all synctargets
 selecting/deselecting books for sync should be possible
 
 */
 
var tzprefs = {

    onload: function () {
        tzcommon.checkDeviceId(); 
        this.updateTarget();
        this.updateDeviceId();
    },

    onclose: function () {
    },

    requestReSync: function () {
        tzcommon.prefs.setCharPref("go", "resync");
    },

    requestSync: function () {
        tzcommon.prefs.setCharPref("go", "sync");
    },

    updateTarget: function () {
        let target = tzcommon.getSyncTarget();
        if (target.name === null) {
            document.getElementById('abname').value = tzcommon.getLocalizedMessage("not_syncronized");
        } else {
            document.getElementById('abname').value = target.name + " (" + target.uri + ")";
        }
    },

    updateDeviceId: function () {
        document.getElementById('deviceId').value = tzcommon.prefs.getCharPref("deviceId");
    },

    // if syncTargets books are renamed/deleted in the addressbook while this pref window open, we need to update it
    prefObserver : {

        register: function () {
            tzcommon.prefs.addObserver("", this, false);
        },

        unregister: function () {
            tzcommon.prefs.removeObserver("", this);
        },

        observe: function (aSubject, aTopic, aData) {
            switch (aData) {
                case "abname": //update name of addressbook sync target
                    tzprefs.updateTarget();
                    break;
                case "deviceId": //update deviceId
                    tzprefs.updateDeviceId();
                    break;
            }
        }
    },

    // the only purpose of this listener is to be able to update the name of the synced addressbook, if it is changed in the address book, while the settings dialog is open
    addressbookListener : {

        onItemPropertyChanged: function addressbookListener_onItemPropertyChanged(aItem, aProperty, aOldValue, aNewValue) {
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                tzprefs.updateTarget();
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
                .removeAddressBookListener(tzpush.addressbookListener);
            else // Thunderbird 2
                Components.classes["@mozilla.org/addressbook/services/session;1"]
                .getService(Components.interfaces.nsIAddrBookSession)
                .removeAddressBookListener(tzpush.addressbookListener);
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

tzprefs.prefObserver.register();
tzprefs.addressbookListener.add();
