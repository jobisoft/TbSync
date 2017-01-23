"use strict";

//TODO (for production)
// - after migration, delete the data stored in prefs, the user might get confused at a later time, if that old account data is remigrated again, if the db was deleted
// - check database fields if add-on updates added/removed fields

var db = {

    prefSettings: Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("extensions.tbsync."),
    tzpushSettings: Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("extensions.tzpush."),

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
            servertype : "TEXT NOT NULL DEFAULT 'zarafa'",
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
        let dbFile = FileUtils.getFile("ProfD", ["TbSync", "db_1_0.sqlite"]);
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

                // Create table
                this.conn.executeSimpleSQL("CREATE TABLE " + tablename + " (" + sql + ");");
            }

            //DB has just been created and we should try to import old TzPush 1.9 account data from preferences
            let hasTzPushSettinngs = false;
            try { 
                this.tzpushSettings.getCharPref("host"); 
                hasTzPushSettinngs = true;
            } catch(e) {};
            
            //Migrate
            if (hasTzPushSettinngs) {
                let account = this.getAccount(this.addAccount("TzPush"), true); //get a copy of the cache, which can be modified
                
                try { account.deviceId = this.tzpushSettings.getCharPref("deviceId") } catch(e) {};
                try { account.asversion = this.tzpushSettings.getCharPref("asversion") } catch(e) {};
                try { account.host = this.tzpushSettings.getCharPref("host") } catch(e) {};
                try { account.user = this.tzpushSettings.getCharPref("user") } catch(e) {};
                try { account.autosync = this.tzpushSettings.getIntPref("autosync") } catch(e) {};

                //BOOL fields - to not have to mess with different field types, everything is stored as TEXT in the DB
                try { account.https = (this.tzpushSettings.getBoolPref("https") ? "1" : "0") } catch(e) {};
                try { account.provision = (this.tzpushSettings.getBoolPref("prov") ? "1" : "0") } catch(e) {};
                try { account.birthday = (this.tzpushSettings.getBoolPref("birthday") ? "1" : "0") } catch(e) {};
                try { account.displayoverride = (this.tzpushSettings.getBoolPref("displayoverride") ? "1" : "0") } catch(e) {};
                try { account.downloadonly = (this.tzpushSettings.getBoolPref("downloadonly") ? "1" : "0") } catch(e) {};
                
                //migrate seperator into server setting
                try {
                    if (this.tzpushSettings.getCharPref("seperator") == ", ") account.servertype = "horde";
                    else account.servertype = "zarafa";
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
        let statement = this.conn.createStatement("SELECT status FROM changelog WHERE parentId='"+parentId+"' AND itemId='"+itemId+"';");
        if (statement.executeStep()) {
            return statement.row.status;
        }
        return null;
    },

    addItemToChangeLog: function (parentId, itemId, status, data = "") {
        this.removeItemFromChangeLog(parentId, itemId);
        this.conn.executeSimpleSQL("INSERT INTO changelog (parentId, itemId, status, data) VALUES ('"+parentId+"', '"+itemId+"', '"+status+"', '"+data+"');");
    },

    removeItemFromChangeLog: function (parentId, itemId) {
        this.conn.executeSimpleSQL("DELETE FROM changelog WHERE parentId='"+parentId+"' AND itemId='"+itemId+"';");
    },
    
    // Remove all cards of a parentId from ChangeLog
    clearChangeLog: function (parentId) {
        this.conn.executeSimpleSQL("DELETE FROM changelog WHERE parentId='"+parentId+"';");
    },

    getItemsFromChangeLog: function (parentId, maxnumbertosend, status = null) {
        let changelog = [];
        let statussql = (status === null) ? "" : "status LIKE '%"+status+"%' AND ";
        let statement = this.conn.createStatement("SELECT itemId, status FROM changelog WHERE " + statussql+ "parentId='"+parentId+"' LIMIT "+ maxnumbertosend +";");
        while (statement.executeStep()) {
            changelog.push({ "id":statement.row.itemId, "status":statement.row.status });
        }
        return changelog;
    },





    // ACCOUNT FUNCTIONS

    getNewDeviceId: function () {
        //taken from https://jsfiddle.net/briguy37/2MVFd/
        let d = new Date().getTime();
        let uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            let r = (d + Math.random()*16)%16 | 0;
            d = Math.floor(d/16);
            return (c=='x' ? r : (r&0x3|0x8)).toString(16);
        });
        return uuid;
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
            let statement = this.conn.createStatement("SELECT * FROM accounts;");
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
        this.conn.executeSimpleSQL("INSERT INTO accounts (accountname, deviceId) VALUES ('" + accountname + "', '" + this.getNewDeviceId() + "');");
        this.getAccounts(true); //force update of this._accountCache
        
        let statement = this.conn.createStatement("SELECT seq FROM sqlite_sequence where name='accounts';");
        if (statement.executeStep()) {
            let accountID = statement.row.seq;
            if (appendID) this.setAccountSetting(accountID, "accountname", accountname + " #" + accountID);
            return accountID;
        } else {
            return null;
        }
    },

    removeAccount: function (account) {
        // remove account from DB
        this.conn.executeSimpleSQL("DELETE FROM accounts WHERE account='"+account+"';");

        // remove Account from Cache
        delete(this._accountCache[account]);

        // also remove all folders of that account
        this.deleteAllFolders(account);
    },

    setAccount: function (data) {
        // if the requested account does not exist, getAccount() will fail
        let settings = this.getAccount(data.account);

        let sql = "";
        for (let p in data) {
            // update account cache if allowed
            if (settings.hasOwnProperty(p)) {
                this._accountCache[data.account][p] = data[p].toString();
                if (sql.length > 0) sql = sql + ", ";
                sql = sql + p + " = '" + data[p] + "'";
            }
            else throw "Unknown account setting <" + p + ">!" + "\nThrown by db.setAccount("+data.account+")";
        }

        // update DB
        this.conn.executeSimpleSQL("UPDATE accounts SET " + sql + " WHERE account='" + data.account + "';");
    },

    setAccountSetting: function (account , name, value) {
        // if the requested account does not exist, getAccount() will fail
        let settings = this.getAccount(account);

        //check if field is allowed
        if (settings.hasOwnProperty(name)) {
            //update this._accountCache
            this._accountCache[account][name] = value.toString();
            //update DB
            this.conn.executeSimpleSQL("UPDATE accounts SET "+name+"='" + value + "' WHERE account='" + account + "';");
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
            let statement = this.conn.createStatement("SELECT * FROM folders WHERE account = '"+account+"';");
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
        let accountsql = "";
        if (account !== null) accountsql = "account = '"+account+"' AND ";

        let data = [];
        let statement = this.conn.createStatement("SELECT * FROM folders WHERE "+ accountsql + name+" = '"+value+"';");
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
        for (let p in data) {
            //update folder cache if allowed
            if (folder.hasOwnProperty(p)) {
                this._folderCache[data.account][data.folderID][p] = data[p].toString();
                if (sql.length > 0) sql = sql + ", ";
                sql = sql + p + " = '" + data[p] + "'";
            }
            else throw "Unknown folder setting <" + p + ">!" + "\nThrown by db.setFolder("+data.account+")";
        }
        this.conn.executeSimpleSQL("UPDATE folders SET " + sql + " WHERE account='" + data.account + "'  AND folderID = '" + data.folderID + "';");
    },

    setFolderSetting: function(account, folderID, field, value) {
        //this function can update ALL folders for a given account (if folderID == "") or just a specific folder
        //folders will contain all folders, which need to be updated;
        let folders = {};
        if (folderID == "") folders = this.getFolders(account);
        else folders[folderID] = this.getFolder(account, folderID);

        // update cache of all requested folders
        for (let fID in folders) {
            if (folders[fID].hasOwnProperty(field)) this._folderCache[account][fID][field] = value.toString();
            else throw "Unknown folder field!" + "\nThrown by db.setFolderSetting("+account+", " + folderID + ", " + field + ", " + value + ")";
        }

        //DB update - if folderID is given, set value only for that folder, otherwise for all folders
        let sql = "SET "+field+" = '" + value + "' WHERE account = '"+account+"'";
        if (folderID != "") sql = sql + " AND folderID = '" + folderID + "'";
        this.conn.executeSimpleSQL("UPDATE folders "+ sql +";");
    },

    addFolder: function(data) {
        let fields = "";
        let values ="";
        let addedData = {};
            
        for (let x=0; x<this.folderColumns.length; x++) {
            if (x>0) {fields = fields + ", "; values = values + ", "; }
            fields = fields + this.folderColumns[x];
            values = values + "'" + data[this.folderColumns[x]] + "'";
            //only add to the cache, what has been added to the DB
            addedData[this.folderColumns[x]] = data[this.folderColumns[x]];
        }
        this.conn.executeSimpleSQL("INSERT INTO folders (" + fields + ") VALUES ("+values+");");

        //update this._folderCache
        if (!this._folderCache.hasOwnProperty(data.account)) this._folderCache[data.account] = {};
        this._folderCache[data.account][data.folderID] = addedData;
    },

    deleteAllFolders: function(account) {
        this.conn.executeSimpleSQL("DELETE FROM folders WHERE account='"+account+"';");
        delete (this._folderCache[account]);
    },

    deleteFolder: function(account, folderID) {
        this.conn.executeSimpleSQL("DELETE FROM folders WHERE account='"+account+"' AND folderID = '"+folderID+"';");
        delete (this._folderCache[account][folderID]);
    },





    // SERVER SETTINGS 
    
    getServerSetting: function(account, field) {
        let settings = {};
        //read-only server setting
        let servertype =  this.getAccountSetting(account, "servertype");

        switch (servertype) {
            case "zarafa":
                settings["seperator"] = "\n";
                break;
            
            case "horde":
                settings["seperator"] = ", ";
                break;
        }
        
        if (settings.hasOwnProperty(field)) {
            return settings[field];
        } else {
            throw "Unknown server setting!" + "\nThrown by db.getServerSetting("+account+", " + field + ")";
        }
    }

};

db.init();
