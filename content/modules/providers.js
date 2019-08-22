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



  
  
  loadProvider:  async function (addonId, provider, js) {
    //only load, if not yet loaded and if the provider name does not shadow a fuction inside provider.js
    if (!this.loadedProviders.hasOwnProperty(provider) && !this.hasOwnProperty(provider) && js.startsWith("chrome://")) {
      try {
        let addon = await AddonManager.getAddonByID(addonId);

        //load provider subscripts into tbSync
        this[provider] = {};
        Services.scriptloader.loadSubScript(js, this[provider], "UTF-8");
        if (tbSync.apiVersion != this[provider].Base.getApiVersion()) {
          throw new Error("API version mismatch, TbSync@"+tbSync.apiVersion+" vs " + provider + "@" + this[provider].Base.getApiVersion());
        }
        
        this.loadedProviders[provider] = {};
        this.loadedProviders[provider].addon = addon;
        this.loadedProviders[provider].addonId = addonId;
        this.loadedProviders[provider].version = addon.version.toString();
        this.loadedProviders[provider].createAccountWindow = null;

        this.loadedProviders[provider].bundle = Services.strings.createBundle(this[provider].Base.getStringBundleUrl());

        // check if provider has its own implementation of folderList
        if (!this[provider].hasOwnProperty("folderList")) this[provider].folderList = new tbSync.manager.DefaultFolderList(provider);
        
        //load provider
        await this[provider].Base.load();

        await tbSync.messenger.overlayManager.registerOverlay("chrome://tbsync/content/manager/editAccount.xul?provider=" + provider, this[provider].Base.getEditAccountOverlayUrl(), [{name: "oninject", value: "tbSyncEditAccountOverlay.onload(window, new tbSync.AccountData(tbSyncAccountSettings.accountID));"}]);        
        tbSync.dump("Loaded provider", provider + "::" + this[provider].Base.getProviderName() + " ("+this.loadedProviders[provider].version+")");
        
        // reset all accounts of this provider
        let providerData = new tbSync.ProviderData(provider);
        let accounts = providerData.getAllAccounts();
        for (let accountData of accounts) {
          // reset sync objects
          tbSync.core.resetSyncDataObj(accountData.accountID);
          
          // set all accounts which are syncing to notsyncronized 
          if (accountData.getAccountProperty("status") == "syncing") accountData.setAccountProperty("status", "notsyncronized");

          // set each folder with PENDING status to ABORTED
          let folders = tbSync.db.findFolders({"status": "pending"}, {"accountID": accountData.accountID});

          for (let f=0; f < folders.length; f++) {
            tbSync.db.setFolderProperty(folders[f].accountID, folders[f].folderID, "status", "aborted");
          }
        }
        
        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateProviderList", provider);
        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);

        // TB60 -> TB68 migration - remove icon and rename target if stale
        let allAddressBooks = MailServices.ab.directories;
        while (allAddressBooks.hasMoreElements()) {
          let addressBook = allAddressBooks.getNext();
          if (addressBook instanceof Components.interfaces.nsIAbDirectory) {
            let storedProvider = addressBook.getStringValue("tbSyncProvider", "");
            if (provider == storedProvider && providerData.getFolders({"target": addressBook.UID}).length == 0) {
              let name = addressBook.dirName;
              addressBook.dirName = tbSync.getString("target.orphaned") + ": " + name;              
              addressBook.setStringValue("tbSyncIcon", "orphaned");
              addressBook.setStringValue("tbSyncProvider", "orphaned");
              addressBook.setStringValue("tbSyncAccountID", "");
            }
          }
        }
        
		if (tbSync.lightning.isAvailable()) {
          for (let calendar of tbSync.lightning.cal.getCalendarManager().getCalendars({})) {
            let storedProvider = calendar.getProperty("tbSyncProvider");
            if (provider == storedProvider && calendar.type == "storage" && providerData.getFolders({"target": calendar.id}).length == 0) {
              let name = calendar.name;
              calendar.name = tbSync.getString("target.orphaned") + ": " + name;
              calendar.setProperty("disabled", true);
              calendar.setProperty("tbSyncProvider", "orphaned");
              calendar.setProperty("tbSyncAccountID", "");        
            }
          }
        }
        
      } catch (e) {
        delete this.loadedProviders[provider];
        delete this[provider];
        let info = new EventLogInfo(provider);
        tbSync.eventlog.add("error", info, "FAILED to load provider <"+provider+">", e.message);
        Components.utils.reportError(e);        
      }

    }
  },
  
  unloadProvider: async function (provider) {        
    if (this.loadedProviders.hasOwnProperty(provider)) {
      tbSync.dump("Unloading provider", provider);
      
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
    let defaults = tbSync.providers[provider].Base.getDefaultAccountEntries();
    
    //add system properties
    defaults.provider = provider;
    defaults.accountID = "";
    defaults.lastsynctime = 0;
    defaults.status = "disabled"; //global status: disabled, OK, syncing, notsyncronized, nolightning, ...
    defaults.autosync = 0;
    defaults.accountname = "";

    return defaults;
  },
  
  getDefaultFolderEntries: function (accountID) {
    let provider = tbSync.db.getAccountProperty(accountID, "provider");
    let defaults = tbSync.providers[provider].Base.getDefaultFolderEntries();
    
    //add system properties
    defaults.accountID = accountID;
    defaults.targetType = "";
    defaults.cached = false;
    defaults.selected = false;
    defaults.lastsynctime = 0;
    defaults.status = "";
    defaults.foldername = "";
    defaults.target = "";
    defaults.targetName = "";
    defaults.downloadonly = false;
    
    return defaults;
  },
}
