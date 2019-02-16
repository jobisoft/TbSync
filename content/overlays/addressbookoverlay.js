/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

tbSync.onInjectIntoAddressbook = function (window) {
    if (window.document.getElementById("abResultsTree")) {
        window.document.getElementById("abResultsTree").addEventListener("select", tbSync.onAbResultsPaneSelectionChanged, false);
        window.document.getElementById("abResultsTree").addEventListener("focus", tbSync.onAbResultsPaneSelectionChanged, false);
        tbSync.onAbResultsPaneSelectionChanged();
    }
    
    //hook into getProperties of abDirTreeItem to inject our own icons for the address books
    if (!window.abDirTreeItem.prototype.hasOwnProperty("_origBeforeTbSyncGetProperties")) {
        window.abDirTreeItem.prototype._origBeforeTbSyncGetProperties = window.abDirTreeItem.prototype.getProperties;
        window.abDirTreeItem.prototype.getProperties = function () {
            //get original properties
            let properties = this._origBeforeTbSyncGetProperties().split(" ");
            
            let type = "";
            if (!this._directory.isMailList && !this._directory.isRemote) {
                try {
                    type = this._directory.getStringValue("tbSyncIcon", "");
                } catch (e) {}
            }
            
            if (type) properties.push(type);
            return properties.join(" ");
        }
    }
}

tbSync.onRemoveFromAddressbook = function (window) {
    if (window.document.getElementById("abResultsTree")) {
        window.document.getElementById("abResultsTree").removeEventListener("select", tbSync.onAbResultsPaneSelectionChanged, false);
        window.document.getElementById("abResultsTree").removeEventListener("focus", tbSync.onAbResultsPaneSelectionChanged, false);
    }
    //remove our injection
    window.abDirTreeItem.prototype.getProperties = window.abDirTreeItem.prototype._origBeforeTbSyncGetProperties;
    delete window.abDirTreeItem.prototype._origBeforeTbSyncGetProperties;
}

tbSync.onAbResultsPaneSelectionChanged = function () {
    //hide all extra fields of all providers
    let container = window.document.getElementsByClassName("tbsyncContainer");
    for (let i=0; i < container.length; i++) {
        container[i].collapsed = true;
    }

    //unhide all default elements, which have been hidden by some provider
    //provider must add class "tbsyncHidden" to the elements it is hiding
    let hiddenElements = window.document.getElementsByClassName("tbsyncHidden");
    for (let i=hiddenElements.length-1; i >= 0 ; i--) {
        if (hiddenElements[i]) {
            hiddenElements[i].collapsed = false;
            let classArr = hiddenElements[i].getAttribute("class").split(" ").filter(e => e != "tbsyncHidden");
            hiddenElements[i].setAttribute("class", classArr.join(" "));
        }                
    }    
    
    let cards = window.GetSelectedAbCards();
    if (cards.length == 1) {
        let aParentDirURI = window.GetSelectedDirectory();
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        let selectedBook = abManager.getDirectory(aParentDirURI);
        if (selectedBook.isMailList) {
            aParentDirURI = aParentDirURI.substring(0, aParentDirURI.lastIndexOf("/"));
        }

        if (aParentDirURI) { //could be undefined
            let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
            if (folders.length == 1) {
                let cardProvider = tbSync.db.getAccountSetting(folders[0].account, "provider");
                if (tbSync[cardProvider].onAbResultsPaneSelectionChanged) {
                    tbSync[cardProvider].onAbResultsPaneSelectionChanged(window, cards[0]);
                }
            }
        }
    }
}