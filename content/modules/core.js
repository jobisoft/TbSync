/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var StatusData = class {
    constructor(type = "success", message = "", details = "") {
        this.type = type; //success, info, warning, error
        this.message = message;
        this.details = details;
    }
    
    static get SUCCESS() {return "success"};
    static get ERROR() {return "error"};
    static get WARNING() {return "warning"};
    static get INFO() {return "info"};
}

var FolderData = class {
    constructor(accountData, folderID) {
        this._accountData = accountData;
        this._folderID = folderID;
        this._target = null;
        
        if (!tbSync.db.folders[accountData.accountID].hasOwnProperty(folderID)) {
            throw new Error("A folder with ID <" + folderID + "> does not exist for the given account. Failed to create FolderData.");
        }
    }
    
    get folderID() {
        return this._folderID;
    }

    get accountID() {
        return this._accountData.accountID;
    }
    
    getDefaultFolderEntries() { // remove
        return tbSync.providers.getDefaultFolderEntries(this.accountID);
    }
    
    getFolderSetting(field) {
        return tbSync.db.getFolderSetting(this.accountID, this.folderID, field);
    }
    
    setFolderSetting(field, value) {
        tbSync.db.setFolderSetting(this.accountID, this.folderID, field, value);
    }

    resetFolderSetting(field) {
        tbSync.db.resetFolderSetting(this.accountID, this.folderID, field);
    }

    isSyncing() {
        let syncdata = this.accountData.syncData;
        return (syncdata.currentFolderData && syncdata.currentFolderData.folderID == this.folderID);
    }
        
    getFolderStatus() {
        let status = "";
        
        if (this.getFolderSetting("selected") == "1") {
            //default
            status = tbSync.getString("status." + this.getFolderSetting("status"), this.accountData.getAccountSetting("provider")).split("||")[0];

            switch (this.getFolderSetting("status").split(".")[0]) { //the status may have a sub-decleration
                case "success":
                case "modified":
                    status = status + ": " + this.getFolderSetting("targetName");
                    break;
                    
                case "pending":
                    //add extra info if this folder is beeing synced
                    if (this.isSyncing()) {
                        let syncdata = this.accountData.syncData;
                        status = tbSync.getString("status.syncing", this.accountData.getAccountSetting("provider"));
                        if (["send","eval","prepare"].includes(syncdata._syncstate.split(".")[0]) && (syncdata.progressData.todo + syncdata.progressData.done) > 0) {
                            //add progress information
                            status = status + " (" + syncdata.progressData.done + (syncdata.progressData.todo > 0 ? "/" + syncdata.progressData.todo : "") + ")"; 
                        }
                    }
                    break;            
            }
        } else {
            //remain empty if not selected
        }        
        return status;
    }
    
    // get data objects
    get accountData() {
        return this._accountData;
    }

    get targetData() {
        // targetData can not be set during construction, because targetType has not been set 
        // create it on the fly - re-create it, if targetType changed
        if (!this._target || this._target.targetType != this.getFolderSetting("targetType")) {
            switch (this.getFolderSetting("targetType")) {
                case "":
                    throw new Error("Property <targetType> not set for this folder.");
                
                case "calendar":
                    this._target = new tbSync.lightning.TargetData(this);
                    break;

                case "addressbook":
                    this._target = new tbSync.addressbook.TargetData(this);
                    break;

                default:
                    this._target = new tbSync.providers[this.accountData.getAccountSetting("provider")].targets[this.getFolderSetting("targetType")].TargetData(this);
            }
        }
        
        return this._target;
    }
}

var AccountData = class {
    constructor(accountID) {
        this._accountID = accountID;

        if (!tbSync.db.accounts.data.hasOwnProperty(accountID)) {
            throw new Error("An account with ID <" + accountID + "> does not exist. Failed to create AccountData.");
        }
    }

    get accountID() {
        return this._accountID;
    }
    
    getAllFolders() {
        let allFolders = [];
        let folders = tbSync.db.findFoldersWithSetting(["cached"], ["0"], "account", this.accountID);
        for (let i=0; i < folders.length; i++) {          
            allFolders.push(new tbSync.FolderData(this, folders[i].folderID));
        }
        return allFolders;
    }

    getAllFoldersIncludingCache() {
        let allFolders = [];
        let folders = tbSync.db.findFoldersWithSetting([], [], "account", this.accountID);
        for (let i=0; i < folders.length; i++) {          
            allFolders.push(new tbSync.FolderData(this, folders[i].folderID));
        }
        return allFolders;
    }
    
    getFolder(setting, value) {
        let folders = tbSync.db.findFoldersWithSetting([setting, "cached"], [value, "0"], "account", this.accountID);
        if (folders.length > 0) return new tbSync.FolderData(this, folders[0].folderID);
        return null;
    }

    getFolderFromCache(setting, value) {
        let folders = tbSync.db.findFoldersWithSetting([setting, "cached"], [value, "1"], "account", this.accountID);
        if (folders.length > 0) return new tbSync.FolderData(this, folders[0].folderID);
        return null;
    }
    
    createNewFolder() {
        return new tbSync.FolderData(this, tbSync.db.addFolder(this.accountID));
    }
    

    
    // get data objects
    get providerData() {
        return new ProviderData(
            this.getAccountSetting("provider"),
        );
    }    

    get syncData() {
        return tbSync.core.getSyncDataObject(this.accountID);
    }


    
    authPrompt(window = null) {
        // default to main Thunderbird window
        let w = window ? window : tbSync.window;
        
        // only popup one auth prompt per account
        if (!tbSync.manager.authWindowObjs.hasOwnProperty[this.accountID] || tbSync.manager.authWindowObjs[this.accountID] === null) {
            let defaultUrl = "chrome://tbsync/content/manager/password.xul";
            let userUrl = tbSync.providers[this.getAccountSetting("provider")].api.getAuthPromptXulUrl();
            tbSync.manager.authWindowObjs[this.accountID] = w.openDialog(userUrl ? userUrl : defaultUrl, "authPrompt", "centerscreen,chrome,resizable=no", this);
        }        
    }

    // shortcuts
    sync(job = "sync") {
        tbSync.core.syncAccount(job, this.accountID)
    }

    isSyncing() {
        return tbSync.core.isSyncing(this.accountID);
    }
    
    isEnabled() {
        return tbSync.core.isEnabled(this.accountID);
    }

    isConnected() {
        return tbSync.core.isConnected(this.accountID);
    }
    

    getAccountSetting(field) {
        return tbSync.db.getAccountSetting(this.accountID, field);
    }

    setAccountSetting(field, value) {
        tbSync.db.setAccountSetting(this.accountID, field, value);
    }
    
    resetAccountSetting(field) {
        tbSync.db.resetAccountSetting(this.accountID, field);
    }
}




var ProgessData = class {
    constructor() {
        this._todo = 0;
        this._done = 0;
     }
     
     reset(done = 0, todo = 0) {
        this._todo = todo;
        this._done = done;
     }
     
     inc(value = 1) {
         this._done += value;
     }
     
     get todo() {
         return this._todo;
     }
     
     get done() {
         return this._done;
     }
}

// there is only one syncdata object per account which contains the current state of the sync
var SyncData = class {
    constructor(accountID) {
        
        //internal (private, not to be touched by provider)
        this._syncstate = "accountdone";
        this._accountData = new tbSync.AccountData(accountID);
        this._progressData = new tbSync.ProgessData();
        this._currentFolderData = null;
    }

    //all functions provider should use should be in here
    //providers should not modify properties directly
    //try to eliminate account and folderID usage
    //icons must use db check and not just directory property, to see "dead" folders
    //hide cache management
    //when getSyncDataObj is used never change the folder id as a sync may be going on!

    _setCurrentFolderData(folderData) {
        this._currentFolderData = folderData;
    }
    _clearCurrentFolderData() {
        this._currentFolderData = null;
    }

    get errorOwnerData() {
        return new ErrorOwnerData(
            this.accountData.getAccountSetting("provider"),
            this.accountData.getAccountSetting("accountname"),
            this.accountData.accountID,
            this.currentFolderData ? this.currentFolderData.getFolderSetting("name") : "",
        );
    }
    
    get currentFolderData() {
        return this._currentFolderData;
    }

    get accountData() {
        return this._accountData;
    }

    get progressData() {
        return this._progressData;
    }

    setSyncState(syncstate) {
        //set new syncstate
        let msg = "State: " + syncstate + ", Account: " + this.accountData.getAccountSetting("accountname");
        if (this.currentFolderData) msg += ", Folder: " + this.currentFolderData.getFolderSetting("name");

        if (syncstate.split(".")[0] == "send") {
            //add timestamp to be able to display timeout countdown
            syncstate = syncstate + "||" + Date.now();
        }

        this._syncstate = syncstate;
        tbSync.dump("setSyncState", msg);

        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", this.accountData.accountID);
    }
    
    getSyncState() {
        return this._syncstate;
    }
}

var core = {

    syncDataObj : null,

    load: async function () {
        this.syncDataObj = {};
    },

    unload: async function () {
    },

    isSyncing: function (accountID) {
        let status = tbSync.db.getAccountSetting(accountID, "status"); //global status of the account
        return (status == "syncing");
    },
    
    isEnabled: function (accountID) {
        let status = tbSync.db.getAccountSetting(accountID, "status");
        return  (status != "disabled");
    },

    isConnected: function (accountID) {
        let status = tbSync.db.getAccountSetting(accountID, "status");
        let validFolders = tbSync.db.findFoldersWithSetting(["cached"], ["0"], "account", accountID);
        return (status != "disabled" && validFolders.length > 0);
    },
    
    prepareSyncDataObj: function (accountID, forceResetOfSyncData = false) {
        if (!this.syncDataObj.hasOwnProperty(accountID) || forceResetOfSyncData) {
            this.syncDataObj[accountID] = new SyncData(accountID);          
        }
    },
    
    getSyncDataObject: function (accountID) {
        this.prepareSyncDataObj(accountID);
        return this.syncDataObj[accountID];        
    },
    
    syncAccount: function (job, accountID = "", folderID = "") {
        //get info of all accounts
        let accounts = tbSync.db.getAccounts();

        //if no account given, loop over all accounts, otherwise only use the provided one
        let accountsToDo = [];        
        if (accountID == "") {
            //add all enabled accounts to the queue
            for (let i=0; i < accounts.IDs.length; i++) {
                accountsToDo.push(accounts.IDs[i]);
            }
        } else {
            accountsToDo.push(accountID);
        }
        
        //update gui
        for (let i = 0; i < accountsToDo.length; i++) {
            //do not init sync if there is a sync running or account is not enabled
            if (!this.isEnabled(accountsToDo[i]) || this.isSyncing(accountsToDo[i])) continue;

            //create syncData object for each account (to be able to have parallel XHR)
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
   
    getNextPendingFolder: function (syncData) {
        let sortedFolders = tbSync.providers[syncData.accountData.getAccountSetting("provider")].api.getSortedFolders(syncData.accountData);
        for (let i=0; i < sortedFolders.length; i++) {
            if (sortedFolders[i].getFolderSetting("status") != "pending") continue;
            syncData._setCurrentFolderData(sortedFolders[i]);
            return true;
        }
        syncData._clearCurrentFolderData();
        return false;
    },
    
    syncSingleAccount: async function (job, syncData) {
        //clear folderID of syncData, just to make sure
        syncData._clearCurrentFolderData();
        
        //check for default sync job
        if (job == "sync") {
            
            let listStatusData = await tbSync.providers[syncData.accountData.getAccountSetting("provider")].api.syncFolderList(syncData);
            
            //if we have an error during folderList sync, there is no need to go on
            if (listStatusData.type != tbSync.StatusData.SUCCESS) {
                this.finishAccountSync(syncData, listStatusData);
                return;
            }
            
            // update folder list in GUI
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateFolderList", syncData.accountData.accountID);

            //set all selected folders to "pending", so they are marked for syncing
            //this also removes all leftover cached folders and sets all other folders to a well defined cached = "0"
            //which will set this account as connected (if at least one folder with cached == "0" is present)
            this.prepareFoldersForSync(syncData);

            // update folder list in GUI
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateFolderList", syncData.accountData.accountID);

            let overallStatusData = new tbSync.StatusData();

            // if any folder was found, sync
            if (syncData.accountData.isConnected()) {
                do {
                    // getNextPendingFolder will set or clear currentFolderData of syncData
                    if (!this.getNextPendingFolder(syncData)) {
                        break;
                    }
                    let folderStatusData = await tbSync.providers[syncData.accountData.getAccountSetting("provider")].api.syncFolder(syncData);
                    this.finishFolderSync(syncData, folderStatusData);

                    //if one of the folders indicated an ERROR, abort sync
                    if (folderStatusData.type == tbSync.StatusData.ERROR) {
                        break;
                    }
                } while (true);
            } else {
                overallStatusData = new tbSync.StatusData(tbSync.StatusData.ERROR, "no-folders-found-on-server");
            }
            this.finishAccountSync(syncData, overallStatusData);

        }
    },
    
    // this could be added to AccountData, but I do not want that in public
    setTargetModified: function (folderData) {
        if (!folderData.accountData.isSyncing() && folderData.accountData.isEnabled()) {
            folderData.accountData.setAccountSetting("status", "notsyncronized");
            folderData.setFolderSetting("status", "modified");
            //notify settings gui to update status
             Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);
        }
    },
    
    enableAccount: function(accountID) {
        let accountData = new AccountData(accountID);
        tbSync.providers[accountData.getAccountSetting("provider")].api.onEnableAccount(accountData);
        accountData.setAccountSetting("status", "notsyncronized");
        accountData.resetAccountSetting("lastsynctime");        
    },

    disableAccount: function(accountID) {
        let accountData = new AccountData(accountID);
        tbSync.providers[accountData.getAccountSetting("provider")].api.onDisableAccount(accountData);
        accountData.setAccountSetting("status", "disabled");
        
        let folders = accountData.getAllFolders();
        for (let folder of folders) {
            //cache folder - this must be done before removing the folder to be able to differ between "deleted by user" and "deleted by disable"
            folder.setFolderSetting("cached", "1");

            if (folder.getFolderSetting("target") != "") {
                //remove associated target and clear its changelog
                folder.targetData.removeTarget();
            }
        }
    },

    //set all selected folders to "pending", so they are marked for syncing 
    //this also removes all leftover cached folders and sets all other folders to a well defined cached = "0"
    //which will set this account as connected (if at least one folder with cached == "0" is present)
    prepareFoldersForSync: function(syncData) {
        let folders = syncData.accountData.getAllFoldersIncludingCache();
        for (let folder of folders) {
            //delete all leftover cached folders
            if (folder.getFolderSetting("cached") == "1") {
                tbSync.db.deleteFolder(folder.accountID, folder.folderID);
                continue;
            } else {
                //set well defined cache state
                folder.setFolderSetting("cached", "0");
            }

            //set selected folders to pending, so they get synced
            if (folder.getFolderSetting("selected") == "1") {
               folder.setFolderSetting("status", "pending");
            }
        }
    },
    
    finishFolderSync: function(syncData, statusData) {        
        if (statusData.type != tbSync.StatusData.SUCCESS) {
            //report error
            tbSync.errorlog.add(statusData.type, syncData.errorOwnerData, statusData.message, statusData.details);
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
        
        if (syncData.currentFolderData) {
            syncData.currentFolderData.setFolderSetting("status", status);
            syncData.currentFolderData.setFolderSetting("lastsynctime", Date.now());
            //clear folderID to fall back to account-only-mode (folder is done!)
            syncData._clearCurrentFolderData();
        } 

       syncData.setSyncState("done");        
    },

    finishAccountSync: function(syncData, statusData) {
        // set each folder with PENDING status to ABORTED
        let folders = tbSync.db.findFoldersWithSetting("status", "pending", syncData.accountData.accountID);
        for (let i=0; i < folders.length; i++) {
            tbSync.db.setFolderSetting(folders[i].accountID, folders[i].folderID, "status", "aborted");
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
            tbSync.errorlog.add("warning", syncData.errorOwnerData, statusData.message, statusData.details);
        } else {
            //account itself is ok, search for folders with error
            folders = tbSync.db.findFoldersWithSetting(["selected","cached"], ["1","0"], syncData.accountData.accountID);
            for (let i in folders) {
                let folderstatus = folders[i].data.status.split(".")[0];
                if (folderstatus != "" && folderstatus != tbSync.StatusData.SUCCESS && folderstatus != "aborted") {
                    status = "foldererror";
                    break;
                }
            }
        }    
        
        //done
        syncData.accountData.setAccountSetting("lastsynctime", Date.now());
        syncData.accountData.setAccountSetting("status", status);
        syncData.setSyncState("accountdone"); 
    }    
    
}
