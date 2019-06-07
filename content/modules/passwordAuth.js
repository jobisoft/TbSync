/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var PasswordAuthData = class {
    constructor(accountData) {
        this._accountData = accountData;
        this._provider = accountData.getAccountSetting("provider");
    }
    
    getHost() {
        return tbSync.providers[this._provider].passwordAuth.getHost(this._accountData);
    }
    
    getUsername() {
        return tbSync.providers[this._provider].passwordAuth.getUsername(this._accountData);
    }
    
    getPassword() {
        let origin = passwordAuth.getOrigin4PasswordManager(this._provider, this.getHost());
        return passwordAuth.getLoginInfo(origin, "TbSync", this.getUsername());
    }
    
    setUsername(newUsername) {
        // as updating the username is a bit more work, only do it, if it changed
        if (newUsername != this.getUsername()) {        
            let origin = passwordAuth.getOrigin4PasswordManager(this._provider, this.getHost());

            //temp store the old password, as we have to remove the current entry from the password manager
            let oldPassword = this.getPassword();
            // try to remove the current/old entry
            passwordAuth.removeLoginInfo(origin, "TbSync", this.getUsername())
            //update username
            tbSync.providers[this._provider].passwordAuth.setUsername(this._accountData, newUsername);
            passwordAuth.setLoginInfo(origin, "TbSync", newUsername, oldPassword);
        }
    }
    
    setPassword(newPassword) {
        let origin = passwordAuth.getOrigin4PasswordManager(this._provider, this.getHost());
        passwordAuth.setLoginInfo(origin, "TbSync", this.getUsername(), newPassword);
    }
}

// ****************************************************************************

var passwordAuth = {

    load: async function () {
    },

    unload: async function () {
    },

    getOrigin4PasswordManager: function (provider, host) {
        // use nsIUri to get the plain host part, newURI needs a full URI, add scheme if missing
        let uri = Services.io.newURI((!host.startsWith("http://") && !host.startsWith("https://")) ? "http://" + host : host);
        return provider + "://" + uri.host;
    },

    removeLoginInfo: function(origin, realm, user) {
        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");

        let logins = Services.logins.findLogins({}, origin, null, realm);
        for (let i = 0; i < logins.length; i++) {
            if (logins[i].username == user) {
                let currentLoginInfo = new nsLoginInfo(origin, null, realm, user, logins[i].password, "", "");
                try {
                    Services.logins.removeLogin(currentLoginInfo);
                } catch (e) {
                    tbSync.dump("Error removing loginInfo", e);
                }
            }
        }
    },

    setLoginInfo: function(origin, realm, user, password) {
        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
        
        this.removeLoginInfo(origin, realm, user);
        
        let newLoginInfo = new nsLoginInfo(origin, null, realm, user, password, "", "");
        try {
            Services.logins.addLogin(newLoginInfo);
        } catch (e) {
            tbSync.dump("Error adding loginInfo", e);
        }
    },
    
    getLoginInfo: function(origin, realm, user) {
        let logins = Services.logins.findLogins({}, origin, null, realm);
        for (let i = 0; i < logins.length; i++) {
            if (logins[i].username == user) {
                return logins[i].password;
            }
        }
        return null;
    },
}
