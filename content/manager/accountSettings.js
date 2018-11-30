/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountSettings = {

    account: null,
    servertype: null,
    provider: null,
    settings: null,
    fixedSettings: null,
    updateTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

    stripHost: function (document, account) {
        let host = document.getElementById('tbsync.accountsettings.pref.host').value;
        if (host.indexOf("https://") == 0) {
            host = host.replace("https://","");
            document.getElementById('tbsync.accountsettings.pref.https').checked = true;
            tbSync.db.setAccountSetting(account, "https", "1");
        } else if (host.indexOf("http://") == 0) {
            host = host.replace("http://","");
            document.getElementById('tbsync.accountsettings.pref.https').checked = false;
            tbSync.db.setAccountSetting(account, "https", "0");
        }
        
        while (host.endsWith("/")) { host = host.slice(0,-1); }        
        document.getElementById('tbsync.accountsettings.pref.host').value = host
        tbSync.db.setAccountSetting(account, "host", host);
    },

    updateFolderListObserver: {
        observe: function (aSubject, aTopic, aData) {
            //only run if is request for this account and main frame is visible
            let account = aData;            
            if (account == tbSyncAccountSettings.account && !document.getElementById('tbsync.accountsettings.frame').hidden) {
                //make sure, folderlist is visible, otherwise our updates will be discarded (may cause errors)
                tbSyncAccountSettings.updateGui();
                tbSyncAccountSettings.updateFolderList();
            }
        }
    },

    updateGuiObserver: {
        observe: function (aSubject, aTopic, aData) {
            //only run if is request for this account and main frame is visible
            let account = aData;            
            if (account == tbSyncAccountSettings.account && !document.getElementById('tbsync.accountsettings.frame').hidden) {
                tbSyncAccountSettings.updateGui();
            }
        }
    },

    updateSyncstateObserver: {
        observe: function (aSubject, aTopic, aData) {
            //only run if is request for this account and main frame is visible
            let account = aData;            
            if (account == tbSyncAccountSettings.account && !document.getElementById('tbsync.accountsettings.frame').hidden) {
                
                let syncstate = tbSync.getSyncData(account,"syncstate");
                if (syncstate == "accountdone") {
                        let status = tbSync.db.getAccountSetting(account, "status");
                        switch (status) {
                            case "401":
                                //only popup one password prompt window
                                if (tbSync.passWindowObj === null) {
                                    tbSync.passWindowObj = window.openDialog("chrome://tbsync/content/manager/password.xul", "passwordprompt", "centerscreen,chrome,resizable=no", tbSync.db.getAccount(account), function() {tbSync.syncAccount("sync", account);});
                                }
                                break;
                        }
                    tbSyncAccountSettings.updateGui();
                } else {
                    tbSyncAccountSettings.updateSyncstate();
                }
            }
        }
    },





    // tbsync.accountsettings.frame
    // tbsync.accountsettings.pref. + x
    // tbsync.accountsettings.label. + x
    // tbsync.accountsettings.label.config
    // tbsync.accountsettings.unlock
    // tbsync.accountsettings.group.options
    // tbsync.accountsettings.group.server
    // tbsync.accountsettings.group.folders
    // tbsync.accountsettings.folderlist
    

    onload: function () {
        //load observers
        Services.obs.addObserver(tbSyncAccountSettings.updateFolderListObserver, "tbsync.updateFolderList", false);
        Services.obs.addObserver(tbSyncAccountSettings.updateGuiObserver, "tbsync.updateAccountSettingsGui", false);
        Services.obs.addObserver(tbSyncAccountSettings.updateSyncstateObserver, "tbsync.updateSyncstate", false);
        //get the selected account from the loaded URI
        tbSyncAccountSettings.account = window.location.toString().split("id=")[1];

        //get information for that acount
        tbSyncAccountSettings.provider = tbSync.db.getAccountSetting(tbSyncAccountSettings.account, "provider");
        tbSyncAccountSettings.settings = tbSync[tbSyncAccountSettings.provider].ui.getAccountStorageFields();
        tbSyncAccountSettings.alwaysUnlockedSettings = tbSync[tbSyncAccountSettings.provider].ui.getAlwaysUnlockedSettings();

    
        tbSync.prepareSyncDataObj(tbSyncAccountSettings.account);
        tbSyncAccountSettings.loadSettings();
        
        //done, folderlist must be updated while visible
        document.getElementById('tbsync.accountsettings.frame').hidden = false;	    
        tbSyncAccountSettings.updateFolderList();        
    },


    onunload: function () {
        tbSyncAccountSettings.updateTimer.cancel();
        if (!document.getElementById('tbsync.accountsettings.frame').hidden) {
            Services.obs.removeObserver(tbSyncAccountSettings.updateFolderListObserver, "tbsync.updateFolderList");
            Services.obs.removeObserver(tbSyncAccountSettings.updateGuiObserver, "tbsync.updateAccountSettingsGui");
            Services.obs.removeObserver(tbSyncAccountSettings.updateSyncstateObserver, "tbsync.updateSyncstate");
        }
    },
    

    /**
     * Run through all defined TbSync settings and if there is a corresponding
     * field in the settings dialog, fill it with the stored value.
     */
    loadSettings: function () {
        tbSyncAccountSettings.servertype = tbSync.db.getAccountSetting(tbSyncAccountSettings.account, "servertype");
        tbSyncAccountSettings.fixedSettings = tbSync[tbSyncAccountSettings.provider].ui.getFixedServerSettings(tbSyncAccountSettings.servertype);

        for (let i=0; i < tbSyncAccountSettings.settings.length; i++) {
            let pref = document.getElementById("tbsync.accountsettings.pref." + tbSyncAccountSettings.settings[i]);
            let label = document.getElementById("tbsync.accountsettings.label." + tbSyncAccountSettings.settings[i]);
            if (pref) {
                //is this a checkbox?
                if (pref.tagName == "checkbox") {
                    //BOOL
                    if (tbSync.db.getAccountSetting(tbSyncAccountSettings.account, tbSyncAccountSettings.settings[i])  == "1") pref.checked = true;
                    else pref.checked = false;
                } else {
                    //Not BOOL
                    pref.value = tbSync.db.getAccountSetting(tbSyncAccountSettings.account, tbSyncAccountSettings.settings[i]);
                }
                
                //disable fixed settings, that is a permanent setting and will not change by switching modes (only by unlocking, which will handle that)
                if (tbSyncAccountSettings.fixedSettings.hasOwnProperty(tbSyncAccountSettings.settings[i])) { 
                    pref.className = "locked"; 
                    pref.disabled = true; 
                    if (label) {
                        label.className = "locked"; 
                        label.disabled = true; 
                    }
                } else {
                    if (!tbSyncAccountSettings.alwaysUnlockedSettings.includes(tbSyncAccountSettings.settings[i])) {
                        pref.className = "lockable";
                        if (label) label.className = "lockable";
                    }
                    if (!pref.onblur) pref.onblur = function() {tbSyncAccountSettings.instantSaveSetting(this)};
                }
            }
        }

        // special treatment for configuration label, which is a permanent setting and will not change by switching modes (only by unlocking, which will handle that)
        document.getElementById("tbsync.accountsettings.label.config").value= tbSync.getLocalizedMessage("config." + tbSyncAccountSettings.servertype, tbSyncAccountSettings.provider);
        
        tbSyncAccountSettings.updateGui();        
    },

    updateGui: function () {
        let status = tbSync.db.getAccountSetting(tbSyncAccountSettings.account, "status");

        let isConnected = tbSync.isConnected(tbSyncAccountSettings.account);
        let isEnabled = tbSync.isEnabled(tbSyncAccountSettings.account);      
        let isSyncing = tbSync.isSyncing(tbSyncAccountSettings.account);

        //show unlock symbol?
        document.getElementById("tbsync.accountsettings.unlock").hidden = (isConnected || tbSyncAccountSettings.servertype == "custom"); 

        //what to show? Update visibility of  folder tab basend on connection state
        if (isConnected && document.getElementById("tbsync.accountsettings.group.folders").hidden) {
            document.getElementById("tbsync.accountsettings.group.folders").hidden = false;
            document.getElementById("tbsync.accountsettings.frame").selectedIndex = 0;
        } else if ((!isConnected || !isEnabled) && !document.getElementById("tbsync.accountsettings.group.folders").hidden) {
            document.getElementById("tbsync.accountsettings.group.folders").hidden = true;
            document.getElementById("tbsync.accountsettings.frame").selectedIndex = 1;
        }
        
        //disable settings if connected or syncing
        let items = document.getElementsByClassName("lockable");
        for (let i=0; i < items.length; i++) {
            items[i].disabled = isConnected || isSyncing;
        //is an invalid tab selected?
        if (document.getElementById("tbsync.accountsettings.group.folders").hidden && !document.getElementById("tbsync.accountsettings.frame").selectedIndex > 0) {
            document.getElementById("tbsync.accountsettings.frame").selectedIndex = 1;
        }

        //change color and boldness of labels, to direct users focus to the sync status
        items = document.getElementsByClassName("header");
        for (let i=0; i < items.length; i++) {
            items[i].style["color"] = isConnected || isSyncing ? "darkgrey" : "black";
            items[i].disabled = isConnected || isSyncing;            
        }
        

        //update folder pane
        document.getElementById('tbsync.accountsettings.folderlist').disabled = isSyncing;
        document.getElementById('tbsync.accountsettings.syncbtn').disabled = isSyncing;
        if (isSyncing) {
            if (isConnected) document.getElementById('tbsync.accountsettings.syncbtn').label = tbSync.getLocalizedMessage("button.syncing");
            else document.getElementById('tbsync.accountsettings.syncbtn').label = tbSync.getLocalizedMessage("button.connecting");            
        } else {
            document.getElementById('tbsync.accountsettings.syncbtn').label = "Synchronize";//tbSync.getLocalizedMessage("button.syncthis");            
        }

        //update settings pane
        document.getElementById('tbsync.accountsettings.enablebtn').disabled = isSyncing;        
        if (!isConnected) document.getElementById('tbsync.accountsettings.enablebtn').label = tbSync.getLocalizedMessage("button.connect");
        else document.getElementById('tbsync.accountsettings.enablebtn').label = tbSync.getLocalizedMessage("button.disconnect");


    
        tbSyncAccountSettings.updateSyncstate();
    },

    updateSyncstate: function () {
        tbSyncAccountSettings.updateTimer.cancel();
        document.getElementById('syncstate_link').textContent = "";
        document.getElementById('syncstate_link').setAttribute("dest", "");

        // if this account is beeing synced, display syncstate, otherwise print status
        let status = tbSync.db.getAccountSetting(tbSyncAccountSettings.account, "status");
        let isSyncing = tbSync.isSyncing(tbSyncAccountSettings.account);
        let isConnected = tbSync.isConnected(tbSyncAccountSettings.account);
        let isEnabled = tbSync.isEnabled(tbSyncAccountSettings.account);
        let syncdata = tbSync.getSyncData(tbSyncAccountSettings.account);
        
        //global status in server settings (Connected (no errors, but maybe local changes), Not Connected, Syncing, Error)
        let globalStatus = document.getElementById('globalstatus');
        if (isSyncing) {
            if (isConnected) globalStatus.value = tbSync.getLocalizedMessage("globalstatus." + "syncing");
            else globalStatus.value = tbSync.getLocalizedMessage("globalstatus." + "connecting");
            document.getElementById('error').hidden = true;
        } else {
            if (!isEnabled) {
                globalStatus.value = tbSync.getLocalizedMessage("globalstatus." + "notconnected");
                document.getElementById('error').hidden = true;
            } else if (status == "OK") {
                globalStatus.value = tbSync.getLocalizedMessage("globalstatus." + "connected");
                document.getElementById('error').hidden = true;
            } else {
                globalStatus.value = tbSync.getLocalizedMessage("globalstatus." + "error");
                document.getElementById('error').hidden = false;
            }
        }


        if (isSyncing) {
            let accounts = tbSync.db.getAccounts().data;
            let target = "";

            if (accounts.hasOwnProperty(syncdata.account) && syncdata.folderID !== "" && syncdata.syncstate != "done") { //if "Done" do not print folder info syncstate
                target = " [" + tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name") + "]";
            }
            
            let parts = syncdata.syncstate.split("||");
            let syncstate = parts[0];
            let synctime = (parts.length>1 ? parts[1] : Date.now());

            let diff = Date.now() - synctime;
            let msg = tbSync.getLocalizedMessage("syncstate." + syncstate, tbSyncAccountSettings.provider);
            if (diff > 2000) msg = msg + " (" + Math.round((tbSync.prefSettings.getIntPref("timeout") - diff)/1000) + "s)";

            document.getElementById('syncstate').textContent = msg + target;
        
            if (syncstate.split(".")[0] == "send") {
                //re-schedule update, if this is a waiting syncstate
                tbSyncAccountSettings.updateTimer.init(tbSyncAccountSettings.updateSyncstate, 1000, 0);
            }            
        } else {
            let localized = tbSync.getLocalizedMessage("status." + status, tbSyncAccountSettings.provider);
            if (!isEnabled) localized = tbSync.getLocalizedMessage("status." + "disabled", tbSyncAccountSettings.provider);

            //check, if this localized string contains a link
            let parts = localized.split("||");
            document.getElementById('syncstate').textContent = parts[0];
            if (parts.length==3) {
                    document.getElementById('syncstate_link').setAttribute("dest", parts[1]);
                    document.getElementById('syncstate_link').textContent = parts[2];
            }
        }
                
        //update syncstates of folders in folderlist, if visible
        if (!document.getElementById("tbsync.accountsettings.group.folders").hidden && !document.getElementById('tbsync.accountsettings.frame').hidden) {
            let folderList = document.getElementById("tbsync.accountsettings.folderlist");
            for (let i=0; i < folderList.getRowCount(); i++) {
                let item = folderList.getItemAtIndex(i);
                let folder = tbSync.db.getFolder(tbSyncAccountSettings.account, item.value);           
                if (folder) {

                    let rowData = tbSync[tbSyncAccountSettings.provider].ui.getFolderRowData(folder, syncdata);
                    tbSync[tbSyncAccountSettings.provider].ui.updateRowOfFolderList(document, item, rowData);
                    
                }
            }
        }
    },

    updateFolderList: function () {        
        //do not upate, if not visible (may cause errors)
        if ( document.getElementById('tbsync.accountsettings.frame').hidden || document.getElementById("tbsync.accountsettings.group.folders").hidden) 
            return;
        
        //clear folderlist
        let folderList = document.getElementById("tbsync.accountsettings.folderlist");
        for (let i=folderList.getRowCount()-1; i>=0; i--) {
            folderList.removeItemAt(i);
        }

        //rebuild folderlist
        let folderData = tbSync[tbSyncAccountSettings.provider].ui.getSortedFolderData(tbSyncAccountSettings.account);
        for (let i=0; i < folderData.length; i++) {
            //add new entry
            let newListItem = document.createElement("richlistitem");
            newListItem.setAttribute("value", folderData[i].folderID);

            tbSync[tbSyncAccountSettings.provider].ui.addRowToFolderList(document, newListItem, folderData[i]);
            
            //ensureElementIsVisible also forces internal update of rowCount, which sometimes is not updated automatically upon appendChild
            folderList.ensureElementIsVisible(folderList.appendChild(newListItem));
        }
    },





    instantSaveSetting: function (field) {
        let setting = field.id.replace("tbsync.accountsettings.pref.","");
        let value = "";
        
        if (field.tagName == "checkbox") {
            if (field.checked) value = "1";
            else value = "0";
        } else {
            value = field.value;
        }
        tbSync.db.setAccountSetting(tbSyncAccountSettings.account, setting, value);
        
        if (setting == "accountname") {
            Services.obs.notifyObservers(null, "tbsync.updateAccountName", tbSyncAccountSettings.account + ":" + field.value);
        }
        tbSync.db.saveAccounts(); //write modified accounts to disk
    },

    unlockSettings: function () {
        if (confirm(tbSync.getLocalizedMessage("prompt.UnlockSettings"))) {
            tbSync.db.setAccountSetting(tbSyncAccountSettings.account, "servertype", "custom");
            tbSyncAccountSettings.loadSettings();
        }
    },
    
    toggleEnableState: function () {
        //ignore request, if button is disabled or a sync is ongoing
        if (document.getElementById('tbsync.accountsettings.enablebtn').disabled || tbSync.isSyncing(tbSyncAccountSettings.account)) return;
        Services.obs.notifyObservers(null, "tbsync.toggleEnableState", tbSyncAccountSettings.account);        
    },

    toggleFolder: function () {
        let folderList = document.getElementById("tbsync.accountsettings.folderlist");
        if (folderList.selectedItem !== null && !folderList.disabled) {
            let fID =  folderList.selectedItem.value;
            let folder = tbSync.db.getFolder(tbSyncAccountSettings.account, fID, true);

            if (!tbSync.isEnabled(folder.account))
                return;
        
            if (folder.selected == "1") {
                if (window.confirm(tbSync.getLocalizedMessage("prompt.Unsubscribe"))) {
                    //deselect folder
                    folder.selected = "0";
                    //remove folder, which will trigger the listener in tbsync which will clean up everything
                    tbSync.removeTarget(folder.target, tbSync[tbSyncAccountSettings.provider].getThunderbirdFolderType(folder.type)); 
                }
            } else {
                //select and update status
                tbSync.db.setFolderSetting(tbSyncAccountSettings.account, fID, "selected", "1");
                tbSync.db.setFolderSetting(tbSyncAccountSettings.account, fID, "status", "aborted");
                tbSync.db.setAccountSetting(folder.account, "status", "notsyncronized");
            }
            Services.obs.notifyObservers(null, "tbsync.updateSyncstate", tbSyncAccountSettings.account);
        }
    },

    onFolderListContextMenuShowing: function () {
        let folderList = document.getElementById("tbsync.accountsettings.folderlist");
        let hideContextMenuToggleSubscription = true;
        let aFolderIsSelected = (!folderList.disabled && folderList.selectedItem !== null && folderList.selectedItem.value !== undefined);
        
        if (aFolderIsSelected) {
            let fID =  folderList.selectedItem.value;
            let folder = tbSync.db.getFolder(tbSyncAccountSettings.account, fID, true);

            //if any folder is selected,  show ContextMenuToggleSubscription
            hideContextMenuToggleSubscription = false;
            if (folder.selected == "1") {
                document.getElementById("tbsync.accountsettings.FolderListContextMenuToggleSubscription").label = tbSync.getLocalizedMessage("subscribe.off::" + folder.name, tbSyncAccountSettings.provider);
            } else {
                document.getElementById("tbsync.accountsettings.FolderListContextMenuToggleSubscription").label = tbSync.getLocalizedMessage("subscribe.on::" + folder.name, tbSyncAccountSettings.provider);
            }
            
            tbSync[tbSyncAccountSettings.provider].ui.onFolderListContextMenuShowing(document, folder);
        } else {
            tbSync[tbSyncAccountSettings.provider].ui.onFolderListContextMenuShowing(document, null);
        }
        
        document.getElementById("tbsync.accountsettings.FolderListContextMenuToggleSubscription").hidden = hideContextMenuToggleSubscription;                    
    }

};
