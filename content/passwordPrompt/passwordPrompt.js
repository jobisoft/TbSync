/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
"use strict";

var tbSyncPassword = {
  
  onload: function () {
    let data = window.arguments[0];
    this.resolve = window.arguments[1];
    this.resolved = false;

    this.namefield =  document.getElementById("tbsync.account");
    this.passfield = document.getElementById("tbsync.password");
    this.userfield = document.getElementById("tbsync.user");

    this.namefield.value = data.accountname;
    this.userfield.value = data.username;
    this.userfield.disabled = data.usernameLocked;

    window.addEventListener("unload", tbSyncPassword.doCANCEL.bind(this));
    document.getElementById("tbsync.password").focus();
    document.getElementById("tbsync.password.ok").addEventListener("click", tbSyncPassword.doOK.bind(this));
    document.getElementById("tbsync.password.cancel").addEventListener("click", () => window.close());
  },

  doOK: function (event) {
    if (!this.resolved) {
      this.resolved = true
      this.resolve({username: this.userfield.value, password: this.passfield.value});
      window.close();
    }
  },
  
  doCANCEL: function (event) {
    if (!this.resolved) {
      this.resolved = true
      this.resolve(false);
    }
  },
  
};
