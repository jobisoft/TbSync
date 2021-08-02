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
    "dav" : {
      name: "CalDAV & CardDAV", 
      homepageUrl: "https://addons.thunderbird.net/addon/dav-4-tbsync/"},
    "eas" : {
      name: "Exchange ActiveSync", 
      homepageUrl: "https://addons.thunderbird.net/addon/eas-4-tbsync/"},
  },
  
  loadedProviders: null,    
  
  load: async function () {
    this.loadedProviders = {};
  },

  unload: async function () {
    for (let provider in this.loadedProviders) {
      await this.unloadProvider(provider);
    }
  },

  request: function(provider, command, parameters) {
    return TbSync.notifyTools.notifyBackground({
      providerID:  this.loadedProviders[provider].addonId,
      command,
      parameters
    });
  },

  
  
  loadProvider:  async function (providerID, provider) {
    //only load, if not yet loaded and if the provider name does not shadow a fuction inside provider.js
    if (!this.loadedProviders.hasOwnProperty(provider) && !this.hasOwnProperty(provider)) {
      try {        
        let extension = ExtensionParent.GlobalManager.getExtension(providerID);
        let addon = await AddonManager.getAddonByID(providerID);
        this.loadedProviders[provider] = {};
        this.loadedProviders[provider].addon = addon;
        this.loadedProviders[provider].extension = extension;
        this.loadedProviders[provider].addonId = providerID;
        this.loadedProviders[provider].version = addon.version.toString();
        this.loadedProviders[provider].createAccountWindow = null;
        this.loadedProviders[provider].defaultFolderEntries = await this.request(provider, "Base.getDefaultFolderEntries");
        this.loadedProviders[provider].defaultAccountEntries = await this.request(provider, "Base.getDefaultAccountEntries");

        this[provider] = {};
        
        //await TbSync.messenger.overlayManager.registerOverlay("chrome://tbsync/content/manager/editAccount.xhtml?provider=" + provider, await this.request(provider, "Base.getEditAccountOverlayUrl"));        
        TbSync.dump("Loaded provider", provider + "::" + await this.request(provider, "Base.getProviderName") + " ("+this.loadedProviders[provider].version+")");
        
        // reset all accounts of this provider
        let providerData = new TbSync.ProviderData(provider);
        let accounts = providerData.getAllAccounts();
        for (let accountData of accounts) {
          // reset sync objects
          //TbSync.core.resetSyncDataObj(accountData.accountID);
          
          // set all accounts which are syncing to notsyncronized 
          if (accountData.getAccountProperty("status") == "syncing") accountData.setAccountProperty("status", "notsyncronized");

          // set each folder with PENDING status to ABORTED
          let folders = TbSync.db.findFolders({"status": "pending"}, {"accountID": accountData.accountID});

          for (let f=0; f < folders.length; f++) {
            TbSync.db.setFolderProperty(folders[f].accountID, folders[f].folderID, "status", "aborted");
          }
        }
        
        await this.request(provider, "Base.onConnect"); // This should be onEstablished, as TbSync has activly confirmed the connection

        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateProviderList", provider);
        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);
        
        /*for (let calendar of TbSync.lightning.cal.getCalendarManager().getCalendars({})) {
          let storedProvider = calendar.getProperty("tbSyncProvider");
          if (provider == storedProvider && calendar.type == "storage" && providerData.getFolders({"target": calendar.id}).length == 0) {
            let name = calendar.name;
            calendar.name = TbSync.getString("target.orphaned") + ": " + name;
            calendar.setProperty("disabled", true);
            calendar.setProperty("tbSyncProvider", "orphaned");
            calendar.setProperty("tbSyncAccountID", "");        
          }
        }*/
        
      } catch (e) {
        delete this.loadedProviders[provider];
        delete this[provider];
        //let info = new EventLogInfo(provider);
        //TbSync.eventlog.add("error", info, "FAILED to load provider <"+provider+">", e.message);
        Components.utils.reportError(e);        
      }

    }
  },
  
  unloadProvider: async function (provider) {        
    if (this.loadedProviders.hasOwnProperty(provider)) {
      TbSync.dump("Unloading provider", provider);
      
       if (this.loadedProviders[provider].createAccountWindow) {
         this.loadedProviders[provider].createAccountWindow.close();
       }

      delete this.loadedProviders[provider];
      delete this[provider];            
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateProviderList", provider);
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);
    }
  },
  
  getDefaultAccountEntries: function (provider) {
    let defaults = this.loadedProviders[provider].defaultAccountEntries;
    
    // List of default system account properties. 
    // Do not remove search marker for doc. 
    // DefaultAccountPropsStart
    defaults.provider = provider;
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
    let provider = TbSync.db.getAccountProperty(accountID, "provider");
    let defaults = this.loadedProviders[provider].defaultFolderEntries;
    
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
  
  getAccountObject(accountData) {
    let rv = {
      accountID: accountData.accountID,
      properties: TbSync.db.getAccountProperties(accountData.accountID),
      folders: {},
    };
    let folders = TbSync.db.findFolders({"cached": false}, { "accountID": accountData.accountID });
    for (let i=0; i < folders.length; i++) {
      rv.folders[folders[i].folderID] = folders[i].data
    }
    return rv;
  } 
}
