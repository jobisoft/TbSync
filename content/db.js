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
        //maxnumbertosend = 0 will return all results
        let log = [];
        let counts = 0;
        for (let i=0; i<this.changelog.length && (log.length < maxnumbertosend || maxnumbertosend == 0); i++) {
            if (this.changelog[i].parentId == parentId && (status === null || this.changelog[i].status.indexOf(status) != -1)) log.push({ "id":this.changelog[i].itemId, "status":this.changelog[i].status });
        }
        return log;
    },





    // ACCOUNT FUNCTIONS

    isValidAccountSetting: function (settings, name) {
        //the only hardcoded account option is "provider", all others are taken from tbSync[provider].getNewAccountEntry())
        return ((name == "provider" || tbSync[settings.provider].getNewAccountEntry().hasOwnProperty(name)));
    },

    getDefaultAccountSetting: function (settings, name) {
        //THIS FUNCTION ASSUMES, THAT THE GIVEN FIELD IS VALID
        return tbSync[settings.provider].getNewAccountEntry()[name];
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
        }
    },

    setAccountSetting: function (account , name, value) {
        // if the requested account does not exist, getAccount() will fail
        let settings = this.getAccount(account);

        //check if field is allowed, and set given value 
        if (this.isValidAccountSetting(settings, name)) {
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

        //check if field is allowed and get value or default value if setting is not set
        if (this.isValidAccountSetting(data, name)) {
            if (data.hasOwnProperty(name)) return data[name];
            else return this.getDefaultAccountSetting(data, name);
        }
        else throw "Unknown account setting!" + "\nThrown by db.getAccountSetting("+account+", " + name + ")";
    }, 





    // FOLDER FUNCTIONS

    isValidFolderSetting: function (account, field) {
        let provider = this.getAccountSetting(account, "provider");
        return tbSync[provider].getNewFolderEntry().hasOwnProperty(field);
    },

    getDefaultFolderSetting: function (account, field) {
        //THIS FUNCTION ASSUMES, THAT THE GIVEN FIELD IS VALID
        let provider = this.getAccountSetting(account, "provider");
        return tbSync[provider].getNewFolderEntry()[name];
    },

    addFolder: function(data) {
        let account = parseInt(data.account);
        if (!this.folders.hasOwnProperty(account)) this.folders[account] = {};
                        
        this.folders[account][data.folderID] = data;
        this.saveFolders();
    },

    deleteFolder: function(account, folderID) {
        delete (this.folders[account][folderID]);
        //if there are no more folders, delete entire account entry
        if (Object.keys(this.folders[account]).length === 0) delete (this.folders[account]);
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
        if (folder === null || !this.isValidFolderSetting(account, field)) throw "Unknown folder field!" + "\nThrown by db.getFolderSetting("+account+", " + folderID + ", " + field + ")";
        else {
            if (folder.hasOwnProperty(field)) return folder[field];
            else return this.getDefaultFolderSetting(account, field); //TODO: Actually set the default setting, so that the folder OBJ has the value as well?
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
            //is this a leftover folder list of an account, which no longer there?
            if (!this.accounts.data.hasOwnProperty(aID)) {
              delete (this.folders[aID]);
              this.saveFolders();
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
    },

    setFolderSetting: function(account, folderID, field, value) {
        //this function can update ALL folders for a given account (if folderID == "") or just a specific folder
        //folders will contain all folders, which need to be updated;
        if (this.isValidFolderSetting(account, field)) {
            let folders = this.getFolders(account);

            if (folderID == "") {
                for (let fID in folders) {
                    folders[fID][field] = value.toString();
                }
            } else {
                folders[folderID][field] = value.toString();
            }

            this.saveFolders();
        } else {
            throw "Unknown folder field!" + "\nThrown by db.setFolderSetting("+account+", " + folderID + ", " + field + ", " + value + ")";
        }
    },
    
    
    
    
    
        
    init: Task.async (function* ()  {
        
        tbSync.dump("INIT","DB");

        //DB Concept:
        //-- on application start, data is read async from json file into object
        //-- AddOn only works on object
        //-- each time data is changed, an async write job is initiated 2s in the future and is resceduled, if another request arrives within that time

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
            
    }),


};
