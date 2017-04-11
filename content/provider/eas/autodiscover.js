"use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncEasAutodiscover = {

    locked: true,
  
    onClose: function () {
        return !tbSyncEasAutodiscover.locked;
    },
    
    onLoad: function () {
        this.account = window.arguments[0];
        let user = window.arguments[1];
        document.getElementById("tbsync.autodiscover.user").value = user;
        document.getElementById('tbsync.autodiscover.progress').hidden = true;
        if (user == "") document.getElementById("tbsync.autodiscover.user").focus();
        else document.getElementById("tbsync.autodiscover.password").focus();
    },

    onUnload: function () {
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.notifyObservers(null, "tbsync.autodiscoverDone", tbSyncEasAutodiscover.account);
    },
    
    onCancel: function () {
        if (document.documentElement.getButton("cancel").disabled == false) {
            tbSyncEasAutodiscover.locked = false;
        }
    },
    
    onSearch: function () {
        if (document.documentElement.getButton("extra1").disabled == false) {
            document.documentElement.getButton("cancel").disabled = true;
            document.documentElement.getButton("extra1").disabled = true;
            this.autodiscover(this.account, document.getElementById('tbsync.autodiscover.user').value, document.getElementById('tbsync.autodiscover.password').value);
        }
    },
    
    setProgressBar: function (index, length) {
        let value = 5+(95*index/length);
        document.getElementById('tbsync.autodiscover.progress').hidden = false;
        document.getElementById('tbsync.autodiscover.progress').value = value;
    },
    
    autodiscover: function (account, user, password) {
        let urls = [];
        let parts = user.split("@");
        urls.push("https://autodiscover."+parts[1]+"/autodiscover/autodiscover.xml");
        urls.push("https://"+parts[1]+"/autodiscover/autodiscover.xml");
        urls.push("https://autodiscover."+parts[1]+"/Autodiscover/Autodiscover.xml");
        urls.push("https://"+parts[1]+"/Autodiscover/Autodiscover.xml");
        this.autodiscoverHTTP(account, user, password, urls, 0);
    },
        
    autodiscoverHTTP: function (account, user, password, urls, index) {
        if (index>=urls.length) {
            this.autodiscoverFailed(account, user);
            return;
        }

        this.setProgressBar(index,urls.length);
        
        let xml = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n";
        xml += "<Autodiscover xmlns= \"http://schemas.microsoft.com/exchange/autodiscover/mobilesync/requestschema/2006\">\r\n";
        xml += "<Request>\r\n";
        xml += "<EMailAddress>"+user+"</EMailAddress>\r\n";
        xml += "<AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/mobilesync/responseschema/2006</AcceptableResponseSchema>\r\n";
        xml += "</Request>\r\n";
        xml += "</Autodiscover>";

        // create request handler
        let req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
        req.mozBackgroundRequest = true;
        req.open("POST", urls[index], true);
        req.setRequestHeader("Content-Length", xml.length);
        req.setRequestHeader("Content-Type", "text/xml");
        req.setRequestHeader("User-Agent", "Thunderbird ActiveSync");
        req.setRequestHeader("Authorization", "Basic " + btoa(user + ":" + password));

        req.timeout = 30000;

        req.ontimeout  = function() {
            //log error and try next server
            tbSync.dump("Timeout on EAS autodiscover", urls[index]);
            this.autodiscoverHTTP(account, user, password, urls, index+1);
        }.bind(this);

        req.onerror = function() {
            //log error and try next server
            tbSync.dump("Network error on EAS autodiscover (" + req.status + ")", (req.responseText) ? req.responseText : urls[index]);
            this.autodiscoverHTTP(account, user, password, urls, index+1);
        }.bind(this);

        // define response handler for our request
        req.onload = function() { 
            if (req.status === 200) {
                let data = tbSync.xmltools.getDataFromXMLString(req.responseText);
        
                if (data && data.Autodiscover && data.Autodiscover.Response) {
                    // there is a response from the server
                    
                    if (data.Autodiscover.Response.Action) {
                        // "Redirect" or "Settings" are possible
                        if (data.Autodiscover.Response.Action.Redirect) {
                            // redirect, start anew with new user
                            let newuser = action.Redirect;
                            tbSync.dump("Redirect on EAS autodiscover", user +" => "+ newuser);
                            //password may not change
                            this.autodiscover(selectedAccount, newuser, password);

                        } else if (data.Autodiscover.Response.Action.Settings) {
                            // get server settings
                            let server = tbSync.xmltools.nodeAsArray(data.Autodiscover.Response.Action.Settings.Server);

                            for (let count = 0; count < server.length; count++) {
                                if (server[count].Type == "MobileSync" && server[count].Url) {
                                    this.autodiscoverOPTIONS(account, user, password, server[count].Url)
                                    //there is also a type CertEnroll
                                    break;
                                }
                            }
                        }
                    }
                }
            } else if (req.status === 401) {
                //No need to try other server, report wrong password
                document.getElementById('tbsync.autodiscover.progress').hidden = true;
                document.documentElement.getButton("cancel").disabled = false;
                document.documentElement.getButton("extra1").disabled = false;
                alert(tbSync.getLocalizedMessage("info.AutodiscoverWrongPassword").replace("##user##", user));
            } else {
                tbSync.dump("Error on EAS autodiscover (" + req.status + ")", (req.responseText) ? req.responseText : urls[index]);
                this.autodiscoverHTTP(account, user, password, urls, index+1);
            }
        }.bind(this);

        req.send(xml);
    },
    
    autodiscoverOPTIONS: function (account, user, password, url) {
        //send OPTIONS request to get ActiveSync Version and provision
        let req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
        req.mozBackgroundRequest = true;
        req.open("OPTIONS", url, true);
        req.setRequestHeader("User-Agent", "Thunderbird ActiveSync");
        req.setRequestHeader("Authorization", "Basic " + btoa(user + ":" + password));

        req.timeout = 5000;

        req.ontimeout  = function() {
            this.autodiscoverFailed (account, user);
        }.bind(this);

        req.onerror = function() {
            this.autodiscoverFailed (account, user);
        }.bind(this);

        // define response handler for our request
        req.onload = function() {
            if (req.status === 200) {
                this.autodiscoverSucceeded (account, user, password, url, req.getResponseHeader("MS-ASProtocolVersions"), req.getResponseHeader("MS-ASProtocolCommands"));
            } else {
                this.autodiscoverFailed (account, user);
            }
        }.bind(this);

        req.send();
    },
    
    autodiscoverFailed: function (account, user) {
        document.getElementById('tbsync.autodiscover.progress').hidden = true;
        document.documentElement.getButton("cancel").disabled = false;
        document.documentElement.getButton("extra1").disabled = false;
        alert(tbSync.getLocalizedMessage("info.AutodiscoverFailed").replace("##user##", user));
    },

    autodiscoverSucceeded: function (account, user, password, url, versions, commands) {
        document.getElementById('tbsync.autodiscover.progress').hidden = true;
        document.documentElement.getButton("cancel").disabled = false;
        document.documentElement.getButton("extra1").disabled = false;
        
        //update settings of user
        if (versions.indexOf("14.0") > -1) tbSync.db.setAccountSetting(account, "asversion", "14.0");
        else if (versions.indexOf("2.5") > -1) tbSync.db.setAccountSetting(account, "asversion", "2.5");
        else {
            alert(tbSync.getLocalizedMessage("info.AutodiscoverBadVersion").replace("##versions##", versions));
            return;
        }

        tbSync.db.setAccountSetting(account, "user", user);
        tbSync.db.setAccountSetting(account, "host", url.split("/")[2]);
        tbSync.db.setAccountSetting(account, "servertype", "auto");

        if (url.substring(0,5) == "https") tbSync.db.setAccountSetting(account, "https", "1");
        else tbSync.db.setAccountSetting(account, "https", "0");

        let c = commands.split(",");
        if (c.indexOf("Provision") > -1) tbSync.db.setAccountSetting(account, "provision", "1");
        else tbSync.db.setAccountSetting(account, "provision", "0");

        //also update password in PasswordManager
        tbSync.setPassword (account, password);

        tbSyncEasAutodiscover.locked = false;
        window.close();
    }
};
