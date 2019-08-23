/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

/**
 * EventLogInfo
 *
 */
var EventLogInfo = class {
  /**
   * Constructor
   *
   * @param {FolderData} folderData    FolderData of the folder for which the
   *                                   display name is requested.
   *
   */
  constructor(provider, accountname, accountID, foldername = "") {
    this.provider = provider;
    this.accountname = accountname;
    this.accountID = accountID;
    this.foldername = foldername;
  }
}
  
var eventlog = {

  events: null,
  eventLogWindow: null,
  
  load: async function () {
    this.clear();
  },

  unload: async function () {
    if (this.eventLogWindow) {
      this.eventLogWindow.close();
    }
  },

  get: function (accountID = null) {
    if (accountID) {
      return this.events.filter(e => e.accountID == accountID);
    } else {
      return this.events;
    }
  },
  
  clear: function () {
    this.events = [];
  },
  
  add: function (type, eventInfo, message, details = null) {
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
  
    if (eventInfo) {
      if (eventInfo.accountID) entry.accountID = eventInfo.accountID;
      if (eventInfo.provider) entry.provider = eventInfo.provider;
      if (eventInfo.accountname) entry.accountname = eventInfo.accountname;
      if (eventInfo.foldername) entry.foldername = eventInfo.foldername;
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
  
    //can we provide a localized version of the event msg?
    if (localized != "status."+message) {
      entry.message = localized;
    }

    //is there a help link?
    if (link != "helplink." + message) {
      entry.link = link;
    }

    //dump the non-localized message into debug log
    tbSync.dump("EventLog", message + (entry.details !== null ? "\n" + entry.details : ""));
    this.events.push(entry);
    if (this.events.length > 100) this.events.shift();
    Services.obs.notifyObservers(null, "tbsync.observer.eventlog.update", null);
  },
  
  open: function (accountID = null, folderID = null) {
    this.eventLogWindow = tbSync.manager.prefWindowObj.open("chrome://tbsync/content/manager/eventlog/eventlog.xul", "TbSyncEventLog", "centerscreen,chrome,resizable");
  },    
}
