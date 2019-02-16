/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAbCardWindow = {

    onInject: function (window) {
        if (window.location.href=="chrome://messenger/content/addressbook/abNewCardDialog.xul") {
            //add handler for ab switching    
            tbSyncAbCardWindow.onAbSelectChangeNewCard(window);
            window.document.getElementById("abPopup").addEventListener("select", function () {tbSyncAbCardWindow.onAbSelectChangeNewCard(window);}, false);
            RegisterSaveListener(tbSyncAbCardWindow.onSaveCard);
        
        } else {
            window.RegisterLoadListener(tbSyncAbCardWindow.onLoadCard);
            window.RegisterSaveListener(tbSyncAbCardWindow.onSaveCard);

            //if this window was open during inject, load the extra fields
            if (gEditCard) tbSyncAbCardWindow.onLoadCard(gEditCard.card, window.document);
        }
    },

    onAbSelectChangeNewCard: function (window) {
        let folders = tbSync.db.findFoldersWithSetting("target", window.document.getElementById("abPopup").value);
        let cardProvider = "";
        if (folders.length == 1) {
            cardProvider = tbSync.db.getAccountSetting(folders[0].account, "provider");
        }

        //loop over all tbsync providers and show/hide container fields
        //we need to execute this even if this is not a tbsync book, because the last book
        //could have been a tbsync book and we thus need to remove our UI elements
        for (let provider in tbSync.loadedProviders) {
            let items = window.document.getElementsByClassName(provider + "Container");
            for (let i=0; i < items.length; i++) {
                items[i].collapsed = (cardProvider != provider);
            }

            if (provider != cardProvider) {
                //if the current view has default elements hidded by the provider, which was loaded last, restore that
                let hiddenItems = window.document.getElementsByClassName(provider + "Hidden");
                //this is a live collection!
                for (let i=hiddenItems.length-1; i >= 0 ; i--) {
                    if (hiddenItems[i]) {
                        hiddenItems[i].collapsed = false;
                        let classArr = hiddenItems[i].getAttribute("class").split(" ").filter(e => e != provider + "Hidden");
                        hiddenItems[i].setAttribute("class", classArr.join(" "));
                    }                
                }
                
                //if the current view has default elements disabled by the provider, which was loaded last, restore that
                let disabledItems = window.document.getElementsByClassName(provider + "Disabled");
                //this is a live collection!
                for (let i=disabledItems.length-1; i >= 0 ; i--) {
                    if (disabledItems[i]) {
                        disabledItems[i].disabled = false;
                        let classArr = disabledItems[i].getAttribute("class").split(" ").filter(e => e != provider + "Disabled");
                        disabledItems[i].setAttribute("class", classArr.join(" "));
                    }
                }
            }
        }
        
        //call custom function to do additional tasks
        if (cardProvider && tbSync[cardProvider].onAbCardLoad) tbSync[cardProvider].onAbCardLoad(window.document);
    },
    
    getSelectedAbFromArgument: function (arg) {
        let abURI = "";
        if (arg.hasOwnProperty("abURI")) {
            abURI = arg.abURI;
        } else if (arg.hasOwnProperty("selectedAB")) {
            abURI = arg.selectedAB;
        }
        
        if (abURI) {
            let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
            let ab = abManager.getDirectory(abURI);
            if (ab.isMailList) {
                let parts = abURI.split("/");
                parts.pop();
                return parts.join("/");
            }
        }
        return abURI;
    },   
    
    onLoadCard: function (aCard, aDocument) {
        let aParentDirURI = tbSyncAbCardWindow.getSelectedAbFromArgument(aDocument.defaultView.arguments[0]);

        let cardProvider = "";
        if (aParentDirURI) { //could be undefined
            let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
            if (folders.length == 1) {
                cardProvider = tbSync.db.getAccountSetting(folders[0].account, "provider");
            }
        }
        
        //onLoadCard is only executed for the editDialog and thus we do not need to run over all providers
        if (cardProvider) {
            //Load fields
            let items = aDocument.getElementsByClassName(cardProvider + "Property");
            for (let i=0; i < items.length; i++) {
                items[i].value = aCard.getProperty(items[i].id, "");
            }

            //show extra provider UI elements
            let container = aDocument.getElementsByClassName(cardProvider + "Container");
            for (let i=0; i < container.length; i++) {
                container[i].collapsed = false;
            }

            //call custom function to do additional tasks
            if (tbSync[cardProvider].onAbCardLoad) tbSync[cardProvider].onAbCardLoad(aDocument, aCard);
        }  
    },
    
    onSaveCard: function (aCard, aDocument) {
        let aParentDirURI = tbSyncAbCardWindow.getSelectedAbFromArgument(aDocument.defaultView.arguments[0]);
        
        let cardProvider = "";
        if (aParentDirURI) { //could be undefined
            let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
            if (folders.length == 1) {
                cardProvider = tbSync.db.getAccountSetting(folders[0].account, "provider");
            }
        }

        if (cardProvider) {
            let items = aDocument.getElementsByClassName(cardProvider + "Property");
            for (let i=0; i < items.length; i++) {
                aCard.setProperty(items[i].id, items[i].value);
            }
        }
    }
    
}
