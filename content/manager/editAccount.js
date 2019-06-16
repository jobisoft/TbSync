/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/osfile.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountSettings = {

    accountID: null,
    provider: null,
    settings: null,
    updateTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

    updateFolderListObserver: {
        observe: function (aSubject, aTopic, aData) {
            //only run if is request for this account and main frame is visible
            let accountID = aData;            
            if (accountID == tbSyncAccountSettings.accountID && !document.getElementById('tbsync.accountsettings.frame').hidden) {
                //make sure, folderlist is visible, otherwise our updates will be discarded (may cause errors)
                tbSyncAccountSettings.updateGui();
                tbSyncAccountSettings.updateFolderList();
            }
        }
    },

    updateGuiObserver: {
        observe: function (aSubject, aTopic, aData) {
            //only run if is request for this account and main frame is visible
            let accountID = aData;            
            if (accountID == tbSyncAccountSettings.accountID && !document.getElementById('tbsync.accountsettings.frame').hidden) {
                tbSyncAccountSettings.updateGui();
            }
        }
    },

    updateSyncstateObserver: {
        observe: function (aSubject, aTopic, aData) {
            //only run if is request for this account and main frame is visible
            let accountID = aData;            
            if (accountID == tbSyncAccountSettings.accountID && !document.getElementById('tbsync.accountsettings.frame').hidden) {
                let syncstate = tbSync.core.getSyncDataObject(accountID).getSyncState();
                if (syncstate == "accountdone") {
                    tbSyncAccountSettings.updateGui();
                } else {
                    tbSyncAccountSettings.updateSyncstate();
                }
            }
        }
    },




    onload: function () {
        //load observers
        Services.obs.addObserver(tbSyncAccountSettings.updateFolderListObserver, "tbsync.observer.manager.updateFolderList", false);
        Services.obs.addObserver(tbSyncAccountSettings.updateGuiObserver, "tbsync.observer.manager.updateAccountSettingsGui", false);
        Services.obs.addObserver(tbSyncAccountSettings.updateSyncstateObserver, "tbsync.observer.manager.updateSyncstate", false);
        //get the selected account from the loaded URI
        tbSyncAccountSettings.accountID = window.location.toString().split("id=")[1];

        //get information for that acount
        tbSyncAccountSettings.provider = tbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, "provider");
        tbSyncAccountSettings.settings = Object.keys(tbSync.providers.getDefaultAccountEntries(tbSyncAccountSettings.provider)).sort();

        //add header to folderlist
        let header = tbSync.providers[tbSyncAccountSettings.provider].folderList.getHeader();
        let folderlistHeader = window.document.getElementById('tbsync.accountsettings.folderlist.header');
        for (let h=0; h < header.length; h++) {
            let listheader = window.document.createElement("listheader");
            for (let a in header[h]) {
                if (header[h].hasOwnProperty(a)) {
                    listheader.setAttribute(a, header[h][a]);
                }
            }
            folderlistHeader.appendChild(listheader);
        }        
        
        //load overlays from the provider (if any)
        tbSync.core.prepareSyncDataObj(tbSyncAccountSettings.accountID);
        tbSync.messenger.overlayManager.injectAllOverlays(window, "chrome://tbsync/content/manager/editAccount.xul?provider=" + tbSyncAccountSettings.provider);
        tbSyncAccountSettings.loadSettings();
        
        //done, folderlist must be updated while visible
        document.getElementById('tbsync.accountsettings.frame').hidden = false;	    
        tbSyncAccountSettings.updateFolderList();      

        if (OS.Constants.Sys.Name == "Darwin") { //we might need to find a way to detect MacOS like styling, other themes move the header bar into the tabpanel as well
            document.getElementById('manager.tabpanels').style["padding-top"] = "3ex";
        }
    },


    onunload: function () {
        tbSyncAccountSettings.updateTimer.cancel();
        if (!document.getElementById('tbsync.accountsettings.frame').hidden) {
            Services.obs.removeObserver(tbSyncAccountSettings.updateFolderListObserver, "tbsync.observer.manager.updateFolderList");
            Services.obs.removeObserver(tbSyncAccountSettings.updateGuiObserver, "tbsync.observer.manager.updateAccountSettingsGui");
            Services.obs.removeObserver(tbSyncAccountSettings.updateSyncstateObserver, "tbsync.observer.manager.updateSyncstate");
        }
    },
    

   folderListVisible: function () {
        let box = document.getElementById('tbsync.accountsettings.folderlist').getBoundingClientRect();
        let visible = box.width && box.height;
        return visible;
    },
    
    /**
     * Run through all defined TbSync settings and if there is a corresponding
     * field in the settings dialog, fill it with the stored value.
     */
    loadSettings: function () {
        for (let i=0; i < tbSyncAccountSettings.settings.length; i++) {
            let pref = document.getElementById("tbsync.accountsettings.pref." + tbSyncAccountSettings.settings[i]);
            let label = document.getElementById("tbsync.accountsettings.label." + tbSyncAccountSettings.settings[i]);

            if (pref) {
                //is this a checkbox?
                let event = "blur";
                if (pref.tagName == "checkbox") {
                    //BOOL
                    if (tbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, tbSyncAccountSettings.settings[i])) pref.setAttribute("checked", true);
                    else pref.setAttribute("checked", false);
                    event = "command";
                } else {
                    //Not BOOL
                    pref.setAttribute("value", tbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, tbSyncAccountSettings.settings[i]));
                    if (pref.tagName == "menulist") {
                        event = "command";
                    }
                }
                pref.addEventListener(event, function() {tbSyncAccountSettings.instantSaveSetting(this)});
            }
        }
        
        tbSyncAccountSettings.updateGui();        
    },

    updateGui: function () {
        let status = tbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, "status");

        let isConnected = tbSync.core.isConnected(tbSyncAccountSettings.accountID);
        let isEnabled = tbSync.core.isEnabled(tbSyncAccountSettings.accountID);      
        let isSyncing = tbSync.core.isSyncing(tbSyncAccountSettings.accountID);
        
        { //disable settings if connected or syncing
            let items = document.getElementsByClassName("lockIfConnected");
            for (let i=0; i < items.length; i++) {
                if (isConnected || isSyncing || items[i].getAttribute("alwaysDisabled") == "true") {
                    items[i].setAttribute("disabled", true);
                    items[i].style["color"] =  "darkgrey";            
                } else {
                    items[i].removeAttribute("disabled");
                    items[i].style["color"] = "black";
                }                    
            }
        }

        document.getElementById('tbsync.accountsettings.connectbtn.container').hidden = !(isEnabled && !isConnected && !isSyncing); 
        //currently we use a fixed button which is hidden during sync
        //document.getElementById('tbsync.accountsettings.connectbtn').label = tbSync.getString("manager." + (isSyncing ? "connecting" : "tryagain"));
        
        { //show elements if connected
            let items = document.getElementsByClassName("showIfConnected");
            for (let i=0; i < items.length; i++) {
                items[i].hidden = !isConnected;    
            }
        }

        { //show elements if enabled
            let items = document.getElementsByClassName("showIfEnabled");
            for (let i=0; i < items.length; i++) {
                items[i].hidden = !isEnabled;    
            }
        }
        
        document.getElementById('tbsync.accountsettings.enabled').checked = isEnabled;
        document.getElementById('tbsync.accountsettings.enabled').disabled = isSyncing;
        document.getElementById('tbsync.accountsettings.folderlist').disabled = isSyncing;
        document.getElementById('tbsync.accountsettings.syncbtn').disabled = isSyncing;
        document.getElementById('tbsync.accountsettings.connectbtn').disabled = isSyncing;
    
        tbSyncAccountSettings.updateSyncstate();
    
        //change color of syncstate according to status
        let showErrorLogButton = false;
        switch (status) {
            case "success":
            case "disabled":
            case "nolightning":
            case "syncing":
                document.getElementById("syncstate").removeAttribute("style");
                break;
            
            case "notsyncronized":
                document.getElementById("syncstate").setAttribute("style","color: red");
                break;
            
            default:
                document.getElementById("syncstate").setAttribute("style","color: red");
                showErrorLogButton = tbSync.errorlog.get(tbSyncAccountSettings.accountID).length > 0;
        }
        document.getElementById('tbsync.accountsettings.errorlogbtn').hidden = !showErrorLogButton;
    },

    updateSyncstate: function () {
        tbSyncAccountSettings.updateTimer.cancel();

        // if this account is beeing synced, display syncstate, otherwise print status
        let status = tbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, "status");
        let isSyncing = tbSync.core.isSyncing(tbSyncAccountSettings.accountID);
        let isConnected = tbSync.core.isConnected(tbSyncAccountSettings.accountID);
        let isEnabled = tbSync.core.isEnabled(tbSyncAccountSettings.accountID);
        let syncdata = tbSync.core.getSyncDataObject(tbSyncAccountSettings.accountID);

        if (isSyncing) {
            let accounts = tbSync.db.getAccounts().data;
            
            let parts = syncdata.getSyncState().split("||");
            let syncstate = parts[0];
            let synctime = (parts.length>1 ? parts[1] : Date.now());

            let diff = Date.now() - synctime;
            let msg = tbSync.getString("syncstate." + syncstate, tbSyncAccountSettings.provider);
            if (diff > 2000) msg = msg + " (" + Math.round((tbSync.prefs.getIntPref("timeout") - diff)/1000) + "s)";

            document.getElementById("syncstate").textContent = msg;
        
            if (syncstate.split(".")[0] == "send") {
                //re-schedule update, if this is a waiting syncstate
                tbSyncAccountSettings.updateTimer.init(tbSyncAccountSettings.updateSyncstate, 1000, 0);
            }            
        } else {
            let localized = tbSync.getString("status." + (isEnabled ? status : "disabled"), tbSyncAccountSettings.provider);
            document.getElementById("syncstate").textContent = localized;
        }
                
        //update syncstates of folders in folderlist, if visible
        if (tbSyncAccountSettings.folderListVisible()) {
            let folderList = document.getElementById("tbsync.accountsettings.folderlist");
            for (let i=0; i < folderList.getRowCount(); i++) {
                let item = folderList.getItemAtIndex(i);
                let folderData = item.folderData;           
                if (folderData) {
                    tbSync.providers[tbSyncAccountSettings.provider].folderList.updateRow(document, item, folderData);
                }
            }
        }
    },

    updateFolderList: function () {        
        //do not upate, if not visible (may cause errors)
        if (!tbSyncAccountSettings.folderListVisible()) 
            return;
        
        //get updated list of folderIDs
        let accountData = new tbSync.AccountData(tbSyncAccountSettings.accountID);
        let folderData = tbSync.providers[tbSyncAccountSettings.provider].api.getSortedFolders(accountData);
        
        let foldersFound = [];
        for (let i=0; i < folderData.length; i++) {
            foldersFound.push(folderData[i].folderID);
        }
        
        //remove entries from folderlist, which no longer exists and build reference array with  current elements
        let folderList = document.getElementById("tbsync.accountsettings.folderlist");
        folderList.hidden=true;

        let foldersElements = {};
        for (let i=folderList.getRowCount()-1; i>=0; i--) {
            if (!foldersFound.includes(folderList.getItemAtIndex(i).getAttribute("value"))) {
                folderList.removeItemAt(i);
            } else {
                foldersElements[folderList.getItemAtIndex(i).folderData.folderID] = folderList.getItemAtIndex(i);
            }
        }

        //update folderlist
        for (let i=0; i < folderData.length; i++) {
            let nextItem = null;
            
            //if this entry does not exist, create it
            if (foldersElements.hasOwnProperty(folderData[i].folderID)) {
                //get reference to current element
                nextItem = foldersElements[folderData[i].folderID];
            } else {
                //add new entry, attach AccountData of this folder as folderData
                nextItem = document.createElement("richlistitem");
                nextItem.folderData = folderData[i];
                
                //add row
                nextItem.appendChild(tbSync.providers[tbSyncAccountSettings.provider].folderList.getRow(document, folderData[i]));
            }

            //add/move row and update its content
            let addedItem = folderList.appendChild(nextItem);
            tbSync.providers[tbSyncAccountSettings.provider].folderList.updateRow(document, addedItem, folderData[i]);

            //ensureElementIsVisible also forces internal update of rowCount, which sometimes is not updated automatically upon appendChild
            folderList.ensureElementIsVisible(addedItem);
        }
        folderList.hidden = false;
    },





    instantSaveSetting: function (field) {
        let setting = field.id.replace("tbsync.accountsettings.pref.","");
        let value = "";
        
        if (field.tagName == "checkbox") {
            if (field.checked) value = true;
            else value = false;
        } else {
            value = field.value;
        }
        tbSync.db.setAccountProperty(tbSyncAccountSettings.accountID, setting, value);
        
        if (setting == "accountname") {
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountName", tbSyncAccountSettings.accountID + ":" + field.value);
        }
        tbSync.db.saveAccounts(); //write modified accounts to disk
    },

    toggleEnableState: function (element) {
        if (!tbSync.core.isConnected(tbSyncAccountSettings.accountID)) {
            //if not connected, we can toggle without prompt
            Services.obs.notifyObservers(null, "tbsync.observer.manager.toggleEnableState", tbSyncAccountSettings.accountID);
            return;
        }      

        if (window.confirm(tbSync.getString("prompt.Disable"))) {
            Services.obs.notifyObservers(null, "tbsync.observer.manager.toggleEnableState", tbSyncAccountSettings.accountID);
        } else {
            //invalid, toggle checkbox back
            element.setAttribute("checked", true);
        }
    },

    
    onFolderListContextMenuShowing: function () {
        let folderList = document.getElementById("tbsync.accountsettings.folderlist");
        let aFolderIsSelected = (!folderList.disabled && folderList.selectedItem !== null && folderList.selectedItem.value !== undefined);
        let menupopup = document.getElementById("tbsync.accountsettings.FolderListContextMenu");
        
        if (aFolderIsSelected) {
            tbSync.providers[tbSyncAccountSettings.provider].folderList.onContextMenuShowing(document, folderList.selectedItem.folderData);
        } else {
            tbSync.providers[tbSyncAccountSettings.provider].folderList.onContextMenuShowing(document, null);
        }
    },

};
