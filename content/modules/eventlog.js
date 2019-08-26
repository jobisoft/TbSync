/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

/**
 *
 */
var EventLogInfo = class {
  /**
   * An EventLogInfo instance is used when adding entries to the
   * :ref:`TbSyncEventLog`. The information given here will be added as a
   * header to the actual event.
   *
   * @param {string} provider     ``Optional`` A provider ID (also used as
   *                              provider namespace). 
   * @param {string} accountname  ``Optional`` An account name. Can be
   *                              arbitrary but should match the accountID
   *                              (if provided).
   * @param {string} accountID    ``Optional`` An account ID. Used to filter
   *                              events for a given account.
   * @param {string} foldername   ``Optional`` A folder name.
   *
   */
  constructor(provider, accountname = "", accountID = "", foldername = "") {
    this._provider = provider;
    this._accountname = accountname;
    this._accountID = accountID;
    this._foldername = foldername;
  }
  
  /**
   * Getter/Setter for the provider ID of this EventLogInfo.
   */
  get provider() {return this._provider};
  /**
   * Getter/Setter for the account ID of this EventLogInfo.
   */
  get accountname() {return this._accountname};
  /**
   * Getter/Setter for the account name of this EventLogInfo.
   */
  get accountID() {return this._accountID};
  /**
   * Getter/Setter for the folder name of this EventLogInfo.
   */
  get foldername() {return this._foldername};

  set provider(v) {this._provider = v};
  set accountname(v) {this._accountname = v};
  set accountID(v) {this._accountID = v};
  set foldername(v) {this._foldername = v};
}


  
/**
 * The TbSync event log 
 */
var eventlog = {
  /**
   * Adds an entry to the TbSync event log
   *
   * @param {StatusDataType}  type       One of the types defined in
   *                                      :class:`StatusData`
   * @param {EventLogInfo}    eventInfo  EventLogInfo for this event.
   * @param {string}          message    The event message.
   * @param {string}          details    ``Optional`` The event details.
   *  
   */
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
  
  
  open: function (accountID = null, folderID = null) {
    this.eventLogWindow = tbSync.manager.prefWindowObj.open("chrome://tbsync/content/manager/eventlog/eventlog.xul", "TbSyncEventLog", "centerscreen,chrome,resizable");
  },    
}
