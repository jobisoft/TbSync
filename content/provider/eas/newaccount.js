"use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncEasNewAccount = {

    locked: true,
  
    onClose: function () {
        return !tbSyncEasNewAccount.locked;
    },
    
    onLoad: function () {
        this.elementName = document.getElementById('tbsync.newaccount.name');
        this.elementUser = document.getElementById('tbsync.newaccount.user');
        this.elementPass = document.getElementById('tbsync.newaccount.password');
        this.elementServertype = document.getElementById('tbsync.newaccount.servertype');
        
        document.documentElement.getButton("extra1").disabled = true;
        document.documentElement.getButton("extra1").label = tbSync.getLocalizedMessage("newaccount.add_auto","eas");
        document.getElementById('tbsync.newaccount.autodiscoverlabel').hidden = true;
        document.getElementById('tbsync.newaccount.autodiscoverstatus').hidden = true;

        document.getElementById("tbsync.newaccount.name").focus();
    },

    onUnload: function () {
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.notifyObservers(null, "tbsync.autodiscoverDone", tbSyncEasNewAccount.account);
    },
    
    onCancel: function () {
        if (document.documentElement.getButton("cancel").disabled == false) {
            tbSyncEasNewAccount.locked = false;
        }
    },

    onUserTextInput: function () {
        if (this.elementServertype.value != "outlook.com" && this.elementUser.value.indexOf("@outlook.")!=-1) {
            this.elementServertype.selectedIndex = 3;
            this.onUserDropdown();
        }
        document.documentElement.getButton("extra1").disabled = (this.elementName.value == "" || this.elementUser.value == "" || this.elementPass.value == "");
    },

    onUserDropdown: function () {
        document.documentElement.getButton("extra1").label = tbSync.getLocalizedMessage("newaccount.add_" + this.elementServertype.value,"eas");
    },
    
    onAdd: function () {
        if (document.documentElement.getButton("extra1").disabled == false) {
            let servertype = this.elementServertype.value;
            let newAccountEntry = tbSync.eas.getNewAccountEntry();
            
            newAccountEntry.accountname = this.elementName.value;
            newAccountEntry.user = this.elementUser.value;
            newAccountEntry["servertype"] = servertype;

            if (servertype == "outlook.com") {
                let fixedSettings = tbSync.eas.getFixedServerSettings(servertype);
                for (let prop in fixedSettings) {
                  if( newAccountEntry.hasOwnProperty(prop) ) {
                    newAccountEntry[prop] = fixedSettings[prop];
                  } 
                }
                tbSyncEasNewAccount.addAccount(newAccountEntry);
            } else if (servertype == "custom") {
                tbSyncEasNewAccount.addAccount(newAccountEntry);
            } else if (servertype == "auto") {
                document.documentElement.getButton("cancel").disabled = true;
                document.documentElement.getButton("extra1").disabled = true;
                this.autodiscover(newAccountEntry, this.elementPass.value);
            }

        }
    },
    
    addAccount (newAccountEntry) {
        //create a new EAS account and pass its id to updateAccountsList, which will select it
        //the onSelect event of the List will load the selected account
        window.opener.tbSyncAccountManager.updateAccountsList(tbSync.db.addAccount(newAccountEntry));
        tbSyncEasNewAccount.locked = false;
        window.close();
    },





    //AUTODISCOVER
    autodiscover: function (accountdata, password) {
        let urls = [];
        let parts = accountdata.user.split("@");
        urls.push("https://autodiscover."+parts[1]+"/autodiscover/autodiscover.xml");
        urls.push("https://"+parts[1]+"/autodiscover/autodiscover.xml");
        urls.push("https://autodiscover."+parts[1]+"/Autodiscover/Autodiscover.xml");
        urls.push("https://"+parts[1]+"/Autodiscover/Autodiscover.xml");
        this.autodiscoverHTTP(accountdata, password, urls, 0);
    },

    setAutodiscoverStatus: function (index, urls) {
        tbSync.dump("Trying EAS autodiscover", urls[index]);
        document.getElementById('tbsync.newaccount.autodiscoverlabel').hidden = false;
        document.getElementById('tbsync.newaccount.autodiscoverstatus').hidden = false;
        document.getElementById('tbsync.newaccount.autodiscoverstatus').textContent  = urls[index] + " ("+(index+1)+"/"+urls.length+")";
    },
    

    autodiscoverHTTP: function (accountdata, password, urls, index) {
        if (index>=urls.length) {
            this.autodiscoverFailed(accountdata);
            return;
        }

        this.setAutodiscoverStatus(index, urls);
        
        let xml = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n";
        xml += "<Autodiscover xmlns= \"http://schemas.microsoft.com/exchange/autodiscover/mobilesync/requestschema/2006\">\r\n";
        xml += "<Request>\r\n";
        xml += "<EMailAddress>"+accountdata.user+"</EMailAddress>\r\n";
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
        req.setRequestHeader("Authorization", "Basic " + btoa(accountdata.user + ":" + password));

        req.timeout = 15000;

        req.ontimeout  = function() {
            //log error and try next server
            tbSync.dump("Timeout on EAS autodiscover", urls[index]);
            this.autodiscoverHTTP(accountdata, password, urls, index+1);
        }.bind(this);

        req.onerror = function() {
            //log error and try next server
            tbSync.dump("Network error on EAS autodiscover (" + req.status + ")", (req.responseText) ? req.responseText : urls[index]);
            this.autodiscoverHTTP(accountdata, password, urls, index+1); 
        }.bind(this);

        // define response handler for our request
        req.onload = function() { 
            if (req.status === 200) {
                tbSync.dump("EAS autodiscover with response (status: 200)", "\n" + req.responseText);
                let data = tbSync.xmltools.getDataFromXMLString(req.responseText);
        
                if (!(data === null) && data.Autodiscover && data.Autodiscover.Response && data.Autodiscover.Response.Action) {
                    // "Redirect" or "Settings" are possible
                    if (data.Autodiscover.Response.Action.Redirect) {
                        // redirect, start anew with new user
                        let newuser = action.Redirect;
                        tbSync.dump("Redirect on EAS autodiscover", accountdata.user +" => "+ newuser);
                        //password may not change
                        accountdata.user = newuser;
                        this.autodiscover(accountdata, password);

                    } else if (data.Autodiscover.Response.Action.Settings) {
                        // get server settings
                        let server = tbSync.xmltools.nodeAsArray(data.Autodiscover.Response.Action.Settings.Server);

                        for (let count = 0; count < server.length; count++) {
                            if (server[count].Type == "MobileSync" && server[count].Url) {
                                this.autodiscoverOPTIONS(accountdata, password, server[count].Url)
                                //there is also a type CertEnroll
                                return; //was break;
                            }
                        }
                    }
                } else {
                    tbSync.dump("EAS autodiscover with invalid response, skipping.", urls[index]);
                    this.autodiscoverHTTP(accountdata, password, urls, index+1);
                }
            } else if (req.status === 401) {
                //Report wrong password and start again
                window.openDialog("chrome://tbsync/content/password.xul", "passwordprompt", "centerscreen,chrome,resizable=no", accountdata, 
                    function() {
                        tbSyncEasNewAccount.autodiscover(accountdata, tbSync.eas.getPassword(accountdata));
                    },
                    function() {
                        document.getElementById('tbsync.newaccount.autodiscoverlabel').hidden = true;
                        document.getElementById('tbsync.newaccount.autodiscoverstatus').hidden = true;
                        document.documentElement.getButton("cancel").disabled = false;
                        document.documentElement.getButton("extra1").disabled = false;
                    });
            } else {
                tbSync.dump("Error on EAS autodiscover (" + req.status + ")", (req.responseText) ? req.responseText : urls[index]);
                this.autodiscoverHTTP(accountdata, password, urls, index+1);
            }
        }.bind(this);

        req.send(xml);
    },
    
    autodiscoverOPTIONS: function (accountdata, password, url) {
        //send OPTIONS request to get ActiveSync Version and provision
        let req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
        req.mozBackgroundRequest = true;
        req.open("OPTIONS", url, true);
        req.setRequestHeader("User-Agent", "Thunderbird ActiveSync");
        req.setRequestHeader("Authorization", "Basic " + btoa(accountdata.user + ":" + password));

        req.timeout = 30000;

        req.ontimeout  = function() {
            this.autodiscoverFailed (accountdata);
        }.bind(this);

        req.onerror = function() {
            this.autodiscoverFailed (accountdata);
        }.bind(this);

        // define response handler for our request
        req.onload = function() {
            if (req.status === 200) {
                this.autodiscoverSucceeded (accountdata, password, url, req.getResponseHeader("MS-ASProtocolVersions"), req.getResponseHeader("MS-ASProtocolCommands"));
            } else {
                this.autodiscoverFailed (accountdata);
            }
        }.bind(this);

        req.send();
    },
    
    autodiscoverFailed: function (accountdata) {
        document.getElementById('tbsync.newaccount.autodiscoverlabel').hidden = true;
        document.getElementById('tbsync.newaccount.autodiscoverstatus').hidden = true;
        alert(tbSync.getLocalizedMessage("info.AutodiscoverFailed","eas").replace("##user##", accountdata.user));
        document.documentElement.getButton("cancel").disabled = false;
        document.documentElement.getButton("extra1").disabled = false;
    },

    autodiscoverSucceeded: function (accountdata, password, url, versions, commands) {
        document.getElementById('tbsync.newaccount.autodiscoverlabel').hidden = true;
        document.getElementById('tbsync.newaccount.autodiscoverstatus').hidden = true;
        document.documentElement.getButton("cancel").disabled = false;
        document.documentElement.getButton("extra1").disabled = false;
        
        //update settings of user
        if (versions.indexOf("14.0") > -1) accountdata.asversion = "14.0";
        else if (versions.indexOf("2.5") > -1) accountdata.asversion = "2.5";
        else {
            alert(tbSync.getLocalizedMessage("info.AutodiscoverBadVersion","eas").replace("##versions##", versions));
            return;
        }

        accountdata.host = url.split("/")[2];
        accountdata.servertype = "auto";

        if (url.substring(0,5) == "https") accountdata.https = "1";
        else accountdata.https = "0";

        let c = commands.split(",");
        if (c.indexOf("Provision") > -1) accountdata.provision = "1";
        else accountdata.provision = "0";

        //also update password in PasswordManager
        tbSync.eas.setPassword (accountdata, password);
        alert(tbSync.getLocalizedMessage("info.AutodiscoverOk","eas"));
        
        tbSyncEasNewAccount.addAccount(accountdata);
        tbSyncEasNewAccount.locked = false;
        window.close();
    }
};
