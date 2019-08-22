/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

 var StatusData = class {
  constructor(type = "success", message = "", details = "") {
    this.type = type; //success, info, warning, error
    this.message = message;
    this.details = details;
  }
  
  static get SUCCESS() {return "success"};
  static get ERROR() {return "error"};
  static get WARNING() {return "warning"};
  static get INFO() {return "info"};
  static get ACCOUNT_RERUN() {return "account_rerun"}; 
  static get FOLDER_RERUN() {return "folder_rerun"}; 
}



var ProgessData = class {
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



var ProviderData = class {
  constructor(provider) {
    if (!tbSync.providers.hasOwnProperty(provider)) {
      throw new Error("Provider <" + provider + "> has not been loaded. Failed to create ProviderData.");
    }
    this.provider = provider;
  }
  
  getVersion() {
    return tbSync.providers.loadedProviders[this.provider].version;
  }
  
  getStringBundle() {
    return tbSync.providers.loadedProviders[this.provider].bundle;
  }
  
  getAllAccounts() {
    let accounts = tbSync.db.getAccounts();
    let allAccounts = [];
    for (let i=0; i<accounts.IDs.length; i++) {
      let accountID = accounts.IDs[i];
      if (accounts.data[accountID].provider == this.provider) {
        allAccounts.push(new tbSync.AccountData(accountID));
      }
    }
    return allAccounts;
  }
  
  getFolders(aFolderSearchCriteria = {}) {
    let allFolders = [];
    let folderSearchCriteria = {};
    Object.assign(folderSearchCriteria, aFolderSearchCriteria);
    folderSearchCriteria.cached = false;
    
    let folders = tbSync.db.findFolders(folderSearchCriteria, {"provider": this.provider});
    for (let i=0; i < folders.length; i++) {          
      allFolders.push(new tbSync.FolderData(new tbSync.AccountData(folders[i].accountID), folders[i].folderID));
    }
    return allFolders;
  }
  
  getDefaultAccountEntries() {
    return  tbSync.providers.getDefaultAccountEntries(this.provider)
  }
  
  addAccount(accountName, accountOptions) {
    let newAccountID = tbSync.db.addAccount(accountName, accountOptions);
    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountsList", newAccountID);
    return new tbSync.AccountData(newAccountID);        
  }
}



var AccountData = class {
  constructor(accountID) {
    this._accountID = accountID;

    if (!tbSync.db.accounts.data.hasOwnProperty(accountID)) {
      throw new Error("An account with ID <" + accountID + "> does not exist. Failed to create AccountData.");
    }
  }

  get accountID() {
    return this._accountID;
  }
  
  getAllFolders() {
    let allFolders = [];
    let folders = tbSync.db.findFolders({"cached": false}, {"accountID": this.accountID});
    for (let i=0; i < folders.length; i++) {          
      allFolders.push(new tbSync.FolderData(this, folders[i].folderID));
    }
    return allFolders;
  }

  getAllFoldersIncludingCache() {
    let allFolders = [];
    let folders = tbSync.db.findFolders({}, {"accountID": this.accountID});
    for (let i=0; i < folders.length; i++) {          
      allFolders.push(new tbSync.FolderData(this, folders[i].folderID));
    }
    return allFolders;
  }
  
  getFolder(setting, value) {
    // ES6 supports variable keys by putting it into brackets
    let folders = tbSync.db.findFolders({[setting]: value, "cached": false}, {"accountID": this.accountID});
    if (folders.length > 0) return new tbSync.FolderData(this, folders[0].folderID);
    return null;
  }

  getFolderFromCache(setting, value) {
    // ES6 supports variable keys by putting it into brackets
    let folders = tbSync.db.findFolders({[setting]: value, "cached": true}, {"accountID": this.accountID});
    if (folders.length > 0) return new tbSync.FolderData(this, folders[0].folderID);
    return null;
  }
  
  createNewFolder() {
    return new tbSync.FolderData(this, tbSync.db.addFolder(this.accountID));
  }
  
  // get data objects
  get providerData() {
    return new tbSync.ProviderData(
      this.getAccountProperty("provider"),
    );
  }    

  get syncData() {
    return tbSync.core.getSyncDataObject(this.accountID);
  }


  // shortcuts
  sync(syncDescription = {}) {
    tbSync.core.syncAccount(this.accountID, syncDescription);
  }

  isSyncing() {
    return tbSync.core.isSyncing(this.accountID);
  }
  
  isEnabled() {
    return tbSync.core.isEnabled(this.accountID);
  }

  isConnected() {
    return tbSync.core.isConnected(this.accountID);
  }
  

  getAccountProperty(field) {
    return tbSync.db.getAccountProperty(this.accountID, field);
  }

  setAccountProperty(field, value) {
    tbSync.db.setAccountProperty(this.accountID, field, value);
    Services.obs.notifyObservers(null, "tbsync.observer.manager.reloadAccountSetting", JSON.stringify({accountID: this.accountID, setting: field}));
  }
  
  resetAccountProperty(field) {
    tbSync.db.resetAccountProperty(this.accountID, field);
    Services.obs.notifyObservers(null, "tbsync.observer.manager.reloadAccountSetting", JSON.stringify({accountID: this.accountID, setting: field}));
  }
}



var FolderData = class {
  constructor(accountData, folderID) {
    this._accountData = accountData;
    this._folderID = folderID;
    this._target = null;
    
    if (!tbSync.db.folders[accountData.accountID].hasOwnProperty(folderID)) {
      throw new Error("A folder with ID <" + folderID + "> does not exist for the given account. Failed to create FolderData.");
    }
  }
  
  get folderID() {
    return this._folderID;
  }

  get accountID() {
    return this._accountData.accountID;
  }
  
  getDefaultFolderEntries() { // remove
    return tbSync.providers.getDefaultFolderEntries(this.accountID);
  }
  
  getFolderProperty(field) {
    return tbSync.db.getFolderProperty(this.accountID, this.folderID, field);
  }
  
  setFolderProperty(field, value) {
    tbSync.db.setFolderProperty(this.accountID, this.folderID, field, value);
  }

  resetFolderProperty(field) {
    tbSync.db.resetFolderProperty(this.accountID, this.folderID, field);
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
      status = tbSync.getString("status." + this.getFolderProperty("status"), this.accountData.getAccountProperty("provider")).split("||")[0];

      switch (this.getFolderProperty("status").split(".")[0]) { //the status may have a sub-decleration
        case "success":
        case "modified":
          status = status + ": " + this.getFolderProperty("targetName");
          break;
          
        case "pending":
          //add extra info if this folder is beeing synced
          if (this.isSyncing()) {
            let syncdata = this.accountData.syncData;
            status = tbSync.getString("status.syncing", this.accountData.getAccountProperty("provider"));
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
          this._target = new tbSync.lightning.TargetData(this);
          break;

        case "addressbook":
          this._target = new tbSync.addressbook.TargetData(this);
          break;

        default:
          this._target = new tbSync.providers[this.accountData.getAccountProperty("provider")][this.getFolderProperty("targetType")](this);
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
        let changes = tbSync.db.getItemsFromChangeLog(target, 0, "_by_user");
        tbSync.db.clearChangeLog(target);      
        this.targetData.appendStaleSuffix(keepStaleTargetSuffix, changes);
      } else {
        this.targetData.removeTarget();
      }
    }
    this.resetFolderProperty("target");
    this.setFolderProperty("cached", true);
  }
}



// there is only one syncdata object per account which contains the current state of the sync
var SyncData = class {
  constructor(accountID) {
    
    //internal (private, not to be touched by provider)
    this._syncstate = "accountdone";
    this._accountData = new tbSync.AccountData(accountID);
    this._progressData = new tbSync.ProgessData();
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
    tbSync.dump("setSyncState", msg);

    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", this.accountData.accountID);
  }
  
  getSyncState(includingTimeStamp = false) {
    return includingTimeStamp ? this._syncstate : this._syncstate.split("||")[0];
  }
}










// simple dumper, who can dump to file or console
var dump = function (what, aMessage) {
  if (tbSync.prefs.getBoolPref("log.toconsole")) {
    Services.console.logStringMessage("[TbSync] " + what + " : " + aMessage);
  }
  
  if (this.prefs.getBoolPref("log.tofile")) {
    let now = new Date();
    tbSync.io.appendToFile("debug.log", "** " + now.toString() + " **\n[" + what + "] : " + aMessage + "\n\n");
  }
}
  


// get localized string from core or provider (if possible)
var getString = function (msg, provider) {
  let success = false;
  let localized = msg;
  
  //spezial treatment of strings with :: like status.httperror::403
  let parts = msg.split("::");

  // if a provider is given, try to get the string from the provider
  if (provider && tbSync.providers.loadedProviders.hasOwnProperty(provider)) {
    try {
      localized = tbSync.providers.loadedProviders[provider].bundle.GetStringFromName(parts[0]);
      success = true;
    } catch (e) {}        
  }

  // if we did not yet succeed, request the tbsync bundle
  if (!success) {
    try {
      localized = tbSync.bundle.GetStringFromName(parts[0]);
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
