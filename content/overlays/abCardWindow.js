/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
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

    //loop over all tbsync providers and show/hide container fields
    //we need to execute this even if this is not a tbsync book, because the last book
    //could have been a tbsync book and we thus need to remove our UI elements
    for (let provider in tbSync.loadedProviders) {
        let items = window.document.getElementsByClassName(provider + "Container");
        for (let i=0; i < items.length; i++) {
            items[i].hidden = (cardProvider != provider);
        }

        //if the current view has default elements hidded by the provider, which was loaded last, restore that
        let hiddenItems = window.document.getElementsByClassName(provider + "Hidden");
        for (let i=0; i < hiddenItems.length; i++) {
            hiddenItems[i].hidden = false;
            let classArr = hiddenItems[i].getAttribute("class").split(" ").filter(e => e != provider + "Hidden");
            if (classArr.length > 0) hiddenItems[i].setAttribute("class", classArr.join(" "));
            else hiddenItems[i].removeAttribute("class");
        }
        
        //if the current view has default elements disabled by the provider, which was loaded last, restore that
        let disabledItems = window.document.getElementsByClassName(provider + "Disabled");
        for (let i=0; i < disabledItems.length; i++) {
            disabledItems[i].disabled = false;
            let classArr = disabledItems[i].getAttribute("class").split(" ").filter(e => e != provider + "Disabled");
            if (classArr.length > 0) disabledItems[i].setAttribute("class", classArr.join(" "));
            else disabledItems[i].removeAttribute("class");
        }
    }
    
    //call custom function to do additional tasks
    if (cardProvider && tbSync[cardProvider].onAbCardLoad) tbSync[cardProvider].onAbCardLoad(window.document);
}

tbSync.getSelectedAbFromArgument = function (arg) {
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

tbSync.onLoadCard = function (aCard, aDocument) {
    let aParentDirURI = tbSync.getSelectedAbFromArgument(window.arguments[0]);

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
            container[i].hidden = false;
        }

        //call custom function to do additional tasks
        if (tbSync[cardProvider].onAbCardLoad) tbSync[cardProvider].onAbCardLoad(aDocument, aCard);
    }    
}


tbSync.onSaveCard = function (aCard, aDocument) {
    let aParentDirURI = tbSync.getSelectedAbFromArgument(window.arguments[0]);
    
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
