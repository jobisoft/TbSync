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

tbSync.onInjectIntoCardEditWindow = function (window) {
    if (window.location.href=="chrome://messenger/content/addressbook/abNewCardDialog.xul") {
        //add handler for ab switching    
        tbSync.onAbSelectChangeNewCard(window);
        window.document.getElementById("abPopup").addEventListener("select", function () {tbSync.onAbSelectChangeNewCard(window);}, false);
        RegisterSaveListener(tbSync.onSaveCard);
    
    } else {
        window.RegisterLoadListener(tbSync.onLoadCard);
        window.RegisterSaveListener(tbSync.onSaveCard);

        //if this window was open during inject, load the extra fields
        if (gEditCard) tbSync.onLoadCard(gEditCard.card, window.document);
    }
}

tbSync.onAbSelectChangeNewCard = function(window) {
    let folders = tbSync.db.findFoldersWithSetting("target", window.document.getElementById("abPopup").value);
    let cardProvider = "";
    if (folders.length == 1) {
        cardProvider = tbSync.db.getAccountSetting(folders[0].account, "provider");
    }

    //loop over all providers and show/hide container fields
    for (let provider in tbSync.providerList) {
        if (tbSync.providerList[provider].enabled) {
            let items = window.document.getElementsByClassName(provider + "Container");
            for (let i=0; i < items.length; i++) {
                items[i].hidden = (cardProvider != provider);
            }
            //call custom function to do additional tasks
            if (tbSync[provider].onAbCardLoad) tbSync[provider].onAbCardLoad(window.document, cardProvider == provider);
        }
    }            
}

tbSync.onLoadCard = function (aCard, aDocument) {
    let aParentDirURI = tbSync.getUriFromPrefId(aCard.directoryId.split("&")[0]);
    let cardProvider = "";
    if (aParentDirURI) { //could be undefined
        let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
        if (folders.length == 1) {
            cardProvider = tbSync.db.getAccountSetting(folders[0].account, "provider");
        }
    }
    
    let items = aDocument.getElementsByClassName(cardProvider + "Property");
    for (let i=0; i < items.length; i++) {
        items[i].value = aCard.getProperty(items[i].id, "");
    }

    //loop over all providers and show/hide container fields
    for (let provider in tbSync.providerList) {
        if (tbSync.providerList[provider].enabled) {
            let container = aDocument.getElementsByClassName(provider + "Container");
            for (let i=0; i < container.length; i++) {
                container[i].hidden = (cardProvider != provider);
            }
            //call custom function to do additional tasks
            if (tbSync[provider].onAbCardLoad) tbSync[provider].onAbCardLoad(aDocument, cardProvider == provider);
        }
    }          
}


tbSync.onSaveCard = function (aCard, aDocument) {
    let aParentDirURI = tbSync.getUriFromPrefId(aCard.directoryId.split("&")[0]);
    let cardProvider = "";
    if (aParentDirURI) { //could be undefined
        let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
        if (folders.length == 1) {
            cardProvider = tbSync.db.getAccountSetting(folders[0].account, "provider");
        }
    }

    let items = aDocument.getElementsByClassName(cardProvider + "Property");
    for (let i=0; i < items.length; i++) {
        aCard.setProperty(items[i].id, items[i].value);
    }
}
