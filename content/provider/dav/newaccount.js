"use strict";

Components.utils.import("resource://gre/modules/Task.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncDavNewAccount = {

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
        this.elementServer = document.getElementById('tbsync.newaccount.server');
        
        document.documentElement.getButton("accept").disabled = true;
        document.getElementById("tbsync.newaccount.name").focus();
    },

    onUnload: function () {
    },

    onUserTextInput: function () {
        document.documentElement.getButton("accept").disabled = (this.elementServer.value == "" || this.elementName.value == "" || this.elementUser.value == "" || this.elementPass.value == "");
    },

    onAdd: function () {
        if (document.documentElement.getButton("accept").disabled == false) {
            let user = this.elementUser.value;
            let password = this.elementPass.value;
            let server = this.elementServer.value;
            let accountname = this.elementName.value;
            tbSyncDavNewAccount.addAccount(user, password, server, accountname);
        }
    },

    addAccount (user, password, server, accountname, url = "") {
/*        let newAccountEntry = tbSync.eas.getNewAccountEntry();
        newAccountEntry.accountname = accountname;
        newAccountEntry.user = user;
        newAccountEntry.servertype = servertype;

        if (url) {
            newAccountEntry.host = tbSync.eas.stripAutodiscoverUrl(url);
            newAccountEntry.https = (url.substring(0,5) == "https") ? "1" : "0";
        }

        //also update password in PasswordManager
        tbSync.eas.setPassword (newAccountEntry, password);

        //create a new EAS account and pass its id to updateAccountsList, which will select it
        //the onSelect event of the List will load the selected account
        window.opener.tbSyncAccounts.updateAccountsList(tbSync.db.addAccount(newAccountEntry));
*/
        window.close();
    }
};
