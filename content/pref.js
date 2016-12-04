/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */
"use strict";

Components.utils.import("chrome://tzpush/content/tools.jsm");

if (typeof tzpush === "undefined") {
    var tzpush = {};
}

var tzpush = {
    prefs: Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush."),

    onopen: function() {
        //Check, if a new deviceID needs to be generated
        if (this.prefs.getCharPref("deviceId") === "") this.prefs.setCharPref("deviceId", Date.now());
        this.localAbs();
    },

    onclose: function() {
    },

    localAbs: function() {
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
                if (this.prefs.getCharPref('abname') === addressBook.URI) {
                    selected = count;
                }
                document.getElementById('localContactsFolder').appendChild(ab);
            }
        }

        if (selected !== -1) document.getElementById('localContactsFolder').selectedIndex = selected;
    },

    reset: function() {
        this.prefs.setCharPref("polkey", "0");
        this.prefs.setCharPref("folderID", "");
        this.prefs.setCharPref("synckey", "");
        this.prefs.setCharPref("deviceId", Date.now());
        this.prefs.setIntPref("autosync", 0);
        this.prefs.setCharPref("LastSyncTime", "0");

        /* Clear ServerId and LastModDate of all cards in addressbook selected for sync - WHY ??? */
        var abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        var addressBook = abManager.getDirectory(this.prefs.getCharPref("abname"));
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
        tztools.clearDeleteLog();
    },

    softreset: function() {
        this.prefs.setCharPref("go", "resync");
    },

    toggelgo: function() {
        if (this.prefs.getCharPref("go") === "0") {
            this.prefs.setCharPref("go", "1");
        } else {
            this.prefs.setCharPref("go", "0");
        }
    }, 

    cape: function() {
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

    notes: function() {
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

    setselect: function(value) {
        this.prefs.setCharPref('abname', value);
    }

};
