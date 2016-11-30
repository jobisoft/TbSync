/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */
var EXPORTED_SYMBOLS = ["Send", "callback"];

//tzprefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush.")
var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush.");
var Components;
function myDump(what, aMessage) {
    var consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
    consoleService.logStringMessage(what + " : " + aMessage);
}


function Send(wbxml, callback, command) {
    var appInfo = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo);
    var platformVer = appInfo.platformVersion;
    
    var _bundle = Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tzpush/locale/statusstrings");

    function getLocalizedMessage(msg) {
        return _bundle.GetStringFromName(msg);
    }

    Components.utils.import("chrome://tzpush/content/toxml.js");

    function decode_utf8(s) {
        var appInfo = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo);
        var platformVer = appInfo.platformVersion;
        if (platformVer >= 40) {
            return s;
        } else {
            try {
                return decodeURIComponent(escape(s));
            } catch (e) {
                return s;
            }
        }
    }

    if (this.prefs.getCharPref("debugwbxml") === "1") {
        this.myDump("sending", decodeURIComponent(escape(toxml(wbxml).split('><').join('>\n<'))));
        writewbxml(wbxml);
    }
    
    var SSL = this.prefs.getBoolPref("https");
    var host = this.prefs.getCharPref("host");
    var hthost;
    var SERVER;
    var USER;
    var PASSWORD;
    var deviceType;
    var deviceId;
    var polkey;
    var req;
    var LastSyncTime;
    var sending = getLocalizedMessage("sendingString");
    var receiving = getLocalizedMessage("receivingString");
    var NEWPASSWORD;

    function setpassword() {
        var SSL = this.prefs.getBoolPref("https");
        var host = this.prefs.getCharPref("host");
        var USER = this.prefs.getCharPref("user");
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
    }

    function getpassword() {

        var myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);

        var logins = myLoginManager.findLogins({}, hthost, SERVER, null);
        var password = '';
        for (var i = 0; i < logins.length; i++) {
            if (logins[i].username === USER) {
                password = logins[i].password;
                break;
            }
        }
        return password;
    }

    hthost = "http://" + host;
    SERVER = "http://" + host + "/Microsoft-Server-ActiveSync";
    if (SSL === true) {
        hthost = "https://" + host;
        SERVER = "https://" + host + "/Microsoft-Server-ActiveSync";
    }
    USER = this.prefs.getCharPref("user");
    PASSWORD = getpassword();
    deviceType = 'Thunderbird';
    deviceId = this.prefs.getCharPref("deviceId");
    polkey = this.prefs.getCharPref("polkey");

    req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
    req.mozBackgroundRequest = true;
    if (this.prefs.getCharPref("debugwbxml") === "1") {
        myDump("sending", "POST " + SERVER + '?Cmd=' + command + '&User=' + USER + '&DeviceType=Thunderbird' + '&DeviceId=' + deviceId, true);
    }
    req.open("POST", SERVER + '?Cmd=' + command + '&User=' + USER + '&DeviceType=Thunderbird' + '&DeviceId=' + deviceId, true);
    req.overrideMimeType("text/plain");
    req.setRequestHeader("User-Agent", deviceType + ' ActiveSync');
    req.setRequestHeader("Content-Type", "application/vnd.ms-sync.wbxml");
    req.setRequestHeader("Authorization", 'Basic ' + btoa(USER + ':' + PASSWORD));
    if (this.prefs.getCharPref("asversion") === "2.5") {
        req.setRequestHeader("MS-ASProtocolVersion", "2.5");
    } else {
        req.setRequestHeader("MS-ASProtocolVersion", "14.0");
    }
    req.setRequestHeader("Content-Length", wbxml.length);
    if (this.prefs.getBoolPref("prov")) {
        req.setRequestHeader("X-MS-PolicyKey", polkey);
    }

    req.onreadystatechange = function() { //this.myDump("header",req.getAllResponseHeaders().toLowerCase())
        if (req.readyState === 4 && req.status === 200) {

            wbxml = req.responseText;
            if (this.prefs.getCharPref("debugwbxml") === "1") {
                this.myDump("recieved", decode_utf8(toxml(wbxml).split('><').join('>\n<')));
                writewbxml(wbxml);
                    //this.myDump("header",req.getAllResponseHeaders().toLowerCase())
            }
            if (wbxml.substr(0, 4) !== String.fromCharCode(0x03, 0x01, 0x6A, 0x00)) {
                if (wbxml.length !== 0) {
                    this.myDump("tzpush", "expecting wbxml but got - " + req.responseText + " request status = " + req.status + " ready state = " + req.readyState);
                }
            }
            callback(req.responseText);
        } else if (req.readyState === 4) {
            if (req.status === 0) {
                this.myDump("tzpush request status", "0 -- No connection - check server address");
            } else if (req.status === 401) {
                this.myDump("tzpush request status", "401 -- Auth error - check username and password");
            } else if (req.status === 449) {
                if (this.prefs.getBoolPref("prov")) {
                    this.prefs.setCharPref("go", "resync");
                } else {
                    this.myDump("tzpush request status", "449 -- Insufficient information - retry with provisioning");
                }
            } else if (req.status === 451) {
                var header = req.getResponseHeader("X-MS-Location");
                this.myDump("header =", header);
                var newurl = header.slice(header.indexOf("://") + 3, header.indexOf("/M"));
                this.myDump("newurl", newurl);
                var password = getpassword();
                this.prefs.setCharPref("host", newurl);
                this.myDump("password = ", password);
                var SSL = this.prefs.getBoolPref("https");
                var host = this.prefs.getCharPref("host");
                var USER = this.prefs.getCharPref("user");

                var hthost = "http://" + host;
                var SERVER = "http://" + host + "/Microsoft-Server-ActiveSync";
                if (SSL === true) {
                    hthost = "https://" + host;
                    SERVER = "https://" + host + "/Microsoft-Server-ActiveSync";
                }
                var nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
                var updateloginInfo = new nsLoginInfo(hthost, SERVER, null, USER, password, "USER", "PASSWORD");
                var myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
                try {
                    myLoginManager.addLogin(updateloginInfo);
                    if (this.prefs.getBoolPref("prov")) {
                        this.Polkey();
                    } else {
                        if (this.prefs.getCharPref("synckey") === '') {
                            this.GetFolderId();
                        } else {
                            this.fromzpush();
                        }
                    }
                } catch (e) {
                    if (e.message.match("This login already exists")) {
                        this.myDump("login ", "Already exists");
                        if (this.prefs.getBoolPref("prov")) {
                            this.Polkey();
                        } else {
                            if (this.prefs.getCharPref("synckey") === '') {
                                this.GetFolderId();
                            } else {
                                this.fromzpush();
                            }
                        }
                    } else {
                        this.myDump("login error", e);
                    }
                }
            } else {
                this.myDump("tzpush request status", "reported -- " + req.status);
            }
            this.prefs.setCharPref("syncstate", "alldone");
        }

    }.bind(this);

    try {
        var nBytes;
        var ui8Data;
        
        if (platformVer >= 50) {
            nBytes = wbxml.length;
            ui8Data = new Uint8Array(nBytes);
            for (let nIdx = 0; nIdx < nBytes; nIdx++) {
                ui8Data[nIdx] = wbxml.charCodeAt(nIdx) & 0xff;
            }

            req.send(wbxml);
        } else {
            nBytes = wbxml.length;
            ui8Data = new Uint8Array(nBytes);
            for (let nIdx = 0; nIdx < nBytes; nIdx++) {
                ui8Data[nIdx] = wbxml.charCodeAt(nIdx) & 0xff;
            }
            //this.myDump("ui8Data",toxml(wbxml))	
            req.send(ui8Data);
        }
    } catch (e) {
        this.myDump("tzpush error", e);
    }

    return true;
}