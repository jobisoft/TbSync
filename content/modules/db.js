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
        if (parentId) {
            for (let i=this.changelog.length-1; i>-1; i-- ) {
                if (this.changelog[i].parentId == parentId) this.changelog.splice(i,1);
            }
            this.saveChangelog();
        }
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

    addAccount: function (accountname, newAccountEntry) {
        this.accounts.sequence++;
        let id = this.accounts.sequence.toString();
        newAccountEntry.accountID = id;
        newAccountEntry.accountname = accountname;
        
        this.accounts.data[id] = newAccountEntry;
        this.saveAccounts();
        return id;
    },

    removeAccount: function (accountID) {
        //check if accountID is known
        if (this.accounts.data.hasOwnProperty(accountID) == false ) {
            throw "Unknown accountID!" + "\nThrown by db.removeAccount("+accountID+ ")";
        } else {
            delete (this.accounts.data[accountID]);
            delete (this.folders[accountID]);
            this.saveAccounts();
            this.saveFolders();
        }
    },

    getAccounts: function () {
        let accounts = {};
        accounts.IDs = Object.keys(this.accounts.data).filter(accountID => tbSync.providers.loadedProviders.hasOwnProperty(this.accounts.data[accountID].provider)).sort((a, b) => a - b);
        accounts.allIDs =  Object.keys(this.accounts.data).sort((a, b) => a - b)
        accounts.data = this.accounts.data;
        return accounts;
    },

    getAccount: function (accountID) {
        //check if accountID is known
        if (this.accounts.data.hasOwnProperty(accountID) == false ) {
            throw "Unknown accountID!" + "\nThrown by db.getAccount("+accountID+ ")";
        } else {
            return this.accounts.data[accountID];
        }
    }, 

    isValidAccountSetting: function (provider, name) {
        if (["provider"].includes(name)) //internal properties, do not need to be defined by user/provider
            return true;

        //check if provider is installed
        if (!tbSync.providers.loadedProviders.hasOwnProperty(provider)) {
            tbSync.dump("Error @ isValidAccountSetting", "Unknown provider <"+provider+">!");
            return false;
        }
        
        if (tbSync.providers.getDefaultAccountEntries(provider).hasOwnProperty(name)) {
            return true;
        } else {
            tbSync.dump("Error @ isValidAccountSetting", "Unknown account setting <"+name+">!");
            return false;
        }            
    },

    getAccountSetting: function (accountID, name) {
        // if the requested accountID does not exist, getAccount() will fail
        let data = this.getAccount(accountID);
        
        //check if field is allowed and get value or default value if setting is not set
        if (this.isValidAccountSetting(data.provider, name)) {
            if (data.hasOwnProperty(name)) return data[name];
            else return tbSync.providers.getDefaultAccountEntries(data.provider)[name];
        }
    }, 

    setAccountSetting: function (accountID , name, value) {
        // if the requested accountID does not exist, getAccount() will fail
        let data = this.getAccount(accountID);

        //check if field is allowed, and set given value 
        if (this.isValidAccountSetting(data.provider, name)) {
            this.accounts.data[accountID][name] = value;
        }
        this.saveAccounts();
    },

    resetAccountSetting: function (accountID , name) {
        // if the requested accountID does not exist, getAccount() will fail
        let data = this.getAccount(accountID);
        let defaults = tbSync.providers.getDefaultAccountEntries(data.provider);        

        //check if field is allowed, and set given value 
        if (this.isValidAccountSetting(data.provider, name)) {
            this.accounts.data[accountID][name] = defaults[name];
        }
        this.saveAccounts();
    },




    // FOLDER FUNCTIONS

    addFolder: function(accountID) {
        let folderID = tbSync.generateUUID();
        let provider = this.getAccountSetting(accountID, "provider");        
        
        if (!this.folders.hasOwnProperty(accountID)) this.folders[accountID] = {};                        
        
        //create folder with default settings
        this.folders[accountID][folderID] = tbSync.providers.getDefaultFolderEntries(accountID);
        this.saveFolders();
        return folderID;
    },

    deleteFolder: function(accountID, folderID) {
        delete (this.folders[accountID][folderID]);
        //if there are no more folders, delete entire account entry
        if (Object.keys(this.folders[accountID]).length === 0) delete (this.folders[accountID]);
        this.saveFolders();
    },

    //get a specific folder
    getFolder: function(accountID, folderID) {
        //does the folder exist?
        if (this.folders.hasOwnProperty(accountID) && this.folders[accountID].hasOwnProperty(folderID)) return this.folders[accountID][folderID];
        else return null;
    },

    isValidFolderSetting: function (accountID, field) {
        if (["cached"].includes(field)) //internal properties, do not need to be defined by user/provider
            return true;
        
        //check if provider is installed
        let provider = this.getAccountSetting(accountID, "provider");
        if (!tbSync.providers.loadedProviders.hasOwnProperty(provider)) {
            tbSync.dump("Error @ isValidFolderSetting", "Unknown provider <"+provider+"> for accountID <"+accountID+">!");
            return false;
        }

        if (tbSync.providers.getDefaultFolderEntries(accountID).hasOwnProperty(field)) {
            return true;
        } else {
            tbSync.dump("Error @ isValidFolderSetting", "Unknown folder setting <"+field+"> for accountID <"+accountID+">!");
            return false;
        }
    },

    getFolderSetting: function(accountID, folderID, field) {
        //does the field exist?
        let folder = this.getFolder(accountID, folderID);
        if (folder === null) {
            throw "Unknown folder <"+folderID+">!";
        }
        
        if (this.isValidFolderSetting(accountID, field)) {
            if (folder.hasOwnProperty(field)) {
                return folder[field];
            } else {
                let provider = this.getAccountSetting(accountID, "provider");
                let defaultFolder = tbSync.providers.getDefaultFolderEntries(accountID);
                //handle internal fields, that do not have a default value (see isValidFolderSetting)
                return (defaultFolder[field] ? defaultFolder[field] : "");
            }
        }
    },

    setFolderSetting: function (accountID, folderID, field, value) {
        //this function can update ALL folders for a given accountID (if folderID == "") or just a specific folder
        if (this.isValidFolderSetting(accountID, field)) {
            if (folderID == "") {
                for (let fID in this.folders[accountID]) {
                    this.folders[accountID][fID][field] = value;
                }
            } else {
                this.folders[accountID][folderID][field] = value;
            }
            this.saveFolders();
        }
    },
    
    resetFolderSetting: function (accountID, folderID, field) {
        let provider = this.getAccountSetting(accountID, "provider");
        let defaults = tbSync.providers.getDefaultFolderEntries(accountID);        
        //this function can update ALL folders for a given accountID (if folderID == "") or just a specific folder
        if (this.isValidFolderSetting(accountID, field)) {
            if (folderID == "") {
                for (let fID in this.folders[accountID]) {
                    //handle internal fields, that do not have a default value (see isValidFolderSetting)
                    this.folders[accountID][fID][field] = defaults[field] ? defaults[field] : "";
                }
            } else {
                //handle internal fields, that do not have a default value (see isValidFolderSetting)
                this.folders[accountID][folderID][field] = defaults[field] ? defaults[field] : "";
            }
            this.saveFolders();
        }
    },

    findFoldersWithSetting: function (folderQuery = {}, accountQuery = {}) {
        // folderQuery is an object with one or more key:value pairs (logical AND) ::
        // {key1: value1, key2: value2} 
        // the value itself may be an array (logical OR)
        let data = [];
        let folderQueryEntries = Object.entries(folderQuery);
        let folderFields = folderQueryEntries.map(pair => pair[0]);
        let folderValues = folderQueryEntries.map(pair => Array.isArray(pair[1]) ? pair[1] : [pair[1]]);
        
        let accountQueryEntries = Object.entries(accountQuery);
        let accountFields = accountQueryEntries.map(pair => pair[0]);
        let accountValues = accountQueryEntries.map(pair => Array.isArray(pair[1]) ? pair[1] : [pair[1]]);

        Services.console.logStringMessage("[findFoldersWithSetting] ");
        
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
                accountmatch = accountValues[a].some(item => item === this.getAccountSetting(aID, accountFields[a]));
                Services.console.logStringMessage("   " + accountFields[a] + ":" + this.getAccountSetting(aID, accountFields[a]) + " in " + JSON.stringify(accountValues[a]) + " ? " + accountmatch);
            }
            
            if (accountmatch) {
                for (let fID in this.folders[aID]) {
                    //does this folder match folder search options?                
                    let foldermatch = true;
                    for (let f = 0; f < folderFields.length && foldermatch; f++) {
                        foldermatch = folderValues[f].some(item => item === this.getFolderSetting(aID, fID, folderFields[f]));
                        Services.console.logStringMessage("   " + folderFields[f] + ":" + this.getFolderSetting(aID, fID, folderFields[f]) + " in " + JSON.stringify(folderValues[f]) + " ? " + foldermatch);
                    }
                    if (foldermatch) data.push({accountID: aID, folderID: fID, data: this.folders[aID][fID]});
                }
            }
        }

        //still a reference to the original data
        return data;
    }
};
