/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var passwordManager = {

  authWindowObjs: {}, //hold references to authWindows for every account

  load: async function () {
  },

  unload: async function () {
    //close all open password prompts
    for (var w in this.authWindowObjs) {
      if (this.authWindowObjs.hasOwnProperty(w) && this.authWindowObjs[w] !== null) {
        this.authWindowObjs[w].close();
      }
    }
  },

  removeLoginInfo: function(origin, realm, user) {
    let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");

    let logins = Services.logins.findLogins(origin, null, realm);
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
    let logins = Services.logins.findLogins(origin, null, realm);
    for (let i = 0; i < logins.length; i++) {
      if (logins[i].username == user) {
        return logins[i].password;
      }
    }
    return null;
  },

  
  // Usage of this method requires the provider to implement the passwordAuth Object
  passwordPrompt: function(accountData) {
    // only popup one auth prompt per account
    if (!this.authWindowObjs.hasOwnProperty[this.accountID] || this.authWindowObjs[this.accountID] === null) {
      let url = "chrome://tbsync/content/manager/passwordPrompt/passwordPrompt.xul";
      this.authWindowObjs[this.accountID] = tbSync.window.openDialog(url, "authPrompt", "centerscreen,chrome,resizable=no", accountData);
    }        
  },

}
