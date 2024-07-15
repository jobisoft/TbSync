/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
 
var providers = {

  //list of default providers (available in add menu, even if not installed)
  defaultProviders: {
    "google" : {
      name: "Google's People API", 
      homepageUrl: "https://addons.thunderbird.net/addon/google-4-tbsync/"},
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



  
  
  loadProvider:  async function (extension, provider, js) {
    //only load, if not yet loaded and if the provider name does not shadow a fuction inside provider.js
    if (!this.loadedProviders.hasOwnProperty(provider) && !this.hasOwnProperty(provider) && js.startsWith("chrome://")) {
      try {
        let addon = await AddonManager.getAddonByID(extension.id);

        //load provider subscripts into TbSync
        this[provider] = {};
        Services.scriptloader.loadSubScript(js, this[provider], "UTF-8");
        if (TbSync.apiVersion != this[provider].Base.getApiVersion()) {
          throw new Error("API version mismatch, TbSync@"+TbSync.apiVersion+" vs " + provider + "@" + this[provider].Base.getApiVersion());
        }
        
        this.loadedProviders[provider] = {
          addon, extension, 
          addonId: extension.id, 
          version: addon.version.toString(),
          createAccountWindow: null
        };

        addon.contributorsURL = this[provider].Base.getContributorsUrl();

        // check if provider has its own implementation of folderList
        if (!this[provider].hasOwnProperty("folderList")) this[provider].folderList = new TbSync.manager.FolderList(provider);
        
        //load provider
        await this[provider].Base.load();

        await TbSync.messenger.overlayManager.registerOverlay("chrome://tbsync/content/manager/editAccount.xhtml?provider=" + provider, this[provider].Base.getEditAccountOverlayUrl());        
        TbSync.dump("Loaded provider", provider + "::" + this[provider].Base.getProviderName() + " ("+this.loadedProviders[provider].version+")");
        
        // reset all accounts of this provider
        let providerData = new TbSync.ProviderData(provider);
        let accounts = providerData.getAllAccounts();
        for (let accountData of accounts) {
          // reset sync objects
          TbSync.core.resetSyncDataObj(accountData.accountID);
          
          // set all accounts which are syncing to notsyncronized 
          if (accountData.getAccountProperty("status") == "syncing") accountData.setAccountProperty("status", "notsyncronized");

          // set each folder with PENDING status to ABORTED
          let folders = TbSync.db.findFolders({"status": "pending"}, {"accountID": accountData.accountID});

          for (let f=0; f < folders.length; f++) {
            TbSync.db.setFolderProperty(folders[f].accountID, folders[f].folderID, "status", "aborted");
          }
        }
        
        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateProviderList", provider);
        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);

        // TB60 -> TB68 migration - remove icon and rename target if stale
        for (let addressBook of MailServices.ab.directories) {
          if (addressBook instanceof Components.interfaces.nsIAbDirectory) {
            let storedProvider = TbSync.addressbook.getStringValue(addressBook, "tbSyncProvider", "");
            if (provider == storedProvider && providerData.getFolders({"target": addressBook.UID}).length == 0) {
              let name = addressBook.dirName;
              addressBook.dirName = TbSync.getString("target.orphaned") + ": " + name;              
              addressBook.setStringValue("tbSyncIcon", "orphaned");
              addressBook.setStringValue("tbSyncProvider", "orphaned");
              addressBook.setStringValue("tbSyncAccountID", "");
            }
          }
        }
        
        let calManager = TbSync.lightning.cal.manager;
        for (let calendar of calManager.getCalendars({})) {
          let storedProvider = calendar.getProperty("tbSyncProvider");
          if (provider == storedProvider && calendar.type == "storage" && providerData.getFolders({"target": calendar.id}).length == 0) {
            let name = calendar.name;
            calendar.name = TbSync.getString("target.orphaned") + ": " + name;
            calendar.setProperty("disabled", true);
            calendar.setProperty("tbSyncProvider", "orphaned");
            calendar.setProperty("tbSyncAccountID", "");        
          }
        }
        
      } catch (e) {
        delete this.loadedProviders[provider];
        delete this[provider];
        let info = new EventLogInfo(provider);
        TbSync.eventlog.add("error", info, "FAILED to load provider <"+provider+">", e.message);
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

      await this[provider].Base.unload();
      delete this.loadedProviders[provider];
      delete this[provider];            
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateProviderList", provider);
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);
    }
  },
  
  getDefaultAccountEntries: function (provider) {
    let defaults = TbSync.providers[provider].Base.getDefaultAccountEntries();
    
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
    let defaults = TbSync.providers[provider].Base.getDefaultFolderEntries();
    
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
