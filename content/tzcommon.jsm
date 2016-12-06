"use strict";

var EXPORTED_SYMBOLS = ["tzcommon"];

Components.utils.import("resource://gre/modules/FileUtils.jsm");

var tzcommon = {

    prefs: Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush."),

    dump: function (what, aMessage) {
        var consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
        consoleService.logStringMessage(what + " : " + aMessage);
    },

    
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
            file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, FileUtils.PERMS_FILE)
        } catch (e) {
            tzpush.myDump("TZPush: Error @ addCardToDeleteLog()", e)
        }
    },


    // Remove selected card from DeleteLog
    removeCardFromDeleteLog: function (cardId) {
        let file = FileUtils.getFile("ProfD", ["ZPush","DeletedCards",cardId.replace(":", "COLON")], true);
        try {
            file.remove("true");
        } catch (e) {
            tzpush.myDump("TZPush: Error @ removeCardFromDelete()", e)
        }
    },


    // Remove all cards from DeleteLog
    clearDeleteLog: function () {
        let dir = FileUtils.getFile("ProfD", ["ZPush","DeletedCards"], true);
        let entries = dir.directoryEntries;
        while (entries.hasMoreElements()) {
            let entry = entries.getNext()
            /* entry.QueryInterface(Components.interfaces.nsIFile) */
            entry.remove("true")
        }
    },


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


    getpassword: function (host, user) {
        let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
        let logins = myLoginManager.findLogins({}, host, host + "/Microsoft-Server-ActiveSync", null);
        for (let i = 0; i < logins.length; i++) {
            if (logins[i].username === user) {
                return logins[i].password;
            }
        }
        //No password found - we should ask for one - this will be triggered by the 401 response, which also catches wrong passwords
        return "";
    },


    getLocalizedMessage: function (msg) {
        let bundle = Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tzpush/locale/statusstrings");
        return bundle.GetStringFromName(msg);
    }

    /*    function setpassword() {
            var SSL = prefs.getBoolPref("https");
            var host = prefs.getCharPref("host");
            var USER = prefs.getCharPref("user");
            var hthost = "http://" + host;
            var SERVER = "http://" + host + "/Microsoft-Server-ActiveSync";
            if (SSL === true) {
                hthost = "https://" + host;
                SERVER = "https://" + host + "/Microsoft-Server-ActiveSync";
            }

            PASSWORD = getpassword();
            if (NEWPASSWORD !== PASSWORD) {

                var nsLoginInfo = new Components.Constructor(
                    "@mozilla.org/login-manager/loginInfo;1",
                    Components.interfaces.nsILoginInfo,
                    "init");
                var loginInfo = new nsLoginInfo(hthost, SERVER, null, USER, PASSWORD, "USER", "PASSWORD");

                var updateloginInfo = new nsLoginInfo(hthost, SERVER, null, USER, NEWPASSWORD, "USER", "PASSWORD");
                var myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);

                if (NEWPASSWORD !== '') {
                    if (NEWPASSWORD !== PASSWORD) {
                        if (PASSWORD !== '') {
                            myLoginManager.removeLogin(loginInfo);
                        }
                    }
                    myLoginManager.addLogin(updateloginInfo);

                } else if (PASSWORD === "" || typeof PASSWORD === 'undefined') {
                    myLoginManager.addLogin(updateloginInfo);
                } else {
                    myLoginManager.removeLogin(loginInfo);
                }
            }
        } */
};
