/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
 
var core = {

    syncDataObj : null,

    load: async function () {
	this.syncDataObj = {};
    },

    unload: async function () {
    },

    isSyncing: function (account) {
        let status = tbSync.db.getAccountSetting(account, "status"); //global status of the account
        return (status == "syncing");
    },
    
    isEnabled: function (account) {
        let status = tbSync.db.getAccountSetting(account, "status");
        return  (status != "disabled");
    },

    isConnected: function (account) {
        let status = tbSync.db.getAccountSetting(account, "status");
        let folders =  tbSync.db.getFolders(account);
        //check for well defined cached state
        let numberOfValidFolders = Object.keys(folders).filter(f => folders[f].cached == "0").length;
        return (status != "disabled" && numberOfValidFolders > 0);
    },
    
    prepareSyncDataObj: function (account, forceResetOfSyncData = false) {
        if (!this.syncDataObj.hasOwnProperty(account)) {
            this.syncDataObj[account] = new Object();          
        }
        
        if (forceResetOfSyncData) {
            this.syncDataObj[account] = {};
        }
    
        this.syncDataObj[account].account = account;
        this.syncDataObj[account].provider = tbSync.db.getAccountSetting(account, "provider");
    },
    
    getSyncData: function (account, field = "") {
        this.prepareSyncDataObj(account);
        if (field == "") {
            //return entire syncdata obj
            return this.syncDataObj[account];
        } else {
            //return the reqested field with fallback value
            if (this.syncDataObj[account].hasOwnProperty(field)) {
                return this.syncDataObj[account][field];
            } else {
                return "";
            }
        }
    },
        
    setSyncData: function (account, field, value) {
        this.prepareSyncDataObj(account);
        this.syncDataObj[account][field] = value;
    },

    syncAccount: function (job, account = "", folderID = "") {
        //get info of all accounts
        let accounts = tbSync.db.getAccounts();

        //if no account given, loop over all accounts, otherwise only use the provided one
        let accountsToDo = [];        
        if (account == "") {
            //add all enabled accounts to the queue
            for (let i=0; i < accounts.IDs.length; i++) {
                accountsToDo.push(accounts.IDs[i]);
            }
        } else {
            accountsToDo.push(account);
        }
        
        //update gui
        for (let i = 0; i < accountsToDo.length; i++) {
            //do not init sync if there is a sync running or account is not enabled
            if (!this.isEnabled(accountsToDo[i]) || this.isSyncing(accountsToDo[i])) continue;

            //create syncdata object for each account (to be able to have parallel XHR)
            this.prepareSyncDataObj(accountsToDo[i], true);
            
            tbSync.db.setAccountSetting(accountsToDo[i], "status", "syncing");
            this.setSyncData(accountsToDo[i], "syncstate",  "syncing");            
            this.setSyncData(accountsToDo[i], "folderID", folderID);            
            //send GUI into lock mode (syncstate == syncing)
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountSettingsGui", accountsToDo[i]);
            
            tbSync[tbSync.db.getAccountSetting(accountsToDo[i], "provider")].start(this.getSyncData(accountsToDo[i]), job);
        }
        
    },
   
    resetSync: function (provider = null) {
        //get all accounts and set all with syncing status to notsyncronized
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i<accounts.IDs.length; i++) {
            if (provider === null || tbSync.providers.loadedProviders.hasOwnProperty(accounts.data[accounts.IDs[i]].provider)) {
                //reset sync objects
                this.prepareSyncDataObj(accounts.IDs[i], true);
                //set all accounts which are syncing to notsyncronized 
                if (accounts.data[accounts.IDs[i]].status == "syncing") tbSync.db.setAccountSetting(accounts.IDs[i], "status", "notsyncronized");

                // set each folder with PENDING status to ABORTED
                let folders = tbSync.db.findFoldersWithSetting("status", "pending", accounts.IDs[i]);
                for (let f=0; f < folders.length; f++) {
                    tbSync.db.setFolderSetting(accounts.IDs[i], folders[f].folderID, "status", "aborted");
                }
                
                //end current sync and switch to idle
                this.setSyncState("accountdone", accounts.IDs[i]); 
            }
        }
    },

    setTargetModified : function (folder) {
        if (!this.isSyncing(folder.account) && this.isEnabled(folder.account)) {
            tbSync.db.setAccountSetting(folder.account, "status", "notsyncronized");
            tbSync.db.setFolderSetting(folder.account, folder.folderID, "status", "modified");
            //notify settings gui to update status
             Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folder.account);
        }
    },

    // actually remove address books / calendars from TB, based on TB type
    removeTarget: function(target, type) {
        switch (type) {
            case "tb-event":
            case "tb-todo":
                tbSync.lightning.removeCalendar(target);
                break;
            case "tb-contact":
                tbSync.addressbook.removeBook(target);
                break;
            default:
                tbSync.dump("tbSync.core.removeTarget","Unknown type <"+type+">");
        }
    },
    
    //rename target, clear changelog (and remove from DB)
    takeTargetOffline: function(provider, folder, suffix, deleteFolder = true) {
        //decouple folder and target
        let target = folder.target;
        tbSync.db.resetFolderSetting(folder.account, folder.folderID, "target");

        if (target != "") {
            //if there are local changes, append an  (*) to the name of the target
            let c = 0;
            let a = tbSync.db.getItemsFromChangeLog(target, 0, "_by_user");
            for (let i=0; i<a.length; i++) c++;
            if (c>0) suffix += " (*)";

            //this is the only place, where we manually have to call clearChangelog, because the target is not deleted
            //(on delete, changelog is cleared automatically)
            tbSync.db.clearChangeLog(target);
            if (suffix) {
                switch (tbSync[provider].getThunderbirdFolderType(folder.type)) {
                    case "tb-event":
                    case "tb-todo":
                        tbSync.lightning.changeNameOfCalendarAndDisable(target, "Local backup of: %ORIG% " + suffix);
                        break;
                    case "tb-contact":
                        tbSync.addressbook.changeNameOfBook(target, "Local backup of: %ORIG% " + suffix);
                        break;
                    default:
                        tbSync.dump("tbSync.core.takeTargetOffline","Unknown type <"+folder.type+">");
                }
            }
        }
        if (deleteFolder) tbSync.db.deleteFolder(folder.account, folder.folderID);            
    },

    getSyncStatusMsg: function (folder, syncdata, provider) {
        let status = "";
        
        if (folder.selected == "1") {
            //default
            status = tbSync.tools.getLocalizedMessage("status." + folder.status, provider).split("||")[0];

            switch (folder.status.split(".")[0]) { //the status may have a sub-decleration
                case "OK":
                case "modified":
                    switch (tbSync[provider].getThunderbirdFolderType(folder.type)) {
                        case "tb-todo": 
                        case "tb-event": 
                            status = tbSync.lightning.isAvailable() ? status + ": "+ tbSync.lightning.getCalendarName(folder.target) : tbSync.tools.getLocalizedMessage("status.nolightning", provider);
                            break;
                        case "tb-contact": 
                            status =status + ": "+ tbSync.addressbook.getAddressBookName(folder.target);
                            break;
                    }
                    break;
                    
                case "pending":
                    if (syncdata && folder.folderID == syncdata.folderID) {
                        //syncing (there is no extra state for this)
                        status = tbSync.tools.getLocalizedMessage("status.syncing", provider);
                        if (["send","eval","prepare"].includes(syncdata.syncstate.split(".")[0]) && (syncdata.todo + syncdata.done) > 0) {
                            //add progress information
                            status = status + " (" + syncdata.done + (syncdata.todo > 0 ? "/" + syncdata.todo : "") + ")"; 
                        }
                    }

                    break;            
            }
        } else {
            //remain empty if not selected
        }        

        return status;
    },

    finishAccountSync: function (syncdata, error) {
        // set each folder with PENDING status to ABORTED
        let folders = tbSync.db.findFoldersWithSetting("status", "pending", syncdata.account);
        for (let i=0; i < folders.length; i++) {
            tbSync.db.setFolderSetting(syncdata.account, folders[i].folderID, "status", "aborted");
        }

        //update account status
        let status = "OK";
        if (error.type == "JavaScriptError") {
            status = error.type;
            tbSync.errorlog.add("warning", syncdata, status, error.message + "\n\n" + error.stack);
        } else if (!error.failed) {
            //account itself is ok, search for folders with error
            folders = tbSync.db.findFoldersWithSetting("selected", "1", syncdata.account);
            for (let i in folders) {
                let folderstatus = folders[i].status.split(".")[0];
                if (folderstatus != "" && folderstatus != "OK" && folderstatus != "aborted") {
                    status = "foldererror";
                    break;
                }
            }
        } else {
            status = error.message;
            //log this error, if it has not been logged already
            if (!error.logged) { 
                tbSync.errorlog.add("warning", syncdata, status, error.details ? error.details : null);
            }
        }
        
        //done
        tbSync.db.setAccountSetting(syncdata.account, "lastsynctime", Date.now());
        tbSync.db.setAccountSetting(syncdata.account, "status", status);
        this.setSyncState("accountdone", syncdata.account); 
    },

    finishFolderSync: function (syncdata, error) {
        //a folder has been finished, update status
        let time = Date.now();
        let status = "OK";

        if (error.type == "JavaScriptError") {
            status = error.type;
            time = "";
            //do not log javascript errors here, let finishAccountSync handle that
        } else if (error.failed) {
            status = error.message;
            time = "";
            tbSync.errorlog.add("warning", syncdata, status, error.details ? error.details : null);
            //set this error as logged so it does not get logged again by finishAccountSync in case of re-throw
            error.logged = true;
        } else {
            //succeeded, but custom msg?
            if (error.message) {
                status = error.message;
            }
        }

        if (syncdata.folderID != "") {
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "status", status);
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "lastsynctime", time);
        } 

        this.setSyncState("done", syncdata.account);
    },
    
    setSyncState: function (syncstate, account = "", folderID = "") {
        //set new syncstate
        let msg = "State: " + syncstate;
        if (account !== "") msg += ", Account: " + tbSync.db.getAccountSetting(account, "accountname");
        if (folderID !== "") msg += ", Folder: " + tbSync.db.getFolderSetting(account, folderID, "name");

        if (account && syncstate.split(".")[0] == "send") {
            //add timestamp to be able to display timeout countdown
            syncstate = syncstate + "||" + Date.now();
        }

        this.setSyncData(account, "syncstate", syncstate);
        tbSync.dump("setSyncState", msg);

        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", account);
    },



    enableAccount: function(account) {
        let provider = tbSync.db.getAccountSetting(account, "provider");
        tbSync[provider].onEnableAccount(account);
        tbSync.db.setAccountSetting(account, "status", "notsyncronized");
    },

    disableAccount: function(account) {
        let provider = tbSync.db.getAccountSetting(account, "provider");
        tbSync[provider].onDisableAccount(account);
        tbSync.db.setAccountSetting(account, "status", "disabled");
        
        let folders = tbSync.db.getFolders(account);
        for (let i in folders) {
            //cache folder - this must be done before removing the folder to be able to differ between "deleted by user" and "deleted by disable"
            tbSync.db.setFolderSetting(folders[i].account, folders[i].folderID, "cached", "1");

            let target = folders[i].target;
            let type = tbSync[provider].getThunderbirdFolderType(folders[i].type);            
            if (target != "") {
                //remove associated target and clear its changelog
                this.removeTarget(target, type);
            }
        }
    },

    //set all selected folders to "pending", so they are marked for syncing 
    //this also removes all leftover cached folders and sets all other folders to a well defined cached = "0"
    //which will set this account as connected (if at least one folder with cached == "0" is present)
    prepareFoldersForSync: function(account) {
        let folders = tbSync.db.getFolders(account);
        for (let f in folders) {
            //delete all leftover cached folders
            if (folders[f].cached == "1") {
                tbSync.db.deleteFolder(folders[f].account, folders[f].folderID);
                continue;
            } else {
                //set well defined cache state
                tbSync.db.setFolderSetting(folders[f].account, folders[f].folderID, "cached", "0");
            }

            //set selected folders to pending, so they get synced
            if (folders[f].selected == "1") {
                tbSync.db.setFolderSetting(folders[f].account, folders[f].folderID, "status", "pending");
            }
        }
    },
    
}
