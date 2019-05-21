/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var OwnerData = class {
    constructor(provider, accountname, foldername = "") {
        this.provider = provider;
        this.accountname = accountname;
        this.foldername = foldername;
    }
}

var AccountData = class { //rename to AccountDataObject
    constructor(accountID, folderID = "") {
        //internal (private, not to be touched by provider)
        this.account = accountID;
        this.folderID = folderID;

        if (tbSync.db.accounts.data.hasOwnProperty(accountID) == false ) {
            throw new Error("An account with ID <" + accountID + "> does not exist. Failed to create AccountData.");
        }

        if (this.hasFolderData() && !tbSync.db.folders[accountID].hasOwnProperty(folderID)) {
            throw new Error("A folder with ID <" + folderID + "> does not exist for the given account. Failed to create AccountData.");
        }
    }

    hasFolderData() {
        return (this.folderID !== "");
    }
    
    // get data objects
    get ownerData() {
        return new OwnerData(
            this.getAccountSetting("provider"),
            this.getAccountSetting("accountname"),
            this.hasFolderData() ? this.getFolderSetting("name") : "",
        );
    }

    get providerData() {
        return new ProviderData(
            this.getAccountSetting("provider"),
        );
    }    

    passwordPrompt(window = null) {
        // default to main Thunderbird window
        let w = window ? window : tbSync.window;
        
        // only popup one password prompt per account
        if (!tbSync.manager.passWindowObjs.hasOwnProperty[this.account] || tbSync.manager.passWindowObjs[this.account] === null) {
            let defaultUrl = "chrome://tbsync/content/manager/password.xul";
            let userUrl = tbSync.providers[this.getAccountSetting("provider")].auth.getAuthPromptXulUrl();
            tbSync.manager.passWindowObjs[this.account] = w.openDialog(userUrl ? userUrl : defaultUrl, "passwordprompt", "centerscreen,chrome,resizable=no", this);
        }        
    }

    // shortcuts
    sync(job = "sync") {
        tbSync.core.syncAccount(job, this.account)
    }

    isSyncing() {
        return tbSync.core.isSyncing(this.account);
    }
    
    isEnabled() {
        return tbSync.core.isEnabled(this.account);
    }

    isConnected() {
        return tbSync.core.isConnected(this.account);
    }
    

    getAccountSetting(field) {
        return tbSync.db.getAccountSetting(this.account, field);
    }

    setAccountSetting(field, value) {
        tbSync.db.setAccountSetting(this.account, field, value);
    }
    
    resetAccountSetting(field) {
        tbSync.db.resetAccountSetting(this.account, field);
    }


    getFolderSetting(field) {
        if (this.hasFolderData()) {
            return tbSync.db.getFolderSetting(this.account, this.folderID, field);
        } else {
            throw new Error("No folder set.");
        }
    }
    
    setFolderSetting(field, value) {
        if (this.hasFolderData()) {
            tbSync.db.setFolderSetting(this.account, this.folderID, field, value);
        } else {
            throw new Error("No folder set.");
        }
    }

    resetFolderSetting(field) {
        if (this.hasFolderData()) {
            tbSync.db.resetFolderSetting(this.account, this.folderID, field);
        } else {
            throw new Error("No folder set.");
        }
    }

}

//there is only one syncdata object per account which contains the current state of the sync
//if you just need an object to manipulate an account or folder, use AccountData
var SyncData = class extends AccountData {
    constructor(account) {
        super(account)

        //internal (private, not to be touched by provider)
        this._syncstate = "";
        this.jsErrorCached = null;
        this.isFolderSync = false;
        this.hasError = false;

        // used by getSyncStatus (getter / setter )  ? 
        //resetProcess(done, todo)
        //incrementProcess(value)
        //setProcess(value)
        this.todo = 0;
        this.done = 0;
    }

    //all functions provider should use should be in here
    //providers should not modify properties directly
    //try to eliminate account and folderID usage
    //icons must use db check and not just directory property, to see "dead" folders
    //get setSyncStatus out of the loop and let functions return an object with the needed data
    //hide cache management

    //when getSyncDataObj is used never change the folder id as a sync may be going on!
    
    //setTargetModified
    //takeTargetOffline
    //removeTarget
    
    setSyncState(syncstate) {
        //set new syncstate
        let msg = "State: " + syncstate;
        if (this.account) msg += ", Account: " + this.getAccountSetting("accountname");
        if (this.account && this.folderID) msg += ", Folder: " + this.getFolderSetting("name");

        if (syncstate.split(".")[0] == "send") {
            //add timestamp to be able to display timeout countdown
            syncstate = syncstate + "||" + Date.now();
        }

        this._syncstate = syncstate;
        tbSync.dump("setSyncState", msg);

        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", this.account);
    }
    
    getSyncState() {
        return this._syncstate;
    }
        
    getSyncStatus(folder) {
        let status = "";
        
        if (folder.selected == "1") {
            //default
            status = tbSync.tools.getLocalizedMessage("status." + folder.status, this.getAccountSetting("provider")).split("||")[0];

            switch (folder.status.split(".")[0]) { //the status may have a sub-decleration
                case "OK":
                case "modified":
                    switch (tbSync.providers[this.getAccountSetting("provider")].api.getThunderbirdFolderType(folder.type)) {
                        case "tb-todo": 
                        case "tb-event": 
                            status = tbSync.lightning.isAvailable() ? status + ": "+ tbSync.lightning.getCalendarName(folder.target) : tbSync.tools.getLocalizedMessage("status.nolightning", this.getAccountSetting("provider"));
                            break;
                        case "tb-contact": 
                            status =status + ": "+ tbSync.addressbook.getAddressBookName(folder.target);
                            break;
                    }
                    break;
                    
                case "pending":
                    if (folder.folderID == this.folderID) {
                        //syncing (there is no extra state for this)
                        status = tbSync.tools.getLocalizedMessage("status.syncing", this.getAccountSetting("provider"));
                        if (["send","eval","prepare"].includes(this._syncstate.split(".")[0]) && (this.todo + this.done) > 0) {
                            //add progress information
                            status = status + " (" + this.done + (this.todo > 0 ? "/" + this.todo : "") + ")"; 
                        }
                    }

                    break;            
            }
        } else {
            //remain empty if not selected
        }        

        return status;
    }
    
    setSyncStatus(msg, details) {
        if (this.isFolderSync) {
            tbSync.core.finishFolderSync(this, msg, details);
        } else {
            tbSync.core.finishAccountSync(this, msg, details);
        }
    }    
}


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
        syncdata.isFolderSync = false;
        //check for default sync job
        if (job == "sync") {
            
            await tbSync.providers[syncdata.getAccountSetting("provider")].api.syncFolderList(syncdata);
            //if we have an error during folderList sync, there is no need to go on
            if (syncdata.hasError) {
                return;
            }
            
            //set all selected folders to "pending", so they are marked for syncing
            //this also removes all leftover cached folders and sets all other folders to a well defined cached = "0"
            //which will set this account as connected (if at least one folder with cached == "0" is present)
            this.prepareFoldersForSync(syncdata.account);

            // update folder list in GUI
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateFolderList", syncdata.account);

            // if any folder was found, sync
            if (this.isConnected(syncdata.account)) {
                syncdata.isFolderSync = true;
                do {
                    if (!this.getNextPendingFolder(syncdata)) {
                        break;
                    }
                    let doNext = await tbSync.providers[syncdata.getAccountSetting("provider")].api.syncFolder(syncdata);
                    if (!doNext) { //use hasError??
                        break;
                    }
                } while (true);
                this.finishAccountSync(syncdata);
            } else {
                this.finishAccountSync(syncdata, "no-folders-found-on-server");
            }
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
    
    finishFolderSync: function(syncdata, msg = "OK", details = null) {        
        // JavaScriptErrors are not handled here, but get cached
        syncdata.jsErrorCached = (msg == "JavaScriptError") ? {msg, details} : null;
        
        if (!msg.startsWith("OK") && !syncdata.jsErrorCached) {
             tbSync.errorlog.add("warning", syncdata.ownerData, msg, details);
        }

        if (syncdata.folderID) {
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "status", msg);
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "lastsynctime", Date.now());
            syncdata.folderID = "";
        } 

       syncdata.setSyncState("done");        
    },

    finishAccountSync: function(syncdata, msg = "OK", details = null) {
        // set each folder with PENDING status to ABORTED
        let folders = tbSync.db.findFoldersWithSetting("status", "pending", syncdata.account);
        for (let i=0; i < folders.length; i++) {
            tbSync.db.setFolderSetting(syncdata.account, folders[i].folderID, "status", "aborted");
        }
        
        //update account status
        let status = msg;
        
        if (syncdata.jsErrorCached) {
            //report cached js error 
            status = syncdata.jsErrorCached.msg;
            tbSync.errorlog.add("warning", syncdata.ownerData, syncdata.jsErrorCached.msg, syncdata.jsErrorCached.details);
            syncdata.jsErrorCached = null;
        } else if (!msg.startsWith("OK")) {
            //report local error
            tbSync.errorlog.add("warning", syncdata.ownerData, msg, details);
        } else {
            //account itself is ok, search for folders with error
            folders = tbSync.db.findFoldersWithSetting("selected", "1", syncdata.account);
            for (let i in folders) {
                let folderstatus = folders[i].status.split(".")[0];
                if (folderstatus != "" && folderstatus != "OK" && folderstatus != "aborted") {
                    status = "foldererror";
                    break;
                }
            }
        }    
        
        //done
        syncdata.hasError = !msg.startsWith("OK");
        tbSync.db.setAccountSetting(syncdata.account, "lastsynctime", Date.now());
        tbSync.db.setAccountSetting(syncdata.account, "status", status);
        syncdata.setSyncState("accountdone"); 
    }    
    
}
