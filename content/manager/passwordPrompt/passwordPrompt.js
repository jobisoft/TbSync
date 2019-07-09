/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { tbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncPassword = {
  
  onload: function () {
    this.accountData = window.arguments[0];
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
    document.getElementById("tbsync.password").focus();
  },

  doOK: function (event) {        
    console.log(this.userfield.value);
    //update username if changeable (must be set before password)
    if (!this.userfield.disabled) {
      this.auth.setUsername(this.accountData, this.userfield.value);            
    }
    
    //update password
    this.auth.setPassword(this.accountData, this.passfield.value);
    this.accountData.sync();
  },
  
};
