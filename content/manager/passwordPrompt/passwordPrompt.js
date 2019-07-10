/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { tbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncPassword = {
  
  onload: function () {
    this.accountData = window.arguments[0];
    this.resolve = window.arguments[1];
    this.accepted = false;

    this.auth = tbSync.providers[this.accountData.getAccountProperty("provider")].passwordAuth;

    this.namefield =  document.getElementById("tbsync.account");
    this.passfield = document.getElementById("tbsync.password");
    this.userfield = document.getElementById("tbsync.user");

    this.namefield.value = this.accountData.getAccountProperty("accountname");
    this.userfield.value =  this.auth.getUsername(this.accountData);

    //allow to change username only if not connected
    if (this.accountData.isConnected()) {
      this.userfield.disabled=true;
    }
    
    document.addEventListener("dialogaccept",  tbSyncPassword.doOK.bind(this));
    window.addEventListener("unload", tbSyncPassword.doCANCEL.bind(this));
    document.getElementById("tbsync.password").focus();
  },

  doOK: function (event) {        
    this.accepted = true
    this.auth.setLogin(this.accountData, this.userfield.value, this.passfield.value);
    Services.obs.notifyObservers(null, "tbsync.observer.manager.reloadAccountSettingsGui", this.accountData.accountID);
    this.resolve({username: this.userfield.value, password: this.passfield.value});
  },
  
  doCANCEL: function (event) {        
    if (!this.accepted) {
      this.resolve(false);
    }
  },
  
};
