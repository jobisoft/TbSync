/* Copyright (c) 2012 Mark Nethersole
See the file LICENSE.txt for licensing information. */
"use strict";

Components.utils.import("chrome://tzpush/content/tzpush.jsm");

var tzprefs = {

    selectedAccount: null,
    init: false,
    boolSettings: ["https", "provision", "birthday", "displayoverride", "downloadonly"],
    protectedSettings: ["asversion", "host", "https", "user", "provision", "birthday", "servertype", "displayoverride", "downloadonly"],
    protectedButtons: ["syncbtn", "resyncbtn"],
        
    onload: function () {
        //get the selected account from tzprefManager
        tzprefs.selectedAccount = parent.tzprefManager.selectedAccount;

        tzprefs.loadSettings();
        tzprefs.updateGui();
        tzprefs.updateFolderList();
        tzprefs.addressbookListener.add();
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.addObserver(tzprefs.accountSyncFinishedObserver, "tzpush.accountSyncFinished", false);
        observerService.addObserver(tzprefs.updateSyncstateObserver, "tzpush.updateSyncstate", false);

        tzprefs.init = true;
    },

    onunload: function () {
        tzprefs.addressbookListener.remove();
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        if (tzprefs.init) {
            observerService.removeObserver(tzprefs.accountSyncFinishedObserver, "tzpush.accountSyncFinished");
            observerService.removeObserver(tzprefs.updateSyncstateObserver, "tzpush.updateSyncstate");
        }
    },

    // manage sync via queue
    requestSync: function (job, account, disabled = false) {
        if (disabled == false && tzPush.sync.currentProzess.account != account) tzPush.sync.addAccountToSyncQueue(job, account);

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

    

    /* * *
    * Disable/Enable input fields and buttons according to the current connection state
    */
    
    updateSyncstate: function () {
        let data = tzPush.sync.currentProzess;
        
        // if this account is beeing synced, display syncstate, otherwise print status
        if (tzPush.sync.currentProzess.account == tzprefs.selectedAccount) {        
            let target = "";
            let accounts = tzPush.db.getAccounts().data;
            if (accounts.hasOwnProperty(data.account) && data.folderID !== "" && data.state != "done") { //if "Done" do not print folder info syncstate
                target = " [" + tzPush.db.getFolderSetting(data.account, data.folderID, "name") + "]";
            }
            document.getElementById('syncstate').textContent = tzPush.getLocalizedMessage("syncstate." + data.state) + target;
        } else {
            let status = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "status");
            document.getElementById('syncstate').textContent = tzPush.getLocalizedMessage("status." + status);
        }            
    },
    
    updateGui: function () {
        let state = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "state"); //connecting, connected, disconnected
        let conBtn = document.getElementById('tzprefs.connectbtn');
        conBtn.label = tzPush.getLocalizedMessage("state."+state); 
        
        //disable connect/disconnect btn during state toggle
        document.getElementById('tzprefs.connectbtn').disabled = (state == "connecting");
        
        document.getElementById("tzprefs.options.1").hidden = (state == "connected"); 
        document.getElementById("tzprefs.options.2").hidden = (state == "connected"); 
        document.getElementById("tzprefs.options.3").hidden = (state == "connected"); 
        document.getElementById("tzprefs.folders").hidden = (state != "connected"); 

        //disable all seetings field, if connected or connecting
        for (let i=0; i<this.protectedSettings.length;i++) {
            document.getElementById("tzprefs." + this.protectedSettings[i]).disabled = (state != "disconnected");
        }

        //disable all protected buttons, if not connected
        for (let i=0; i<this.protectedButtons.length;i++) {
            document.getElementById("tzprefs." + this.protectedButtons[i]).disabled = (state != "connected");
        }
        
        this.updateSyncstate();
    },

    toggleFolder: function () {
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
        let folderList = document.getElementById("tzprefs.folderlist");
        let folders = tzPush.db.getFolders(tzprefs.selectedAccount);
        let folderIDs = Object.keys(folders).sort((a, b) => a - b);

        //clear list
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
                let target = "";
                if (selected) {
                    if (type == "9" || type == "14") target = tzPush.getAddressBookName(folders[folderIDs[i]].target);
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
                itemLabelCell.setAttribute("flex", "1");
                let itemLabel = document.createElement("label");
                itemLabel.setAttribute("value", folders[folderIDs[i]].name);
                itemLabel.setAttribute("disabled", !selected);
                itemLabelCell.appendChild(itemLabel);
                newListItem.appendChild(itemLabelCell);

                //add target name
                let itemTargetCell = document.createElement("listcell");
                itemTargetCell.setAttribute("class", "label");
                itemTargetCell.setAttribute("flex", "1");
                let itemTarget = document.createElement("label");
                itemTarget.setAttribute("value", target);
                itemTarget.setAttribute("disabled", !selected);
                itemTargetCell.appendChild(itemTarget);
                newListItem.appendChild(itemTargetCell);
                
                //add folder status
                let itemStatusCell = document.createElement("listcell");
                itemStatusCell.setAttribute("class", "label");
                itemStatusCell.setAttribute("flex", "1");
                let itemStatus = document.createElement("label");
                itemStatus.setAttribute("value", folders[folderIDs[i]].status);
                itemStatus.setAttribute("disabled", !selected);
                itemStatus.setAttribute("style", "text-align:right;");
                itemStatusCell.appendChild(itemStatus);
                newListItem.appendChild(itemStatusCell);                
                
                folderList.appendChild(newListItem);
            }
        }            
    },    
    
    /* * *
    * This function is executed, when the user hits the connect/disconnet button. On disconnect, all
    * sync targets are deleted and the settings can be changed again. On connect, the settings are
    * stored and a new sync is initiated.
    */
    toggleConnectionState: function () {
        //ignore cancel request, if button is disabled
        if (document.getElementById('tzprefs.connectbtn').disabled) return;

        let state = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "state"); //connecting, connected, disconnected
        if (state == "connected") {
            //we are connected and want to disconnect
            tzPush.sync.disconnectAccount(tzprefs.selectedAccount);
            tzprefs.updateGui();
            parent.tzprefManager.updateAccountStatus(tzprefs.selectedAccount);
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
    */
    updateSyncstateObserver: {
        observe: function (aSubject, aTopic, aData) {
            tzprefs.updateSyncstate();
            if (tzPush.sync.currentProzess.state == "done") tzprefs.updateFolderList();
        }
    },


    /* * *
    * Observer to catch a finished sync job and do visual error handling (only if settings window is open)
    */
    accountSyncFinishedObserver: {
        observe: function (aSubject, aTopic, aData) {
            //aData contains the account, which has been finished
            let status = tzPush.db.getAccountSetting(aData, "status");

            //Only observe actions for the active account
            if (aData == tzprefs.selectedAccount) {

                switch (status) {
                    case "401":
                        window.openDialog("chrome://tzpush/content/password.xul", "passwordprompt", "centerscreen,chrome,resizable=no", "Set password for TzPush account <" + tzPush.db.getAccountSetting(aData, "accountname") + ">", aData);
                        break;
                    case "OK":
                    case "notsyncronized":
                        //do not pop alert box for these
                        break;
                    default:
                        alert(tzPush.getLocalizedMessage("status." + status));
                }
                tzprefs.updateGui();
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
