/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var DefaultAuthentication = class {
    constructor(accountObject) {
        this.accountObject = accountObject;
        this.provider = accountObject.getAccountSetting("provider");
        this.userField = tbSync.providers[this.provider].auth.getUserField4PasswordManager(accountObject);
        this.hostField = tbSync.providers[this.provider].auth.getHostField4PasswordManager(accountObject);
    }
    
    getUsername() {
        return this.accountObject.getAccountSetting(this.userField);
    }
    
    getPassword() {
        let host = this.accountObject.getAccountSetting(this.hostField)
        let origin = authentication.getOrigin4PasswordManager(this.provider, host);
        return authentication.getLoginInfo(origin, "TbSync", this.getUsername());
    }
    
    setUsername(newUsername) {
        this.accountObject.setAccountSetting(this.userField, newUsername);        
    }
    
    setPassword(newPassword) {
        let host = this.accountObject.getAccountSetting(this.hostField)
        let origin = authentication.getOrigin4PasswordManager(this.provider, host);
        authentication.setLoginInfo(origin, "TbSync", this.getUsername(), newPassword);
    }
}

var authentication = {

    load: async function () {
    },

    unload: async function () {
    },

    getOrigin4PasswordManager: function (provider, host) {
        let uri = Services.io.newURI((!host.startsWith("http://") && !host.startsWith("https://")) ? "http://" + host : host);
        return provider + "://" + uri.host;
    },

    setLoginInfo: function(origin, realm, user, password) {
        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");

        //remove any existing entry
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
