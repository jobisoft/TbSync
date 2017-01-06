/* Copyright (c) 2012 Mark Nethersole
See the file LICENSE.txt for licensing information. */
"use strict";

Components.utils.import("chrome://tzpush/content/tzpush.jsm");

var tzprefs = {

    selectedAccount: null,
    init: false,
    boolSettings: ["https", "provision", "birthday", "displayoverride", "downloadonly"],
    protectedSettings: ["asversion", "host", "https", "user", "provision", "birthday", "servertype", "displayoverride", "downloadonly"],
        
    onload: function () {
        //get the selected account from tzprefManager
        tzprefs.selectedAccount = parent.tzprefManager.selectedAccount;

        tzprefs.loadSettings();
        tzprefs.updateGui();
        tzprefs.addressbookListener.add();

        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.addObserver(tzprefs.syncstateObserver, "tzpush.changedSyncstate", false);
        tzprefs.init = true;
    },

    onunload: function () {
        tzprefs.addressbookListener.remove();
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        if (tzprefs.init) {
            observerService.removeObserver(tzprefs.syncstateObserver, "tzpush.changedSyncstate");
        }
    },

    // manage sync via queue
    requestSync: function (job, account, btnDisabled = false) {
        if (btnDisabled == false && tzPush.sync.currentProzess.account != account) tzPush.sync.addAccountToSyncQueue(job, account);

    },


    /* * *
    * Run through all defined TzPush settings and if there is a corresponding
    * field in the settings dialog, fill it with the stored value.
    */
    loadSettings: function () {
        let settings = tzPush.db.getTableFields("accounts");
        
        for (let i=0; i<settings.length;i++) {
            if (document.getElementById("tzprefs." + settings[i])) {
                //bool fields need special treatment
                if (this.boolSettings.indexOf(settings[i]) == -1) {
                    //Not BOOL
                    document.getElementById("tzprefs." + settings[i]).value = tzPush.db.getAccountSetting(tzprefs.selectedAccount, settings[i]);
                } else {
                    //BOOL
                    if (tzPush.db.getAccountSetting(tzprefs.selectedAccount, settings[i])  == "1") document.getElementById("tzprefs." + settings[i]).checked = true;
                    else document.getElementById("tzprefs." + settings[i]).checked = false;
                }
            }
        }

        //Also load DeviceId
        document.getElementById('deviceId').value = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "deviceId");
    },


    /* * *
    * Run through all defined TzPush settings and if there is a corresponding
    * field in the settings dialog, store its current value.
    */
    saveSettings: function () {
        let settings = tzPush.db.getTableFields("accounts");

        let data = tzPush.db.getAccount(tzprefs.selectedAccount, true); //get a copy of the cache, which can be modified
        for (let i=0; i<settings.length;i++) {
            if (document.getElementById("tzprefs." + settings[i])) {
                //bool fields need special treatment
                if (this.boolSettings.indexOf(settings[i]) == -1) {
                    //Not BOOL
                    data[settings[i]] = document.getElementById("tzprefs." + settings[i]).value;
                } else {
                    //BOOL
                    if (document.getElementById("tzprefs." + settings[i]).checked) data[settings[i]] = "1";
                    else data[settings[i]] = "0";
                }
            }
        }
        
        tzPush.db.setAccount(data);
        parent.tzprefManager.updateAccountName(tzprefs.selectedAccount, data.accountname);
    },


    /* * *
    * Some fields are not protected and can be changed even if the account is connected. Since we
    * do not have (want) another save button for these, they are saved upon change.
    */
    instantSaveSetting: function (field) {
        let setting = field.id.replace("tzprefs.","");
        tzPush.db.setAccountSetting(tzprefs.selectedAccount, setting, field.value);
        if (setting == "accountname") parent.tzprefManager.updateAccountName(tzprefs.selectedAccount, field.value);
    },


    stripHost: function () {
        let host = document.getElementById('tzprefs.host').value;
        if (host.indexOf("https://") == 0) {
            host = host.replace("https://","");
            document.getElementById('tzprefs.https').checked = true;
        } else if (host.indexOf("http://") == 0) {
            host = host.replace("http://","");
            document.getElementById('tzprefs.https').checked = false;
        }
        document.getElementById('tzprefs.host').value = host.replace("/","");
    },



    updateGui: function () {
        let state = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "state"); //connecting, connected, disconnected
        document.getElementById('tzprefs.connectbtn').label = tzPush.getLocalizedMessage("state."+state); 
        
        document.getElementById("tzprefs.options.1").hidden = (state != "disconnected"); 
        document.getElementById("tzprefs.options.2").hidden = (state != "disconnected"); 
        document.getElementById("tzprefs.options.3").hidden = (state != "disconnected"); 
        document.getElementById("tzprefs.folders").hidden = (state == "disconnected"); 

        //disable all seetings field, if connected or connecting
        for (let i=0; i<this.protectedSettings.length;i++) {
            document.getElementById("tzprefs." + this.protectedSettings[i]).disabled = (state != "disconnected");
        }
        
        this.updateSyncstate();
        this.updateFolderList();
    },


    updateSyncstate: function () {
        let data = tzPush.sync.currentProzess;
        
        // if this account is beeing synced, display syncstate, otherwise print status
        let status = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "status");
        let state = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "state"); //connecting, connected, disconnected

        if (status == "syncing") {
            let target = "";
            let accounts = tzPush.db.getAccounts().data;
            if (accounts.hasOwnProperty(data.account) && data.folderID !== "" && data.state != "done") { //if "Done" do not print folder info syncstate
                target = " [" + tzPush.db.getFolderSetting(data.account, data.folderID, "name") + "]";
            }
            document.getElementById('syncstate').textContent = tzPush.getLocalizedMessage("syncstate." + data.state) + target;
        } else {
            document.getElementById('syncstate').textContent = tzPush.getLocalizedMessage("status." + status);
        }

        //disable connect/disconnect btn and folderlist during sync, also disable sync button, if syncingor disconnected
        document.getElementById('tzprefs.connectbtn').disabled = (status == "syncing");
        document.getElementById('tzprefs.folderlist').disabled = (status == "syncing");
        document.getElementById('tzprefs.syncbtn').disabled = (status == "syncing" || state == "disconnected");
        
        
    },


    toggleFolder: function () {
        let folderList = document.getElementById("tzprefs.folderlist");
        if (folderList.selectedItem !== null) {
            let fID = folderList.getItemAtIndex(folderList.selectedIndex).value;
            let folder = tzPush.db.getFolder(tzprefs.selectedAccount, fID, true);

            if (folder.selected == "1") {
                //get copy of the current target, before resetting it
                let target = folder.target;

                //deselect and clean up
                folder.selected = "0";
                folder.target = "";
                folder.synckey = "";
                folder.lastsynctime = "";
                folder.status = "";
                tzPush.db.setFolder(folder);
                tzPush.db.clearDeleteLog(target);
                                
                if (target != "") tzPush.removeBook(target); //we must remove the target AFTER cleaning up the DB, otherwise the addressbookListener in messenger will interfere
            } else {
                //select and update status
                tzPush.db.setFolderSetting(tzprefs.selectedAccount, fID, "selected", "1");
                tzPush.db.setFolderSetting(tzprefs.selectedAccount, fID, "status", "aborted");
                tzPush.db.setAccountSetting(folder.account, "status", "notsyncronized");
                parent.tzprefManager.updateAccountStatus(tzprefs.selectedAccount);
                this.updateSyncstate();
            }
            this.updateFolderList();
        }
    },


    getTypeImage: function (type) {
        let src = ""; 
        switch (type) {
            case "8":
            case "13":
                src = "calendar16.png";
                break;
            case "9":
            case "14":
                src = "contacts16.png";
                break;
        }
        return "chrome://tzpush/skin/" + src;
    },


    updateFolderList: function () {
        //do not update folder list, if not visible
        if (document.getElementById("tzprefs.folders").hidden) return;
        
        let folderList = document.getElementById("tzprefs.folderlist");
        let folders = tzPush.db.getFolders(tzprefs.selectedAccount);
        let folderIDs = Object.keys(folders).sort((a, b) => a - b);

        //clear list - todo UPDATE list
        for (let i=folderList.getRowCount()-1; i>=0; i--) {
            folderList.removeItemAt(i);
        }

        // add allowed folder based on type (check https://msdn.microsoft.com/en-us/library/gg650877(v=exchg.80).aspx)
        for (let i = 0; i < folderIDs.length; i++) {
            if (["8","9","13","14"].indexOf(folders[folderIDs[i]].type) != -1) { 
                let newListItem = document.createElement("richlistitem");
                newListItem.setAttribute("id", "zprefs.folder." + folderIDs[i]);
                newListItem.setAttribute("value", folderIDs[i]);

                let selected = (folders[folderIDs[i]].selected == "1");
                let type = folders[folderIDs[i]].type;
                let status = (selected) ? folders[folderIDs[i]].status : "";

                //if status OK, print target
                if (selected) {
                    switch (status) {
                        case "OK":
                        case "modified":
                            if (type == "8" || type == "13") status = tzPush.getLocalizedMessage("status.skipped"); //TODO
                            if (type == "9" || type == "14") status = tzPush.getLocalizedMessage("status." + status) + " ["+ tzPush.getAddressBookName(folders[folderIDs[i]].target) + "]";
                            break;
                        case "pending":
                            if (folderIDs[i] == tzPush.sync.currentProzess.folderID) status = "syncing"; 
                        default:
                            status = tzPush.getLocalizedMessage("status." + status);
                    }
                }

                //add folder type/img
                let itemTypeCell = document.createElement("listcell");
                itemTypeCell.setAttribute("class", "img");
                itemTypeCell.setAttribute("width", "24");
                itemTypeCell.setAttribute("height", "24");
                    let itemType = document.createElement("image");
                    itemType.setAttribute("src", this.getTypeImage(type));
                    itemType.setAttribute("style", "margin: 4px;");
                itemTypeCell.appendChild(itemType);
                newListItem.appendChild(itemTypeCell);

                //add folder name
                let itemLabelCell = document.createElement("listcell");
                itemLabelCell.setAttribute("class", "label");
                itemLabelCell.setAttribute("width", "145");
                itemLabelCell.setAttribute("crop", "end");
                itemLabelCell.setAttribute("label", folders[folderIDs[i]].name);
                itemLabelCell.setAttribute("tooltiptext", folders[folderIDs[i]].name);
                if (!selected) itemLabelCell.setAttribute("style", "font-style:italic;");
                itemLabelCell.setAttribute("disabled", !selected);
                newListItem.appendChild(itemLabelCell);

               
                //add folder status
                let itemStatusCell = document.createElement("listcell");
                itemStatusCell.setAttribute("class", "label");
                itemStatusCell.setAttribute("flex", "1");
                itemStatusCell.setAttribute("crop", "end");
                //itemStatusCell.setAttribute("style", "text-align:right;padding-right:10px;");
                itemStatusCell.setAttribute("label", status);
                itemStatusCell.setAttribute("tooltiptext", status);
                itemStatusCell.setAttribute("disabled", !selected);
                newListItem.appendChild(itemStatusCell);

                //ensureElementIsVisible also forces internal update of rowCount, which sometimes is not updated automatically upon appendChild
                folderList.ensureElementIsVisible(folderList.appendChild(newListItem));
            }
        }
    },


    /* * *
    * This function is executed, when the user hits the connect/disconnet button. On disconnect, all
    * sync targets are deleted and the settings can be changed again. On connect, the settings are
    * stored and a new sync is initiated.
    */
    toggleConnectionState: function () {
        //ignore cancel request, if button is disabled or a sync is ongoing
        if (document.getElementById('tzprefs.connectbtn').disabled || tzPush.sync.currentProzess.account == tzprefs.selectedAccount) return;

        let state = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "state"); //connecting, connected, disconnected
        if (state == "connected") {
            //we are connected and want to disconnect
            if (window.confirm(tzPush.getLocalizedMessage("promptDisconnect"))) {
                tzPush.sync.disconnectAccount(tzprefs.selectedAccount);
                tzprefs.updateGui();
                parent.tzprefManager.updateAccountStatus(tzprefs.selectedAccount);
            }
        } else if (state == "disconnected") {
            //we are disconnected and want to connected
            tzPush.sync.connectAccount(tzprefs.selectedAccount);
            tzprefs.updateGui();
            tzprefs.saveSettings();
            tzprefs.requestSync("sync", tzprefs.selectedAccount);
        }
    },


    /* * *
    * Observer to catch changing syncstate and to update the status info.
    * aData provides an account information, but this observer ignores it and only acts on the currentProzess
    */
    syncstateObserver: {
        observe: function (aSubject, aTopic, aData) {
            //the notification could be send by setSyncState (aData = "") or by tzMessenger (aData = account)
            let account = (aData == "") ? tzPush.sync.currentProzess.account : aData;

            //only handle syncstate changes of the active account
            if (account == tzprefs.selectedAccount) {
                
                if (aData == "" && tzPush.sync.currentProzess.state == "accountdone") {

                        let status = tzPush.db.getAccountSetting(tzPush.sync.currentProzess.account, "status");
                        switch (status) {
                            case "401":
                                window.openDialog("chrome://tzpush/content/password.xul", "passwordprompt", "centerscreen,chrome,resizable=no", "Set password for TzPush account <" + tzPush.db.getAccountSetting(account, "accountname") + ">", account);
                                break;
                            case "OK":
                            case "notsyncronized":
                                //do not pop alert box for these
                                break;
                            default:
                                alert(tzPush.getLocalizedMessage("status." + status));
                        }
                        tzprefs.updateGui();
                        
                } else { 
                    
                        tzprefs.updateSyncstate();
                        tzprefs.updateFolderList();
                    
                }
            }
        }
    },


    /* * *
    * Address book listener to catch if the synced address book (sync target) has been renamed
    * or deleted, so the corresponding labels can be updated. For simplicity, we do not check,
    * if the modified book belongs to the current account - we update on any change.
    */
    addressbookListener: {

        onItemPropertyChanged: function addressbookListener_onItemPropertyChanged(aItem, aProperty, aOldValue, aNewValue) {
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                tzprefs.updateFolderList();
            }
        },

        onItemRemoved: function addressbookListener_onItemRemoved (aParentDir, aItem) {
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                tzprefs.updateFolderList();
            }
        },

        add: function addressbookListener_add () {
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .addAddressBookListener(tzprefs.addressbookListener, Components.interfaces.nsIAbListener.all);
        },

        remove: function addressbookListener_remove () {
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .removeAddressBookListener(tzprefs.addressbookListener);
        }
    }

};
