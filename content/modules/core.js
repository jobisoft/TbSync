/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

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
    this.syncDataObj[accountID] = new tbSync.SyncData(accountID);          
  },
  
  getSyncDataObject: function (accountID) {
    if (!this.syncDataObj.hasOwnProperty(accountID)) {
      this.resetSyncDataObj(accountID);
    }
    return this.syncDataObj[accountID];        
  },
  
  getNextPendingFolder: function (syncData) {
    let sortedFolders = tbSync.providers[syncData.accountData.getAccountProperty("provider")].Base.getSortedFolders(syncData.accountData);
    for (let i=0; i < sortedFolders.length; i++) {
      if (sortedFolders[i].getFolderProperty("status") != "pending") continue;
      syncData._setCurrentFolderData(sortedFolders[i]);
      return true;
    }
    syncData._clearCurrentFolderData();
    return false;
  },
  

  syncAllAccounts: function () {
    //get info of all accounts
    let accounts = tbSync.db.getAccounts();

    for (let i=0; i < accounts.IDs.length; i++) {
      // core async sync function, but we do not wait until it has finished,
      // but return right away and initiate sync of all accounts parallel
      this.syncAccount(accounts.IDs[i]);
    }
  },

  syncAccount: async function (accountID, aSyncDescription = {}) {
    let syncDescription = {};
    Object.assign(syncDescription, aSyncDescription);
    
    if (!syncDescription.hasOwnProperty("maxAccountReruns")) syncDescription.maxAccountReruns = 2;
    if (!syncDescription.hasOwnProperty("maxFolderReruns")) syncDescription.maxFolderReruns = 2;
    if (!syncDescription.hasOwnProperty("syncList")) syncDescription.syncList = true;
    if (!syncDescription.hasOwnProperty("syncFolders")) syncDescription.syncFolders = null; // null ( = default = sync selected folders) or (empty) Array with folderData obj to be synced
    if (!syncDescription.hasOwnProperty("syncJob")) syncDescription.syncJob = "sync";

    //do not init sync if there is a sync running or account is not enabled
    if (!this.isEnabled(accountID) || this.isSyncing(accountID)) return;

    //create syncData object for each account (to be able to have parallel XHR)
    this.resetSyncDataObj(accountID);
    let syncData = this.getSyncDataObject(accountID);
    
    //send GUI into lock mode (status == syncing)
    tbSync.db.setAccountProperty(accountID, "status", "syncing");
    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountSettingsGui", accountID);
    
    let overallStatusData = new tbSync.StatusData();
    let accountRerun;
    let accountRuns = 0;
    
    do {
      accountRerun = false;

      if (accountRuns > syncDescription.maxAccountReruns) {
        overallStatusData = new tbSync.StatusData(tbSync.StatusData.ERROR, "resync-loop");
        break;
      }      
      accountRuns++;
      
      if (syncDescription.syncList) {
        let listStatusData;
        try {
          listStatusData = await tbSync.providers[syncData.accountData.getAccountProperty("provider")].Base.syncFolderList(syncData, syncDescription.syncJob, accountRuns);
        } catch (e) {
          listStatusData = new tbSync.StatusData(tbSync.StatusData.WARNING, "JavaScriptError", e.message + "\n\n" + e.stack);
        }
          
        if (!(listStatusData instanceof tbSync.StatusData)) {
          overallStatusData = new tbSync.StatusData(tbSync.StatusData.ERROR, "apiError", "TbSync/"+syncData.accountData.getAccountProperty("provider")+": Base.syncFolderList() must return a StatusData object");
          break;
        }
        
        //if we have an error during folderList sync, there is no need to go on
        if (listStatusData.type != tbSync.StatusData.SUCCESS) {
          overallStatusData = listStatusData;
          accountRerun = (listStatusData.type == tbSync.StatusData.ACCOUNT_RERUN)
          tbSync.eventlog.add(listStatusData.type, syncData.eventLogInfo, listStatusData.message, listStatusData.details);
          continue; //jumps to the while condition check
        }
        
        // Removes all leftover cached folders and sets all other folders to a well defined cached = "0"
        // which will set this account as connected (if at least one non-cached folder is present).
        this.removeCachedFolders(syncData);

        // update folder list in GUI
        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateFolderList", syncData.accountData.accountID);
      }
      
      // syncDescription.syncFolders is either null ( = default = sync selected folders) or an Array.
      // Skip folder sync if Array is empty.
      if (!Array.isArray(syncDescription.syncFolders) || syncDescription.syncFolders.length > 0) {
        this.prepareFoldersForSync(syncData, syncDescription);

        // update folder list in GUI
        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateFolderList", syncData.accountData.accountID);

        // if any folder was found, sync
        if (syncData.accountData.isConnected()) {
          let folderRuns = 1;
          do {
            if (folderRuns > syncDescription.maxFolderReruns) {
              overallStatusData = new tbSync.StatusData(tbSync.StatusData.ERROR, "resync-loop");
              break;
            }
            
            // getNextPendingFolder will set or clear currentFolderData of syncData
            if (!this.getNextPendingFolder(syncData)) {
              break;
            }
            
            let folderStatusData;
            try {
              folderStatusData = await tbSync.providers[syncData.accountData.getAccountProperty("provider")].Base.syncFolder(syncData, syncDescription.syncJob, folderRuns);
            } catch (e) {
              folderStatusData = new tbSync.StatusData(tbSync.StatusData.WARNING, "JavaScriptError", e.message + "\n\n" + e.stack);
            }
            
            if (!(folderStatusData instanceof tbSync.StatusData)) {
              folderStatusData = new tbSync.StatusData(tbSync.StatusData.ERROR, "apiError", "TbSync/"+syncData.accountData.getAccountProperty("provider")+": Base.syncFolder() must return a StatusData object");
            }

            // if one of the folders indicated a FOLDER_RERUN, do not finish this
            // folder but do it again
            if (folderStatusData.type == tbSync.StatusData.FOLDER_RERUN) {
              tbSync.eventlog.add(folderStatusData.type, syncData.eventLogInfo, folderStatusData.message, folderStatusData.details);
              folderRuns++;
              continue;
            } else {
              folderRuns = 1;
            }
            
            this.finishFolderSync(syncData, folderStatusData);

            //if one of the folders indicated an ERROR, abort sync
            if (folderStatusData.type == tbSync.StatusData.ERROR) {
              break;
            }
            
            //if the folder has send an ACCOUNT_RERUN, abort sync and rerun the entire account
            if (folderStatusData.type == tbSync.StatusData.ACCOUNT_RERUN) {
              syncDescription.syncList = true;
              accountRerun = true;
              break;
            }
            
          } while (true);
        } else {
          overallStatusData = new tbSync.StatusData(tbSync.StatusData.ERROR, "no-folders-found-on-server");
        }
      }
    
    } while (accountRerun);
    
    this.finishAccountSync(syncData, overallStatusData);
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
    let accountData = new tbSync.AccountData(accountID);
    tbSync.providers[accountData.getAccountProperty("provider")].Base.onEnableAccount(accountData);
    accountData.setAccountProperty("status", "notsyncronized");
    accountData.resetAccountProperty("lastsynctime");        
  },

  disableAccount: function(accountID) {
    let accountData = new tbSync.AccountData(accountID);
    tbSync.providers[accountData.getAccountProperty("provider")].Base.onDisableAccount(accountData);
    accountData.setAccountProperty("status", "disabled");
    
    let folders = accountData.getAllFolders();
    for (let folder of folders) {
      let target = folder.getFolderProperty("target");
      if (target) {
        folder.targetData.removeTarget(); 
        tbSync.db.clearChangeLog(target);
        folder.resetFolderProperty("target");
      }
      folder.setFolderProperty("selected", false);
      folder.setFolderProperty("cached", true);
    }
  },

  //removes all leftover cached folders and sets all other folders to a well defined cached = "0"
  //which will set this account as connected (if at least one non-cached folder is present)
  removeCachedFolders: function(syncData) {
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
    }
  },
  
  //set allrequested folders to "pending", so they are marked for syncing 
  prepareFoldersForSync: function(syncData, syncDescription) {
    let folders = syncData.accountData.getAllFolders();
    for (let folder of folders) {
      let requested = (Array.isArray(syncDescription.syncFolders) && syncDescription.syncFolders.filter(f => f.folderID == folder.folderID).length > 0);
      let selected = (!Array.isArray(syncDescription.syncFolders) && folder.getFolderProperty("selected"));

      //set folders to pending, so they get synced
      if (requested || selected) {
         folder.setFolderProperty("status", "pending");
      }
    }
  },
  
  finishFolderSync: function(syncData, statusData) {        
    if (statusData.type != tbSync.StatusData.SUCCESS) {
      //report error
      tbSync.eventlog.add(statusData.type, syncData.eventLogInfo, statusData.message, statusData.details);
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
      tbSync.eventlog.add("warning", syncData.eventLogInfo, statusData.message, statusData.details);
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
    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateFolderList", syncData.accountData.accountID);
    this.resetSyncDataObj(syncData.accountData.accountID);
  }    
  
}
