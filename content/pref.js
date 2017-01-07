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

        //disable connect/disconnect btn, sync btn and folderlist during sync, also hide sync button if disconnected
        document.getElementById('tzprefs.connectbtn').disabled = (status == "syncing");
        document.getElementById('tzprefs.folderlist').disabled = (status == "syncing");
        document.getElementById('tzprefs.syncbtn').disabled = (status == "syncing");
        document.getElementById('tzprefs.syncbtn').hidden = (state == "disconnected");
        
        
    },


    toggleFolder: function () {
        let folderList = document.getElementById("tzprefs.folderlist");
        if (folderList.selectedItem !== null && !folderList.disabled) {
            let fID =  folderList.selectedItem.value;
            let folder = tzPush.db.getFolder(tzprefs.selectedAccount, fID, true);

            if (folder.selected == "1") {
                if (window.confirm(tzPush.getLocalizedMessage("promptUnsubscribe"))) {
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
                }
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
        
        //sorting as 8,13,9,14 (any value 12+ is custom) 
        // 8 -> 8*2 = 16
        // 13 -> (13-5)*2 + 1 = 17
        // 9 -> 9*2 = 18
        // 14 -> (14-5) * 2 + 1 = 19
        let folderIDs = Object.keys(folders).sort((a, b) => (((folders[a].type < 12) ? folders[a].type * 2: 1+ (folders[a].type-5) * 2) - ((folders[b].type < 12) ? folders[b].type * 2: 1+ (folders[b].type-5) * 2)));

        //get current accounts in list and remove entries of accounts no longer there
        let listedfolders = [];
        for (let i=folderList.getRowCount()-1; i>=0; i--) {
            listedfolders.push(folderList.getItemAtIndex (i).value); 
            if (folderIDs.indexOf(folderList.getItemAtIndex(i).value) == -1) {
                folderList.removeItemAt(i);
            }
        }

        //listedFolders contains the folderIDs, in the current list (aa,bb,cc,dd)
        //folderIDs contains a list of folderIDs with potential new items (aa,ab,bb,cc,cd,dd, de) - the existing ones must be updated - the new ones must be added at their desired location 
        //walking backwards! after each item update lastCheckdEntry (null at the beginning)
        // - de? add via append (because lastChecked is null)
        // - dd? update
        // - cd? insert before lastChecked (dd)
        // - cc? update
        // - bb? update
        // - ab? insert before lastChecked (bb)
        // - aa? update
        
        // add/update allowed folder based on type (check https://msdn.microsoft.com/en-us/library/gg650877(v=exchg.80).aspx)
        // walk backwards, so adding items does not mess up index
        let lastCheckedEntry = null;
        
        for (let i = folderIDs.length-1; i >= 0; i--) {
            if (["8","9","13","14"].indexOf(folders[folderIDs[i]].type) != -1) { 
                let selected = (folders[folderIDs[i]].selected == "1");
                let type = folders[folderIDs[i]].type;
                let status = (selected) ? folders[folderIDs[i]].status : "";
                let name = folders[folderIDs[i]].name;

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
                
                if (listedfolders.indexOf(folderIDs[i]) == -1) {

                    //add new entry
                    let newListItem = document.createElement("richlistitem");
                    newListItem.setAttribute("id", "zprefs.folder." + folderIDs[i]);
                    newListItem.setAttribute("value", folderIDs[i]);

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
                    itemLabelCell.setAttribute("label", name);
                    itemLabelCell.setAttribute("tooltiptext", name);
                    itemLabelCell.setAttribute("disabled", !selected);
                    if (!selected) itemLabelCell.setAttribute("style", "font-style:italic;");
                    newListItem.appendChild(itemLabelCell);

                    //add folder status
                    let itemStatusCell = document.createElement("listcell");
                    itemStatusCell.setAttribute("class", "label");
                    itemStatusCell.setAttribute("flex", "1");
                    itemStatusCell.setAttribute("crop", "end");
                    itemStatusCell.setAttribute("label", status);
                    itemStatusCell.setAttribute("tooltiptext", status);
                    newListItem.appendChild(itemStatusCell);

                    //ensureElementIsVisible also forces internal update of rowCount, which sometimes is not updated automatically upon appendChild
                    //we have to now, if appendChild at end or insertBefore
                    if (lastCheckedEntry === null) folderList.ensureElementIsVisible(folderList.appendChild(newListItem));
                    else folderList.ensureElementIsVisible(folderList.insertBefore(newListItem,document.getElementById(lastCheckedEntry)));

                } else {

                    //update entry
                    let item = document.getElementById("zprefs.folder." + folderIDs[i]);
                    
                    this.updateCell(item.childNodes[1], ["label","tooltiptext"], name);
                    this.updateCell(item.childNodes[2], ["label","tooltiptext"], status);
                    if (selected) {
                        this.updateCell(item.childNodes[1], ["style"], "font-style:normal;");
                        this.updateCell(item.childNodes[1], ["disabled"], "false");
                    } else {
                        this.updateCell(item.childNodes[1], ["style"], "font-style:italic;");
                        this.updateCell(item.childNodes[1], ["disabled"], "true");
                    }

                }
                lastCheckedEntry = "zprefs.folder." + folderIDs[i];
            }
        }
    },

    updateCell: function (e, attribs, value) {
        if (e.getAttribute(attribs[0]) != value) {
            for (let i=0; i<attribs.length; i++) {
                e.setAttribute(attribs[i],value);
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

                        //this syncstate change notification was send by setSyncState
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
                    
                        //this syncstate change notification could have been send setSyncState (aData = "") for the currentProcess or by manual notifications from tzmessenger
                        //in either case, the notification is for THIS account
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
