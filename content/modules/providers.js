/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
var { ExtensionParent } = ChromeUtils.import("resource://gre/modules/ExtensionParent.jsm");
 
var providers = {

  //list of default providers (available in add menu, even if not installed)
  defaultProviders: {
    "google-4-tbsync@marcozanon.com" : {
      name: "Google's People API", 
      homepageUrl: "https://addons.thunderbird.net/addon/google-4-tbsync/"},
    "dav4tbsync@jobisoft.de" : {
      name: "CalDAV & CardDAV", 
      homepageUrl: "https://addons.thunderbird.net/addon/dav-4-tbsync/"},
    "eas4tbsync@jobisoft.de" : {
      name: "Exchange ActiveSync", 
      homepageUrl: "https://addons.thunderbird.net/addon/eas-4-tbsync/"},
  },
  
  loadedProviders: null,    
  
  load: async function () {
    this.loadedProviders = {};
  },

  unload: async function () {
    for (let providerID in this.loadedProviders) {
      await this.unloadProvider(providerID);
    }
  },

  loadProvider:  async function (providerID) {
    console.log("loadProvider", providerID);
    //only load, if not yet loaded and if the provider name does not shadow a fuction inside provider.js
    if (!this.loadedProviders.hasOwnProperty(providerID) && !this.hasOwnProperty(providerID)) {
      try {
        let extension = ExtensionParent.GlobalManager.getExtension(providerID);
        let addon = await AddonManager.getAddonByID(providerID);
        this.loadedProviders[providerID] = {};
        this.loadedProviders[providerID].addon = addon;
        this.loadedProviders[providerID].extension = extension;
        this.loadedProviders[providerID].addonId = providerID;
        this.loadedProviders[providerID].version = addon.version.toString();
        this.loadedProviders[providerID].createAccountWindow = null;
        this.loadedProviders[providerID].defaultFolderEntries = await TbSync.request(providerID, "Base.getDefaultFolderEntries");
        this.loadedProviders[providerID].defaultAccountEntries = await TbSync.request(providerID, "Base.getDefaultAccountEntries");
        this.loadedProviders[providerID].addon.contributorsURL = await TbSync.request(providerID, "Base.getContributorsUrl");
        this.loadedProviders[providerID].editAccountOverlayUrl = await TbSync.request(providerID, "Base.getEditAccountOverlayUrl");

        // We no longer support custom folder lists. 
        this[providerID] = {};
        
        await TbSync.messenger.overlayManager.registerOverlay("chrome://tbsync/content/manager/editAccount.xhtml?providerID=" + providerID, this.loadedProviders[providerID].editAccountOverlayUrl);        
        
        // reset all accounts of this provider
        let providerData = new TbSync.ProviderData(providerID);
        let accounts = providerData.getAllAccounts();
        for (let accountID of accounts) {
          // reset sync objects
          TbSync.core.resetSyncDataObj(accountID);
          
          // set all accounts which are syncing to notsyncronized 
          if (TbSync.db.getAccountProperty(accountID, "status") == "syncing") TbSync.db.setAccountProperty(accountID, "status", "notsyncronized");

          // set each folder with PENDING status to ABORTED
          let folders = TbSync.db.findFolders({"status": "pending"}, {"accountID": accountID});

          for (let f=0; f < folders.length; f++) {
            TbSync.db.setFolderProperty(folders[f].accountID, folders[f].folderID, "status", "aborted");
          }
        }
        
        await TbSync.request(providerID, "Base.onConnect"); // This should be onEstablished, as TbSync has activly confirmed the connection - or load

        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateProviderList", providerID);
        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);
        
        for (let calendar of TbSync.lightning.cal.getCalendarManager().getCalendars({})) {
          let storedProvider = calendar.getProperty("tbSyncProvider");
          if (providerID == storedProvider && calendar.type == "storage" && providerData.getFolders({"target": calendar.id}).length == 0) {
            let name = calendar.name;
            calendar.name = TbSync.getString("target.orphaned") + ": " + name;
            calendar.setProperty("disabled", true);
            calendar.setProperty("tbSyncProvider", "orphaned");
            calendar.setProperty("tbSyncAccountID", "");        
          }
        }
        
      } catch (e) {
        delete this.loadedProviders[providerID];
        delete this[providerID];
        let info = new EventLogInfo(providerID);
        TbSync.eventlog.add("error", info, "FAILED to load provider <"+providerID+">", e.message);
        Components.utils.reportError(e);        
      }

    }
  },
  
  unloadProvider: async function (providerID) {        
    console.log("unloadProvider", providerID);
    if (this.loadedProviders.hasOwnProperty(providerID)) {
      TbSync.dump("Unloading provider", providerID);
      
       if (this.loadedProviders[providerID].createAccountWindow) {
         this.loadedProviders[providerID].createAccountWindow.close();
       }

      delete this.loadedProviders[providerID];
      delete this[providerID];            
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateProviderList", providerID);
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);
    }
  },
  
  getDefaultAccountEntries: function (providerID) {
    let defaults = this.loadedProviders[providerID].defaultAccountEntries;
    
    // List of default system account properties. 
    // Do not remove search marker for doc. 
    // DefaultAccountPropsStart
    defaults.providerID = providerID;
    defaults.accountID = "";
    defaults.lastsynctime = 0;
    defaults.status = "disabled";
    defaults.autosync = 0;
    defaults.noAutosyncUntil = 0;
    defaults.accountname = "";
    // DefaultAccountPropsEnd

    return defaults;
  },
  
  getDefaultFolderEntries: function (accountID) {
    let providerID = TbSync.db.getAccountProperty(accountID, "providerID");
    let defaults = this.loadedProviders[providerID].defaultFolderEntries;
    
    // List of default system folder properties.
    // Do not remove search marker for doc. 
    // DefaultFolderPropsStart
    defaults.accountID = accountID;
    defaults.targetType = "";
    defaults.cached = false;
    defaults.selected = false;
    defaults.lastsynctime = 0;
    defaults.status = "";
    defaults.foldername = "";
    defaults.downloadonly = false;
    // DefaultFolderPropsEnd
    
    return defaults;
  },
}
