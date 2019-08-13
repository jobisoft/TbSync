/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { DeferredTask } = ChromeUtils.import("resource://gre/modules/DeferredTask.jsm");

var db = {

  loaded: false,

  files: {
    accounts: {
      name: "accounts68.json", 
      default: JSON.stringify({ sequence: 0, data : {} })
      //data[account] = {row}
      },
    folders: {
      name: "folders68.json", 
      default: JSON.stringify({})
      //assoziative array of assoziative array : folders[<int>accountID][<string>folderID] = {row} 
      },
    changelog: {
      name: "changelog68.json", 
      default: JSON.stringify([]),
      },
  },
    
  load: async function ()  {
    //DB Concept:
    //-- on application start, data is read async from json file into object
    //-- add-on only works on object
    //-- each time data is changed, an async write job is initiated <writeDelay>ms in the future and is resceduled, if another request arrives within that time

    for (let f in this.files) {
      this.files[f].write = new DeferredTask(() => this.writeAsync(f), 6000);
      
      try {
        let data = await OS.File.read(tbSync.io.getAbsolutePath(this.files[f].name));
        this[f] = JSON.parse(tbSync.decoder.decode(data));
        this.files[f].found = true;
      } catch (e) {
        //if there is no file, there is no file...
        this[f] = JSON.parse(this.files[f].default);                
        this.files[f].found = false;
        Components.utils.reportError(e);
      }
    }

    function getNewDeviceId4Migration() {
        //taken from https://jsfiddle.net/briguy37/2MVFd/
        let d = new Date().getTime();
        let uuid = 'xxxxxxxxxxxxxxxxyxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            let r = (d + Math.random()*16)%16 | 0;
            d = Math.floor(d/16);
            return (c=='x' ? r : (r&0x3|0x8)).toString(16);
        });
        return "MZTB" + uuid;
    }
    
    // try to migrate old accounts file from TB60
    if (!this.files["accounts"].found) {
      try {
        let data = await OS.File.read(tbSync.io.getAbsolutePath("accounts.json"));
        let accounts = JSON.parse(tbSync.decoder.decode(data));
        for (let d of Object.values(accounts.data)) {
          console.log("Migrating: " + JSON.stringify(d));
          
          let settings = {};
          settings.status = "disabled";
          settings.provider = d.provider;
          settings.https = (d.https == "1");
          
          switch (d.provider) {
            case "dav":
              settings.calDavHost = d.host ? d.host : "";
              settings.cardDavHost = d.host2 ? d.host2 : "";
              settings.serviceprovider = d.serviceprovider;
              settings.user = d.user;
              settings.syncGroups = (d.syncGroups == "1");
              settings.useCalendarCache = (d.useCache == "1");
            break;
            
            case "eas":
              settings.useragent = d.useragent;
              settings.devicetype = d.devicetype;
              settings.deviceId = getNewDeviceId4Migration();
              settings.asversionselected = d.asversionselected;
              settings.asversion = d.asversion;
              settings.host = d.host;
              settings.user = d.user;
              settings.servertype = d.servertype;
              settings.seperator = d.seperator;
              settings.provision = (d.provision == "1");
              settings.displayoverride = (d.displayoverride == "1");
              if (d.hasOwnProperty("galautocomplete")) settings.galautocomplete = (d.galautocomplete == "1");
            break;
          }
          
          this.addAccount(d.accountname, settings);
        }
      } catch (e) {
        Components.utils.reportError(e);
      }
    }
    
    this.loaded = true;
  },
  
  unload: async function ()  {
    if (this.loaded) {
      for (let f in this.files) {
        try{ 
          //abort write delay timers and write current file content to disk 
          await this.files[f].write.finalize();
        } catch (e) {
          Components.utils.reportError(e);
        }                
      }
    }
  },
  

  saveFile: function (f) {
    if (this.loaded) {
      //cancel any pending write and schedule a new delayed write
      this.files[f].write.disarm();
      this.files[f].write.arm();
    }
  },

  writeAsync: async function (f) {
    // if this file was not found/read on load, do not write default content to prevent clearing of data in case of read-errors
    if (!this.files[f].found && JSON.stringify(this[f]) == this.files[f].default) {
      return;
    }
    
    let filepath = tbSync.io.getAbsolutePath(this.files[f].name);
    let json = tbSync.encoder.encode(JSON.stringify(this[f]));
    
    await OS.File.makeDir(tbSync.io.storageDirectory);
    await OS.File.writeAtomic(filepath, json, {tmpPath: filepath + ".tmp"});
  },



  // simple convenience wrapper
  saveAccounts: function () {
    this.saveFile("accounts");
  },

  saveFolders: function () {
    this.saveFile("folders");
  },

  saveChangelog: function () {
    this.saveFile("changelog");
  },

  

  // CHANGELOG FUNCTIONS
  getItemStatusFromChangeLog: function (parentId, itemId) {   
    for (let i=0; i<this.changelog.length; i++) {
      if (this.changelog[i].parentId == parentId && this.changelog[i].itemId == itemId) return this.changelog[i].status;
    }
    return null;
  },

  getItemDataFromChangeLog: function (parentId, itemId) {   
    for (let i=0; i<this.changelog.length; i++) {
      if (this.changelog[i].parentId == parentId && this.changelog[i].itemId == itemId) return this.changelog[i];
    }
    return null;
  },
  
  addItemToChangeLog: function (parentId, itemId, status) {
    this.removeItemFromChangeLog(parentId, itemId);

    //ChangelogData object
    let row = {
      "parentId" : parentId,
      "itemId" : itemId,
      "timestamp": Date.now(),
      "status" : status};
    
    this.changelog.push(row);
    this.saveChangelog();
  },

  removeItemFromChangeLog: function (parentId, itemId, moveToEnd = false) {
    for (let i=this.changelog.length-1; i>-1; i-- ) {
      if (this.changelog[i].parentId == parentId && this.changelog[i].itemId == itemId) {
        let row = this.changelog.splice(i,1);
        if (moveToEnd) this.changelog.push(row[0]);
        this.saveChangelog();
        return;
      }
    }
  },

  removeAllItemsFromChangeLogWithStatus: function (parentId, status) {
    for (let i=this.changelog.length-1; i>-1; i-- ) {
      if (this.changelog[i].parentId == parentId && this.changelog[i].status == status) {
        let row = this.changelog.splice(i,1);
      }
    }
    this.saveChangelog();
  },

  // Remove all cards of a parentId from ChangeLog
  clearChangeLog: function (parentId) {
    if (parentId) {
      // we allow extra parameters added to a parentId, but still want to delete all items of that parent
      // so we check for startsWith instead of equal
      for (let i=this.changelog.length-1; i>-1; i-- ) {
        if (this.changelog[i].parentId.startsWith(parentId)) this.changelog.splice(i,1);
      }
      this.saveChangelog();
    }
  },

  getItemsFromChangeLog: function (parentId, maxnumbertosend, status = null) {        
    //maxnumbertosend = 0 will return all results
    let log = [];
    let counts = 0;
    for (let i=0; i<this.changelog.length && (log.length < maxnumbertosend || maxnumbertosend == 0); i++) {
      if (this.changelog[i].parentId == parentId && (status === null || this.changelog[i].status.indexOf(status) != -1)) log.push(this.changelog[i]);
    }
    return log;
  },





  // ACCOUNT FUNCTIONS

  addAccount: function (accountname, newAccountEntry) {
    this.accounts.sequence++;
    let id = this.accounts.sequence.toString();
    newAccountEntry.accountID = id;
    newAccountEntry.accountname = accountname;
    
    this.accounts.data[id] = newAccountEntry;
    this.saveAccounts();
    return id;
  },

  removeAccount: function (accountID) {
    //check if accountID is known
    if (this.accounts.data.hasOwnProperty(accountID) == false ) {
      throw "Unknown accountID!" + "\nThrown by db.removeAccount("+accountID+ ")";
    } else {
      delete (this.accounts.data[accountID]);
      delete (this.folders[accountID]);
      this.saveAccounts();
      this.saveFolders();
    }
  },

  getAccounts: function () {
    let accounts = {};
    accounts.IDs = Object.keys(this.accounts.data).filter(accountID => tbSync.providers.loadedProviders.hasOwnProperty(this.accounts.data[accountID].provider)).sort((a, b) => a - b);
    accounts.allIDs =  Object.keys(this.accounts.data).sort((a, b) => a - b)
    accounts.data = this.accounts.data;
    return accounts;
  },

  getAccount: function (accountID) {
    //check if accountID is known
    if (this.accounts.data.hasOwnProperty(accountID) == false ) {
      throw "Unknown accountID!" + "\nThrown by db.getAccount("+accountID+ ")";
    } else {
      return this.accounts.data[accountID];
    }
  }, 

  isValidAccountProperty: function (provider, name) {
    if (["provider"].includes(name)) //internal properties, do not need to be defined by user/provider
      return true;

    //check if provider is installed
    if (!tbSync.providers.loadedProviders.hasOwnProperty(provider)) {
      tbSync.dump("Error @ isValidAccountProperty", "Unknown provider <"+provider+">!");
      return false;
    }
    
    if (tbSync.providers.getDefaultAccountEntries(provider).hasOwnProperty(name)) {
      return true;
    } else {
      tbSync.dump("Error @ isValidAccountProperty", "Unknown account setting <"+name+">!");
      return false;
    }            
  },

  getAccountProperty: function (accountID, name) {
    // if the requested accountID does not exist, getAccount() will fail
    let data = this.getAccount(accountID);
    
    //check if field is allowed and get value or default value if setting is not set
    if (this.isValidAccountProperty(data.provider, name)) {
      if (data.hasOwnProperty(name)) return data[name];
      else return tbSync.providers.getDefaultAccountEntries(data.provider)[name];
    }
  }, 

  setAccountProperty: function (accountID , name, value) {
    // if the requested accountID does not exist, getAccount() will fail
    let data = this.getAccount(accountID);

    //check if field is allowed, and set given value 
    if (this.isValidAccountProperty(data.provider, name)) {
      this.accounts.data[accountID][name] = value;
    }
    this.saveAccounts();
  },

  resetAccountProperty: function (accountID , name) {
    // if the requested accountID does not exist, getAccount() will fail
    let data = this.getAccount(accountID);
    let defaults = tbSync.providers.getDefaultAccountEntries(data.provider);        

    //check if field is allowed, and set given value 
    if (this.isValidAccountProperty(data.provider, name)) {
      this.accounts.data[accountID][name] = defaults[name];
    }
    this.saveAccounts();
  },




  // FOLDER FUNCTIONS

  addFolder: function(accountID) {
    let folderID = tbSync.generateUUID();
    let provider = this.getAccountProperty(accountID, "provider");        
    
    if (!this.folders.hasOwnProperty(accountID)) this.folders[accountID] = {};                        
    
    //create folder with default settings
    this.folders[accountID][folderID] = tbSync.providers.getDefaultFolderEntries(accountID);
    this.saveFolders();
    return folderID;
  },

  deleteFolder: function(accountID, folderID) {
    delete (this.folders[accountID][folderID]);
    //if there are no more folders, delete entire account entry
    if (Object.keys(this.folders[accountID]).length === 0) delete (this.folders[accountID]);
    this.saveFolders();
  },

  isValidFolderProperty: function (accountID, field) {
    if (["cached"].includes(field)) //internal properties, do not need to be defined by user/provider
      return true;
    
    //check if provider is installed
    let provider = this.getAccountProperty(accountID, "provider");
    if (!tbSync.providers.loadedProviders.hasOwnProperty(provider)) {
      tbSync.dump("Error @ isValidFolderProperty", "Unknown provider <"+provider+"> for accountID <"+accountID+">!");
      return false;
    }

    if (tbSync.providers.getDefaultFolderEntries(accountID).hasOwnProperty(field)) {
      return true;
    } else {
      tbSync.dump("Error @ isValidFolderProperty", "Unknown folder setting <"+field+"> for accountID <"+accountID+">!");
      return false;
    }
  },

  getFolderProperty: function(accountID, folderID, field) {
    //does the field exist?
    let folder = (this.folders.hasOwnProperty(accountID) && this.folders[accountID].hasOwnProperty(folderID)) ? this.folders[accountID][folderID] : null;
    
    if (folder === null) {
      throw "Unknown folder <"+folderID+">!";
    }
    
    if (this.isValidFolderProperty(accountID, field)) {
      if (folder.hasOwnProperty(field)) {
        return folder[field];
      } else {
        let provider = this.getAccountProperty(accountID, "provider");
        let defaultFolder = tbSync.providers.getDefaultFolderEntries(accountID);
        //handle internal fields, that do not have a default value (see isValidFolderProperty)
        return (defaultFolder[field] ? defaultFolder[field] : "");
      }
    }
  },

  setFolderProperty: function (accountID, folderID, field, value) {
    if (this.isValidFolderProperty(accountID, field)) {
      this.folders[accountID][folderID][field] = value;
      this.saveFolders();
    }
  },
  
  resetFolderProperty: function (accountID, folderID, field) {
    let provider = this.getAccountProperty(accountID, "provider");
    let defaults = tbSync.providers.getDefaultFolderEntries(accountID);        
    if (this.isValidFolderProperty(accountID, field)) {
      //handle internal fields, that do not have a default value (see isValidFolderProperty)
      this.folders[accountID][folderID][field] = defaults[field] ? defaults[field] : "";
      this.saveFolders();
    }
  },

  findFolders: function (folderQuery = {}, accountQuery = {}) {
    // folderQuery is an object with one or more key:value pairs (logical AND) ::
    // {key1: value1, key2: value2} 
    // the value itself may be an array (logical OR)
    let data = [];
    let folderQueryEntries = Object.entries(folderQuery);
    let folderFields = folderQueryEntries.map(pair => pair[0]);
    let folderValues = folderQueryEntries.map(pair => Array.isArray(pair[1]) ? pair[1] : [pair[1]]);
    
    let accountQueryEntries = Object.entries(accountQuery);
    let accountFields = accountQueryEntries.map(pair => pair[0]);
    let accountValues = accountQueryEntries.map(pair => Array.isArray(pair[1]) ? pair[1] : [pair[1]]);
    
    for (let aID in this.folders) {
      //is this a leftover folder of an account, which no longer there?
      if (!this.accounts.data.hasOwnProperty(aID)) {
        delete (this.folders[aID]);
        this.saveFolders();
        continue;
      }
    
      //skip this folder, if it belongs to an account currently not supported (provider not loaded)
      if (!tbSync.providers.loadedProviders.hasOwnProperty(this.getAccountProperty(aID, "provider"))) {
        continue;
      }

      //does this account match account search options?
      let accountmatch = true;
      for (let a = 0; a < accountFields.length && accountmatch; a++) {
        accountmatch = accountValues[a].some(item => item === this.getAccountProperty(aID, accountFields[a]));
        //Services.console.logStringMessage("   " + accountFields[a] + ":" + this.getAccountProperty(aID, accountFields[a]) + " in " + JSON.stringify(accountValues[a]) + " ? " + accountmatch);
      }
      
      if (accountmatch) {
        for (let fID in this.folders[aID]) {
          //does this folder match folder search options?                
          let foldermatch = true;
          for (let f = 0; f < folderFields.length && foldermatch; f++) {
            foldermatch = folderValues[f].some(item => item === this.getFolderProperty(aID, fID, folderFields[f]));
            //Services.console.logStringMessage("   " + folderFields[f] + ":" + this.getFolderProperty(aID, fID, folderFields[f]) + " in " + JSON.stringify(folderValues[f]) + " ? " + foldermatch);
          }
          if (foldermatch) data.push({accountID: aID, folderID: fID, data: this.folders[aID][fID]});
        }
      }
    }

    //still a reference to the original data
    return data;
  }
};
