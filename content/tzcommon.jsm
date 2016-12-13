"use strict";

var EXPORTED_SYMBOLS = ["tzcommon"];

Components.utils.import("resource://gre/modules/FileUtils.jsm");
Components.utils.import("chrome://tzpush/content/tzdb.jsm");

var tzcommon = {

    prefs: Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush."),
    bundle: Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tzpush/locale/strings"),

    boolSettings : ["https", "prov", "birthday", "displayoverride", "connected", "downloadonly" /*, "hidephones", "showanniversary" */],
    intSettings : ["autosync"],
    charSettings : ["abname", "deviceId", "asversion", "host", "user", "seperator", "accountname", "polkey", "folderID", "synckey", "LastSyncTime", "folderSynckey" ],
    
    /**
        * manage sync via observer - since this is the only place where new requests end up, we could also implement some sort of queuing
        */
    requestSync: function () {
        if (tzcommon.prefs.getCharPref("syncstate") === "alldone") {
            tzcommon.prefs.setCharPref("syncstate","syncrequest");
        }
    },

    requestReSync: function () {
        if (tzcommon.prefs.getCharPref("syncstate") === "alldone") {
            tzcommon.prefs.setCharPref("syncstate","resyncrequest");
        }
    },

    resetSync: function () {
        if (tzcommon.prefs.getCharPref("syncstate") !== "alldone") {
            tzcommon.prefs.setCharPref("syncstate", "alldone");
        }
    },
   
    finishSync: function () {
        if (tzcommon.prefs.getCharPref("syncstate") !== "alldone") {
            tzcommon.setSetting("LastSyncTime", Date.now());
            tzcommon.prefs.setCharPref("syncstate", "alldone");
            let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
            observerService.notifyObservers(null, "tzpush.syncstatus", "done");
        }
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
        return tzcommon.bundle.GetStringFromName(msg);
    },


    dump: function (what, aMessage) {
        var consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
        consoleService.logStringMessage("[TzPush] " + what + " : " + aMessage);
    },





    /* Address book functions */
    removeSId: function (aParentDir, ServerId) {
        let acard = aParentDir.getCardFromProperty("ServerId", ServerId, false);
        if (acard instanceof Components.interfaces.nsIAbCard) {
            acard.setProperty("ServerId", "");
            aParentDir.modifyCard(acard);
        }
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


    // For each deleted card, create a "log" file, to be able to delete it during sync from the server as well.
    addCardToDeleteLog: function (cardId) { 
        // Get fileobject of <UserProfileFolder>/ZPush/DeletedCards/cardId
        let file = FileUtils.getFile("ProfD", ["ZPush","DeletedCards",cardId.replace(":", "COLON")], true);
        try {
            file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, FileUtils.PERMS_FILE); //TODO: File may exist already due to doubling
        } catch (e) {
            this.dump("Error @ addCardToDeleteLog()", e);
        }
    },


    // Remove selected card from DeleteLog
    removeCardFromDeleteLog: function (cardId) {
        let file = FileUtils.getFile("ProfD", ["ZPush","DeletedCards",cardId.replace(":", "COLON")], true);
        try {
            file.remove("true");
        } catch (e) {
            this.dump("Error @ removeCardFromDelete()", e);
        }
    },


    // Remove all cards from DeleteLog
    clearDeleteLog: function () {
        let dir = FileUtils.getDir("ProfD", ["ZPush","DeletedCards"], true);
        let entries = dir.directoryEntries;
        while (entries.hasMoreElements()) {
            let entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
            entry.remove("true");
        }
    },


    getCardsFromDeleteLog: function (maxnumbertosend) {
        let dir = FileUtils.getDir("ProfD", ["ZPush","DeletedCards"], true);
        let entries = dir.directoryEntries;
        let deletelog = [];
        while (entries.hasMoreElements() && deletelog.length < maxnumbertosend) {
            let entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
            deletelog.push(entry.leafName.replace("COLON", ":"));
        }
        return deletelog;
    },





    /* Account settings related functions */
    getConnection: function() {
        let connection = {
            protocol: (tzcommon.getSetting("https")) ? "https://" : "http://",
            set host(newHost) { tzcommon.setSetting("host", newHost); },
            get host() { return this.protocol + tzcommon.getSetting("host"); },
            get url() { return this.host + "/Microsoft-Server-ActiveSync"; },
            user: tzcommon.getSetting("user"),
        };
        return connection;
    },
    
    // wrap get functions, to be able to switch storage backend
    getSetting: function(field) {
        let value = tzdb.getAccountSetting(tzdb.defaultAccount, field);

        if (this.intSettings.indexOf(field) != -1) {
            if (value === "" || value === "null") return 0;
            else return parseInt(value);
        } else if (this.boolSettings.indexOf(field) != -1) {
            return (value === "true");
        } else if (this.charSettings.indexOf(field) != -1) {
            return value;
        } else throw "Unknown TzPush setting!" + "\nThrown by tzcommon.getSetting(" + field + ")";

        /* if db empty, try to load from prefs as fallback - how to test if db is empty? TODO
        if (this.intSettings.indexOf(field) != -1) return tzcommon.prefs.getIntPref(field);
        else if (this.boolSettings.indexOf(field) != -1) return tzcommon.prefs.getBoolPref(field);
        else if (this.charSettings.indexOf(field) != -1) return tzcommon.prefs.getCharPref(field);
        else throw "Unknown TzPush setting!" + "\nThrown by tzcommon.getSetting(" + field + ")";*/
    },

    // wrap set functions, to be able to switch storage backend
    setSetting: function(field, value) {
        tzdb.setAccountSetting(tzdb.defaultAccount, field, value);
    },

    getPassword: function (connection) {
        let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
        let logins = myLoginManager.findLogins({}, connection.host, connection.url, null);
        for (let i = 0; i < logins.length; i++) {
            if (logins[i].username === connection.user) {
                return logins[i].password;
            }
        }
        //No password found - we should ask for one - this will be triggered by the 401 response, which also catches wrong passwords
        return null;
    },


    setPassword: function (newPassword) {
        let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
        let connection = this.getConnection();
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
        let newLoginInfo = new nsLoginInfo(connection.host, connection.url, null, connection.user, newPassword, "USER", "PASSWORD");
        try {
            myLoginManager.addLogin(newLoginInfo);
        } catch (e) {
            tzcommon.dump("Error adding loginInfo", e);
        }
    } ,


    checkDeviceId: function () {
        if (tzcommon.getSetting("deviceId", "") === "") tzcommon.setSetting("deviceId", Date.now());
        return  tzcommon.getSetting("deviceId");
    },


    checkSyncTarget: function () {
        let addressBook = this.getSyncTarget().obj;
        if (addressBook instanceof Components.interfaces.nsIAbDirectory) return true;
        
        // Get unique Name for new address book
        let testname = tzcommon.getSetting("accountname");
        let newname = testname;
        let count = 1;
        let unique = false;
        do {
            unique = true;
            let booksIter = this.addBookOrGetItter();
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
        let dirPrefId = this.addBookOrGetItter(newname);
        
        //find uri of new book and store in prefs
        let booksIter = this.addBookOrGetItter();
        while (booksIter.hasMoreElements()) {
            let data = booksIter.getNext();
            if (data instanceof Components.interfaces.nsIAbDirectory && data.dirPrefId == dirPrefId) {
                tzcommon.setSetting("abname", data.URI); 
                return true;
            }
        }
        
        return false;
    },


    getSyncTarget: function () { //account,type
        let target = {
            get name() {
                let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
                let allAddressBooks = abManager.directories;
                while (allAddressBooks.hasMoreElements()) {
                    let addressBook = allAddressBooks.getNext();
                    if (addressBook instanceof Components.interfaces.nsIAbDirectory && addressBook.URI === this.uri) {
                        return addressBook.dirName;
                    }
                }
                return null;
            },
            
            get uri() { 
                return tzcommon.getSetting("abname"); 
            },
            
            get obj() { 
                if (this.uri !== "") {
                    let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
                    try {
                        let addressBook = abManager.getDirectory(this.uri);
                        if (addressBook instanceof Components.interfaces.nsIAbDirectory) return addressBook;
                    } catch (e) {}
                }
                return null;
            }
        };
        return target;
    },


    addBookOrGetItter: function (name = null) { //if name === null, returns iter, otherwise adds book with given name
        // get all address books
        if (Components.classes["@mozilla.org/abmanager;1"]) { // TB 3
            let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
            if (name === null) return abManager.directories;
            else return abManager.newAddressBook(name, "", 2); //kPABDirectory - return abManager.newAddressBook(name, "moz-abmdbdirectory://", 2);
        } else { // TB 2
            // obtain the main directory through the RDF service
            let dir = Components.classes["@mozilla.org/rdf/rdf-service;1"].getService(Components.interfaces.nsIRDFService).GetResource("moz-abdirectory://").QueryInterface(Components.interfaces.nsIAbDirectory);
            // setup the "properties" of the new address book
            let properties = Components.classes["@mozilla.org/addressbook/properties;1"].createInstance(Components.interfaces.nsIAbDirectoryProperties);
            properties.description = name;
            properties.dirType = 2; // address book
            if (name === null) return dir.childNodes;
            else return dir.createNewDirectory(properties);
        }
    },

    removeBook: function (uri) { 
        // get all address books
        if (Components.classes["@mozilla.org/abmanager;1"]) { // TB 3
            let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
            try {
                if (abManager.getDirectory(uri) instanceof Components.interfaces.nsIAbDirectory) {
                    abManager.deleteAddressBook(uri);
                }
            } catch (e) {}
        } else { // TB 2
            // obtain the main directory through the RDF service
            let dir = Components.classes["@mozilla.org/rdf/rdf-service;1"].getService(Components.interfaces.nsIRDFService).GetResource("moz-abdirectory://").QueryInterface(Components.interfaces.nsIAbDirectory);
            // setup the "properties" of the new address book
            //TODO
        }
    }
        
};
