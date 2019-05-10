/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("resource://gre/modules/DeferredTask.jsm");

var db = {

    loaded: false,

    files: {
        accounts: {
            name: "accounts.json", 
            default: JSON.stringify({ sequence: 0, data : {} })
            //data[account] = {row}
            },
        folders: {
            name: "folders.json", 
            default: JSON.stringify({})
            //assoziative array of assoziative array : folders[<int>accountID][<string>folderID] = {row} 
            },
        changelog: {
            name: "changelog.json", 
            default: JSON.stringify([]),
            },
    },
        
    load: async function ()  {
        //DB Concept:
        //-- on application start, data is read async from json file into object
        //-- add-on only works on object
        //-- each time data is changed, an async write job is initiated <writeDelay>ms in the future and is resceduled, if another request arrives within that time

        for (let f in this.files) {
            this.files[f].write = new DeferredTask(() => this.writeAsync(f), 6000);
            
            try {
                let data = await OS.File.read(tbSync.io.getAbsolutePath(this.files[f].name));
                this[f] = JSON.parse(tbSync.decoder.decode(data));
                this.files[f].found = true;
            } catch (e) {
                //if there is no file, there is no file...
                this[f] = JSON.parse(this.files[f].default);                
                this.files[f].found = false;
                Components.utils.reportError(e);
            }
        }
        
        this.loaded = true;
    },
    
    unload: async function ()  {
        if (this.loaded) {
            for (let f in this.files) {
                try{ 
                    //abort write delay timers and write current file content to disk 
                    await this.files[f].write.finalize();
                } catch (e) {
                    Components.utils.reportError(e);
                }                
            }
        }
    },
    

    saveFile: function (f) {
        if (this.loaded) {
            //cancel any pending write and schedule a new delayed write
            this.files[f].write.disarm();
            this.files[f].write.arm();
        }
    },

    writeAsync: async function (f) {
        // if this file was not found/read on load, do not write default content to prevent clearing of data in case of read-errors
        if (!this.files[f].found && JSON.stringify(this[f]) == this.files[f].default) {
            return;
        }
        
        let filepath = tbSync.io.getAbsolutePath(this.files[f].name);
        let json = tbSync.encoder.encode(JSON.stringify(this[f]));
        
        await OS.File.makeDir(tbSync.io.storageDirectory);
        await OS.File.writeAtomic(filepath, json, {tmpPath: filepath + ".tmp"});
    },



    // simple convenience wrapper
    saveAccounts: function () {
        this.saveFile("accounts");
    },

    saveFolders: function () {
        this.saveFile("folders");
    },

    saveChangelog: function () {
        this.saveFile("changelog");
    },

    

    // CHANGELOG FUNCTIONS
    getItemStatusFromChangeLog: function (parentId, itemId) {   
        for (let i=0; i<this.changelog.length; i++) {
            if (this.changelog[i].parentId == parentId && this.changelog[i].itemId == itemId) return this.changelog[i].status;
        }
        return null;
    },

    addItemToChangeLog: function (parentId, itemId, status) {
        this.removeItemFromChangeLog(parentId, itemId);

        let row = {
            "parentId" : parentId,
            "itemId" : itemId,
            "status" : status};
        
        this.changelog.push(row);
        this.saveChangelog();
    },

    removeItemFromChangeLog: function (parentId, itemId, moveToEnd = false) {
        for (let i=this.changelog.length-1; i>-1; i-- ) {
            if (this.changelog[i].parentId == parentId && this.changelog[i].itemId == itemId) {
                let row = this.changelog.splice(i,1);
                if (moveToEnd) this.changelog.push(row[0]);
                this.saveChangelog();
                return;
            }
        }
    },

    removeAllItemsFromChangeLogWithStatus: function (parentId, status) {
        for (let i=this.changelog.length-1; i>-1; i-- ) {
            if (this.changelog[i].parentId == parentId && this.changelog[i].status == status) {
                let row = this.changelog.splice(i,1);
            }
        }
        this.saveChangelog();
    },

    // Remove all cards of a parentId from ChangeLog
    clearChangeLog: function (parentId) {
        for (let i=this.changelog.length-1; i>-1; i-- ) {
            if (this.changelog[i].parentId == parentId) this.changelog.splice(i,1);
        }
        this.saveChangelog();
    },

    getItemsFromChangeLog: function (parentId, maxnumbertosend, status = null) {        
        //maxnumbertosend = 0 will return all results
        let log = [];
        let counts = 0;
        for (let i=0; i<this.changelog.length && (log.length < maxnumbertosend || maxnumbertosend == 0); i++) {
            if (this.changelog[i].parentId == parentId && (status === null || this.changelog[i].status.indexOf(status) != -1)) log.push({ "id":this.changelog[i].itemId, "status":this.changelog[i].status });
        }
        return log;
    },





    // ACCOUNT FUNCTIONS

    addAccount: function (newAccountEntry) {
        this.accounts.sequence++;
        let id = this.accounts.sequence;
        newAccountEntry.account = id.toString(),

        this.accounts.data[id]=newAccountEntry;
        this.saveAccounts();
        return id;
    },

    removeAccount: function (account) {
        //check if account is known
        if (this.accounts.data.hasOwnProperty(account) == false ) {
            throw "Unknown account!" + "\nThrown by db.removeAccount("+account+ ")";
        } else {
            delete (this.accounts.data[account]);
            delete (this.folders[account]);
            this.saveAccounts();
            this.saveFolders();
        }
    },

    getAccounts: function () {
        let accounts = {};
        accounts.IDs = Object.keys(this.accounts.data).filter(account => tbSync.providers.loadedProviders.hasOwnProperty(this.accounts.data[account].provider)).sort((a, b) => a - b);
        accounts.allIDs =  Object.keys(this.accounts.data).sort((a, b) => a - b)
        accounts.data = this.accounts.data;
        return accounts;
    },

    getAccount: function (account) {
        //check if account is known
        if (this.accounts.data.hasOwnProperty(account) == false ) {
            throw "Unknown account!" + "\nThrown by db.getAccount("+account+ ")";
        } else {
            return this.accounts.data[account];
        }
    }, 

    isValidAccountSetting: function (provider, name) {
        //provider is hardcoded and always true
        if (name == "provider") 
            return true;

        //check if provider is installed
        if (!tbSync.providers.loadedProviders.hasOwnProperty(provider)) {
            tbSync.dump("Error @ isValidAccountSetting", "Unknown provider <"+provider+">!");
            return false;
        }
        
        if (tbSync[provider].getDefaultAccountEntries().hasOwnProperty(name)) {
            return true;
        } else {
            tbSync.dump("Error @ isValidAccountSetting", "Unknown account setting <"+name+">!");
            return false;
        }
            
    },

    getAccountSetting: function (account, name) {
        // if the requested account does not exist, getAccount() will fail
        let data = this.getAccount(account);
        
        //check if field is allowed and get value or default value if setting is not set
        if (this.isValidAccountSetting(data.provider, name)) {
            if (data.hasOwnProperty(name)) return data[name];
            else return tbSync[data.provider].getDefaultAccountEntries()[name];
        }
    }, 

    setAccountSetting: function (account , name, value) {
        // if the requested account does not exist, getAccount() will fail
        let data = this.getAccount(account);

        //check if field is allowed, and set given value 
        if (this.isValidAccountSetting(data.provider, name)) {
            this.accounts.data[account][name] = value.toString();
        }
        this.saveAccounts();
    },

    resetAccountSetting: function (account , name) {
        // if the requested account does not exist, getAccount() will fail
        let data = this.getAccount(account);
        let defaults = tbSync[data.provider].getDefaultAccountEntries();        

        //check if field is allowed, and set given value 
        if (this.isValidAccountSetting(data.provider, name)) {
            this.accounts.data[account][name] = defaults[name];
        }
        this.saveAccounts();
    },




    // FOLDER FUNCTIONS

    addFolder: function(account, data) {
        let provider = this.getAccountSetting(account, "provider");

        //create folder with default settings
        let newFolderSettings = tbSync[provider].getDefaultFolderEntries(account);
        
        //add custom settings
        for (let d in data) {
            if (data.hasOwnProperty(d)) {
                newFolderSettings[d] = data[d];
            }
        }

        //merge cached/persistent values (if there exists a folder with the given folderID)
        let folder = this.getFolder(account, newFolderSettings.folderID);
        if (folder !== null) {
            let persistentSettings = tbSync[provider].getPersistentFolderSettings();
            for (let s=0; s < persistentSettings.length; s++) {
                if (folder[persistentSettings[s]]) newFolderSettings[persistentSettings[s]] = folder[persistentSettings[s]];
            }
        }

        if (!this.folders.hasOwnProperty(account)) this.folders[account] = {};                        
        this.folders[account][newFolderSettings.folderID] = newFolderSettings;
        this.saveFolders();
    },

    deleteFolder: function(account, folderID) {
        delete (this.folders[account][folderID]);
        //if there are no more folders, delete entire account entry
        if (Object.keys(this.folders[account]).length === 0) delete (this.folders[account]);
        this.saveFolders();
    },

    //get all folders of a given account
    getFolders: function (account) {
        if (!this.folders.hasOwnProperty(account)) this.folders[account] = {};
        return this.folders[account];
    },

    //get a specific folder
    getFolder: function(account, folderID) {
        //does the folder exist?
        if (this.folders.hasOwnProperty(account) && this.folders[account].hasOwnProperty(folderID)) return this.folders[account][folderID];
        else return null;
    },

    isValidFolderSetting: function (account, field) {
        if (["cached"].includes(field)) //internal properties, do not need to be defined by user/provider
            return true;
        
        //check if provider is installed
        let provider = this.getAccountSetting(account, "provider");
        if (!tbSync.providers.loadedProviders.hasOwnProperty(provider)) {
            tbSync.dump("Error @ isValidFolderSetting", "Unknown provider <"+provider+"> for account <"+account+">!");
            return false;
        }

        if (tbSync[provider].getDefaultFolderEntries(account).hasOwnProperty(field)) {
            return true;
        } else {
            tbSync.dump("Error @ isValidFolderSetting", "Unknown folder setting <"+field+"> for account <"+account+">!");
            return false;
        }
    },

    getFolderSetting: function(account, folderID, field) {
        //does the field exist?
        let folder = this.getFolder(account, folderID);
        if (folder === null) throw "Unknown folder <"+folderID+">!";

        if (this.isValidFolderSetting(account, field)) {
            if (folder.hasOwnProperty(field)) {
                return folder[field];
            } else {
                let provider = this.getAccountSetting(account, "provider");
                let defaultFolder = tbSync[provider].getDefaultFolderEntries(account);
                //handle internal fields, that do not have a default value (see isValidFolderSetting)
                return (defaultFolder[field] ? defaultFolder[field] : "");
            }
        }
    },

    setFolderSetting: function (account, folderID, field, value) {
        //this function can update ALL folders for a given account (if folderID == "") or just a specific folder
        if (this.isValidFolderSetting(account, field)) {
            if (folderID == "") {
                for (let fID in this.folders[account]) {
                    this.folders[account][fID][field] = value.toString();
                }
            } else {
                this.folders[account][folderID][field] = value.toString();
            }
            this.saveFolders();
        }
    },
    
    resetFolderSetting: function (account, folderID, field) {
        let provider = this.getAccountSetting(account, "provider");
        let defaults = tbSync[provider].getDefaultFolderEntries(account);        
        //this function can update ALL folders for a given account (if folderID == "") or just a specific folder
        if (this.isValidFolderSetting(account, field)) {
            if (folderID == "") {
                for (let fID in this.folders[account]) {
                    //handle internal fields, that do not have a default value (see isValidFolderSetting)
                    this.folders[account][fID][field] = defaults[field] ? defaults[field] : "";
                }
            } else {
                //handle internal fields, that do not have a default value (see isValidFolderSetting)
                this.folders[account][folderID][field] = defaults[field] ? defaults[field] : "";
            }
            this.saveFolders();
        }
    },

    findFoldersWithSetting: function (_folderFields, _folderValues, _accountFields = [], _accountValues = []) {
        //Find values based on one (string) or more (array) field conditions in folder and account data.
        //folderValues element may contain "," to seperate multiple field values for matching (OR)
        let data = [];
        let folderFields = [];
        let folderValues = [];
        let accountFields = [];
        let accountValues = [];
        
        //turn string parameters into arrays
        if (Array.isArray(_folderFields)) folderFields = _folderFields; else folderFields.push(_folderFields);
        if (Array.isArray(_folderValues)) folderValues = _folderValues; else folderValues.push(_folderValues);
        if (Array.isArray(_accountFields)) accountFields = _accountFields; else accountFields.push(_accountFields);
        if (Array.isArray(_accountValues)) accountValues = _accountValues; else accountValues.push(_accountValues);

        //fallback to old interface (name, value, account = "")
        if (accountFields.length == 1 && accountValues.length == 0) {
            accountValues.push(accountFields[0]);
            accountFields[0] = "account";
        }
        
        for (let aID in this.folders) {
            //is this a leftover folder of an account, which no longer there?
            if (!this.accounts.data.hasOwnProperty(aID)) {
              delete (this.folders[aID]);
              this.saveFolders();
              continue;
            }
        
            //skip this folder, if it belongs to an account currently not supported (provider not loaded)
            if (!tbSync.providers.loadedProviders.hasOwnProperty(this.getAccountSetting(aID, "provider"))) {
                continue;
            }

            //does this account match account search options?
            let accountmatch = true;
            for (let a = 0; a < accountFields.length && accountmatch; a++) {
                accountmatch = (this.getAccountSetting(aID, accountFields[a]) == accountValues[a]);
            }
            
            if (accountmatch) {
                for (let fID in this.folders[aID]) {
                    //does this folder match folder search options?                
                    let foldermatch = true;
                    for (let f = 0; f < folderFields.length && foldermatch; f++) {
                        foldermatch = folderValues[f].split(",").includes(this.getFolderSetting(aID, fID, folderFields[f]));
                    }
                    if (foldermatch) data.push(this.folders[aID][fID]);
                }
            }
        }

        //still a reference to the original data
        return data;
    }
};
