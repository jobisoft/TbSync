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
 var StatusData = class {
  /**
   * A StatusData instance must be used as return value by 
   * :class:`Base.syncFolderList` and :class:`Base.syncFolder`.
   * 
   * StatusData also defines the possible StatusDataTypes used by the
   * :ref:`TbSyncEventLog`.
   *
   * @param {StatusDataType} type  Status type (see const definitions below)
   * @param {string} message  ``Optional`` A message, which will be used as
   *                          sync status. If this is not a success, it will be
   *                          used also in the :ref:`TbSyncEventLog` as well.
   * @param {string} details  ``Optional``  If this is not a success, it will
   *                          be used as description in the
   *                          :ref:`TbSyncEventLog`.
   *
   */
  constructor(type = "success", message = "", details = "") {
    this.type = type; //success, info, warning, error
    this.message = message;
    this.details = details;
  }
  /**
   * Successfull sync. 
   */
  static get SUCCESS() {return "success"};
  /**
   * Sync of the entire account will be aborted.
   */
  static get ERROR() {return "error"};
  /**
   * Sync of this resource will be aborted and continued with next resource.
   */
  static get WARNING() {return "warning"};
  /**
   * Successfull sync, but message and details
   * provided will be added to the event log.
   */
  static get INFO() {return "info"};
  /**
   * Sync of the entire account will be aborted and restarted completely.
   */
  static get ACCOUNT_RERUN() {return "account_rerun"}; 
  /**
   * Sync of the current folder/resource will be restarted.
   */
  static get FOLDER_RERUN() {return "folder_rerun"}; 
}



/**
 * ProgressData
 *
 */
var ProgressData = class {
  /**
   * Constructor
   *
   * @param {FolderData} folderData    FolderData of the folder for which the
   *                                   display name is requested.
   *
   */
  constructor() {
    this._todo = 0;
    this._done = 0;
   }
   
   reset(done = 0, todo = 0) {
    this._todo = todo;
    this._done = done;
   }
   
   inc(value = 1) {
     this._done += value;
   }
   
   get todo() {
     return this._todo;
   }
   
   get done() {
     return this._done;
   }
}



/**
 * ProviderData
 *
 */
var ProviderData = class {
  /**
   * Constructor
   *
   * @param {FolderData} folderData    FolderData of the folder for which the
   *                                   display name is requested.
   *
   */
  constructor(provider) {
    if (!TbSync.providers.hasOwnProperty(provider)) {
      throw new Error("Provider <" + provider + "> has not been loaded. Failed to create ProviderData.");
    }
    this.provider = provider;
  }
  
  /**
   * Getter for an :class:`EventLogInfo` instance with all the information
   * regarding this ProviderData instance.
   *
   */
  get eventLogInfo() {
    return new EventLogInfo(
      this.getAccountProperty("provider"));
  }

  getVersion() {
    return TbSync.providers.loadedProviders[this.provider].version;
  }
  
  getStringBundle() {
    return TbSync.providers.loadedProviders[this.provider].bundle;
  }
  
  getAllAccounts() {
    let accounts = TbSync.db.getAccounts();
    let allAccounts = [];
    for (let i=0; i<accounts.IDs.length; i++) {
      let accountID = accounts.IDs[i];
      if (accounts.data[accountID].provider == this.provider) {
        allAccounts.push(new TbSync.AccountData(accountID));
      }
    }
    return allAccounts;
  }
  
  getFolders(aFolderSearchCriteria = {}) {
    let allFolders = [];
    let folderSearchCriteria = {};
    Object.assign(folderSearchCriteria, aFolderSearchCriteria);
    folderSearchCriteria.cached = false;
    
    let folders = TbSync.db.findFolders(folderSearchCriteria, {"provider": this.provider});
    for (let i=0; i < folders.length; i++) {          
      allFolders.push(new TbSync.FolderData(new TbSync.AccountData(folders[i].accountID), folders[i].folderID));
    }
    return allFolders;
  }
  
  getDefaultAccountEntries() {
    return  TbSync.providers.getDefaultAccountEntries(this.provider)
  }
  
  addAccount(accountName, accountOptions) {
    let newAccountID = TbSync.db.addAccount(accountName, accountOptions);
    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountsList", newAccountID);
    return new TbSync.AccountData(newAccountID);        
  }
}



/**
 * AccountData
 *
 */
var AccountData = class {
  /**
   * Constructor
   *
   * @param {FolderData} folderData    FolderData of the folder for which the
   *                                   display name is requested.
   *
   */
  constructor(accountID) {
    this._accountID = accountID;

    if (!TbSync.db.accounts.data.hasOwnProperty(accountID)) {
      throw new Error("An account with ID <" + accountID + "> does not exist. Failed to create AccountData.");
    }
  }

  /**
   * Getter for an :class:`EventLogInfo` instance with all the information
   * regarding this AccountData instance.
   *
   */
  get eventLogInfo() {
    return new EventLogInfo(
      this.getAccountProperty("provider"),
      this.getAccountProperty("accountname"),
      this.accountID);
  }

  get accountID() {
    return this._accountID;
  }
  
  getAllFolders() {
    let allFolders = [];
    let folders = TbSync.db.findFolders({"cached": false}, {"accountID": this.accountID});
    for (let i=0; i < folders.length; i++) {          
      allFolders.push(new TbSync.FolderData(this, folders[i].folderID));
    }
    return allFolders;
  }

  getAllFoldersIncludingCache() {
    let allFolders = [];
    let folders = TbSync.db.findFolders({}, {"accountID": this.accountID});
    for (let i=0; i < folders.length; i++) {          
      allFolders.push(new TbSync.FolderData(this, folders[i].folderID));
    }
    return allFolders;
  }
  
  getFolder(setting, value) {
    // ES6 supports variable keys by putting it into brackets
    let folders = TbSync.db.findFolders({[setting]: value, "cached": false}, {"accountID": this.accountID});
    if (folders.length > 0) return new TbSync.FolderData(this, folders[0].folderID);
    return null;
  }

  getFolderFromCache(setting, value) {
    // ES6 supports variable keys by putting it into brackets
    let folders = TbSync.db.findFolders({[setting]: value, "cached": true}, {"accountID": this.accountID});
    if (folders.length > 0) return new TbSync.FolderData(this, folders[0].folderID);
    return null;
  }
  
  createNewFolder() {
    return new TbSync.FolderData(this, TbSync.db.addFolder(this.accountID));
  }
  
  // get data objects
  get providerData() {
    return new TbSync.ProviderData(
      this.getAccountProperty("provider"),
    );
  }    

  get syncData() {
    return TbSync.core.getSyncDataObject(this.accountID);
  }


  // shortcuts
  sync(syncDescription = {}) {
    TbSync.core.syncAccount(this.accountID, syncDescription);
  }

  isSyncing() {
    return TbSync.core.isSyncing(this.accountID);
  }
  
  isEnabled() {
    return TbSync.core.isEnabled(this.accountID);
  }

  isConnected() {
    return TbSync.core.isConnected(this.accountID);
  }
  

  getAccountProperty(field) {
    return TbSync.db.getAccountProperty(this.accountID, field);
  }

  setAccountProperty(field, value) {
    TbSync.db.setAccountProperty(this.accountID, field, value);
    Services.obs.notifyObservers(null, "tbsync.observer.manager.reloadAccountSetting", JSON.stringify({accountID: this.accountID, setting: field}));
  }
  
  resetAccountProperty(field) {
    TbSync.db.resetAccountProperty(this.accountID, field);
    Services.obs.notifyObservers(null, "tbsync.observer.manager.reloadAccountSetting", JSON.stringify({accountID: this.accountID, setting: field}));
  }
}



/**
 * FolderData
 *
 */
var FolderData = class {
  /**
   * Constructor
   *
   * @param {FolderData} folderData    FolderData of the folder for which the
   *                                   display name is requested.
   *
   */
  constructor(accountData, folderID) {
    this._accountData = accountData;
    this._folderID = folderID;
    this._target = null;
    
    if (!TbSync.db.folders[accountData.accountID].hasOwnProperty(folderID)) {
      throw new Error("A folder with ID <" + folderID + "> does not exist for the given account. Failed to create FolderData.");
    }
  }
  
  /**
   * Getter for an :class:`EventLogInfo` instance with all the information 
   * regarding this FolderData instance.
   *
   */
  get eventLogInfo() {
    return new EventLogInfo(
      this.accountData.getAccountProperty("provider"),
      this.accountData.getAccountProperty("accountname"),
      this.accountData.accountID,
      this.getFolderProperty("foldername"),
    );
  }

  get folderID() {
    return this._folderID;
  }

  get accountID() {
    return this._accountData.accountID;
  }
  
  getDefaultFolderEntries() { // remove
    return TbSync.providers.getDefaultFolderEntries(this.accountID);
  }
  
  getFolderProperty(field) {
    return TbSync.db.getFolderProperty(this.accountID, this.folderID, field);
  }
  
  setFolderProperty(field, value) {
    TbSync.db.setFolderProperty(this.accountID, this.folderID, field, value);
  }

  resetFolderProperty(field) {
    TbSync.db.resetFolderProperty(this.accountID, this.folderID, field);
  }

  sync(aSyncDescription = {}) {
    let syncDescription = {};
    Object.assign(syncDescription, aSyncDescription);

    syncDescription.syncFolders = [this];
    this.accountData.sync(syncDescription);
  }
  
  isSyncing() {
    let syncdata = this.accountData.syncData;
    return (syncdata.currentFolderData && syncdata.currentFolderData.folderID == this.folderID);
  }
    
  getFolderStatus() {
    let status = "";
    
    if (this.getFolderProperty("selected")) {
      //default
      status = TbSync.getString("status." + this.getFolderProperty("status"), this.accountData.getAccountProperty("provider")).split("||")[0];

      switch (this.getFolderProperty("status").split(".")[0]) { //the status may have a sub-decleration
        case "success":
        case "modified":
          status = status + ": " + this.getFolderProperty("targetName");
          break;
          
        case "pending":
          //add extra info if this folder is beeing synced
          if (this.isSyncing()) {
            let syncdata = this.accountData.syncData;
            status = TbSync.getString("status.syncing", this.accountData.getAccountProperty("provider"));
            if (["send","eval","prepare"].includes(syncdata._syncstate.split(".")[0]) && (syncdata.progressData.todo + syncdata.progressData.done) > 0) {
              //add progress information
              status = status + " (" + syncdata.progressData.done + (syncdata.progressData.todo > 0 ? "/" + syncdata.progressData.todo : "") + ")"; 
            }
          }
          break;            
      }
    } else {
      //remain empty if not selected
    }        
    return status;
  }
  
  // get data objects
  get accountData() {
    return this._accountData;
  }

  get targetData() {
    // targetData can not be set during construction, because targetType has not been set 
    // create it on the fly - re-create it, if targetType changed
    if (!this._target || this._target.targetType != this.getFolderProperty("targetType")) {
      switch (this.getFolderProperty("targetType")) {
        case "":
          throw new Error("Property <targetType> not set for this folder.");
        
        case "calendar":
          this._target = new TbSync.lightning.TargetData(this);
          break;

        case "addressbook":
          this._target = new TbSync.addressbook.TargetData(this);
          break;

        default:
          this._target = new TbSync.providers[this.accountData.getAccountProperty("provider")][this.getFolderProperty("targetType")](this);
      }
    }
    
    return this._target;
  }
  
  // Removes the folder and its target. If the target should be 
  // kept  as a stale/unconnected item, provide a suffix, which
  // will be added to its name, to indicate, that it is no longer
  // managed by TbSync.
  remove(keepStaleTargetSuffix = "") {
    let target = this.getFolderProperty("target");
    if (target) {
      if (keepStaleTargetSuffix) {
        let oldName =  this.targetData.targetName;
        this.targetData.targetName = TbSync.getString("target.orphaned") + ": " + oldName + " " + keepStaleTargetSuffix;
        this.targetData.onBeforeDisconnectTarget();
      } else {
        this.targetData.removeTarget();
      }
      TbSync.db.clearChangeLog(target);
    }
    this.resetFolderProperty("target");
    this.setFolderProperty("cached", true);
  }
}



/**
 * SyncData
 *
 * there is only one syncdata object per account which contains the current state of the sync
 */
var SyncData = class {
  /**
   * Constructor
   *
   * @param {FolderData} folderData    FolderData of the folder for which the
   *                                   display name is requested.
   *
   */
  constructor(accountID) {
    
    //internal (private, not to be touched by provider)
    this._syncstate = "accountdone";
    this._accountData = new TbSync.AccountData(accountID);
    this._progressData = new TbSync.ProgressData();
    this._currentFolderData = null;
  }

  //all functions provider should use should be in here
  //providers should not modify properties directly
  //when getSyncDataObj is used never change the folder id as a sync may be going on!

  _setCurrentFolderData(folderData) {
    this._currentFolderData = folderData;
  }
  _clearCurrentFolderData() {
    this._currentFolderData = null;
  }

  /**
   * Getter for an :class:`EventLogInfo` instance with all the information
   * regarding this SyncData instance.
   *
   */  
  get eventLogInfo() {
    return new EventLogInfo(
      this.accountData.getAccountProperty("provider"),
      this.accountData.getAccountProperty("accountname"),
      this.accountData.accountID,
      this.currentFolderData ? this.currentFolderData.getFolderProperty("foldername") : "",
    );
  }
  
  get currentFolderData() {
    return this._currentFolderData;
  }

  get accountData() {
    return this._accountData;
  }

  get progressData() {
    return this._progressData;
  }

  setSyncState(syncstate) {
    //set new syncstate
    let msg = "State: " + syncstate + ", Account: " + this.accountData.getAccountProperty("accountname");
    if (this.currentFolderData) msg += ", Folder: " + this.currentFolderData.getFolderProperty("foldername");

    if (syncstate.split(".")[0] == "send") {
      //add timestamp to be able to display timeout countdown
      syncstate = syncstate + "||" + Date.now();
    }

    this._syncstate = syncstate;
    TbSync.dump("setSyncState", msg);

    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", this.accountData.accountID);
  }
  
  getSyncState(includingTimeStamp = false) {
    return includingTimeStamp ? this._syncstate : this._syncstate.split("||")[0];
  }
}










// simple dumper, who can dump to file or console
var dump = function (what, aMessage) {
  if (TbSync.prefs.getBoolPref("log.toconsole")) {
    Services.console.logStringMessage("[TbSync] " + what + " : " + aMessage);
  }
  
  if (this.prefs.getBoolPref("log.tofile")) {
    let now = new Date();
    TbSync.io.appendToFile("debug.log", "** " + now.toString() + " **\n[" + what + "] : " + aMessage + "\n\n");
  }
}
  


// get localized string from core or provider (if possible)
var getString = function (msg, provider) {
  let success = false;
  let localized = msg;
  
  //spezial treatment of strings with :: like status.httperror::403
  let parts = msg.split("::");

  // if a provider is given, try to get the string from the provider
  if (provider && TbSync.providers.loadedProviders.hasOwnProperty(provider)) {
    try {
      localized = TbSync.providers.loadedProviders[provider].bundle.GetStringFromName(parts[0]);
      success = true;
    } catch (e) {}        
  }

  // if we did not yet succeed, request the tbsync bundle
  if (!success) {
    try {
      localized = TbSync.bundle.GetStringFromName(parts[0]);
      success = true;
    } catch (e) {}                    
  }

  //replace placeholders in returned string
  if (success) {
    for (let i = 0; i<parts.length; i++) {
      let regex = new RegExp( "##replace\."+i+"##", "g");
      localized = localized.replace(regex, parts[i]);
    }
  }

  return localized;
}



var generateUUID = function () {
  const uuidGenerator  = Cc["@mozilla.org/uuid-generator;1"].getService(Ci.nsIUUIDGenerator);
  return uuidGenerator.generateUUID().toString().replace(/[{}]/g, '');
}
