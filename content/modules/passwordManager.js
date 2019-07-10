/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var passwordManager = {

  load: async function () {
  },

  unload: async function () {
  },

  removeLoginInfos: function(origin, realm, users) {
    let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");

    let logins = Services.logins.findLogins(origin, null, realm);
    for (let i = 0; i < logins.length; i++) {
      if (users.includes(logins[i].username)) {
        let currentLoginInfo = new nsLoginInfo(origin, null, realm, logins[i].username, logins[i].password, "", "");
        try {
          Services.logins.removeLogin(currentLoginInfo);
        } catch (e) {
          tbSync.dump("Error removing loginInfo", e);
        }
      }
    }
  },

  setLoginInfo: function(origin, realm, oldUser, newUser, newPassword) {
    let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
    
    this.removeLoginInfos(origin, realm, [oldUser, newUser]);
    
    let newLoginInfo = new nsLoginInfo(origin, null, realm, newUser, newPassword, "", "");
    try {
      Services.logins.addLogin(newLoginInfo);
    } catch (e) {
      tbSync.dump("Error adding loginInfo", e);
    }
  },
  
  getLoginInfo: function(origin, realm, user) {
    let logins = Services.logins.findLogins(origin, null, realm);
    for (let i = 0; i < logins.length; i++) {
      if (logins[i].username == user) {
        return logins[i].password;
      }
    }
    return null;
  },

  
  // Usage of this method requires the provider to implement the passwordAuth Object
  passwordPrompt: async function(accountData) {
    let url = "chrome://tbsync/content/manager/passwordPrompt/passwordPrompt.xul";
    let provider = accountData.getAccountProperty("provider");
    let accountID = accountData.accountID;

    // Close auth window, if already open (resolving the connected async process).
    if (tbSync.providers.loadedProviders[provider].authWindows.hasOwnProperty(accountID)) {
      tbSync.providers.loadedProviders[provider].authWindows[accountID].close();
    }
    
    accountData.syncData.setSyncState("PasswordPrompt");
    return await new Promise(function(resolve, reject) {
      tbSync.providers.loadedProviders[provider].authWindows[accountID] = tbSync.window.openDialog(url, "authPrompt", "centerscreen,chrome,resizable=no", accountData, resolve);
    });
  },

}
