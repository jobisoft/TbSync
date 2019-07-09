/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var ErrorOwnerData = class {
  constructor(provider, accountname, accountID, foldername = "") {
    this.provider = provider;
    this.accountname = accountname;
    this.accountID = accountID;
    this.foldername = foldername;
  }
}
  
var errorlog = {

  errors: null,
  
  load: async function () {
    this.clear();
  },

  unload: async function () {
  },

  get: function (accountID = null) {
    if (accountID) {
      return this.errors.filter(e => e.accountID == accountID);
    } else {
      return this.errors;
    }
  },
  
  clear: function () {
    this.errors = [];
  },
  
  add: function (type, errorOwnerData, message, details = null) {
    let entry = {
      timestamp: Date.now(),
      message: message, 
      type: type,
      link: null, 
      //some details are just true, which is not a useful detail, ignore
      details: details === true ? null : details,
      provider: "",
      accountname: "",
      foldername: "",
    };
  
    if (errorOwnerData) {
      if (errorOwnerData.accountID) entry.accountID = errorOwnerData.accountID;
      if (errorOwnerData.provider) entry.provider = errorOwnerData.provider;
      if (errorOwnerData.accountname) entry.accountname = errorOwnerData.accountname;
      if (errorOwnerData.foldername) entry.foldername = errorOwnerData.foldername;
    }

    let localized = "";
    let link = "";        
    if (entry.provider) {
      localized = tbSync.getString("status." + message, entry.provider);
      link = tbSync.getString("helplink." + message, entry.provider);
    } else {
      //try to get localized string from message from tbSync
      localized = tbSync.getString("status." + message);
      link = tbSync.getString("helplink." + message);
    }
  
    //can we provide a localized version of the error msg?
    if (localized != "status."+message) {
      entry.message = localized;
    }

    //is there a help link?
    if (link != "helplink." + message) {
      entry.link = link;
    }

    //dump the non-localized message into debug log
    tbSync.dump("ErrorLog", message + (entry.details !== null ? "\n" + entry.details : ""));
    this.errors.push(entry);
    if (this.errors.length > 100) this.errors.shift();
    Services.obs.notifyObservers(null, "tbsync.observer.errorlog.update", null);
  },
  
  open: function (accountID = null, folderID = null) {
    tbSync.manager.prefWindowObj.open("chrome://tbsync/content/manager/errorlog/errorlog.xul", "TbSyncErrorLog", "centerscreen,chrome,resizable");
  },    
}
