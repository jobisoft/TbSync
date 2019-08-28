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
 * ProgressData to manage a ``done`` and a ``todo`` counter. 
 *
 * Each :class:`SyncData` instance has an associated ProgressData instance. See
 * :class:`SyncData.progressData`. The information of that ProgressData
 * instance is used, when the current syncstate is prefixed by ``send.``,
 * ``eval.`` or ``prepare.``. See :class:`SyncData.setSyncState`.
 *
 */
var ProgressData = class {
  /**
   *
   */
  constructor() {
    this._todo = 0;
    this._done = 0;
   }
   
  /**
   * Reset ``done`` and ``todo`` counter.
   *
   * @param {integer} done  ``Optional`` Set a value for the ``done`` counter.
   * @param {integer} todo  ``Optional`` Set a value for the ``todo`` counter.
   *
   */
   reset(done = 0, todo = 0) {
    this._todo = todo;
    this._done = done;
   }
   
  /**
   * Increment the ``done`` counter.
   *
   * @param {integer} value  ``Optional`` Set incrementation value.
   *
   */
   inc(value = 1) {
     this._done += value;
   }
   
  /**
   * Getter for the ``todo`` counter.
   *
   */
   get todo() {
     return this._todo;
   }
   
  /**
   * Getter for the ``done`` counter.
   *
   */
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


  /**
   * Initiate a sync of this entire account by calling
   * :class:`Base.syncFolderList`. If that succeeded, :class:`Base.syncFolder`
   * will be called for each available folder / resource found on the server.
   *
   * @param {Object} syncDescription  ``Optional``
   */
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

  /**
   * Initiate a sync of this folder only by calling
   * :class:`Base.syncFolderList` and than :class:`Base.syncFolder` for this
   * folder / resource only.
   *
   * @param {Object} syncDescription  ``Optional``
   */
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
          status = status + ": " + this.targetData.targetName;
          break;
          
        case "pending":
          //add extra info if this folder is beeing synced
          if (this.isSyncing()) {
            let syncdata = this.accountData.syncData;
            status = TbSync.getString("status.syncing", this.accountData.getAccountProperty("provider"));
            if (["send","eval","prepare"].includes(syncdata.getSyncState().state.split(".")[0]) && (syncdata.progressData.todo + syncdata.progressData.done) > 0) {
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

  /**
   * Getter for the :class:`TargetData` instance associated with this
   * FolderData. See :ref:`TbSyncTargets` for more details.
   *
   * @returns {TargetData}
   *
   */
  get targetData() {
    // targetData is created on demand
    if (!this._target) {
      let provider = this.accountData.getAccountProperty("provider");
      let targetType = this.getFolderProperty("targetType");
      
      if (!targetType)
        throw new Error("Provider <"+provider+"> has not set a proper target type for this folder.");
      
      if (!TbSync.providers[provider].hasOwnProperty("TargetData_" + targetType))
        throw new Error("Provider <"+provider+"> is missing a TargetData implementation for <"+targetType+">.");
      
      this._target = new TbSync.providers[provider]["TargetData_" + targetType](this);
      
      if (!this._target)
        throw new Error("notargets");
    }
    
    return this._target;
  }
  
  // Removes the folder and its target. If the target should be 
  // kept  as a stale/unconnected item, provide a suffix, which
  // will be added to its name, to indicate, that it is no longer
  // managed by TbSync.
  remove(keepStaleTargetSuffix = "") {
    if (this.targetData.hasTarget()) {
      if (keepStaleTargetSuffix) {
        let oldName =  this.targetData.targetName;
        this.targetData.targetName = TbSync.getString("target.orphaned") + ": " + oldName + " " + keepStaleTargetSuffix;
        this.targetData.disconnectTarget();
      } else {
        this.targetData.removeTarget();
      }
    }
    this.setFolderProperty("cached", true);
  }
}



/**
 * There is only one SyncData instance per account which contains all
 * relevant information regarding an ongoing sync. 
 *
 */
var SyncData = class {
  /**
   *
   */
  constructor(accountID) {
    
    //internal (private, not to be touched by provider)
    this._syncstate = {
      state: "accountdone",
      timestamp: Date.now(),
    }
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
  
  /**
   * Getter for the :class:`FolderData` instance of the folder being currently
   * synced. Can be ``null`` if no folder is being synced.
   *
   */  
  get currentFolderData() {
    return this._currentFolderData;
  }

  /**
   * Getter for the :class:`AccountData` instance of the account being
   * currently synced.
   *
   */  
  get accountData() {
    return this._accountData;
  }

  /**
   * Getter for the :class:`ProgressData` instance of the ongoing sync.
   *
   */
  get progressData() {
    return this._progressData;
  }

  /**
   * Sets the syncstate of the ongoing sync, to provide feedback to the user.
   * The selected state can trigger special UI features, if it starts with one
   * of the following prefixes:
   *
   *   * ``send.``, ``eval.``, ``prepare.`` :
   *     The status message in the UI will be appended with the current progress
   *     stored in the :class:`ProgressData` associated with this SyncData
   *     instance. See :class:`SyncData.progressData`. 
   * 
   *   * ``send.`` : 
   *     The status message in the UI will be appended by a timeout countdown
   *     with the timeout being defined by :class:`Base.getConnectionTimeout`.
   *
   * @param {string} state      A short syncstate identifier. The actual
   *                            message to be displayed in the UI will be
   *                            looked up in the string bundle of the provider
   *                            associated with this SyncData instance
   *                            (:class:`Base.getStringBundleUrl`) by looking 
   *                            for ``syncstate.<state>``. The lookup is
   *                            done via :func:`getString`, so the same 
   *                            fallback rules apply. 
   *
   */  
  setSyncState(state) {
    //set new syncstate
    let msg = "State: " + state + ", Account: " + this.accountData.getAccountProperty("accountname");
    if (this.currentFolderData) msg += ", Folder: " + this.currentFolderData.getFolderProperty("foldername");

    let syncstate = {};
    syncstate.state = state;
    syncstate.timestamp = Date.now();

    this._syncstate = syncstate;
    TbSync.dump("setSyncState", msg);

    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", this.accountData.accountID);
  }
  
  /**
   * Gets the current syncstate and its timestamp of the ongoing sync. The
   * returned Object has the following attributes:
   *
   *   * ``state`` : the current syncstate
   *   * ``timestamp`` : its timestamp
   *
   * @returns {Object}  The syncstate and its timestamp.
   *
   */
  getSyncState() {
    return this._syncstate;
  }
}










// Simple dumper, who can dump to file or console
// It is suggested to use the event log instead of dumping directly.
var dump = function (what, aMessage) {
  if (TbSync.prefs.getBoolPref("log.toconsole")) {
    Services.console.logStringMessage("[TbSync] " + what + " : " + aMessage);
  }
  
  if (this.prefs.getBoolPref("log.tofile")) {
    let now = new Date();
    TbSync.io.appendToFile("debug.log", "** " + now.toString() + " **\n[" + what + "] : " + aMessage + "\n\n");
  }
}
  


/**
 * Get a localized string from a string bundle.
 *
 * TODO: Explain placeholder and :: notation.
 *
 * @param {string} key       The key to look up in the string bundle
 * @param {string} provider  ``Optional`` The provider whose string bundle
 *                           should be used to lookup the key. See
 *                           :class:`Base.getStringBundleUrl`.
 *
 * @returns {string} The entry in the string bundle of the specified provider
 *                   matching the provided key. If that key is not found in the
 *                   string bundle of the specified provider or if no provider
 *                   has been specified, the string bundle of TbSync itself we
 *                   be used as fallback. If the key could not be found there
 *                   as well, the key itself is returned.
 *
 */
var getString = function (key, provider) {
  let success = false;
  let localized = key;
  
  //spezial treatment of strings with :: like status.httperror::403
  let parts = key.split("::");

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
