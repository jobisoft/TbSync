"use strict";

var EXPORTED_SYMBOLS = ["tzcommon"];

Components.utils.import("resource://gre/modules/FileUtils.jsm");
Components.utils.import("chrome://tzpush/content/tzdb.jsm");

var tzcommon = {

    prefs: Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush."),
    bundle: Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tzpush/locale/strings"),

    boolSettings : ["https", "prov", "birthday", "displayoverride", "downloadonly", "connected"],
    intSettings : ["autosync"],
    charSettings : ["abname", "deviceId", "asversion", "host", "user", "servertype", "accountname", "polkey", "folderID", "synckey", "LastSyncTime", "folderSynckey", "lastError" ],
    serverSettings : ["seperator" ],

    syncQueue : [],

    /**
        * manage sync via observer and queue
        */
    requestSync: function (account) {
        tzcommon.addJobToSyncQueue("sync", account);
    },

    requestReSync: function (account) {
        tzcommon.addJobToSyncQueue("resync", account);
    },

    addJobToSyncQueue: function (job, account = -1) {
        if (account == -1) {
            //add all connected accounts to the queue
            let accounts = tzcommon.getAccounts();
            if (accounts === null) return;

            let accountIDs = Object.keys(accounts).sort();
            for (let i=0; i<accountIDs.length; i++) {
                if (tzcommon.getAccountSetting(accountIDs[i], "connected")) tzcommon.syncQueue.push(accountIDs[i] + "." + job);
            }
        } else tzcommon.syncQueue.push(account + "." + job);

        //after jobs have been aded to the queue, try to start working on the queue
        if (tzcommon.getSyncState() == "alldone") tzcommon.workSyncQueue();
    },

    workSyncQueue: function () {
        //workSyncQueue assumes, that it is allowed to start a new sync job
        //if no more jobs in queue, do nothing
        if (tzcommon.syncQueue.length == 0) return;

        let job = tzcommon.syncQueue.shift().split(".");
        let account = job[0];
        let jobdescription = job[1];
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);

        switch (jobdescription) {
            case "sync":
            case "resync":
                tzcommon.setSyncState(account, "syncing");
                observerService.notifyObservers(null, "tzpush.syncRequest", account + "." + jobdescription);
                break;
            default:
                tzcommon.dump("Unknow job description for sync queue", jobdescription);
        }
    },



    resetSync: function (account = -1, errorcode = 999) {
        let resetAccounts = [];
        
        //account == -1 -> loop over all present accounts
        if (account == -1) {
            let allAccounts = tzcommon.getAccounts();
            if (allAccounts !== null) resetAccounts = Object.keys(allAccounts).sort();
        } else {
            resetAccounts.push(account);
        }
        
        for (let i=0; i<resetAccounts.length; i++) {
            if (tzcommon.getAccountSetting(resetAccounts[i], "LastSyncTime") == "0") {
                tzcommon.disconnectAccount(resetAccounts[i]);
            }
            tzcommon.setSyncState(resetAccounts[i], "alldone", errorcode);
        }
    },


    finishSync: function (account) {
        if (tzcommon.getSyncState() !== "alldone") {
            tzcommon.setAccountSetting(account, "LastSyncTime", Date.now());
            tzcommon.setSyncState(account, "alldone");
        }
    },


    // wrappers for set/get syncstate
    getSyncState: function () {
        return tzcommon.prefs.getCharPref("syncstate");
    },


    setSyncState: function (account, syncstate, errorcode = 200) {
        let msg = account + "." + syncstate;
        let workTheQueue = false;

        //errocode reporting only if syncstate == alldone
        if (syncstate == "alldone") {
            switch (errorcode) {
                case 200: //success, clear last error
                    tzcommon.setAccountSetting(account, "lastError", "");
                    break;
                case 999: //reset without errorcode, do nothing
                    break;
                default:
                    msg = account + ".error";
                    tzcommon.dump("Error @ Account #" + account, tzcommon.getLocalizedMessage("error." + errorcode));
                    tzcommon.setAccountSetting(account, "lastError", errorcode);
            }

            //this is the very end of a sync process - check the queue for more
            workTheQueue = true;
        }

        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.notifyObservers(null, "tzpush.syncStatus", msg);

        //if there is a request to work the queue (syncstate switch to alldone) and there are more jobs, work the queue
        if (workTheQueue && tzcommon.syncQueue.length > 0) tzcommon.workSyncQueue();
        else tzcommon.prefs.setCharPref("syncstate", syncstate);
    },





    /* tools */
    decode_utf8: function (s) {
        let platformVer = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo).platformVersion;
        if (platformVer >= 40) {
            return s;
        } else {
            try {
                return decodeURIComponent(escape(s));
            } catch (e) {
                return s;
            }
        }
    },


    encode_utf8: function (string) {
        let appInfo = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo);
        let platformVer = appInfo.platformVersion;
        if (platformVer >= 50) {
            return string;
        } else {
            string = string.replace(/\r\n/g, "\n");
            let utf8string = "";
            for (let n = 0; n < string.length; n++) {
                let c = string.charCodeAt(n);
                if (c < 128) {
                    utf8string += String.fromCharCode(c);
                } else if ((c > 127) && (c < 2048)) {
                    utf8string += String.fromCharCode((c >> 6) | 192);
                    utf8string += String.fromCharCode((c & 63) | 128);
                } else {
                    utf8string += String.fromCharCode((c >> 12) | 224);
                    utf8string += String.fromCharCode(((c >> 6) & 63) | 128);
                    utf8string += String.fromCharCode((c & 63) | 128);
                }
            }
            return utf8string;
        }
    },


    getLocalizedMessage: function (msg) {
        let localized = msg;
        try {
            localized = tzcommon.bundle.GetStringFromName(msg);
        } catch (e) {}
        return localized;
    },


    dump: function (what, aMessage) {
        var consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
        consoleService.logStringMessage("[TzPush] " + what + " : " + aMessage);
    },


    addNewCardFromServer: function (card, addressBook, account) {
        if (tzcommon.getAccountSetting(account, "displayoverride")) {
            card.setProperty("DisplayName", card.getProperty("FirstName", "") + " " + card.getProperty("LastName", ""));
        }
        
        //Remove the ServerID from the card, add the card without serverId and modify the added card later on - otherwise the ServerId will be removed by the onAddItem-listener
        let curID = card.getProperty("ServerId", "");
        card.setProperty("ServerId", "");
        
        let addedCard = addressBook.addCard(card);
        addedCard.setProperty("ServerId", curID);
        addressBook.modifyCard(addedCard);
    },




    /* Filesystem functions */
    appendToFile: function (filename, data) {
        let file = FileUtils.getFile("ProfD", ["ZPush",filename]);
        //create a strem to write to that file
        let foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
        foStream.init(file, 0x02 | 0x08 | 0x10, parseInt("0666", 8), 0); // write, create, append
        foStream.write(data, data.length);
        foStream.close();
    },


    addphoto: function (card, data) {
        let photo = card.getProperty("ServerId", "") + '.jpg';
        let file = FileUtils.getFile("ProfD", ["ZPush","Photos", photo] );

        let foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
        foStream.init(file, 0x02 | 0x08 | 0x20, 0x180, 0); // write, create, truncate
        let binary = atob(data);
        foStream.write(binary, binary.length);
        foStream.close();

        let filePath = 'file:///' + file.path.replace(/\\/g, '\/').replace(/^\s*\/?/, '').replace(/\ /g, '%20');
        card.setProperty("PhotoName", photo);
        card.setProperty("PhotoType", "file");
        card.setProperty("PhotoURI", filePath);

        return filePath;
    },


    //DeleteLog Wrappers
    // For each deleted card, create a "log" file, to be able to delete it during sync from the server as well.
    addCardToDeleteLog: function (book, cardId) { 
        return tzdb.addCardToDeleteLog(book, cardId);
    },


    // Remove selected card from DeleteLog
    removeCardFromDeleteLog: function (book, cardId) {
        return tzdb.removeCardFromDeleteLog(book, cardId);
    },


    // Remove all cards from DeleteLog
    clearDeleteLog: function (book) {
        return tzdb.clearDeleteLog(book);
    },


    getCardsFromDeleteLog: function (book, maxnumbertosend) {
        return tzdb.getCardsFromDeleteLog(book, maxnumbertosend);
    },


    /* Account settings related functions - some of them are wrapper functions, to be able to switch the storage backend*/
    connectAccount: function (account) {
            tzcommon.setAccountSetting(account, "lastError", "");
            tzcommon.setAccountSetting(account, "connected", true)
    },


    disconnectAccount: function (account) {
        tzcommon.setAccountSetting(account, "LastSyncTime", "0");
        tzcommon.setAccountSetting(account, "connected", false);
        tzcommon.removeBook(tzcommon.getSyncTarget(account).uri);
    },

    removeAccount: function (account) {
        //disconnect (removes ab, triggers deletelog cleanup) 
        tzcommon.disconnectAccount(account);
        //delete account from db
        tzdb.removeAccount(account);
    },
    
    addAccount: function() {
        let accountID = tzdb.addAccount("new_account");
        //set some defaults
        this.setAccountSetting(accountID, "accountname", tzcommon.getLocalizedMessage("new_account") + " #" + accountID);
        this.setAccountSetting(accountID, "prov", true);
        this.setAccountSetting(accountID, "asversion", "14.0");
        this.setAccountSetting(accountID, "servertype", "zarafa");
        this.setAccountSetting(accountID, "LastSyncTime", "0");
        return accountID;
    },


    getAccounts: function () {
        let accounts = tzdb.getAccounts();
        if (accounts === null && tzdb.migrate) {
            //DB has just been created and we should try to import old account data from preferences
            let account = tzcommon.addAccount();
            let accountname = "TzPush";
            
            for (let i=0; i<this.intSettings.length; i++) try {
                this.setAccountSetting(account, this.intSettings[i], tzcommon.prefs.getIntPref(this.intSettings[i]));
            } catch (e) {}

            for (let i=0; i<this.boolSettings.length; i++) try {
                this.setAccountSetting(account, this.boolSettings[i], tzcommon.prefs.getBoolPref(this.boolSettings[i]));
            } catch (e) {}

            for (let i=0; i<this.charSettings.length; i++) try {
                this.setAccountSetting(account, this.charSettings[i], tzcommon.prefs.getCharPref(this.charSettings[i]));
            } catch (e) {}

            this.setAccountSetting(account, "accountname", accountname);
            this.setAccountSetting(account, "connected", false);
            
            //migrate seperator into server setting
            try {
                if (tzcommon.prefs.getCharPref("seperator") == ", ") this.setAccountSetting(account, "servertype", "horde");
                else this.setAccountSetting(account, "servertype", "zarafa");
            } catch(e) {}
            
            //do not try to auto migrate again
            tzdb.migrate = false;
                
            accounts = tzdb.getAccounts();
        }
        return accounts;
    },


    //return all accounts, which have a given setting
    findAccountsWithSetting: function (name, value) {
        return tzdb.findAccountsWithSetting(name, value);
    },


    // wrap get functions, to be able to switch storage backend
    getAccountSetting: function(account, field) {
        if (this.serverSettings.indexOf(field) != -1) {
            //read-only server setting
            let servertype =  tzcommon.getAccountSetting(account, "servertype");
            let settings = {};

            switch (servertype) {
                case "zarafa":
                    settings["seperator"] = "\n";
                    break;
                
                case "horde":
                    settings["seperator"] = ", ";
                    break;
            }
            return settings[field];
        } else {
            let value = tzdb.getAccountSetting(account, field);

            if (this.intSettings.indexOf(field) != -1) {
                if (value == "" || value == "null") return 0;
                else return parseInt(value);
            } else if (this.boolSettings.indexOf(field) != -1) {
                return (value == "true");
            } else if (this.charSettings.indexOf(field) != -1) {
                return value;
            } else throw "Unknown TzPush setting!" + "\nThrown by tzcommon.getAccountSetting("+account+", " + field + ")";
        }
    },


    // wrap set functions, to be able to switch storage backend
    setAccountSetting: function(account, field, value) {
        //account -1 is only used durring initial reset of the addon
        if (account != -1) {
            //server settings are read-only
            if (this.serverSettings.indexOf(field) != -1) {
                throw "Server settings are read-only!" + "\nThrown by tzcommon.setAccountSetting("+account+", " + field + ")";
            } else {
                tzdb.setAccountSetting(account, field, value);
            }
        }
    },


    getConnection: function(account) {
        let connection = {
            protocol: (tzcommon.getAccountSetting(account, "https")) ? "https://" : "http://",
            set host(newHost) { tzcommon.setAccountSetting(account, "host", newHost); },
            get host() { return this.protocol + tzcommon.getAccountSetting(account, "host"); },
            get url() { return this.host + "/Microsoft-Server-ActiveSync"; },
            user: tzcommon.getAccountSetting(account, "user"),
        };
        return connection;
    },


    getPassword: function (connection) {
        let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
        let logins = myLoginManager.findLogins({}, connection.host, connection.url, null);
        for (let i = 0; i < logins.length; i++) {
            if (logins[i].username == connection.user) {
                return logins[i].password;
            }
        }
        //No password found - we should ask for one - this will be triggered by the 401 response, which also catches wrong passwords
        return null;
    },


    setPassword: function (account, newPassword) {
        let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
        let connection = this.getConnection(account);
        let curPassword = this.getPassword(connection);
        
        //Is there a loginInfo for this connection?
        if (curPassword !== null) {
            //remove current login info
            let currentLoginInfo = new nsLoginInfo(connection.host, connection.url, null, connection.user, curPassword, "USER", "PASSWORD");
            try {
                myLoginManager.removeLogin(currentLoginInfo);
            } catch (e) {
                tzcommon.dump("Error removing loginInfo", e);
            }
        }
        
        //create loginInfo with new password
        if (newPassword != "") {
            let newLoginInfo = new nsLoginInfo(connection.host, connection.url, null, connection.user, newPassword, "USER", "PASSWORD");
            try {
                myLoginManager.addLogin(newLoginInfo);
            } catch (e) {
                tzcommon.dump("Error adding loginInfo", e);
            }
        }
    } ,

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

    checkDeviceId: function (account) {
        if (tzcommon.getAccountSetting(account, "deviceId", "") == "") tzcommon.setAccountSetting(account, "deviceId", tzcommon.getNewDeviceId());
        return  tzcommon.getAccountSetting(account, "deviceId");
    },


    checkSyncTarget: function (account) {
        let target = this.getSyncTarget(account);
        if (target.name !== null && target.obj !== null && target.obj instanceof Components.interfaces.nsIAbDirectory) return true;

        // Get unique Name for new address book
        let testname = tzcommon.getAccountSetting(account, "accountname");
        let newname = testname;
        let count = 1;
        let unique = false;
        do {
            unique = true;
            let booksIter = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager).directories;
            while (booksIter.hasMoreElements()) {
                let data = booksIter.getNext();
                if (data instanceof Components.interfaces.nsIAbDirectory && data.dirName == newname) {
                    unique = false;
                    break;
                }
            }
            if (!unique) {
                newname = testname + "." + count;
                count = count + 1;
            }
        } while (!unique);
        
        //Create the new book with the unique name
        let dirPrefId = this.addBook(newname);
        
        //find uri of new book and store in prefs
        let booksIter = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager).directories;
        while (booksIter.hasMoreElements()) {
            let data = booksIter.getNext();
            if (data instanceof Components.interfaces.nsIAbDirectory && data.dirPrefId == dirPrefId) {
                tzcommon.setAccountSetting(account, "abname", data.URI); 
                tzcommon.dump("checkSyncTarget("+account+")", "Creating new sync target (" + newname + ", " + data.URI + ")");
                return true;
            }
        }
        
        return false;
    },


    getSyncTarget: function (account) { //account,type
        let target = {
            get name() {
                let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
                let allAddressBooks = abManager.directories;
                while (allAddressBooks.hasMoreElements()) {
                    let addressBook = allAddressBooks.getNext();
                    if (addressBook instanceof Components.interfaces.nsIAbDirectory && addressBook.URI == this.uri) {
                        return addressBook.dirName;
                    }
                }
                return null;
            },
            
            get uri() { 
                return tzcommon.getAccountSetting(account, "abname");
            },
            
            get obj() { 
                if (this.uri !== "") {
                    let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
                    try {
                        let addressBook = abManager.getDirectory(this.uri);
                        if (addressBook instanceof Components.interfaces.nsIAbDirectory) {
                            return addressBook;
                        }
                    } catch (e) {}
                }
                return null;
            }
        };
        return target;
    },


    addBook: function (name) {
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        return abManager.newAddressBook(name, "", 2); /* kPABDirectory - return abManager.newAddressBook(name, "moz-abmdbdirectory://", 2); */
    },


    removeBook: function (uri) { 
        // get all address books
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        try {
            if (abManager.getDirectory(uri) instanceof Components.interfaces.nsIAbDirectory) {
                abManager.deleteAddressBook(uri);
            }
        } catch (e) {}
    }
        
};
