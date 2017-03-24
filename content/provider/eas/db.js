"use strict";

//TODO (for production)
// - after migration, delete the data stored in prefs, the user might get confused at a later time, if that old account data is remigrated again, if the db was deleted
// - check database fields if add-on updates added/removed fields

var db = {

    conn: null,
    _accountCache: null,
    _folderCache: {},

    tables: { 
        accounts: {
            account : "INTEGER PRIMARY KEY AUTOINCREMENT", 
            accountname : "TEXT NOT NULL DEFAULT ''", 
            policykey : "TEXT NOT NULL DEFAULT ''", 
            foldersynckey : "TEXT NOT NULL DEFAULT ''",
            lastsynctime : "TEXT NOT NULL DEFAULT ''", 
            state : "TEXT NOT NULL DEFAULT 'disconnected'",
            status : "TEXT NOT NULL DEFAULT 'notconnected'",
            deviceId : "TEXT NOT NULL DEFAULT ''",
            asversion : "TEXT NOT NULL DEFAULT '14.0'",
            host : "TEXT NOT NULL DEFAULT ''",
            user : "TEXT NOT NULL DEFAULT ''",
            servertype : "TEXT NOT NULL DEFAULT ''",
            seperator : "TEXT NOT NULL DEFAULT '10'",
            https : "TEXT NOT NULL DEFAULT '0'",
            provision : "TEXT NOT NULL DEFAULT '1'",
            birthday : "TEXT NOT NULL DEFAULT '0'",
            displayoverride : "TEXT NOT NULL DEFAULT '0'", 
            downloadonly : "TEXT NOT NULL DEFAULT '0'",
            autosync : "TEXT NOT NULL DEFAULT '0'"
        },

        folders: {
            account : "INTEGER",
            folderID : "TEXT NOT NULL DEFAULT ''",
            name : "TEXT NOT NULL DEFAULT ''",
            type : "TEXT NOT NULL DEFAULT ''",
            synckey : "TEXT NOT NULL DEFAULT ''",
            target : "TEXT NOT NULL DEFAULT ''",
            selected : "TEXT NOT NULL DEFAULT ''",
            lastsynctime : "TEXT NOT NULL DEFAULT ''",
            status : "TEXT NOT NULL DEFAULT ''"
        },

        changelog: {
            id : "INTEGER PRIMARY KEY AUTOINCREMENT",
            parentId : "TEXT NOT NULL DEFAULT ''",
            itemId : "TEXT NOT NULL DEFAULT ''",
            status : "TEXT NOT NULL DEFAULT ''",
            data : "TEXT NOT NULL DEFAULT ''"
        },
        
    },

    accountColumns: null,
    folderColumns: null,

    
    init: function () {
        let dbFile = FileUtils.getFile("ProfD", ["TbSync", "db_1_1.sqlite"]);
        let dbService = Cc["@mozilla.org/storage/service;1"].getService(Ci.mozIStorageService);

        this.accountColumns = this.getTableFields("accounts");
        this.folderColumns = this.getTableFields("folders");

        if (!dbFile.exists()) {
            this.conn = dbService.openDatabase(dbFile);

            // Create all defined tables
            for (let tablename in this.tables) {
                let sql = "";
                for (let field in this.tables[tablename]) {
                    if (sql.length > 0) sql = sql + ", ";
                    sql = sql + field + " " + this.tables[tablename][field];
                }

                // Create table - this statement is created completly from hardcoded elements, no userland input, no need to use createStatement
                this.conn.executeSimpleSQL("CREATE TABLE " + tablename + " (" + sql + ");");
            }

            //DB has just been created and we should try to import old TzPush 1.9 account data from preferences
            let hasTzPushSettinngs = false;
            try { 
                tbSync.tzpushSettings.getCharPref("host"); 
                hasTzPushSettinngs = true;
            } catch(e) {};
            
            //Migrate
            if (hasTzPushSettinngs) {
                let account = this.getAccount(this.addAccount("TzPush"), true); //get a copy of the cache, which can be modified
                
                try { account.deviceId = tbSync.tzpushSettings.getCharPref("deviceId") } catch(e) {};
                try { account.asversion = tbSync.tzpushSettings.getCharPref("asversion") } catch(e) {};
                try { account.host = tbSync.tzpushSettings.getCharPref("host") } catch(e) {};
                try { account.user = tbSync.tzpushSettings.getCharPref("user") } catch(e) {};
                try { account.autosync = tbSync.tzpushSettings.getIntPref("autosync") } catch(e) {};

                //BOOL fields - to not have to mess with different field types, everything is stored as TEXT in the DB
                try { account.https = (tbSync.tzpushSettings.getBoolPref("https") ? "1" : "0") } catch(e) {};
                try { account.provision = (tbSync.tzpushSettings.getBoolPref("prov") ? "1" : "0") } catch(e) {};
                try { account.birthday = (tbSync.tzpushSettings.getBoolPref("birthday") ? "1" : "0") } catch(e) {};
                try { account.displayoverride = (tbSync.tzpushSettings.getBoolPref("displayoverride") ? "1" : "0") } catch(e) {};
                try { account.downloadonly = (tbSync.tzpushSettings.getBoolPref("downloadonly") ? "1" : "0") } catch(e) {};
                
                //migrate seperator into server setting
                account.servertype = "custom";
                try {
                    if (tbSync.tzpushSettings.getCharPref("seperator") == ", ") account.seperator = "44";
                    else account.seperator = "10";
                } catch(e) {}
                
                this.setAccount(account);
            }

        } else {
            this.conn = dbService.openDatabase(dbFile);
        }
    
    },

    getTableFields: function (tablename) {
        return Object.keys(this.tables[tablename]).sort();
    },
    




    // CHANGELOG FUNCTIONS - needs caching // TODO

    getItemStatusFromChangeLog: function (parentId, itemId) {
        let statement = this.conn.createStatement("SELECT status FROM changelog WHERE parentId = :parentId AND itemId = :itemId");
        statement.params.parentId = parentId;
        statement.params.itemId = itemId;
        
        if (statement.executeStep()) {
            return statement.row.status;
        }
        return null;
    },

    addItemToChangeLog: function (parentId, itemId, status, data = "") {
        this.removeItemFromChangeLog(parentId, itemId);
        let statement = this.conn.createStatement("INSERT INTO changelog (parentId, itemId, status, data) VALUES (:parentId, :itemId, :status, :data)");
        statement.params.parentId = parentId;
        statement.params.itemId = itemId;
        statement.params.status = status;
        statement.params.data = data;
        statement.executeStep();
    },

    removeItemFromChangeLog: function (parentId, itemId) {
        let statement = this.conn.createStatement("DELETE FROM changelog WHERE parentId = :parentId AND itemId = :itemId");
        statement.params.parentId = parentId;
        statement.params.itemId = itemId;
        statement.executeStep();

    },
    
    // Remove all cards of a parentId from ChangeLog
    clearChangeLog: function (parentId) {
        let statement = this.conn.createStatement("DELETE FROM changelog WHERE parentId = :parentId");
        statement.params.parentId = parentId;
        statement.executeStep();        
    },

    getItemsFromChangeLog: function (parentId, maxnumbertosend, status = null) {
        let changelog = [];
        let statement = null;
        if (status === null) {
            statement = this.conn.createStatement("SELECT itemId, status FROM changelog WHERE parentId = :parentId LIMIT :maxnumbertosend");
        } else {
            statement = this.conn.createStatement("SELECT itemId, status FROM changelog WHERE status LIKE :status AND parentId = :parentId LIMIT :maxnumbertosend");
            statement.params.status = "%"+status+"%";
        }
        statement.params.parentId = parentId;
        statement.params.maxnumbertosend = maxnumbertosend;
        
        while (statement.executeStep()) {
            changelog.push({ "id":statement.row.itemId, "status":statement.row.status });
        }
        return changelog;
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
    
    // Get a proxied version of the cached account, which cannot be modified
    getProxyAccount: function(account) {
        let handler = {
            get (target, key) { return target[key]; },
            set (target, key, value) { Components.utils.reportError("[TbSync] Trying to write to a readonly reference of the this._accountCache!"); throw "Aborting."; return false; }
        };
        return new Proxy(this._accountCache[account], handler);
    },
    
    // The first request to get any account data will retrieve all data and store it in cache
    // This function returns a proxied read-only-reference to the account cache.
    getAccounts: function (forceupdate = false) {
        //update this._accountCache
        if (this._accountCache === null || forceupdate) {
            this._accountCache = {};
            let statement = this.conn.createStatement("SELECT * FROM accounts");
            while (statement.executeStep()) {
                let data = {};
                for (let x=0; x<this.accountColumns.length; x++) data[this.accountColumns[x]] = statement.row[this.accountColumns[x]];
                this._accountCache[statement.row.account] = data;
            }
        }
        
        let proxyAccounts = {};
        proxyAccounts.IDs = Object.keys(this._accountCache).sort((a, b) => a - b);
        proxyAccounts.data = {};
        for (let a in this._accountCache) proxyAccounts.data[a] = this.getProxyAccount(a);
        return proxyAccounts;
    },

    // This function can either return a read-only-reference or a copy of the cached account data. The default is to get a reference,
    getAccount: function (account, copy = false) {
        let data = this.getAccounts().data;
        
        //check if account is known
        if (data.hasOwnProperty(account) == false ) throw "Unknown account!" + "\nThrown by db.getAccount("+account+ ")";
        else {
            // return a reference or a copy?
            if (copy) {
                let copy = {};
                for(let p in data[account]) copy[p] = data[account][p];
                return copy;
            } else {
                return data[account];
            }
        }
    }, 
    
    getAccountSetting: function (account, name) {
        let data = this.getAccount(account);
        
        //check if field is allowed
        if (data.hasOwnProperty(name)) return data[name];
        else throw "Unknown account setting!" + "\nThrown by db.getAccountSetting("+account+", " + name + ")";
    }, 

    addAccount: function (accountname, appendID = false) {
        let statement = this.conn.createStatement("INSERT INTO accounts (accountname, deviceId) VALUES (:accountname, :deviceId)");
        statement.params.accountname = accountname;
        statement.params.deviceId = this.getNewDeviceId();
        statement.executeStep();
        
        this.getAccounts(true); //force update of this._accountCache        
        let statement2 = this.conn.createStatement("SELECT seq FROM sqlite_sequence where name = :accounts");
        statement2.params.accounts = "accounts";
        
        if (statement2.executeStep()) {
            let accountID = statement2.row.seq;
            if (appendID) this.setAccountSetting(accountID, "accountname", accountname + " #" + accountID);
            return accountID;
        } else {
            return null;
        }
    },

    removeAccount: function (account) {
        // remove account from DB
        let statement = this.conn.createStatement("DELETE FROM accounts WHERE account = :account");
        statement.params.account = account;
        statement.executeStep();

        // remove Account from Cache
        delete(this._accountCache[account]);

        // also remove all folders of that account
        this.deleteAllFolders(account);
    },

    setAccount: function (data) {
        // if the requested account does not exist, getAccount() will fail
        let settings = this.getAccount(data.account);
        
        let params = {};
        let sql = "";
        for (let p in data) {
            // update account cache if allowed
            if (settings.hasOwnProperty(p)) {
                this._accountCache[data.account][p] = data[p].toString();
                if (sql.length > 0) sql = sql + ", ";
                sql = sql + p + " = :" + p; //build paramstring p = :p which will actually be set by statement.params
                params[p] = data[p].toString();
            }
            else throw "Unknown account setting <" + p + ">!" + "\nThrown by db.setAccount("+data.account+")";
        }

        // update DB
        let statement = this.conn.createStatement("UPDATE accounts SET " + sql + " WHERE account = :account"); //sql is a param-string
        statement.params.account = data.account;
        for (let p in params) statement.params[p] = params[p];
        statement.executeStep();
    },

    setAccountSetting: function (account , name, value) {
        // if the requested account does not exist, getAccount() will fail
        let settings = this.getAccount(account);

        //check if field is allowed
        if (settings.hasOwnProperty(name)) {
            //update this._accountCache
            this._accountCache[account][name] = value.toString();
            //update DB
            let statement = this.conn.createStatement("UPDATE accounts SET "+name+" = :value WHERE account = :account"); //name is NOT coming from userland
            statement.params.value = value;
            statement.params.account = account;
            statement.executeStep();
        } else {
            throw "Unknown account setting!" + "\nThrown by db.setAccountSetting("+account+", " + name + ", " + value + ")";
        }
    },





    // FOLDER FUNCTIONS

    // Get a proxied version of the cached folder, which cannot be modified
    getProxyFolder: function(account, folder) {
        let handler = {
            get (target, key) { return target[key]; },
            set (target, key, value) { Components.utils.reportError("[TbSync] Trying to write to a readonly reference of the this._folderCache!"); throw "Aborting"; return false; }
        };
        return new Proxy(this._folderCache[account][folder], handler);
    },

    // Get all folders of a given account.
    // This function returns either a proxied read-only-reference to the folder cache, or a deep copy. Reference is default.
    getFolders: function (account, copy = false) {
        //query this._folderCache
        if (this._folderCache.hasOwnProperty(account) == false) {

            let folders = {};
            let statement = this.conn.createStatement("SELECT * FROM folders WHERE account = :account");
            statement.params.account = account;
            
            let entries = 0;
            while (statement.executeStep()) {
                let data = {};
                for (let x=0; x<this.folderColumns.length; x++) data[this.folderColumns[x]] = statement.row[this.folderColumns[x]];
                folders[statement.row.folderID] = data;
                entries++;
            }

            //update this._folderCache (array of array!)
            this._folderCache[account] = folders;
        }

        //return proxy-read-only reference or a deep copy
        if (copy) {
            let copiedFolders = {};
            for (let f in this._folderCache[account]) {
                copiedFolders[f] = {};
                for (let s in this._folderCache[account][f]) copiedFolders[f][s] = this._folderCache[account][f][s];
            }
            return copiedFolders;
        } else {
            let proxyFolders = {};
            for (let f in this._folderCache[account]) proxyFolders[f] = this.getProxyFolder(account, f);
            return proxyFolders;
        }
    },
    
    getFolder: function(account, folderID, copy = false) {
        let folders = this.getFolders(account);
        
        //does the folder exist?
        if (folders.hasOwnProperty(folderID)) {
            if (copy) {
                let copiedFolder = {};        
                for (let s in folders[folderID]) copiedFolder[s] = folders[folderID][s];
                return copiedFolder;
            } else {
                return folders[folderID];
            }
        }
        else return null;
    },

    getFolderSetting: function(account, folderID, field) {
        let folder = this.getFolder(account, folderID);

        //does the field exist?
        if (folder.hasOwnProperty(field)) return folder[field];
        else throw "Unknown folder field!" + "\nThrown by db.getFolderSetting("+account+", " + folderID + ", " + field + ")";
    },

    //use sql to find the desired data, not the cache
    findFoldersWithSetting: function (name, value, account = null) {

        let data = [];
        let statement = null;
        if (account === null) {
            statement = this.conn.createStatement("SELECT * FROM folders WHERE "+name+" = :value"); //name is NOT coming from userland!
        } else {
            statement = this.conn.createStatement("SELECT * FROM folders WHERE account = :account AND "+name+" = :value"); //name is NOT coming from userland!
            statement.params.account = account;
        }
        statement.params.value = value;
        
        while (statement.executeStep()) {
            
            let folder = {};
            for (let x=0; x<this.folderColumns.length; x++) folder[this.folderColumns[x]] = statement.row[this.folderColumns[x]];
            data.push(folder);
        }
        
        return data;
    },

    setFolder: function(data) {
        //update this._folderCache from DB, if not yet done so or a reload has been requested
        let folder = this.getFolder(data.account, data.folderID); 

        let sql = "";
        let params = {};
        for (let p in data) {
            //update folder cache if allowed
            if (folder.hasOwnProperty(p)) {
                this._folderCache[data.account][data.folderID][p] = data[p].toString();
                if (sql.length > 0) sql = sql + ", ";
                sql = sql + p + " = :" +p; //build param string, which will be replaced by statement.params
                params[p] = data[p].toString();
            }
            else throw "Unknown folder setting <" + p + ">!" + "\nThrown by db.setFolder("+data.account+")";
        }
        let statement = this.conn.createStatement("UPDATE folders SET " + sql + " WHERE account = :account AND folderID = :folderID");
        statement.params.account = data.account;
        statement.params.folderID = data.folderID;
        for (let p in params) statement.params[p] = params[p];
        statement.executeStep();                
    },

    setFolderSetting: function(account, folderID, field, value) {
        //this function can update ALL folders for a given account (if folderID == "") or just a specific folder
        //folders will contain all folders, which need to be updated;
        let folders = {};
        if (folderID == "") folders = this.getFolders(account);
        else folders[folderID] = this.getFolder(account, folderID);

        //update cache of all requested folders
        for (let fID in folders) {
            if (folders[fID].hasOwnProperty(field)) this._folderCache[account][fID][field] = value.toString();
            else throw "Unknown folder field!" + "\nThrown by db.setFolderSetting("+account+", " + folderID + ", " + field + ", " + value + ")";
        }

        //DB update - if folderID is given, set value only for that folder, otherwise for all folders - field is checked for allowed values prior to usage in SQL statement
        let statement = null;
        if (folderID != "") {
            statement = this.conn.createStatement("UPDATE folders SET "+field+" = :value WHERE account = :account AND folderID = :folderID");
            statement.params.folderID = folderID;
        } else {
            statement = this.conn.createStatement("UPDATE folders SET "+field+" = :value WHERE account = :account");
        }
        statement.params.account = account;
        statement.params.value = value;
        statement.executeStep();                        
    },

    addFolder: function(data) {
        let fields = "";
        let values ="";
        let addedData = {};
            
        for (let x=0; x<this.folderColumns.length; x++) {
            if (x>0) {fields = fields + ", "; values = values + ", "; }
            fields = fields + this.folderColumns[x];
            values = values + ":" + this.folderColumns[x];
            //only add to the cache, what has been added to the DB
            addedData[this.folderColumns[x]] = data[this.folderColumns[x]];
        }
        let statement = this.conn.createStatement("INSERT INTO folders (" + fields + ") VALUES ("+values+");");
        for (let x=0; x<this.folderColumns.length; x++) statement.params[this.folderColumns[x]] = data[this.folderColumns[x]];
        statement.executeStep();
        
        //update this._folderCache
        if (!this._folderCache.hasOwnProperty(data.account)) this._folderCache[data.account] = {};
        this._folderCache[data.account][data.folderID] = addedData;
    },

    deleteAllFolders: function(account) {
        let statement = this.conn.createStatement("DELETE FROM folders WHERE account = :account");
        statement.params.account = account;
        statement.executeStep();
        delete (this._folderCache[account]);
    },

    deleteFolder: function(account, folderID) {
        let statement = this.conn.createStatement("DELETE FROM folders WHERE account = :account AND folderID = :folderID");
        statement.params.account = account;
        statement.params.folderID = folderID;
        statement.executeStep();        
        delete (this._folderCache[account][folderID]);
    }

};

db.init();
