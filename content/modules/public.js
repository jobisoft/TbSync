/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
 
// simple dumper, who can dump to file or console
var dump = function (what, aMessage) {
    if (tbSync.prefs.getBoolPref("log.toconsole")) {
        Services.console.logStringMessage("[TbSync] " + what + " : " + aMessage);
    }
    
    if (this.prefs.getBoolPref("log.tofile")) {
        let now = new Date();
        tbSync.io.appendToFile("debug.log", "** " + now.toString() + " **\n[" + what + "] : " + aMessage + "\n\n");
    }
}
    
// get localized string from core or provider (if possible)
// TODO: move as many locales from provider to tbsync
var getString = function (msg, provider) {
    let success = false;
    let localized = msg;
    
    //spezial treatment of strings with :: like status.httperror::403
    let parts = msg.split("::");

    // if a provider is given, try to get the string from the provider
    if (provider && tbSync.providers.loadedProviders.hasOwnProperty(provider)) {
        try {
            localized = tbSync.providers.loadedProviders[provider].bundle.GetStringFromName(parts[0]);
            success = true;
        } catch (e) {}        
    }

    // if we did not yet succeed, request the tbsync bundle
    if (!success) {
        try {
            localized = tbSync.bundle.GetStringFromName(parts[0]);
            success = true;
        } catch (e) {}                    
    }

    //replace placeholders in returned string
    if (success) {
        for (let i = 0; i<parts.length; i++) {
            let regex = new RegExp( "##replace\."+i+"##", "g");
            localized = localized.replace(regex, parts[i]);
        }
    }

    return localized;
}

var generateUUID = function () {
    const uuidGenerator  = Cc["@mozilla.org/uuid-generator;1"].getService(Ci.nsIUUIDGenerator);
    return uuidGenerator.generateUUID().toString().replace(/[{}]/g, '');
}
    
// promisified implementation AddonManager.getAddonByID() (only needed in TB60)
var getAddonByID = async function (id) {
    return new Promise(function(resolve, reject) {
        function callback (addon) {
            resolve(addon);
        }
        AddonManager.getAddonByID(id, callback);
    })
}





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

var OwnerData = class {
    constructor(provider, accountname, foldername = "") {
        this.provider = provider;
        this.accountname = accountname;
        this.foldername = foldername;
    }
}


var AccountData = class {
    constructor(accountID, folderID = "") {
        //internal (private, not to be touched by provider)
        this.account = accountID;
        this._folderID = folderID;

        if (!tbSync.db.accounts.data.hasOwnProperty(accountID)) {
            throw new Error("An account with ID <" + accountID + "> does not exist. Failed to create AccountData.");
        }

        if (this.hasFolderData() && !tbSync.db.folders[accountID].hasOwnProperty(folderID)) {
            throw new Error("A folder with ID <" + folderID + "> does not exist for the given account. Failed to create AccountData.");
        }
    }

    hasFolderData() {
        return (this.folderID !== "");
    }
    
    //no setter!
    get folderID() {
        return this._folderID;
    }
    
    set folderID(v) {
        try {
            throw new Error("Cannot set folderID");
        } catch (e) {
            Components.utils.reportError(e);
        }
    }
    
    
    getFolder(setting, value) {
        let folders = tbSync.db.findFoldersWithSetting([setting, "cached"], [value, "0"], "account", this.account);
        if (folders.length > 0) return new tbSync.AccountData(folders[0].accountID, folders[0].folderID);
        return null;
    }

    getFolderFromCache(setting, value) {
        let folders = tbSync.db.findFoldersWithSetting([setting, "cached"], [value, "1"], "account", this.account);
        if (folders.length > 0) return new tbSync.AccountData(folders[0].accountID, folders[0].folderID);
        return null;
    }
    
    createNewFolder() {
        return new tbSync.AccountData(this.account, tbSync.db.addFolder(this.account));
    }
    
    getAllFolders() {
        let allFolders = [];
        let folderIDs = Object.keys(tbSync.db.getFolders(this.account));
        for (let i=0; i < folderIDs.length; i++) {          
            allFolders.push(new tbSync.AccountData(this.account, folderIDs[i]));
        }
        return allFolders;
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

    authPrompt(window = null) {
        // default to main Thunderbird window
        let w = window ? window : tbSync.window;
        
        // only popup one password prompt per account
        if (!tbSync.manager.authWindowObjs.hasOwnProperty[this.account] || tbSync.manager.authWindowObjs[this.account] === null) {
            let defaultUrl = "chrome://tbsync/content/manager/password.xul";
            let userUrl = tbSync.providers[this.getAccountSetting("provider")].auth.getAuthPromptXulUrl();
            tbSync.manager.authWindowObjs[this.account] = w.openDialog(userUrl ? userUrl : defaultUrl, "authPrompt", "centerscreen,chrome,resizable=no", this);
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


    getDefaultFolderEntries() {
        return tbSync.providers.getDefaultFolderEntries(this.account);
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

    //rename target, clear changelog (and remove from DB)
    takeTargetOffline(suffix, deleteFolder = true) {
        //decouple folder and target
        let target = this.getFolderSetting("target");
        this.resetFolderSetting("target");

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
                switch (this.getFolderSetting("targetType")) {
                    case "calendar":
                        tbSync.lightning.changeNameOfCalendarAndDisable(target, "Local backup of: %ORIG% " + suffix);
                        break;
                    case "addressbook":
                        tbSync.addressbook.changeNameOfBook(target, "Local backup of: %ORIG% " + suffix);
                        break;
                    default:
                        throw new Error ("takeTargetOffline: Unknown type <"+this.getFolderSetting("targetType")+">");
                }
            }
        }
        if (deleteFolder) tbSync.db.deleteFolder(this.account, this.folderID);            
    }
    
    getFolderStatus() {
        let status = "";
        
        if (this.getFolderSetting("selected") == "1") {
            //default
            status = tbSync.getString("status." + this.getFolderSetting("status"), this.getAccountSetting("provider")).split("||")[0];

            switch (this.getFolderSetting("status").split(".")[0]) { //the status may have a sub-decleration
                case "success":
                case "modified":
                    switch (this.getFolderSetting("targetType")) {
                        case "calendar": 
                            status = tbSync.lightning.isAvailable() ? status + ": "+ tbSync.lightning.getCalendarName(this.getFolderSetting("target")) : tbSync.getString("status.nolightning", this.getAccountSetting("provider"));
                            break;
                        case "addressbook": 
                            status =status + ": "+ tbSync.addressbook.getDirectoryFromDirectoryUID(this.getFolderSetting("target")).dirName;
                            break;
                    }
                    break;
                    
                case "pending":
                    //add extra info if this folder is beeing synced, there is no extra state for this, 
                    //compare folderID with the actual SyncData
                    let syncdata = this.getSyncData();
                    if (syncdata.folderID == this.folderID) {
                        status = tbSync.getString("status.syncing", syncdata.getAccountSetting("provider"));
                        if (["send","eval","prepare"].includes(syncdata._syncstate.split(".")[0]) && (syncdata.progress.todo + syncdata.progress.done) > 0) {
                            //add progress information
                            status = status + " (" + syncdata.progress.done + (syncdata.progress.todo > 0 ? "/" + syncdata.progress.todo : "") + ")"; 
                        }
                    }
                    break;            
            }
        } else {
            //remain empty if not selected
        }        

        return status;
    }

    getSyncData() {
        return tbSync.core.getSyncDataObject(this.account);
    }
    
    getTarget() {
        if (this.hasFolderData()) {
            switch (this.getFolderSetting("targetType")) {
                case "calendar": 
                    if (tbSync.lightning.isAvailable()) {
                        return cal.getCalendarManager().getCalendarById(this.getFolderSetting("target"));
                    }
                    break;
                    
                case "addressbook": 
                    return new tbSync.AbDirectoryData(this.getFolderSetting("target"));
            }
        }
        
        return null;
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
var SyncData = class extends AccountData {
    constructor(account) {
        super(account)

        //internal (private, not to be touched by provider)
        this._syncstate = "";
        this._progress = new ProgessData();
    }

    //all functions provider should use should be in here
    //providers should not modify properties directly
    //try to eliminate account and folderID usage
    //icons must use db check and not just directory property, to see "dead" folders
    //hide cache management
    //when getSyncDataObj is used never change the folder id as a sync may be going on!
    
    //setTargetModified
    //takeTargetOffline
    //removeTarget
    
    get progress() {
        return this._progress;
    }
    
    setSyncState(syncstate) {
        //set new syncstate
        let msg = "State: " + syncstate;
        if (this.account) msg += ", Account: " + this.getAccountSetting("accountname");
        if (this.account && this.hasFolderData()) msg += ", Folder: " + this.getFolderSetting("name");

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
}


