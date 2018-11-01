/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

tbSync.onInjectIntoAddressbook = function (window) {
    if (window.document.getElementById("abResultsTree")) {
    window.document.getElementById("abResultsTree").addEventListener("select", tbSync.onAbResultsPaneSelectionChanged, false);
        tbSync.onAbResultsPaneSelectionChanged();
    }    
}

tbSync.onRemoveFromAddressbook = function (window) {
    if (window.document.getElementById("abResultsTree")) {
    window.document.getElementById("abResultsTree").removeEventListener("select", tbSync.onAbResultsPaneSelectionChanged, false);
    }
}

tbSync.onAbResultsPaneSelectionChanged = function () {
    //hide all extra fields of all providers
    for (let provider in tbSync.providerList) {
        if (tbSync.providerList[provider].enabled) {
            let container = window.document.getElementsByClassName(provider + "Container");
            for (let i=0; i < container.length; i++) {
                container[i].hidden = true;
            }
        }
    }
    
    let cards = window.GetSelectedAbCards();
    if (cards.length == 1) {
        let aParentDirURI = tbSync.getUriFromPrefId(cards[0].directoryId.split("&")[0]);
        if (aParentDirURI) { //could be undefined
            let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
            if (folders.length == 1) {
                let provider = tbSync.db.getAccountSetting(folders[0].account, "provider");
                if (tbSync[provider].onAbResultsPaneSelectionChanged) {
                    tbSync[provider].onAbResultsPaneSelectionChanged(window, cards[0]);
                }
            }
        }
    }
}