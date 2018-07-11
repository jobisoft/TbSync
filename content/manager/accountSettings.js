"use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountSettings = {

    account: null,
    servertype: null,
    provider: null,
    settings: null,
    fixedSettings: null,
    viewFolderPane: null,
    updateTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

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
        //get the selected account from the loaded URI
        tbSyncAccountSettings.account = window.location.toString().split("id=")[1];

        //get information for that acount
        tbSyncAccountSettings.provider = tbSync.db.getAccountSetting(tbSyncAccountSettings.account, "provider");
        tbSyncAccountSettings.settings = tbSync[tbSyncAccountSettings.provider].ui.getAccountStorageFields();
        tbSyncAccountSettings.alwaysUnlockedSettings = tbSync[tbSyncAccountSettings.provider].ui.getAlwaysUnlockedSettings();
        //also get settings, which might be changed during sync, so need to be updated more often
        tbSyncAccountSettings.viewFolderPane = "on";
    
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
        let hideOptions = isConnected && tbSyncAccountSettings.viewFolderPane == "on";
        
        //which box is to be displayed? options or folders
        document.getElementById("tbsync.accountsettings.unlock").hidden = (isConnected || tbSyncAccountSettings.servertype == "custom"); 
        document.getElementById("tbsync.accountsettings.group.options").hidden = hideOptions;
        document.getElementById("tbsync.accountsettings.group.server").hidden = hideOptions;
        document.getElementById("tbsync.accountsettings.group.folders").hidden = !hideOptions;

        //disable settings if connected or syncing
        let items = document.getElementsByClassName("lockable");
        for (let i=0; i < items.length; i++) {
            items[i].disabled = isConnected || isSyncing;
        }

        //change color and boldness of labels, to direct users focus to the sync status
        items = document.getElementsByClassName("header");
        for (let i=0; i < items.length; i++) {
            items[i].style["color"] = isConnected || isSyncing ? "darkgrey" : "black";
            items[i].disabled = isConnected || isSyncing;            
        }
        

        //update Buttons (get it down to 1 button?)
        if (isSyncing) {
            //we are syncing, either still connection or indeed syncing
            if (isConnected) document.getElementById('tbsync.accountsettings.syncbtn').label = tbSync.getLocalizedMessage("button.syncing");
            else document.getElementById('tbsync.accountsettings.syncbtn').label = tbSync.getLocalizedMessage("button.connecting");            

            //do not display slider while syncing
            document.getElementById('tbsync.accountsettings.slider').hidden = true;
        } else {
            if (isConnected) document.getElementById('tbsync.accountsettings.syncbtn').label = tbSync.getLocalizedMessage("button.syncthis");            
            else document.getElementById('tbsync.accountsettings.syncbtn').label = tbSync.getLocalizedMessage("button.tryagain");            

            //do not display slider if not connected
            document.getElementById('tbsync.accountsettings.slider').hidden = !isConnected;
            document.getElementById('tbsync.accountsettings.slider').src = "chrome://tbsync/skin/slider-"+tbSyncAccountSettings.viewFolderPane+".png";        
        }
        //disable enable/disable btn, sync btn and folderlist during sync, also hide sync button if disabled
        document.getElementById('tbsync.accountsettings.enablebtn').disabled = isSyncing;
        document.getElementById('tbsync.accountsettings.folderlist').disabled = isSyncing;
        document.getElementById('tbsync.accountsettings.syncbtn').disabled = isSyncing;
        
        document.getElementById('tbsync.accountsettings.syncbtn').hidden = !(isEnabled && tbSyncAccountSettings.viewFolderPane == "on");
        document.getElementById('tbsync.accountsettings.enablebtn').hidden = (isEnabled && tbSyncAccountSettings.viewFolderPane == "on");

        if (isEnabled) document.getElementById('tbsync.accountsettings.enablebtn').label = tbSync.getLocalizedMessage("button.disableAndEdit");
        else document.getElementById('tbsync.accountsettings.enablebtn').label = tbSync.getLocalizedMessage("button.enableAndConnect");
        
        
        
        tbSyncAccountSettings.updateFolderList();
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
        
        if (isSyncing) {
            tbSyncAccountSettings.viewFolderPane = "on";
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
            Services.obs.notifyObservers(null, "tbsync.changedAccountName", tbSyncAccountSettings.account + ":" + field.value);
        }
        tbSync.db.saveAccounts(); //write modified accounts to disk
    },

    unlockSettings: function () {
        if (confirm(tbSync.getLocalizedMessage("prompt.UnlockSettings", tbSyncAccountSettings.provider))) {
            tbSync.db.setAccountSetting(tbSyncAccountSettings.account, "servertype", "custom");
            tbSyncAccountSettings.loadSettings();
        }
    },

    switchFoldersAndConfigView: function () {
        if (tbSyncAccountSettings.viewFolderPane == "on") tbSyncAccountSettings.viewFolderPane = "off"; 
        else tbSyncAccountSettings.viewFolderPane = "on";
        tbSyncAccountSettings.updateGui();
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
                Services.obs.notifyObservers(null, "tbsync.changedSyncstate", tbSyncAccountSettings.account);
            }
            tbSyncAccountSettings.updateSyncstate();
            //tbSyncAccountSettings.updateFolderList(); //updateFodlerList is actually changing the content of the folderlist, changing the state of a folder is done by updateSyncstate
        }
    },

    onFolderListContextMenuShowing: function () {
        let folderList = document.getElementById("tbsync.accountsettings.folderlist");
        let hideContextMenuToggleSubscription = true;
        let aFolderIsSelected = (!folderList.disabled && folderList.selectedItem !== null && folderList.selectedItem.value !== undefined);
        
        if (aFolderIsSelected) {
            let fID =  folderList.selectedItem.value;
            let folder = tbSync.db.getFolder(tbSyncAccountSettings.account, fID, true);

            //if any folder is selected, also show ContextMenuToggleSubscription
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
        if (document.getElementById("tbsync.accountsettings.group.folders").hidden) return;
        
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
    * Observer to catch changeing syncstate and to update the status info.
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

};
