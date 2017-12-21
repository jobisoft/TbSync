"use strict";

var db = {

    changelogFile : "changelog.json",
    changelog: [], 

    accountsFile : "accounts.json",
    accounts: { sequence: 0, data : {} }, //data[account] = {row}

    foldersFile : "folders.json",
    folders: {}, //assoziative array of assoziative array : folders[<int>accountID][<string>folderID] = {row} 

    accountsTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),
    foldersTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),
    changelogTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

    writeDelay : 6000,
        
    saveAccounts: function () {
        db.accountsTimer.cancel();
        db.accountsTimer.init(db.writeJSON, db.writeDelay + 1, 0);
    },

    saveFolders: function () {
        db.foldersTimer.cancel();
        db.foldersTimer.init(db.writeJSON, db.writeDelay + 2, 0);
    },

    saveChangelog: function () {
        db.changelogTimer.cancel();
        db.changelogTimer.init(db.writeJSON, db.writeDelay + 3, 0);
    },

    writeJSON : {
      observe: function(subject, topic, data) {
        switch (subject.delay) { //use delay setting to find out, which file is to be saved
            case (db.writeDelay + 1): tbSync.writeAsyncJSON(db.accounts, db.accountsFile); break;
            case (db.writeDelay + 2): tbSync.writeAsyncJSON(db.folders, db.foldersFile); break;
            case (db.writeDelay + 3): tbSync.writeAsyncJSON(db.changelog, db.changelogFile); break;
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

    getAccountStorageFields: function (account) {
        return Object.keys(this.accounts.data[account]).sort();
    },

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
                        
        this.folders[account][data.folderID] = data;
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
    },
    
    
    
    
    
    
    
    init: function () {
        
        //DB Concept:
        //-- on application start, data is read async from json file into object
        //-- AddOn only works on object
        //-- each time data is changed, an async write job is initiated 2s in the future and is resceduled, if another request arrives within that time

        //A task is "serializing" async jobs
        Task.spawn(function* () {

            //load changelog from file
            try {
                let data = yield OS.File.read(tbSync.getAbsolutePath(db.changelogFile));
                db.changelog = JSON.parse(tbSync.decoder.decode(data));
            } catch (ex) {
                //if there is no file, there is no file...
            }

            //load accounts from file
            try {
                let data = yield OS.File.read(tbSync.getAbsolutePath(db.accountsFile));
                db.accounts = JSON.parse(tbSync.decoder.decode(data));
            } catch (ex) {
                //if there is no file, there is no file...
            }

            //load folders from file
            try {
                let data = yield OS.File.read(tbSync.getAbsolutePath(db.foldersFile));
                db.folders = JSON.parse(tbSync.decoder.decode(data));
            } catch (ex) {
                //if there is no file, there is no file...
            }

            //finish async init by calling main init()
            tbSync.init("db");
            
        }).then(null, Components.utils.reportError);

    },


};

db.init();
