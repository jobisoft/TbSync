/*
 * This file is part of TbSync.
 *
 * TbSync is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * TbSync is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with TbSync. If not, see <https://www.gnu.org/licenses/>.
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