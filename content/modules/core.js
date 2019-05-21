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
        if (!this.syncDataObj.hasOwnProperty(account) || forceResetOfSyncData) {
            this.syncDataObj[account] = new SyncData(account);          
        } else {
            this.syncDataObj[account].account = account;
        }
    },
    
    getSyncDataObject: function (account) {
        this.prepareSyncDataObj(account);
        return this.syncDataObj[account];        
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
            //i have no idea whey they are here
            //this.getSyncDataObject(accountsToDo[i]).syncstate = "syncing";            
            //this.getSyncDataObject(accountsToDo[i]).folderID = folderID;            
            //send GUI into lock mode (status == syncing)
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountSettingsGui", accountsToDo[i]);
            
            // core async sync function, but we do not wait until it has finished,
            // but return right away and initiate all remaining accounts parallel
            this.syncSingleAccount(job, this.getSyncDataObject(accountsToDo[i]));
        }
    },
   
    getNextPendingFolder: function (syncdata) {
        //using getSortedData, to sync in the same order as shown in the list
        let sortedFolders = tbSync.providers[syncdata.getAccountSetting("provider")].folderList.getSortedData(syncdata.account);
        for (let i=0; i < sortedFolders.length; i++) {
            if (sortedFolders[i].statusCode != "pending") continue;
            syncdata.folderID = sortedFolders[i].folderID;
            return true;
        }
        syncdata.folderID = "";
        return false;
    },
    
    syncSingleAccount: async function (job, syncdata) {
        //clear folderID of syncdata, just to make sure
        syncdata.folderID = "";
        
        //check for default sync job
        if (job == "sync") {
            
            let listStatusData = await tbSync.providers[syncdata.getAccountSetting("provider")].api.syncFolderList(syncdata);
            
            //if we have an error during folderList sync, there is no need to go on
            if (listStatusData.type != tbSync.StatusData.SUCCESS) {
                this.finishAccountSync(syncdata, listStatusData);
                return;
            }
            
            //set all selected folders to "pending", so they are marked for syncing
            //this also removes all leftover cached folders and sets all other folders to a well defined cached = "0"
            //which will set this account as connected (if at least one folder with cached == "0" is present)
            this.prepareFoldersForSync(syncdata.account);

            // update folder list in GUI
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateFolderList", syncdata.account);

            let overallStatusData = new tbSync.StatusData();

            // if any folder was found, sync
            if (this.isConnected(syncdata.account)) {
                do {
                    // getNextPendingFolder will set or clear folderID of syncdata
                    if (!this.getNextPendingFolder(syncdata)) {
                        break;
                    }
                    let folderStatusData = await tbSync.providers[syncdata.getAccountSetting("provider")].api.syncFolder(syncdata);
                    this.finishFolderSync(syncdata, folderStatusData);

                    //if one of the folders indicated an ERROR, abort sync
                    if (folderStatusData.type == tbSync.StatusData.ERROR) {
                        break;
                    }
                } while (true);
            } else {
                overallStatusData = new tbSync.StatusData(tbSync.StatusData.ERROR, "no-folders-found-on-server");
            }
            this.finishAccountSync(syncdata, overallStatusData);

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
                tbSync.core.getSyncDataObject(accounts.IDs[i]).setSyncState("accountdone"); 
            }
        }
    },

    setTargetModified: function (folder) {
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
                switch (tbSync.providers[provider].api.getThunderbirdFolderType(folder.type)) {
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
    
    enableAccount: function(account) {
        let accountData = new AccountData(account);
        tbSync.providers[accountData.getAccountSetting("provider")].api.onEnableAccount(accountData);
        accountData.setAccountSetting("status", "notsyncronized");
        accountData.resetAccountSetting("lastsynctime");        
    },

    disableAccount: function(account) {
        let accountData = new AccountData(account);
        tbSync.providers[accountData.getAccountSetting("provider")].api.onDisableAccount(accountData);
        accountData.setAccountSetting("status", "disabled");
        
        let folders = tbSync.db.getFolders(account);
        for (let i in folders) {
            //cache folder - this must be done before removing the folder to be able to differ between "deleted by user" and "deleted by disable"
            tbSync.db.setFolderSetting(folders[i].account, folders[i].folderID, "cached", "1");

            let target = folders[i].target;
            let type = tbSync.providers[accountData.getAccountSetting("provider")].api.getThunderbirdFolderType(folders[i].type);            
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
    
    finishFolderSync: function(syncdata, statusData) {        
        if (statusData.type != tbSync.StatusData.SUCCESS) {
            //report error
            tbSync.errorlog.add(statusData.type, syncdata.ownerData, statusData.message, statusData.details);
        }
        
        //if this is a success, prepend success to the status message, 
        //otherwise just set the message
        let status;
        if (statusData.type == tbSync.StatusData.SUCCESS || statusData.message == "") {
            status = statusData.type;
            if (statusData.message) status = status + "." + statusData.message;
        } else {
            status = statusData.message;
        }
        
        if (syncdata.hasFolderData()) {
            syncdata.setFolderSetting("status", status);
            syncdata.setFolderSetting("lastsynctime", Date.now());
            //clear folderID to fall back to account-only-mode (folder is done!)
            syncdata.folderID = "";
        } 

       syncdata.setSyncState("done");        
    },

    finishAccountSync: function(syncdata, statusData) {
        // set each folder with PENDING status to ABORTED
        let folders = tbSync.db.findFoldersWithSetting("status", "pending", syncdata.account);
        for (let i=0; i < folders.length; i++) {
            tbSync.db.setFolderSetting(syncdata.account, folders[i].folderID, "status", "aborted");
        }
        
        //if this is a success, prepend success to the status message, 
        //otherwise just set the message
        let status;
        if (statusData.type == tbSync.StatusData.SUCCESS || statusData.message == "") {
            status = statusData.type;
            if (statusData.message) status = status + "." + statusData.message;
        } else {
            status = statusData.message;
        }

        
        if (statusData.type != tbSync.StatusData.SUCCESS) {
            //report error
            tbSync.errorlog.add("warning", syncdata.ownerData, statusData.message, statusData.details);
        } else {
            //account itself is ok, search for folders with error
            folders = tbSync.db.findFoldersWithSetting("selected", "1", syncdata.account);
            for (let i in folders) {
                let folderstatus = folders[i].status.split(".")[0];
                if (folderstatus != "" && folderstatus != tbSync.StatusData.SUCCESS && folderstatus != "aborted") {
                    status = "foldererror";
                    break;
                }
            }
        }    
        
        //done
        tbSync.db.setAccountSetting(syncdata.account, "lastsynctime", Date.now());
        tbSync.db.setAccountSetting(syncdata.account, "status", status);
        syncdata.setSyncState("accountdone"); 
    }    
    
}
