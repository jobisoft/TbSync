"use strict";

var EXPORTED_SYMBOLS = ["tzPush"];

//global objects (not exported, not available outside this module)
const Cc = Components.classes;
const Ci = Components.interfaces;
var bundle = Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tzpush/locale/strings");

Components.utils.import("resource://gre/modules/FileUtils.jsm");

/* TODO
 - explizitly use if (error !== "") not if (error) - fails on "0"
 - loop over all properties when card copy
 - check "resync account folder" - maybe rework it
 - drop syncdata and use currentProcess only ???

 - fix blanks bug also for contacts group (not only for contacts2)

*/

var tzPush = {

    prefWindowObj: null,

    // TOOLS

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
            localized = bundle.GetStringFromName(msg);
        } catch (e) {}
        return localized;
    },

    dump: function (what, aMessage) {
        var consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
        consoleService.logStringMessage("[TzPush] " + what + " : " + aMessage);
    },





    // FILESYSTEM FUNCTION

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





    // GENERAL ACCOUNT STUFF

    getConnection: function(account) {
        let connection = {
            protocol: (tzPush.db.getAccountSetting(account, "https") == "1") ? "https://" : "http://",
            set host(newHost) { tzPush.db.setAccountSetting(account, "host", newHost); },
            get server() { return tzPush.db.getAccountSetting(account, "host"); },
            get host() { return this.protocol + tzPush.db.getAccountSetting(account, "host"); },
            get url() { return this.host + "/Microsoft-Server-ActiveSync"; },
            user: tzPush.db.getAccountSetting(account, "user"),
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
                this.dump("Error removing loginInfo", e);
            }
        }
        
        //create loginInfo with new password
        if (newPassword != "") {
            let newLoginInfo = new nsLoginInfo(connection.host, connection.url, null, connection.user, newPassword, "USER", "PASSWORD");
            try {
                myLoginManager.addLogin(newLoginInfo);
            } catch (e) {
                this.dump("Error adding loginInfo", e);
            }
        }
    } ,





    // ADDRESS BOOK FUNCTIONS

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
    },

    addNewCardFromServer: function (card, addressBook, account) {
        if (this.db.getAccountSetting(account, "displayoverride") == "1") {
            card.setProperty("DisplayName", card.getProperty("FirstName", "") + " " + card.getProperty("LastName", ""));
        }
        
        //Remove the ServerID from the card, add the card without serverId and modify the added card later on - otherwise the ServerId will be removed by the onAddItem-listener
        let curID = card.getProperty("ServerId", "");
        card.setProperty("ServerId", "");
        
        let addedCard = addressBook.addCard(card);
        addedCard.setProperty("ServerId", curID);
        addressBook.modifyCard(addedCard);
    },

    getAddressBookObject: function (uri) {
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        try {
            let addressBook = abManager.getDirectory(uri);
            if (addressBook instanceof Components.interfaces.nsIAbDirectory) {
                return addressBook;
            }
        } catch (e) {}
        return null;
    },

    getAddressBookName: function (uri) {
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        let allAddressBooks = abManager.directories;
        while (allAddressBooks.hasMoreElements()) {
            let addressBook = allAddressBooks.getNext();
            if (addressBook instanceof Components.interfaces.nsIAbDirectory && addressBook.URI == uri) {
                return addressBook.dirName;
            }
        }
        return null;
    },
    


    getUriFromPrefId : function(id) {
        return this._prefIDs[id];
    },
        
    scanPrefIdsOfAddressBooks : function () {
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);        
        let allAddressBooks = abManager.directories;
        this._prefIDs = {};
        while (allAddressBooks.hasMoreElements()) {
            let addressBook = allAddressBooks.getNext().QueryInterface(Components.interfaces.nsIAbDirectory);
            if (addressBook.isRemote) continue;
            this._prefIDs[addressBook.dirPrefId] = addressBook.URI;
        }
    },
    
};

// load all subscripts into tzPush
//- each subscript will be able to access functions/members of other subscripts
//- loading order does not matter
let loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"].getService(Components.interfaces.mozIJSSubScriptLoader);
loader.loadSubScript("chrome://tzpush/content/subscripts/db.js", tzPush);
loader.loadSubScript("chrome://tzpush/content/subscripts/sync.js", tzPush);
loader.loadSubScript("chrome://tzpush/content/subscripts/contactsync.js", tzPush);
loader.loadSubScript("chrome://tzpush/content/subscripts/calendarsync.js", tzPush);
loader.loadSubScript("chrome://tzpush/content/subscripts/wbxmltools.js", tzPush);

tzPush.scanPrefIdsOfAddressBooks();
