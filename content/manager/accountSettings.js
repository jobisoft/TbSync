"use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountSettings = {

    account: null,
    provider: null,
    switchMode: "on",
    updateTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),


    onload: function () {
        //get the selected account from the loaded URI
        tbSyncAccountSettings.account = window.location.toString().split("id=")[1];
        tbSyncAccountSettings.provider = tbSync.db.getAccountSetting(tbSyncAccountSettings.account, "provider");
        
        tbSync.prepareSyncDataObj(tbSyncAccountSettings.account);

        tbSyncAccountSettings.loadSettings();
        
        Services.obs.addObserver(tbSyncAccountSettings.syncstateObserver, "tbsync.changedSyncstate", false);
        Services.obs.addObserver(tbSyncAccountSettings.updateGuiObserver, "tbsync.updateAccountSettingsGui", false);

        document.getElementById('tbsync.accountsettings.frame').hidden = false;	    
    },


    onunload: function () {
        tbSyncAccountSettings.updateTimer.cancel();
        if (!document.getElementById('tbsync.accountsettings.frame').hidden) {
            Services.obs.removeObserver(tbSyncAccountSettings.syncstateObserver, "tbsync.changedSyncstate");
            Services.obs.removeObserver(tbSyncAccountSettings.updateGuiObserver, "tbsync.updateAccountSettingsGui");
        }
    },
    

    /**
     * Run through all defined TbSync settings and if there is a corresponding
     * field in the settings dialog, fill it with the stored value.
     */
    loadSettings: function () {
        let settings = tbSync[tbSyncAccountSettings.provider].getAccountStorageFields();
        let servertype = tbSync.db.getAccountSetting(tbSyncAccountSettings.account, "servertype");
        let fixedSettings = tbSync[tbSyncAccountSettings.provider].getFixedServerSettings(servertype);

        for (let i=0; i<settings.length;i++) {
            if (document.getElementById("tbsync.accountsettings." + settings[i])) {
                //is this a checkbox?
                if (document.getElementById("tbsync.accountsettings." + settings[i]).tagName == "checkbox") {
                    //BOOL
                    if (tbSync.db.getAccountSetting(tbSyncAccountSettings.account, settings[i])  == "1") document.getElementById("tbsync.accountsettings." + settings[i]).checked = true;
                    else document.getElementById("tbsync.accountsettings." + settings[i]).checked = false;
                    
                } else {
                    //Not BOOL
                    document.getElementById("tbsync.accountsettings." + settings[i]).value = tbSync.db.getAccountSetting(tbSyncAccountSettings.account, settings[i]);
                    
                }
                
                if (fixedSettings.hasOwnProperty(settings[i])) document.getElementById("tbsync.accountsettings." + settings[i]).disabled = true;
                else document.getElementById("tbsync.accountsettings." + settings[i]).disabled = false;
                
            }
        }
        
        // special treatment for configuration label
        document.getElementById("tbsync.accountsettings.config.label").value= tbSync.getLocalizedMessage("config." + servertype, tbSyncAccountSettings.provider);

        tbSyncAccountSettings.updateGui();
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
        tbSync.db.setAccountSetting(tbSyncAccountSettings.account, setting, value);
        
        if (setting == "accountname") {
            Services.obs.notifyObservers(null, "tbsync.changedAccountName", tbSyncAccountSettings.account + ":" + field.value);
        }
        tbSync.db.saveAccounts(); //write modified accounts to disk
    },


    stripHost: function () {
        let host = document.getElementById('tbsync.accountsettings.host').value;
        if (host.indexOf("https://") == 0) {
            host = host.replace("https://","");
            document.getElementById('tbsync.accountsettings.https').checked = true;
            tbSync.db.setAccountSetting(tbSyncAccountSettings.account, "https", "1");
        } else if (host.indexOf("http://") == 0) {
            host = host.replace("http://","");
            document.getElementById('tbsync.accountsettings.https').checked = false;
            tbSync.db.setAccountSetting(tbSyncAccountSettings.account, "https", "0");
        }
        
        while (host.endsWith("/")) { host = host.slice(0,-1); }        
        document.getElementById('tbsync.accountsettings.host').value = host
        tbSync.db.setAccountSetting(tbSyncAccountSettings.account, "host", host);
    },

    unlockSettings: function () {
        if (confirm(tbSync.getLocalizedMessage("prompt.UnlockSettings", tbSyncAccountSettings.provider))) {
            tbSync.db.setAccountSetting(tbSyncAccountSettings.account, "servertype", "custom");
            tbSyncAccountSettings.loadSettings();
        }
    },






    updateGui: function () {
        let status = tbSync.db.getAccountSetting(tbSyncAccountSettings.account, "status");
        let neverLockedFields = ["autosync"];

        let isConnected = tbSync.isConnected(tbSyncAccountSettings.account);
        let isEnabled = tbSync.isEnabled(tbSyncAccountSettings.account);      
        let isSyncing = tbSync.isSyncing(tbSyncAccountSettings.account);
        let hideOptions = isConnected && tbSyncAccountSettings.switchMode == "on";
        
        //which box is to be displayed? options or folders
        document.getElementById("tbsync.accountsettings.config.unlock").hidden = (isConnected || tbSync.db.getAccountSetting(tbSyncAccountSettings.account, "servertype") == "custom"); 
        document.getElementById("tbsync.accountsettings.options").hidden = hideOptions;
        document.getElementById("tbsync.accountsettings.server").hidden = hideOptions;
        document.getElementById("tbsync.accountsettings.folders").hidden = !hideOptions;

        //disable settings if connected
        let settings = tbSync[tbSyncAccountSettings.provider].getAccountStorageFields();
        let servertype = tbSync.db.getAccountSetting(tbSyncAccountSettings.account, "servertype");
        let fixedSettings = tbSync[tbSyncAccountSettings.provider].getFixedServerSettings(servertype);
        for (let i=0; i<settings.length;i++) {
            if (neverLockedFields.includes(settings[i])) continue;
            if (document.getElementById("tbsync.accountsettings." + settings[i])) document.getElementById("tbsync.accountsettings." + settings[i]).disabled = (isConnected || isSyncing || fixedSettings.hasOwnProperty(settings[i])); 
            if (document.getElementById("tbsync.accountsettingslabel." + settings[i])) document.getElementById("tbsync.accountsettingslabel." + settings[i]).disabled = isConnected || isSyncing; 
        }

        //change color and boldness of labels, to direct users focus to the sync status
        document.getElementById("tbsync.accountsettings.config.label").style["color"] = isConnected || isSyncing ? "darkgrey" : "black";
        document.getElementById("tbsync.accountsettings.contacts.label").style["color"] = isConnected || isSyncing ? "darkgrey" : "black";
        document.getElementById("tbsync.accountsettings.general.label").style["color"] = isConnected || isSyncing ? "darkgrey" : "black";
        
        tbSyncAccountSettings.updateSyncstate();
        tbSyncAccountSettings.updateFolderList();
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
        
        if (isSyncing) {
            tbSyncAccountSettings.switchMode = "on";
            let syncdata = tbSync.getSyncData(tbSyncAccountSettings.account);
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

            //we are syncing, either still connection or indeed syncing
            if (isConnected) document.getElementById('tbsync.accountsettings.syncbtn').label = tbSync.getLocalizedMessage("status.syncing", tbSyncAccountSettings.provider);
            else document.getElementById('tbsync.accountsettings.syncbtn').label = tbSync.getLocalizedMessage("status.connecting", tbSyncAccountSettings.provider);            

            //do not display slider while syncing
            document.getElementById('tbsync.accountsettings.slider').hidden = true;
            
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
            
            if (isConnected) document.getElementById('tbsync.accountsettings.syncbtn').label = tbSync.getLocalizedMessage("button.syncthis", tbSyncAccountSettings.provider);            
            else document.getElementById('tbsync.accountsettings.syncbtn').label = tbSync.getLocalizedMessage("button.tryagain", tbSyncAccountSettings.provider);            

            //do not display slider if not connected
            document.getElementById('tbsync.accountsettings.slider').hidden = !isConnected;
            document.getElementById('tbsync.accountsettings.slider').src = "chrome://tbsync/skin/slider-"+tbSyncAccountSettings.switchMode+".png";
        
        }

        //disable enable/disable btn, sync btn and folderlist during sync, also hide sync button if disabled
        document.getElementById('tbsync.accountsettings.enablebtn').disabled = isSyncing;
        document.getElementById('tbsync.accountsettings.folderlist').disabled = isSyncing;
        document.getElementById('tbsync.accountsettings.syncbtn').disabled = isSyncing;
        
        document.getElementById('tbsync.accountsettings.syncbtn').hidden = !(isEnabled && tbSyncAccountSettings.switchMode == "on");
        document.getElementById('tbsync.accountsettings.enablebtn').hidden = (isEnabled && tbSyncAccountSettings.switchMode == "on");

        if (isEnabled) document.getElementById('tbsync.accountsettings.enablebtn').label = tbSync.getLocalizedMessage("button.disableAndEdit", tbSyncAccountSettings.provider);
        else document.getElementById('tbsync.accountsettings.enablebtn').label = tbSync.getLocalizedMessage("button.enableAndConnect", tbSyncAccountSettings.provider);
    },


    toggleFolder: function () {
        let folderList = document.getElementById("tbsync.accountsettings.folderlist");
        if (folderList.selectedItem !== null && !folderList.disabled) {
            let fID =  folderList.selectedItem.value;
            let folder = tbSync.db.getFolder(tbSyncAccountSettings.account, fID, true);

            if (!tbSync.isEnabled(folder.account))
                return;
        
            if (folder.selected == "1") {
                if (window.confirm(tbSync.getLocalizedMessage("prompt.Unsubscribe", tbSyncAccountSettings.provider))) {
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
                Services.obs.notifyObservers(null, "tbsync.changedSyncstate", tbSyncAccountSettings.account);
                tbSyncAccountSettings.updateSyncstate();
            }
            tbSyncAccountSettings.updateFolderList();
        }
    },

    updateMenuPopup: function () {
        let folderList = document.getElementById("tbsync.accountsettings.folderlist");
        let hideContextMenuDelete = true;
        let hideContextMenuToggleSubscription = true;

        if (!folderList.disabled && folderList.selectedItem !== null && folderList.selectedItem.value !== undefined) {
            let fID =  folderList.selectedItem.value;
            let folder = tbSync.db.getFolder(tbSyncAccountSettings.account, fID, true);

            //if any folder is selected, also show ContextMenuToggleSubscription
            hideContextMenuToggleSubscription = false;
            if (folder.selected == "1") {
                document.getElementById("tbsync.accountsettings.ContextMenuToggleSubscription").label = tbSync.getLocalizedMessage("subscribe.off::" + folder.name, tbSyncAccountSettings.provider);
            } else {
                document.getElementById("tbsync.accountsettings.ContextMenuToggleSubscription").label = tbSync.getLocalizedMessage("subscribe.on::" + folder.name, tbSyncAccountSettings.provider);
            }
            
            //if a folder in trash is selected, also show ContextMenuDelete (but only if FolderDelete is allowed)
            if (tbSync[tbSyncAccountSettings.provider].parentIsTrash(tbSyncAccountSettings.account, folder.parentID) && tbSync.db.getAccountSetting(tbSyncAccountSettings.account, "allowedEasCommands").split(",").includes("FolderDelete")) {// folder in recycle bin
                hideContextMenuDelete = false;
                document.getElementById("tbsync.accountsettings.ContextMenuDelete").label = tbSync.getLocalizedMessage("deletefolder.menuentry::" + folder.name, tbSyncAccountSettings.provider);
            }
        }
        
        document.getElementById("tbsync.accountsettings.ContextMenuDelete").hidden = hideContextMenuDelete;
        document.getElementById("tbsync.accountsettings.ContextMenuToggleSubscription").hidden = hideContextMenuToggleSubscription;
    },

    getIdChain: function (allowedTypesOrder, account, folderID) {
        //create sort string so that child folders are directly below their parent folders, different folder types are grouped and trashed folders at the end
        let folder = folderID;
        let parent = tbSync.db.getFolder(account, folderID).parentID;
        let chain = folder.toString().padStart(3,"0");
        
        while (parent && parent != "0") {
            chain = parent.toString().padStart(3,"0") + "." + chain;
            folder = parent;
            parent = tbSync.db.getFolder(account, folder).parentID;
        };
        
        let pos = allowedTypesOrder.indexOf(tbSync.db.getFolder(account, folder).type);
        chain = (pos == -1 ? "U" : pos).toString().padStart(3,"0") + "." + chain;
        return chain;
    },    

    updateFolderList: function () {
        //do not update folder list, if not visible
        if (document.getElementById("tbsync.accountsettings.folders").hidden) return;
        
        let folderList = document.getElementById("tbsync.accountsettings.folderlist");
        let folders = tbSync.db.getFolders(tbSyncAccountSettings.account);

        //sort by specified order, trashed folders are moved to the end
        let allowedTypesOrder = ["9","14","8","13","7","15"];
        let folderIDs = Object.keys(folders).sort((a, b) => (tbSyncAccountSettings.getIdChain(allowedTypesOrder, tbSyncAccountSettings.account, a).localeCompare(tbSyncAccountSettings.getIdChain(allowedTypesOrder, tbSyncAccountSettings.account, b))));

        //get current folders in list and remove entries of folders no longer there
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
            if (allowedTypesOrder.indexOf(folders[folderIDs[i]].type) != -1) { 
                let selected = (folders[folderIDs[i]].selected == "1");
                let type = folders[folderIDs[i]].type;
                let status = (selected) ? folders[folderIDs[i]].status : "";
                let name = folders[folderIDs[i]].name ;
                if (tbSync[tbSyncAccountSettings.provider].parentIsTrash(tbSyncAccountSettings.account, folders[folderIDs[i]].parentID)) name = tbSync.getLocalizedMessage("recyclebin", tbSyncAccountSettings.provider)+" | "+name;

                //if status OK, print target
                if (selected) {
                    switch (status) {
                        case "OK":
                        case "modified":
                            if (type == "7" || type == "15" || type == "8" || type == "13") {
                                if (tbSync.lightningIsAvailable()) status = tbSync.getLocalizedMessage("status." + status, tbSyncAccountSettings.provider) + ": "+ tbSync.getCalendarName(folders[folderIDs[i]].target);
                                else status = tbSync.getLocalizedMessage("status.nolightning", tbSyncAccountSettings.provider);
                            }
                            if (type == "9" || type == "14") status = tbSync.getLocalizedMessage("status." + status, tbSyncAccountSettings.provider) + ": "+ tbSync.getAddressBookName(folders[folderIDs[i]].target);
                            break;
                        case "pending":
                            let syncdata = tbSync.getSyncData(tbSyncAccountSettings.account);
                            status = tbSync.getLocalizedMessage("status." + status, tbSyncAccountSettings.provider);
                            if (folderIDs[i] == syncdata.folderID) {
                                status = tbSync.getLocalizedMessage("status.syncing", tbSyncAccountSettings.provider);
                                if (["send","eval","prepare"].includes(syncdata.syncstate.split(".")[0]) && (syncdata.todo + syncdata.done) > 0) status = status + " (" + syncdata.done + (syncdata.todo>0 ? "/" + syncdata.todo : "") + ")"; 
                            }
                            status = status + " ...";
                            break;
                        default:
                            status = tbSync.getLocalizedMessage("status." + status, tbSyncAccountSettings.provider);
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
                        itemType.setAttribute("src", tbSync.getTypeImage(tbSync[tbSyncAccountSettings.provider].getThunderbirdFolderType(type)));
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
                    
                    tbSyncAccountSettings.updateCell(item.childNodes[1], ["label","tooltiptext"], name);
                    tbSyncAccountSettings.updateCell(item.childNodes[2], ["label","tooltiptext"], status);
                    if (selected) {
                        tbSyncAccountSettings.updateCell(item.childNodes[1], ["style"], "font-style:normal;");
                        tbSyncAccountSettings.updateCell(item.childNodes[1], ["disabled"], "false");
                    } else {
                        tbSyncAccountSettings.updateCell(item.childNodes[1], ["style"], "font-style:italic;");
                        tbSyncAccountSettings.updateCell(item.childNodes[1], ["disabled"], "true");
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

    switchFoldersAndConfigView: function () {
        if (tbSyncAccountSettings.switchMode == "on") tbSyncAccountSettings.switchMode = "off"; 
        else tbSyncAccountSettings.switchMode = "on";
        tbSyncAccountSettings.updateGui();
    },
    
    updateDisableContextMenu: function () {
        document.getElementById("contextMenuDisableAccount").disabled = tbSync.isSyncing(tbSyncAccountSettings.account);
    },
    
    /* * *
    * This function is executed, when the user hits the enable/disable button. On disable, all
    * sync targets are deleted and the settings can be changed again. On enable, a new sync is 
    * initiated.
    */
    toggleEnableState: function () {
        //ignore cancel request, if button is disabled or a sync is ongoing
        if (document.getElementById('tbsync.accountsettings.enablebtn').disabled || tbSync.isSyncing(tbSyncAccountSettings.account)) return;

        Services.obs.notifyObservers(null, "tbsync.toggleEnableState", tbSyncAccountSettings.account);        
    },






    updateGuiObserver: {
        observe: function (aSubject, aTopic, aData) {
            //only update if request for this account
            if (aData == tbSyncAccountSettings.account) {
        
                //if this is called while beeing disabled, clear the folderlist, so we start fresh on next re-enable
                if (!tbSync.isEnabled(aData)) {
                    let folderList = document.getElementById("tbsync.accountsettings.folderlist");
                    for (let i=folderList.getRowCount()-1; i>=0; i--) {
                        folderList.removeItemAt(i);
                    }
                }
                
                tbSyncAccountSettings.loadSettings();
            }
            Services.obs.notifyObservers(null, "tbsync.changedSyncstate", aData);
        }
    },

    /* * *
    * Observer to catch changing syncstate and to update the status info.
    */    
    syncstateObserver: {
        observe: function (aSubject, aTopic, aData) {
            let account = aData;            
            let msg = null;
            
            //only handle syncstate changes of the active account
            if (account == tbSyncAccountSettings.account) {
                
                let syncstate = tbSync.getSyncData(account,"syncstate");
                if (syncstate == "accountdone") {
                        let status = tbSync.db.getAccountSetting(account, "status");
                        switch (status) {
                            case "401":
                                window.openDialog("chrome://tbsync/content/manager/password.xul", "passwordprompt", "centerscreen,chrome,resizable=no", tbSync.db.getAccount(account), function() {tbSync.syncAccount("sync", account);});
                                break;
                            case "OK":
                            case "notsyncronized":
                            case "disabled":
                                //do not pop alert box for these
                                break;
                            default:
                                msg = tbSync.getLocalizedMessage("status." + status, tbSyncAccountSettings.provider);
                        }
                }
                
                if (syncstate == "connected" || syncstate == "syncing" || syncstate == "accountdone") tbSyncAccountSettings.updateGui();
                else {
                    tbSyncAccountSettings.updateFolderList();
                    tbSyncAccountSettings.updateSyncstate();
                }
            }
        }
    },





    //FUNCTIONS INVOKED BY CUSTOM POPUPS
    deleteFolder: function() {
        let folderList = document.getElementById("tbsync.accountsettings.folderlist");
        if (folderList.selectedItem !== null && !folderList.disabled) {
            let fID =  folderList.selectedItem.value;
            let folder = tbSync.db.getFolder(tbSyncAccountSettings.account, fID, true);

            //only trashed folders can be purged (for example O365 does not show deleted folders but also does not allow to purge them)
            if (!tbSync[tbSyncAccountSettings.provider].parentIsTrash(tbSyncAccountSettings.account, folder.parentID)) return;
            
            if (folder.selected == "1") alert(tbSync.getLocalizedMessage("deletefolder.notallowed::" + folder.name, tbSyncAccountSettings.provider));
            else if (confirm(tbSync.getLocalizedMessage("deletefolder.confirm::" + folder.name, tbSyncAccountSettings.provider))) {
                tbSync.syncAccount("deletefolder", tbSyncAccountSettings.account, fID);
            } 
        }            
    },

};
