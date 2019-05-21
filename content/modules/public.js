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

var PasswordAuthData = class {
    constructor(accountData) {
        this.accountData = accountData;
        this.provider = accountData.getAccountSetting("provider");
        this.userField = tbSync.providers[this.provider].auth.getUserField4PasswordManager(accountData);
        this.hostField = tbSync.providers[this.provider].auth.getHostField4PasswordManager(accountData);
    }
    
    getUsername() {
        return this.accountData.getAccountSetting(this.userField);
    }
    
    getPassword() {
        let host = this.accountData.getAccountSetting(this.hostField)
        let origin = passwordAuth.getOrigin4PasswordManager(this.provider, host);
        return passwordAuth.getLoginInfo(origin, "TbSync", this.getUsername());
    }
    
    setUsername(newUsername) {
        // as updating the username is a bit more work, only do it, if it changed
        if (newUsername != this.getUsername()) {        
            let host = this.accountData.getAccountSetting(this.hostField)
            let origin = passwordAuth.getOrigin4PasswordManager(this.provider, host);

            //temp store the old password, as we have to remove the current entry from the password manager
            let oldPassword = this.getPassword();
            // try to remove the current/old entry
            passwordAuth.removeLoginInfo(origin, "TbSync", this.getUsername())
            //update username
            this.accountData.setAccountSetting(this.userField, newUsername);
            passwordAuth.setLoginInfo(origin, "TbSync", newUsername, oldPassword);
        }
    }
    
    setPassword(newPassword) {
        let host = this.accountData.getAccountSetting(this.hostField)
        let origin = passwordAuth.getOrigin4PasswordManager(this.provider, host);
        passwordAuth.setLoginInfo(origin, "TbSync", this.getUsername(), newPassword);
    }
}

var AccountData = class {
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
        
    getFolderStatus(folder) {
        let status = "";
        
        if (folder.selected == "1") {
            //default
            status = tbSync.getString("status." + folder.status, this.getAccountSetting("provider")).split("||")[0];

            switch (folder.status.split(".")[0]) { //the status may have a sub-decleration
                case "success":
                case "modified":
                    switch (tbSync.providers[this.getAccountSetting("provider")].api.getThunderbirdFolderType(folder.type)) {
                        case "tb-todo": 
                        case "tb-event": 
                            status = tbSync.lightning.isAvailable() ? status + ": "+ tbSync.lightning.getCalendarName(folder.target) : tbSync.getString("status.nolightning", this.getAccountSetting("provider"));
                            break;
                        case "tb-contact": 
                            status =status + ": "+ tbSync.addressbook.getAddressBookName(folder.target);
                            break;
                    }
                    break;
                    
                case "pending":
                    if (folder.folderID == this.folderID) {
                        //syncing (there is no extra state for this)
                        status = tbSync.getString("status.syncing", this.getAccountSetting("provider"));
                        if (["send","eval","prepare"].includes(this._syncstate.split(".")[0]) && (this.progress.todo + this.progress.done) > 0) {
                            //add progress information
                            status = status + " (" + this.progress.done + (this.progress.todo > 0 ? "/" + this.progress.todo : "") + ")"; 
                        }
                    }

                    break;            
            }
        } else {
            //remain empty if not selected
        }        

        return status;
    }
}

var ProviderData = class {
    constructor(provider) {
        if (!tbSync.providers.hasOwnProperty(provider)) {
            throw new Error("Provider <" + provider + "> has not been loaded. Failed to create ProviderData.");
        }
        this.provider = provider;
    }
    
    getVersion() {
        return tbSync.providers.loadedProviders[this.provider].version;
    }
    
    getStringBundle() {
        return tbSync.providers.loadedProviders[this.provider].bundle;
    }
    
    getAllAccounts() {
        let accounts = tbSync.db.getAccounts();
        let allAccounts = [];
        for (let i=0; i<accounts.IDs.length; i++) {
            let accountID = accounts.IDs[i];
            if (accounts.data[accountID].provider == this.provider) {
                allAccounts.push(new tbSync.AccountData(accountID));
            }
        }
        return allAccounts;
    }
    
    getDefaultAccountEntries() {
        return  tbSync.providers.getDefaultAccountEntries(this.provider)
    }
    
    addAccount(accountName, accountOptions) {
        let newAccountID = tbSync.db.addAccount(accountName, accountOptions);
        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountsList", newAccountID);
        return new tbSync.AccountData(newAccountID);        
    }
}
