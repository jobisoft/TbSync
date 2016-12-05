/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */
"use strict";

Components.utils.import("chrome://tzpush/content/tzcommon.jsm");

var tzprefs = {

    onopen: function () {
        //Check, if a new deviceID needs to be generated
        if (tzcommon.prefs.getCharPref("deviceId") === "") tzcommon.prefs.setCharPref("deviceId", Date.now());
        this.localAbs();
    },

    onclose: function () {
    },

    localAbs: function () {
        //clear list of address books
        let count = -1;
        while (document.getElementById('localContactsFolder').children.length > 0) {
            document.getElementById('localContactsFolder').removeChild(document.getElementById('localContactsFolder').firstChild);
        }

        //fill list of address books - ignore LDAP, Mailinglists and history
        let selected = -1;
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        let allAddressBooks = abManager.directories;
        while (allAddressBooks.hasMoreElements()) {
            let addressBook = allAddressBooks.getNext();
            if (addressBook instanceof Components.interfaces.nsIAbDirectory && !addressBook.isRemote && !addressBook.isMailList && addressBook.fileName !== 'history.mab') {
                var ab = document.createElement('listitem');
                ab.setAttribute('label', addressBook.dirName);
                ab.setAttribute('value', addressBook.URI);
                count = count + 1;

                //is this book the selected one? TODO! This will check for the FILENAME, not the ID (delete book #3, create a new one -> the new one is selected!
                if (tzcommon.prefs.getCharPref('abname') === addressBook.URI) {
                    selected = count;
                }
                document.getElementById('localContactsFolder').appendChild(ab);
            }
        }

        if (selected !== -1) document.getElementById('localContactsFolder').selectedIndex = selected;
    },

    reset: function () {
        tzcommon.prefs.setCharPref("polkey", "0");
        tzcommon.prefs.setCharPref("folderID", "");
        tzcommon.prefs.setCharPref("synckey", "");
        tzcommon.prefs.setCharPref("deviceId", Date.now());
        tzcommon.prefs.setIntPref("autosync", 0);
        tzcommon.prefs.setCharPref("LastSyncTime", "0");

        /* Clear ServerId and LastModDate of all cards in addressbook selected for sync - WHY ??? */
        var abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        var addressBook = abManager.getDirectory(tzcommon.prefs.getCharPref("abname"));
        var cards = addressBook.childCards;
        while (cards.hasMoreElements()) {
            let card = cards.getNext();
            if (card instanceof Components.interfaces.nsIAbCard) {
                card.setProperty('ServerId', '');
                card.setProperty("LastModifiedDate", '');
                addressBook.modifyCard(card);
            }
        }

        /* Cleanup of cards marked for deletion */
        /*  - the file "DeletedCards" inside the ZPush folder in the users profile folder contains a list of ids of deleted cards, which still need to be deleted from server */
        /*  - after a reset, no further action should be pending  -> clear that log! */
        tzcommon.clearDeleteLog();
    },

    softreset: function () {
        tzcommon.prefs.setCharPref("go", "resync");
    },

    requestSync: function () {
        tzcommon.prefs.setCharPref("go", "sync");
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

    setselect: function (value) {
        tzcommon.prefs.setCharPref('abname', value);
    }

};
