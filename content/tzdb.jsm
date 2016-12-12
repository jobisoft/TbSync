"use strict";

var EXPORTED_SYMBOLS = ["tzdb"];

const Cc = Components.classes;
const Ci = Components.interfaces;

/* * *
 * Taken from:
 * https://developer.mozilla.org/en-US/Add-ons/Thunderbird/HowTos/Common_Thunderbird_Extension_Techniques/Use_SQLite
 */

var tzdb = {

  onLoad: function() {
    // initialization code
    this.initialized = true;
    this.dbInit();
  },

  conn: null,

  dbSchema: {
     tables: {
       settings:"id           INTEGER PRIMARY KEY, \
                 name         TEXT \
                 value        TEXT NOT NULL"
    }
  },

  dbInit: function () {
    var dirService = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties);

    var dbFile = dirService.get("ProfD", Ci.nsIFile);
    dbFile.append("ZPush");
    dbFile.append("db.sqlite");

    var dbService = Cc["@mozilla.org/storage/service;1"].getService(Ci.mozIStorageService);

    var conn;

    if (!dbFile.exists())
      conn = this._dbCreate(dbService, dbFile);
    else {
      conn = dbService.openDatabase(dbFile);
    }
    this.conn = conn;
  },

  _dbCreate: function (aDBService, aDBFile) {
    var conn = aDBService.openDatabase(aDBFile);
    this._dbCreateTables(conn);
    return conn;
  },

  _dbCreateTables: function (aDBConnection) {
    for(var name in this.dbSchema.tables)
      aDBConnection.createTable(name, this.dbSchema.tables[name]);
  },
  
  
  
  
  
  
  getSetting: function (name) {
    let statement = null;
    let value = null;
    
    try {
//        statement = this.conn.createStatement("SELECT * FROM settings;");
        statement = this.conn.createStatement("SELECT * FROM settings;");
//        statement.params.name = name;
        if (statement.executeStep()) {
            value = statement.row.value;
        }
    } catch (e) {
        var consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
        consoleService.logStringMessage("[SQLite] Error ("+name+"): " + e);    
    }
                        

    var consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
    consoleService.logStringMessage("[SQLite] " + name + " : " + value);    
    return value;
  },
  
  getIdOfSetting: function (name) {
    let statement = this.conn.createStatement("SELECT id FROM settings WHERE name = :name");
    statement.params.name = name;
    
    let id = null;
    if (statement.executeStep()) {
        id = statement.row.id;
    }   
    return id;
  },
  
  setSetting: function (name, value) {
    //first get id of setting
    let id = this.getIdOfSetting(name);
    
    let statement;
    if (id) {
        //UPDATE
        statement = this.conn.createStatement("UPDATE settings SET value = :value WHERE id = :id");
        statement.params.id = id;
        statement.params.value = value;
    } else {
        //INSERT
        statement = this.conn.createStatement("INSERT INTO settings (name, value) VALUES (:name, :value)");
        statement.params.name = name;
        statement.params.value = value;
    }
    
    statement.executeStep();
  }
  
  
};

tzdb.onLoad();