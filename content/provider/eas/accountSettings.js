"use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountSettings = {

    selectedAccount: null,
    init: false,
    fixedSettings: {},
    protectedSettings: ["host", "user"],

    onload: function () {
        //get the selected account from the loaded URI
        tbSyncAccountSettings.selectedAccount = window.location.toString().split("id=")[1];

        tbSyncAccountSettings.loadSettings();
        tbSyncAccountSettings.addressbookListener.add();

        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.addObserver(tbSyncAccountSettings.syncstateObserver, "tbsync.changedSyncstate", false);
        observerService.addObserver(tbSyncAccountSettings.updateGuiObserver, "tbsync.updateAccountSettingsGui", false);
        observerService.addObserver(tbSyncAccountSettings.autodiscoverObserver, "tbsync.autodiscoverDone", false);
        tbSyncAccountSettings.init = true;
    },

    onunload: function () {
        tbSyncAccountSettings.addressbookListener.remove();
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        if (tbSyncAccountSettings.init) {
            observerService.removeObserver(tbSyncAccountSettings.syncstateObserver, "tbsync.changedSyncstate");
            observerService.removeObserver(tbSyncAccountSettings.updateGuiObserver, "tbsync.updateAccountSettingsGui");
            observerService.removeObserver(tbSyncAccountSettings.autodiscoverObserver, "tbsync.autodiscoverDone");
        }
    },

    // manage sync via queue
    requestSync: function (job, account, btnDisabled = false) {
        if (btnDisabled == false && tbSync.sync.currentProzess.account != account) tbSync.sync.addAccountToSyncQueue(job, account);

    },


    /* * *
    * Run through all defined TbSync settings and if there is a corresponding
    * field in the settings dialog, fill it with the stored value.
    */
    loadSettings: function () {
        let settings = tbSync.db.getTableFields("accounts");
        let servertype = tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, "servertype");
        
        this.fixedSettings = this.getServerSetting(servertype);

        for (let i=0; i<settings.length;i++) {
            if (document.getElementById("tbsync.accountsettings." + settings[i])) {
                //is this a checkbox?
                if (document.getElementById("tbsync.accountsettings." + settings[i]).tagName == "checkbox") {
                    //BOOL
                    if (tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, settings[i])  == "1") document.getElementById("tbsync.accountsettings." + settings[i]).checked = true;
                    else document.getElementById("tbsync.accountsettings." + settings[i]).checked = false;
                    
                } else {
                    //Not BOOL
                    document.getElementById("tbsync.accountsettings." + settings[i]).value = tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, settings[i]);
                    
                }
                
                if (this.fixedSettings.hasOwnProperty(settings[i])) document.getElementById("tbsync.accountsettings." + settings[i]).disabled = true;
                else document.getElementById("tbsync.accountsettings." + settings[i]).disabled = false;
                
            }
        }

        // special treatment for servertype - always select main item
        document.getElementById("tbsync.servertype").value= "";
        
        // special treatment for configuration label
        document.getElementById("tbsync.accountsettings.config.label").value= tbSync.getLocalizedMessage("config." + servertype);
        
        // also load DeviceId
        document.getElementById('deviceId').value = tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, "deviceId");
        
        this.updateGui();
    },


    /* * *
    * Run through all defined TbSync settings and if there is a corresponding
    * field in the settings dialog, store its current value.
    */
    saveSettings: function () {
        let settings = tbSync.db.getTableFields("accounts");

        let data = tbSync.db.getAccount(tbSyncAccountSettings.selectedAccount, true); //get a copy of the cache, which can be modified
        for (let i=0; i<settings.length;i++) {
            if (document.getElementById("tbsync.accountsettings." + settings[i])) {
                //bool fields need special treatment
                if (document.getElementById("tbsync.accountsettings." + settings[i]).tagName == "checkbox") {
                    //BOOL
                    if (document.getElementById("tbsync.accountsettings." + settings[i]).checked) data[settings[i]] = "1";
                    else data[settings[i]] = "0";
                } else {
                    //Not BOOL
                    data[settings[i]] = document.getElementById("tbsync.accountsettings." + settings[i]).value;
                }
            }
        }
        
        tbSync.db.setAccount(data);
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.notifyObservers(null, "tbsync.changedAccountName", tbSyncAccountSettings.selectedAccount + ":" + data.accountname);
    },


    instantSaveSetting: function (field) {
        let setting = field.id.replace("tbsync.accountsettings.","");
        let value = "";
        
        if (field.tagName == "checkbox") {
            if (field.checked) value = "1";
            else value = "0";
        } else {
            value = field.value;
        }
        tbSync.db.setAccountSetting(tbSyncAccountSettings.selectedAccount, setting, value);
        
        if (setting == "accountname") {
            let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
            observerService.notifyObservers(null, "tbsync.changedAccountName", tbSyncAccountSettings.selectedAccount + ":" + field.value);
        }
    },


    stripHost: function () {
        let host = document.getElementById('tbsync.accountsettings.host').value;
        if (host.indexOf("https://") == 0) {
            host = host.replace("https://","");
            document.getElementById('tbsync.accountsettings.https').checked = true;
            tbSync.db.setAccountSetting(tbSyncAccountSettings.selectedAccount, "https", "1");
        } else if (host.indexOf("http://") == 0) {
            host = host.replace("http://","");
            document.getElementById('tbsync.accountsettings.https').checked = false;
            tbSync.db.setAccountSetting(tbSyncAccountSettings.selectedAccount, "https", "0");
        }
        host = host.replace(/\//g,"");
        document.getElementById('tbsync.accountsettings.host').value = host
        tbSync.db.setAccountSetting(tbSyncAccountSettings.selectedAccount, "host", host);
    },

    getServerSetting: function(servertype) {
        let settings = {};

        switch (servertype) {
            case "auto":
                settings["host"] = null;
                settings["https"] = null;
                settings["provision"] = null;
                settings["asversion"] = null;
                break;

            case "zarafa":
                settings["seperator"] = "10";
                break;
            
            case "horde":
                settings["seperator"] = "44";
                break;

            case "outlook.com":
                settings["host"] = "eas.outlook.com";
                settings["https"] = "1";
                settings["provision"] = "0";
                settings["asversion"] = "2.5";
                settings["seperator"] = "44";
                break;
        }
        
        return settings;
    },

    
    loadServerProfile: function () {
        if (tbSyncAccountSettings.selectedAccount === null) return;

        let selection = document.getElementById('tbsync.servertype').value;
        if (selection == "") return;
        
        //special treatment for autodiscover request
        if (selection == "auto") {
            window.openDialog("chrome://tbsync/content/provider/eas/autodiscover.xul", "easautodiscover", "centerscreen,modal,resizable=no", this.selectedAccount, document.getElementById('tbsync.accountsettings.user').value);
        } else {
            //save fixed values
            this.fixedSettings = this.getServerSetting(selection);
            let data = tbSync.db.getAccount(tbSyncAccountSettings.selectedAccount, true); //get a copy of the cache, which can be modified
            for (let key in this.fixedSettings) {
                if (data.hasOwnProperty(key) && this.fixedSettings[key] !== null) { //null is used by autodiscover, do not change real value
                    data[key] = this.fixedSettings[key];
                }
            }
            data.servertype = selection;
            tbSync.db.setAccount(data);

            // load new settings and update gui 
            this.loadSettings();
        }
    },

    unlockSettings: function () {
        if (confirm(tbSync.getLocalizedMessage("prompt.UnlockSettings"))) {
            tbSync.db.setAccountSetting(tbSyncAccountSettings.selectedAccount, "servertype", "custom");
            this.loadSettings();
        }
    },
    
    autodiscoverObserver: {
        observe: function (aSubject, aTopic, aData) {
            //only update if request for this account
            tbSync.dump("DONE","A");
            if (aData == tbSyncAccountSettings.selectedAccount) {
                tbSyncAccountSettings.loadSettings();
                if (tbSync.db.getAccountSetting(aData, "servertype") == "auto") setTimeout(function(){ alert(tbSync.getLocalizedMessage("info.AutodiscoverOk")); }, 100);
            }
        }
    },

    updateGuiObserver: {
        observe: function (aSubject, aTopic, aData) {
            //only update if request for this account
            if (aData == tbSyncAccountSettings.selectedAccount) {
                tbSyncAccountSettings.updateGui();
            }
        }
    },

    updateGui: function () {
        let state = tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, "state"); //connecting, connected, disconnected
        document.getElementById('tbsync.accountsettings.connectbtn').label = tbSync.getLocalizedMessage("state."+state); 
        
        //which box is to be displayed? presets, options or folders
        document.getElementById("tbsync.accountsettings.presets").hidden = (state != "disconnected" || tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, "servertype") != "");

        document.getElementById("tbsync.accountsettings.config.unlock").hidden = (state != "disconnected" || tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, "servertype") == "custom" || tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, "servertype") == ""); 

        document.getElementById("tbsync.accountsettings.options").hidden = (state != "disconnected" || tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, "servertype") == ""); 
        document.getElementById("tbsync.accountsettings.folders").hidden = (state == "disconnected"); 

        //disable all seetings field, if connected or connecting
        for (let i=0; i<this.protectedSettings.length;i++) {
            document.getElementById("tbsync.accountsettings." + this.protectedSettings[i]).disabled = (state != "disconnected" || this.fixedSettings.hasOwnProperty(this.protectedSettings[i]));
        }
        
        this.updateSyncstate();
        this.updateFolderList();
    },


    updateSyncstate: function () {
        let data = tbSync.sync.currentProzess;
        
        // if this account is beeing synced, display syncstate, otherwise print status
        let status = tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, "status");
        let state = tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, "state"); //connecting, connected, disconnected

        if (status == "syncing") {
            let target = "";
            let accounts = tbSync.db.getAccounts().data;
            if (accounts.hasOwnProperty(data.account) && data.folderID !== "" && data.state != "done") { //if "Done" do not print folder info syncstate
                target = " [" + tbSync.db.getFolderSetting(data.account, data.folderID, "name") + "]";
            }
            document.getElementById('syncstate').textContent = tbSync.getLocalizedMessage("syncstate." + data.state) + target;
        } else {
            document.getElementById('syncstate').textContent = tbSync.getLocalizedMessage("status." + status);
        }

        //disable connect/disconnect btn, sync btn and folderlist during sync, also hide sync button if disconnected
        document.getElementById('tbsync.accountsettings.connectbtn').disabled = (status == "syncing" || tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, "servertype") == "");
        document.getElementById('tbsync.accountsettings.folderlist').disabled = (status == "syncing");
        document.getElementById('tbsync.accountsettings.syncbtn').disabled = (status == "syncing");
        document.getElementById('tbsync.accountsettings.syncbtn').hidden = (state == "disconnected");
        
        
    },


    toggleFolder: function () {
        let folderList = document.getElementById("tbsync.accountsettings.folderlist");
        if (folderList.selectedItem !== null && !folderList.disabled) {
            let fID =  folderList.selectedItem.value;
            let folder = tbSync.db.getFolder(tbSyncAccountSettings.selectedAccount, fID, true);

            if (folder.selected == "1") {
                if (window.confirm(tbSync.getLocalizedMessage("prompt.Unsubscribe"))) {
                    //get copy of the current target, before resetting it
                    let target = folder.target;
                    let type = folder.type;

                    //deselect and clean up
                    folder.selected = "0";
                    folder.target = "";
                    folder.synckey = "";
                    folder.lastsynctime = "";
                    folder.status = "";
                    tbSync.db.setFolder(folder);
                    tbSync.db.clearChangeLog(target);

                    if (target != "") tbSync.removeTarget(target, type); //we must remove the target AFTER cleaning up the DB, otherwise the addressbookListener in tbSync.jsm will interfere
                }
            } else {
                //select and update status
                tbSync.db.setFolderSetting(tbSyncAccountSettings.selectedAccount, fID, "selected", "1");
                tbSync.db.setFolderSetting(tbSyncAccountSettings.selectedAccount, fID, "status", "aborted");
                tbSync.db.setAccountSetting(folder.account, "status", "notsyncronized");
                let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                observerService.notifyObservers(null, "tbsync.changedSyncstate", tbSyncAccountSettings.selectedAccount);
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
        return "chrome://tbsync/skin/" + src;
    },


    updateFolderList: function () {
        //do not update folder list, if not visible
        if (document.getElementById("tbsync.accountsettings.folders").hidden) return;
        
        let folderList = document.getElementById("tbsync.accountsettings.folderlist");
        let folders = tbSync.db.getFolders(tbSyncAccountSettings.selectedAccount);
        
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
                            if (type == "8" || type == "13") {
                                if ("calICalendar" in Components.interfaces) status = tbSync.getLocalizedMessage("status." + status) + " ["+ tbSync.getCalendarName(folders[folderIDs[i]].target) + "]";
                                else status = tbSync.getLocalizedMessage("status.nolightning");
                            }
                            if (type == "9" || type == "14") status = tbSync.getLocalizedMessage("status." + status) + " ["+ tbSync.getAddressBookName(folders[folderIDs[i]].target) + "]";
                            break;
                        case "pending":
                            if (folderIDs[i] == tbSync.sync.currentProzess.folderID) status = "syncing"; 
                        default:
                            status = tbSync.getLocalizedMessage("status." + status);
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
        if (document.getElementById('tbsync.accountsettings.connectbtn').disabled || (tbSync.sync.currentProzess.account == tbSyncAccountSettings.selectedAccount)) return;

        let state = tbSync.db.getAccountSetting(tbSyncAccountSettings.selectedAccount, "state"); //connecting, connected, disconnected
        if (state == "connected") {
            //we are connected and want to disconnect
            if (window.confirm(tbSync.getLocalizedMessage("prompt.Disconnect"))) {
                tbSync.sync.disconnectAccount(tbSyncAccountSettings.selectedAccount);
                tbSyncAccountSettings.updateGui();
                let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                observerService.notifyObservers(null, "tbsync.changedSyncstate", tbSyncAccountSettings.selectedAccount);
            }
        } else if (state == "disconnected") {
            //we are disconnected and want to connected
            tbSync.sync.connectAccount(tbSyncAccountSettings.selectedAccount);
            tbSyncAccountSettings.updateGui();
            tbSyncAccountSettings.saveSettings();
            tbSyncAccountSettings.requestSync("sync", tbSyncAccountSettings.selectedAccount);
        }
    },


    /* * *
    * Observer to catch changing syncstate and to update the status info.
    * aData provides an account information, but this observer ignores it and only acts on the currentProzess
    */
    syncstateObserver: {
        observe: function (aSubject, aTopic, aData) {
            //the notification could be send by setSyncState (aData = "") or by tzMessenger (aData = account)
            let account = (aData == "") ? tbSync.sync.currentProzess.account : aData;

            //only handle syncstate changes of the active account
            if (account == tbSyncAccountSettings.selectedAccount) {
                
                if (aData == "" && tbSync.sync.currentProzess.state == "accountdone") {

                        //this syncstate change notification was send by setSyncState
                        let status = tbSync.db.getAccountSetting(tbSync.sync.currentProzess.account, "status");
                        switch (status) {
                            case "401":
                                window.openDialog("chrome://tbsync/content/password.xul", "passwordprompt", "centerscreen,chrome,resizable=no", tbSync.getLocalizedMessage("account").replace("##accountname##", tbSync.db.getAccountSetting(account, "accountname")), account);
                                break;
                            case "OK":
                            case "notsyncronized":
                                //do not pop alert box for these
                                break;
                            default:
                                alert(tbSync.getLocalizedMessage("status." + status));
                        }
                        tbSyncAccountSettings.updateGui();
                        
                } else { 
                    
                        //this syncstate change notification could have been send setSyncState (aData = "") for the currentProcess or by manual notifications from tzmessenger
                        //in either case, the notification is for THIS account
                        tbSyncAccountSettings.updateSyncstate();
                        tbSyncAccountSettings.updateFolderList();
                    
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
                tbSyncAccountSettings.updateFolderList();
            }
        },

        onItemRemoved: function addressbookListener_onItemRemoved (aParentDir, aItem) {
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                tbSyncAccountSettings.updateFolderList();
            }
        },

        add: function addressbookListener_add () {
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .addAddressBookListener(tbSyncAccountSettings.addressbookListener, Components.interfaces.nsIAbListener.all);
        },

        remove: function addressbookListener_remove () {
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .removeAddressBookListener(tbSyncAccountSettings.addressbookListener);
        }
    }

};
