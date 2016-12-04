/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */
var EXPORTED_SYMBOLS = ["Send" /*, "callback" */];

Components.utils.import("chrome://tzpush/content/toxml.js");

// The entire module gets exported (this one function), why do wen need a module?
function Send(wbxml, callback, command) {
    let platformVer = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo).platformVersion;   
    let prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush.");
    
    if (prefs.getCharPref("debugwbxml") === "1") {
        this.myDump("sending", decodeURIComponent(escape(toxml(wbxml).split('><').join('>\n<'))));
        appendToFile("wbxml-debug.log", wbxml);
    }


    let protocol = (prefs.getBoolPref("https")) ? "https://" : "http://";
    let host = protocol + prefs.getCharPref("host");
    let server = host + "/Microsoft-Server-ActiveSync";

    let user = prefs.getCharPref("user");
    let password = getpassword(host, user)
    let deviceType = 'Thunderbird';
    let deviceId = prefs.getCharPref("deviceId");
    
    // Create request handler
    let req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
    req.mozBackgroundRequest = true;
    if (prefs.getCharPref("debugwbxml") === "1") {
        myDump("sending", "POST " + server + '?Cmd=' + command + '&User=' + user + '&DeviceType=' +deviceType + '&DeviceId=' + deviceId, true);
    }
    req.open("POST", server + '?Cmd=' + command + '&User=' + user + '&DeviceType=' +deviceType + '&DeviceId=' + deviceId, true);
    req.overrideMimeType("text/plain");
    req.setRequestHeader("User-Agent", deviceType + ' ActiveSync');
    req.setRequestHeader("Content-Type", "application/vnd.ms-sync.wbxml");
    req.setRequestHeader("Authorization", 'Basic ' + btoa(user + ':' + password));
    if (prefs.getCharPref("asversion") === "2.5") {
        req.setRequestHeader("MS-ASProtocolVersion", "2.5");
    } else {
        req.setRequestHeader("MS-ASProtocolVersion", "14.0");
    }
    req.setRequestHeader("Content-Length", wbxml.length);
    if (prefs.getBoolPref("prov")) {
        req.setRequestHeader("X-MS-PolicyKey", prefs.getCharPref("polkey"));
    }

    // Define response handler for our request
    req.onreadystatechange = function() { 
        //this.myDump("header",req.getAllResponseHeaders().toLowerCase())
        if (req.readyState === 4 && req.status === 200) {

            wbxml = req.responseText;
            if (prefs.getCharPref("debugwbxml") === "1") {
                this.myDump("recieved", decode_utf8(toxml(wbxml).split('><').join('>\n<')));
                appendToFile("wbxml-debug.log", wbxml);
                //this.myDump("header",req.getAllResponseHeaders().toLowerCase())
            }
            if (wbxml.substr(0, 4) !== String.fromCharCode(0x03, 0x01, 0x6A, 0x00)) {
                if (wbxml.length !== 0) {
                    this.myDump("tzpush", "expecting wbxml but got - " + req.responseText + ", request status = " + req.status + ", ready state = " + req.readyState);
                }
            }
            callback(req.responseText);
        } else if (req.readyState === 4) {

            switch(req.status) {
                case 0:
                    this.myDump("tzpush request status", "0 -- No connection - check server address");
                    break;
                
                case 401: // AuthError
                    this.myDump("tzpush request status", "401 -- Auth error - check username and password");
                    break;
                
                case 449: // Request for new provision
                    if (prefs.getBoolPref("prov")) {
                        prefs.setCharPref("go", "resync");
                    } else {
                        this.myDump("tzpush request status", "449 -- Insufficient information - retry with provisioning");
                    }
                    break;
            
                case 451: // Redirect - update host and login manager 
                    let header = req.getResponseHeader("X-MS-Location");
                    let newurl = header.slice(header.indexOf("://") + 3, header.indexOf("/M"));
                    let password = getpassword();

                    this.myDump("Redirect (451)", "header: " + header + ", newurl: " + newurl + ", password: " + password);
                    prefs.setCharPref("host", newurl);

                    let protocol = (prefs.getBoolPref("https")) ? "http://" : "https://";
                    let host = protocol + newurl;
                    let server = host + "/Microsoft-Server-ActiveSync";
                    let user = prefs.getCharPref("user");

                    let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
                    let updateloginInfo = new nsLoginInfo(host, server, null, user, password, "USER", "PASSWORD");
                    let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);

                    // We are trying to update the LoginManager (because the host changed), but what about Polkey, GetFolderId and fromzpush?
                    try {
                        myLoginManager.addLogin(updateloginInfo);
                        if (prefs.getBoolPref("prov")) {
                            this.Polkey();
                        } else {
                            if (prefs.getCharPref("synckey") === '') {
                                this.GetFolderId();
                            } else {
                                this.fromzpush();
                            }
                        }
                    } catch (e) {
                        if (e.message.match("This login already exists")) {
                            this.myDump("login ", "Already exists");
                            if (prefs.getBoolPref("prov")) {
                                this.Polkey();
                            } else {
                                if (prefs.getCharPref("synckey") === '') {
                                    this.GetFolderId();
                                } else {
                                    this.fromzpush();
                                }
                            }
                        } else {
                            this.myDump("login error", e);
                        }
                    }
                    break;
                    
                default:
                    this.myDump("tzpush request status", "reported -- " + req.status);
            }
            prefs.setCharPref("syncstate", "alldone"); // Maybe inform user about errors?
        }

    }.bind(this);


    try {        
        if (platformVer >= 50) {
            /*nBytes = wbxml.length;
            ui8Data = new Uint8Array(nBytes);
            for (let nIdx = 0; nIdx < nBytes; nIdx++) {
                ui8Data[nIdx] = wbxml.charCodeAt(nIdx) & 0xff;
            }*/

            req.send(wbxml);
        } else {
            let nBytes = wbxml.length;
            let ui8Data = new Uint8Array(nBytes);
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