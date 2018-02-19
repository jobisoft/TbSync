"use strict";

Components.utils.import("resource://gre/modules/Task.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncEasNewAccount = {

    startTime: 0,
    maxTimeout: 30,

    onClose: function () {
        //tbSync.dump("onClose", tbSync.addAccountWindowOpen);
        return !document.documentElement.getButton("cancel").disabled;
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
    },

    onUserTextInput: function () {
        document.documentElement.getButton("extra1").disabled = (this.elementName.value == "" || this.elementUser.value == "" || this.elementPass.value == "");
    },

    onUserDropdown: function () {
        document.documentElement.getButton("extra1").label = tbSync.getLocalizedMessage("newaccount.add_" + this.elementServertype.value,"eas");
    },

    onAdd: Task.async (function* () {
        if (document.documentElement.getButton("extra1").disabled == false) {
            let user = this.elementUser.value;
            let password = this.elementPass.value;
            let servertype = this.elementServertype.value;
            let accountname = this.elementName.value;

            if (user.split("@").length != 2) {
                alert(tbSync.getLocalizedMessage("autodiscover.NeedEmail","eas"))
                return
            };

            if (servertype == "custom") {
                tbSyncEasNewAccount.addAccount(user, password, servertype, accountname);                
            }
            
            if (servertype == "auto") {
                document.documentElement.getButton("cancel").disabled = true;
                document.documentElement.getButton("extra1").disabled = true;
                document.getElementById("tbsync.newaccount.name").disabled = true;
                document.getElementById("tbsync.newaccount.user").disabled = true;
                document.getElementById("tbsync.newaccount.password").disabled = true;
                document.getElementById("tbsync.newaccount.servertype").disabled = true;

                let updateTimer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
                updateTimer.initWithCallback({notify : function () {tbSyncEasNewAccount.updateAutodiscoverStatus()}}, 1000, 3);

                tbSyncEasNewAccount.startTime = Date.now();
                tbSyncEasNewAccount.updateAutodiscoverStatus();

                let responses = yield tbSync.eas.getServerUrlViaAutodiscover(user, password, tbSyncEasNewAccount.maxTimeout*1000);
                updateTimer.cancel();

                document.getElementById('tbsync.newaccount.autodiscoverlabel').hidden = true;
                document.getElementById('tbsync.newaccount.autodiscoverstatus').hidden = true;

                //set a default error
                let error = tbSync.getLocalizedMessage("autodiscover.FailedUnknown","eas");
                let certerrors = [];
                let serverfound = null;

                //All requests have finished, check them for success or hard failed requests.
                //Fall through is a general error "nothing found".
                for (let r=0; r<responses.length; r++) {
                    //if there is a positive responce, abort
                    if (responses[r].server) {
                        serverfound = r;
                        certerrors = []; //only print hard failed errors
                        break;
                    }
                    
                    //report hard failed requests
                    if ([401,403].includes(responses[r].error)) {
                        error = tbSync.getLocalizedMessage("status." + responses[r].error);
                        certerrors = []; //only print hard failed errors
                        break;
                    }

                    //look for certificate errors, which might be usefull to the user in case of a general fail
                    if (responses[r].error) {
                        let security_error = responses[r].error.toString().split("::");
                        if (security_error.length == 2 && security_error[0] == "security") {
                            certerrors.push(responses[r].url + "\n\t => " + security_error[1]);
                        }
                    }
                }

                if (serverfound) {
                    
                    alert(tbSync.getLocalizedMessage("autodiscover.Ok","eas"));
                    //add account with found server url
                    tbSyncEasNewAccount.addAccount(responses[serverfound].user, password, servertype, accountname, responses[serverfound].server);                
                    
                } else {
                    
                    if (certerrors.length>0) error = error + "\n\n" + tbSync.getLocalizedMessage("autodiscover.FailedSecurity","eas") + "\n\n" + certerrors.join("\n");
                    alert(tbSync.getLocalizedMessage("autodiscover.Failed","eas").replace("##user##", user) + "\n\n" + error);

                }
                document.getElementById("tbsync.newaccount.name").disabled = false;
                document.getElementById("tbsync.newaccount.user").disabled = false;
                document.getElementById("tbsync.newaccount.password").disabled = false;
                document.getElementById("tbsync.newaccount.servertype").disabled = false;

                document.documentElement.getButton("cancel").disabled = false;
                document.documentElement.getButton("extra1").disabled = false;
            }

        }
    }),

    updateAutodiscoverStatus: function () {
        document.getElementById('tbsync.newaccount.autodiscoverstatus').hidden = false;
        let offset = Math.round(((Date.now()-tbSyncEasNewAccount.startTime)/1000));
        let timeout = (offset>2) ? " (" + (tbSyncEasNewAccount.maxTimeout - offset) + ")" : "";

        document.getElementById('tbsync.newaccount.autodiscoverstatus').value  = tbSync.getLocalizedMessage("autodiscover.Querying","eas") + timeout;
    },

    addAccount (user, password, servertype, accountname, url = "") {
        let newAccountEntry = tbSync.eas.getNewAccountEntry();
        newAccountEntry.accountname = accountname;
        newAccountEntry.user = user;
        newAccountEntry.servertype = servertype;

        if (url) {
            newAccountEntry.host = url.split("/")[2];
            if (url.substring(0,5) == "https") newAccountEntry.https = "1";
            else newAccountEntry.https = "0";
        }

        //also update password in PasswordManager
        tbSync.eas.setPassword (newAccountEntry, password);

        //create a new EAS account and pass its id to updateAccountsList, which will select it
        //the onSelect event of the List will load the selected account
        window.opener.tbSyncAccounts.updateAccountsList(tbSync.db.addAccount(newAccountEntry));

        window.close();
    }
};
