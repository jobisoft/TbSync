/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncPassword = {
    
    onload: function () {
        this.accountdata = window.arguments[0];
        this.callbackOK = window.arguments[1];
        this.callbackCANCEL = window.arguments[2];
        document.getElementById("tbsync.account").value = this.accountdata.accountname;
        
        this.userfield = document.getElementById("tbsync.user");
        this.userfield.value = this.accountdata.user;
        //allow to change username only if not connected
        if (tbSync.isConnected(this.accountdata.account)) {
            this.userfield.disabled=true;
        }
        
        document.getElementById("tbsync.password").focus();
    },

    doOK: function () {
        tbSync.passWindowObj[this.accountdata.account] = null;
        //update username if changeable
        if (!this.userfield.disabled) {
            tbSync.db.setAccountSetting(this.accountdata.account, "user", this.userfield.value);
        }
        
        //update password by calling setPassword function of accounts provider
        let pass = document.getElementById("tbsync.password").value;
        tbSync[this.accountdata.provider].setPassword(this.accountdata, pass);
        if (this.callbackOK) this.callbackOK();
    },

    doCANCEL: function () {
        tbSync.passWindowObj[this.accountdata.account] = null;
        if (this.callbackCANCEL) this.callbackCANCEL();
    }
    
};
