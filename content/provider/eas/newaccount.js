"use strict";

Components.utils.import("resource://gre/modules/Task.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncEasNewAccount = {

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
                
                let responses = yield tbSync.eas.getServerUrlViaAutodiscover(user, password);

                document.getElementById('tbsync.newaccount.autodiscoverlabel').hidden = true;
                document.getElementById('tbsync.newaccount.autodiscoverstatus').hidden = true;

                let errors = [];
                let server = "";
                for (let r=0; r<responses.length; r++) {
                    if (responses[r].server) server = responses[r].server;
                    else errors.push(responses[r].url + "\n\t => " + responses[r].error);
                    
                    //reduce error messages for some errors
                    if (["401","403"].includes(responses[r].error)) {
                        errors = [];
                        errors.push(tbSync.getLocalizedMessage("status." + responses[r].error));
                        break;
                    }
                }

                if (server) {
                    
                    alert(tbSync.getLocalizedMessage("info.AutodiscoverOk","eas"));                    
                    //add account with found server url
                    tbSyncEasNewAccount.addAccount(user, password, servertype, accountname, server);                
                    
                } else {
                    
                    alert(tbSync.getLocalizedMessage("info.AutodiscoverFailed","eas").replace("##user##", user).replace("##errors##", errors.join("\n")));

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
