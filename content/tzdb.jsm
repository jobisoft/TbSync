"use strict";

var EXPORTED_SYMBOLS = ["tzdb"];

const Cc = Components.classes;
const Ci = Components.interfaces;

/* * *
 * Inspired by:
 * https://developer.mozilla.org/en-US/Add-ons/Thunderbird/HowTos/Common_Thunderbird_Extension_Techniques/Use_SQLite
 */

var tzdb = {

    conn: null,
    defaultAccount: null,

    onLoad: function() {
        // initialization code
        this.initialized = true;
        this.dbInit();
        this.defaultAccount = this.getDefaultAccount();
    },


    dbInit: function () {
        let dirService = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties);
        let dbFile = dirService.get("ProfD", Ci.nsIFile);
        dbFile.append("ZPush");
        dbFile.append("db.sqlite");

        let dbService = Cc["@mozilla.org/storage/service;1"].getService(Ci.mozIStorageService);
        if (!dbFile.exists()) {
            this.conn = dbService.openDatabase(dbFile);
            this.conn.executeSimpleSQL("CREATE TABLE accounts(account INTEGER PRIMARY KEY AUTOINCREMENT, accountname TEXT);");
            this.conn.executeSimpleSQL("CREATE TABLE settings(id INTEGER PRIMARY KEY AUTOINCREMENT, account INTEGER, name TEXT, value TEXT);");
            this.conn.executeSimpleSQL("INSERT INTO accounts(accountname) VALUES('Default');");
        } else {
            this.conn = dbService.openDatabase(dbFile);
        }
    },


    getDefaultAccount: function () {
        //dummy, return the id of the default account
        let statement = this.conn.createStatement("SELECT account FROM accounts;");
        if (statement.executeStep()) {
            return statement.row.account;
        } else {
            return null;
        }
    },


    getIdOfSetting: function (account, name) {
        let statement = this.conn.createStatement("SELECT id FROM settings WHERE account='" + account + "' AND name='" + name +"';");
        if (statement.executeStep()) {
            return statement.row.id;
        } else {
            return null
        }
    },


    setAccountSetting: function (account , name, value) {
        //first get id of setting
        let id = this.getIdOfSetting(account, name);
        if (id) { //UPDATE
            this.conn.executeSimpleSQL("UPDATE settings SET value='"+value+"' WHERE account='" + account + "' AND id=" + id + ";");
        } else { //INSERT
            this.conn.executeSimpleSQL("INSERT INTO settings(account,name,value) VALUES('"+account+"','"+name+"','" +value+ "');");
        }
    },


    getAccountSetting: function (account, name) {
        let statement = this.conn.createStatement("SELECT value FROM settings WHERE account='" + account + "' AND name='" + name + "';");
        if (statement.executeStep()) {
            return statement.row.value;
        } else {
            return "";
        }
    }

};

tzdb.onLoad();
