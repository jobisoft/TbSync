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
          this._target = new tbSync.providers[this.accountData.getAccountProperty("provider")].targets[this.getFolderProperty("targetType")].TargetData(this);
      }
    }
    
    return this._target;
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
    return new ProviderData(
      this.getAccountProperty("provider"),
    );
  }    

  get syncData() {
    return tbSync.core.getSyncDataObject(this.accountID);
  }


  // shortcuts
  sync(job = "sync") {
    tbSync.core.syncAccount(job, this.accountID)
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

  get errorInfo() {
    return new ErrorInfo(
      this.accountData.getAccountProperty("provider"),
      this.accountData.getAccountProperty("accountname"),
      this.accountData.accountID,
      this.currentFolderData ? this.currentFolderData.getFolderProperty("name") : "",
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
    if (this.currentFolderData) msg += ", Folder: " + this.currentFolderData.getFolderProperty("name");

    if (syncstate.split(".")[0] == "send") {
      //add timestamp to be able to display timeout countdown
      syncstate = syncstate + "||" + Date.now();
    }

    this._syncstate = syncstate;
    tbSync.dump("setSyncState", msg);

    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", this.accountData.accountID);
  }
  
  getSyncState() {
    return this._syncstate;
  }
}

var core = {

  syncDataObj : null,

  load: async function () {
    this.syncDataObj = {};
  },

  unload: async function () {
  },

  isSyncing: function (accountID) {
    let status = tbSync.db.getAccountProperty(accountID, "status"); //global status of the account
    return (status == "syncing");
  },
  
  isEnabled: function (accountID) {
    let status = tbSync.db.getAccountProperty(accountID, "status");
    return  (status != "disabled");
  },

  isConnected: function (accountID) {
    let status = tbSync.db.getAccountProperty(accountID, "status");
    let validFolders = tbSync.db.findFolders({"cached": false}, {"accountID": accountID});
    return (status != "disabled" && validFolders.length > 0);
  },
  
  resetSyncDataObj: function (accountID) {
    this.syncDataObj[accountID] = new SyncData(accountID);          
  },
  
  getSyncDataObject: function (accountID) {
    if (!this.syncDataObj.hasOwnProperty(accountID)) {
      this.resetSyncDataObj(accountID);
    }
    return this.syncDataObj[accountID];        
  },
  
  syncAccount: function (job, accountID = "", folderID = "") {
    //get info of all accounts
    let accounts = tbSync.db.getAccounts();

    //if no account given, loop over all accounts, otherwise only use the provided one
    let accountsToDo = [];        
    if (accountID == "") {
      //add all enabled accounts to the queue
      for (let i=0; i < accounts.IDs.length; i++) {
        accountsToDo.push(accounts.IDs[i]);
      }
    } else {
      accountsToDo.push(accountID);
    }
    
    //update gui
    for (let i = 0; i < accountsToDo.length; i++) {
      //do not init sync if there is a sync running or account is not enabled
      if (!this.isEnabled(accountsToDo[i]) || this.isSyncing(accountsToDo[i])) continue;

      //create syncData object for each account (to be able to have parallel XHR)
      this.prepareSyncDataObj(accountsToDo[i], true);
      
      tbSync.db.setAccountProperty(accountsToDo[i], "status", "syncing");
      //i have no idea whey they are here
      //this.getSyncDataObject(accountsToDo[i]).syncstate = "syncing";            
      //this.getSyncDataObject(accountsToDo[i]).folderID = folderID;            
      //send GUI into lock mode (status == syncing)
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountSettingsGui", accountsToDo[i]);
      
      // core async sync function, but we do not wait until it has finished,
      // but return right away and initiate all remaining accounts parallel
      this.syncSingleAccount(job, this.getSyncDataObject(accountsToDo[i]));
    }
  },
   
  getNextPendingFolder: function (syncData) {
    let sortedFolders = tbSync.providers[syncData.accountData.getAccountProperty("provider")].base.getSortedFolders(syncData.accountData);
    for (let i=0; i < sortedFolders.length; i++) {
      if (sortedFolders[i].getFolderProperty("status") != "pending") continue;
      syncData._setCurrentFolderData(sortedFolders[i]);
      return true;
    }
    syncData._clearCurrentFolderData();
    return false;
  },
  
  syncSingleAccount: async function (job, syncData) {
    //clear folderID of syncData, just to make sure
    syncData._clearCurrentFolderData();
    
    //check for default sync job
    if (job == "sync") {
      
      let listStatusData = await tbSync.providers[syncData.accountData.getAccountProperty("provider")].base.syncFolderList(syncData);
      if (!(listStatusData instanceof tbSync.StatusData)) {
        let statusData = new tbSync.StatusData(tbSync.StatusData.ERROR, "apiError", "TbSync/"+syncData.accountData.getAccountProperty("provider")+": base.syncFolderList() must return a StatusData object");
        this.finishAccountSync(syncData, statusData);
        return;
      }
      
      //if we have an error during folderList sync, there is no need to go on
      if (listStatusData.type != tbSync.StatusData.SUCCESS) {
        this.finishAccountSync(syncData, listStatusData);
        return;
      }
      
      // update folder list in GUI
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateFolderList", syncData.accountData.accountID);

      //set all selected folders to "pending", so they are marked for syncing
      //this also removes all leftover cached folders and sets all other folders to a well defined cached = "0"
      //which will set this account as connected (if at least one non-cached folder is present)
      this.prepareFoldersForSync(syncData);

      // update folder list in GUI
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateFolderList", syncData.accountData.accountID);

      let overallStatusData = new tbSync.StatusData();

      // if any folder was found, sync
      if (syncData.accountData.isConnected()) {
        do {
          // getNextPendingFolder will set or clear currentFolderData of syncData
          if (!this.getNextPendingFolder(syncData)) {
            break;
          }
          let folderStatusData = await tbSync.providers[syncData.accountData.getAccountProperty("provider")].base.syncFolder(syncData);
          if (!(folderStatusData instanceof tbSync.StatusData)) {
            folderStatusData = new tbSync.StatusData(tbSync.StatusData.ERROR, "apiError", "TbSync/"+syncData.accountData.getAccountProperty("provider")+": base.syncFolder() must return a StatusData object");
          }

          this.finishFolderSync(syncData, folderStatusData);

          //if one of the folders indicated an ERROR, abort sync
          if (folderStatusData.type == tbSync.StatusData.ERROR) {
            break;
          }
        } while (true);
      } else {
        overallStatusData = new tbSync.StatusData(tbSync.StatusData.ERROR, "no-folders-found-on-server");
      }
      this.finishAccountSync(syncData, overallStatusData);

    }
  },
  
  // this could be added to AccountData, but I do not want that in public
  setTargetModified: function (folderData) {
    if (!folderData.accountData.isSyncing() && folderData.accountData.isEnabled()) {
      folderData.accountData.setAccountProperty("status", "notsyncronized");
      folderData.setFolderProperty("status", "modified");
      //notify settings gui to update status
       Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);
    }
  },
  
  enableAccount: function(accountID) {
    let accountData = new AccountData(accountID);
    tbSync.providers[accountData.getAccountProperty("provider")].base.onEnableAccount(accountData);
    accountData.setAccountProperty("status", "notsyncronized");
    accountData.resetAccountProperty("lastsynctime");        
  },

  disableAccount: function(accountID) {
    let accountData = new AccountData(accountID);
    tbSync.providers[accountData.getAccountProperty("provider")].base.onDisableAccount(accountData);
    accountData.setAccountProperty("status", "disabled");
    
    let folders = accountData.getAllFolders();
    for (let folder of folders) {
      let target = folder.getFolderProperty("target");
      if (target) {
        folder.targetData.removeTarget(); 
        tbSync.db.clearChangeLog(target);
      }
      folder.setFolderProperty("selected", false);
      folder.setFolderProperty("cached", true);
    }
  },

  //set all selected folders to "pending", so they are marked for syncing 
  //this also removes all leftover cached folders and sets all other folders to a well defined cached = "0"
  //which will set this account as connected (if at least one non-cached folder is present)
  prepareFoldersForSync: function(syncData) {
    let folders = syncData.accountData.getAllFoldersIncludingCache();
    for (let folder of folders) {
      //delete all leftover cached folders
      if (folder.getFolderProperty("cached")) {
        tbSync.db.deleteFolder(folder.accountID, folder.folderID);
        continue;
      } else {
        //set well defined cache state
        folder.setFolderProperty("cached", false);
      }

      //set selected folders to pending, so they get synced
      if (folder.getFolderProperty("selected")) {
         folder.setFolderProperty("status", "pending");
      }
    }
  },
  
  finishFolderSync: function(syncData, statusData) {        
    if (statusData.type != tbSync.StatusData.SUCCESS) {
      //report error
      tbSync.errorlog.add(statusData.type, syncData.errorInfo, statusData.message, statusData.details);
    }
    
    //if this is a success, prepend success to the status message, 
    //otherwise just set the message
    let status;
    if (statusData.type == tbSync.StatusData.SUCCESS || statusData.message == "") {
      status = statusData.type;
      if (statusData.message) status = status + "." + statusData.message;
    } else {
      status = statusData.message;
    }
    
    if (syncData.currentFolderData) {
      syncData.currentFolderData.setFolderProperty("status", status);
      syncData.currentFolderData.setFolderProperty("lastsynctime", Date.now());
      //clear folderID to fall back to account-only-mode (folder is done!)
      syncData._clearCurrentFolderData();
    } 

     syncData.setSyncState("done");        
  },

  finishAccountSync: function(syncData, statusData) {
    // set each folder with PENDING status to ABORTED
    let folders = tbSync.db.findFolders({"status": "pending"}, {"accountID": syncData.accountData.accountID});
    for (let i=0; i < folders.length; i++) {
      tbSync.db.setFolderProperty(folders[i].accountID, folders[i].folderID, "status", "aborted");
    }
    
    //if this is a success, prepend success to the status message, 
    //otherwise just set the message
    let status;
    if (statusData.type == tbSync.StatusData.SUCCESS || statusData.message == "") {
      status = statusData.type;
      if (statusData.message) status = status + "." + statusData.message;
    } else {
      status = statusData.message;
    }

    
    if (statusData.type != tbSync.StatusData.SUCCESS) {
      //report error
      tbSync.errorlog.add("warning", syncData.errorInfo, statusData.message, statusData.details);
    } else {
      //account itself is ok, search for folders with error
      folders = tbSync.db.findFolders({"selected": true, "cached": false}, {"accountID": syncData.accountData.accountID});
      for (let i in folders) {
        let folderstatus = folders[i].data.status.split(".")[0];
        if (folderstatus != "" && folderstatus != tbSync.StatusData.SUCCESS && folderstatus != "aborted") {
          status = "foldererror";
          break;
        }
      }
    }    
    
    //done
    syncData.accountData.setAccountProperty("lastsynctime", Date.now());
    syncData.accountData.setAccountProperty("status", status);
    syncData.setSyncState("accountdone"); 
  }    
  
}
