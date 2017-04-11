"use strict";

var db = {

    changelogFile : "eas_changelog_0_7.json",
    changelog: [], 

    accountsFile : "eas_accounts_0_7.json",
    accounts: { sequence: 0, data : {} }, //data[account] = {row}

    foldersFile : "eas_folders_0_7.json",
    folders: {}, //assoziative array of assoziative array : folders[<int>accountID][<string>folderID] = {row} 

    changelogTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),
    accountsTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),
    foldersTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

    saveAccounts: function () {
        db.accountsTimer.cancel();
        db.accountsTimer.init(db.writeJSON, 3001, 0); //run in 3s
    },

    saveFolders: function () {
        db.foldersTimer.cancel();
        db.foldersTimer.init(db.writeJSON, 3002, 0); //run in 3s
    },

    saveChangelog: function () {
        db.changelogTimer.cancel();
        db.changelogTimer.initWithCallback(db.writeJSON, 3003, 0); //run in 3s
    },

    writeJSON : {
      observe: function(subject, topic, data) {
        switch (subject.delay) { //use delay setting to find out, which file is to be saved
            case 3001: tbSync.writeAsyncJSON(db.accounts, db.accountsFile); break;
            case 3002: tbSync.writeAsyncJSON(db.folders, db.foldersFile); break;
            case 3003: tbSync.writeAsyncJSON(db.changelog, db.changelogFile); break;
        }
      }
    },




    // CHANGELOG FUNCTIONS

    getItemStatusFromChangeLog: function (parentId, itemId) {   
        for (let i=0; i<this.changelog.length; i++) {
            if (this.changelog[i].parentId == parentId && this.changelog[i].itemId == itemId) return this.changelog[i].status;
        }
        return null;
    },

    addItemToChangeLog: function (parentId, itemId, status, data = "") {
        this.removeItemFromChangeLog(parentId, itemId);

        let row = {
            "parentId" : parentId,
            "itemId" : itemId,
            "status" : status,
            "data" : data };
        
        this.changelog.push(row);
        this.saveChangelog();
    },

    removeItemFromChangeLog: function (parentId, itemId) {
        for (let i=this.changelog.length-1; i>-1; i-- ) {
            if (this.changelog[i].parentId == parentId && this.changelog[i].itemId == itemId) this.changelog.splice(i,1);
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
        let log = [];
        let counts = 0;
        for (let i=0; i<this.changelog.length && log.length < maxnumbertosend; i++) {
            if (this.changelog[i].parentId == parentId && (status === null || this.changelog[i].status.indexOf(status) != -1)) log.push({ "id":this.changelog[i].itemId, "status":this.changelog[i].status });
        }
        return log;
    },





    // ACCOUNT FUNCTIONS

    getNewDeviceId: function () {
        //taken from https://jsfiddle.net/briguy37/2MVFd/
        let d = new Date().getTime();
        let uuid = 'xxxxxxxxxxxxxxxxyxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            let r = (d + Math.random()*16)%16 | 0;
            d = Math.floor(d/16);
            return (c=='x' ? r : (r&0x3|0x8)).toString(16);
        });
        return "mztb" + uuid;
    },

    getAccountStorageFields: function (account) {
        return Object.keys(this.accounts.data[account]).sort();
    },

    addAccount: function (accountname, appendID = false) {
        this.accounts.sequence++;

        let id = this.accounts.sequence;
        let name = accountname;
        if (appendID) name = name + " #" + id;

        let row = {
            "account" : id.toString(),
            "accountname": name, 
            "policykey" : "", 
            "foldersynckey" : "0",
            "lastsynctime" : "0", 
            "state" : "disconnected",
            "status" : "notconnected",
            "deviceId" : this.getNewDeviceId(),
            "asversion" : "14.0",
            "host" : "",
            "user" : "",
            "servertype" : "",
            "seperator" : "10",
            "https" : "0",
            "provision" : "1",
            "birthday" : "0",
            "displayoverride" : "0", 
            "downloadonly" : "0",
            "autosync" : "0" };

        this.accounts.data[id]=row;
        this.saveAccounts();
        return id;
    },

    removeAccount: function (account) {
        //check if account is known
        if (this.accounts.data.hasOwnProperty(account) == false ) {
            throw "Unknown account!" + "\nThrown by db.removeAccount("+account+ ")";
        } else {
            delete(this.accounts.data[account]);
            this.saveAccounts();

            // also remove all folders of that account
            this.deleteAllFolders(account);
        }
    },

    setAccountSetting: function (account , name, value) {
        // if the requested account does not exist, getAccount() will fail
        let settings = this.getAccount(account);

        //check if field is allowed
        if (settings.hasOwnProperty(name)) {
            this.accounts.data[account][name] = value.toString();
        } else {
            throw "Unknown account setting!" + "\nThrown by db.setAccountSetting("+account+", " + name + ", " + value + ")";
        }
        this.saveAccounts();
    },

    getAccounts: function () {
        let accounts = {};
        accounts.IDs = Object.keys(this.accounts.data).sort((a, b) => a - b);
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

    getAccountSetting: function (account, name) {
        let data = this.getAccount(account);
        //check if field is allowed
        if (data.hasOwnProperty(name)) return data[name];
        else throw "Unknown account setting!" + "\nThrown by db.getAccountSetting("+account+", " + name + ")";
    }, 





    // FOLDER FUNCTIONS

    addFolder: function(data) {
        let account = parseInt(data.account);
        if (!this.folders.hasOwnProperty(account)) this.folders[account] = {};
            
        let folder = {
            "account" : "",
            "folderID" : "",
            "name" : "",
            "type" : "",
            "synckey" : "",
            "target" : "",
            "selected" : "",
            "lastsynctime" : "",
            "status" : ""};

        //copy all valid fields from data to folder
        for (let property in data) {
            if (folder.hasOwnProperty(property)) {
                folder[property] = data[property];
            }
        }
            
        this.folders[account][data.folderID] = folder;
        this.saveFolders();
    },

    deleteAllFolders: function(account) {
        delete (this.folders[account]);
        this.saveFolders();
    },

    deleteFolder: function(account, folderID) {
        delete (this.folders[account][folderID]);
        this.saveFolders();
    },

    //get all folders of a given account.
    getFolders: function (account) {
        if (!this.folders.hasOwnProperty(account)) this.folders[account] = {};
        return this.folders[account];
    },

    //get a specific folder
    getFolder: function(account, folderID) {
        let folders = this.getFolders(account);
        //does the folder exist?
        if (folders.hasOwnProperty(folderID)) return folders[folderID];
        else return null;
    },

    getFolderSetting: function(account, folderID, field) {
        let folder = this.getFolder(account, folderID);
        //does the field exist?
        if (folder === null || !folder.hasOwnProperty(field)) throw "Unknown folder field!" + "\nThrown by db.getFolderSetting("+account+", " + folderID + ", " + field + ")";
        else return folder[field];
    },

    findFoldersWithSetting: function (name, value, account = null) {
        let data = [];
        for (let aID in this.folders) {
            for (let fID in this.folders[aID]) {
                if ((account === null || account == aID) && this.folders[aID][fID].hasOwnProperty(name) && this.folders[aID][fID][name] == value) data.push(this.folders[aID][fID]);
            }
        }

        //still a reference to the original data
        return data;
    },

    setFolderSetting: function(account, folderID, field, value) {
        //this function can update ALL folders for a given account (if folderID == "") or just a specific folder
        //folders will contain all folders, which need to be updated;
        let folders = this.getFolders(account);

        if (folderID == "") {
            for (let fID in folders) {
                if (folders[fID].hasOwnProperty(field)) folders[fID][field] = value.toString();
                else throw "Unknown folder field!" + "\nThrown by db.setFolderSetting("+account+", " + folderID + ", " + field + ", " + value + ")";
            }
        } else {
            if (folders[folderID].hasOwnProperty(field)) folders[folderID][field] = value.toString();
            else throw "Unknown folder field!" + "\nThrown by db.setFolderSetting("+account+", " + folderID + ", " + field + ", " + value + ")";
        }

        this.saveFolders();
    }

};
