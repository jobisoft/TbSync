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
        document.title = tbSync.getLocalizedMessage("account").replace("##accountname##", this.accountdata.accountname)

        document.getElementById("tbsync.password.description").textContent = tbSync.getLocalizedMessage("prompt.Password").replace("##user##", this.accountdata.user);
    },

    doOK: function () {
        tbSync.passWindowObj = null;
        //call set password function of accounts provider
        tbSync[this.accountdata.provider].setPassword(this.accountdata, document.getElementById("tbsync.password").value);
        if (this.callbackOK) this.callbackOK();
    },

    doCANCEL: function () {
        tbSync.passWindowObj = null;
        if (this.callbackCANCEL) this.callbackCANCEL();
    }
    
};
