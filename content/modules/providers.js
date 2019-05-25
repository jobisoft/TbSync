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
                let addon = await tbSync.getAddonByID(addonId);

                this[provider] = {};
                this.loadedProviders[provider] = {};
                this.loadedProviders[provider].addon = addon;
                this.loadedProviders[provider].addonId = addonId;
                this.loadedProviders[provider].version = addon.version.toString();
                
                //load provider subscripts into tbSync
                Services.scriptloader.loadSubScript(js, this[provider], "UTF-8");
                this.loadedProviders[provider].bundle = Services.strings.createBundle(this[provider].api.getStringBundleUrl());

                // check if provider has its own implementation of folderList
                if (!this[provider].hasOwnProperty("folderList")) this[provider].folderList = new tbSync.manager.DefaultFolderList(provider);
                
                //load provider
                await this[provider].api.load(tbSync.lightning.isAvailable());

                await tbSync.messenger.overlayManager.registerOverlay("chrome://tbsync/content/manager/editAccount.xul?provider=" + provider, this[provider].api.getEditAccountOverlayUrl());        
                tbSync.dump("Loaded provider", provider + "::" + this[provider].api.getNiceProviderName() + " ("+this.loadedProviders[provider].version+")");
                tbSync.core.resetSync(provider);
                Services.obs.notifyObservers(null, "tbsync.observer.manager.updateProviderList", provider);

            } catch (e) {
                tbSync.dump("FAILED to load provider", provider);
                Components.utils.reportError(e);
            }

        }
    },
    
    unloadProvider: async function (provider) {        
        if (this.loadedProviders.hasOwnProperty(provider)) {
            tbSync.dump("Unloading provider", provider);
            await this[provider].api.unload(tbSync.lightning.isAvailable());
            delete this.loadedProviders[provider];
            delete this[provider];            
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateProviderList", provider);
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);
        }
    },
    
    getDefaultAccountEntries: function (provider) {
        let defaults = tbSync.providers[provider].api.getDefaultAccountEntries();
        
        //add system properties
        defaults.provider = provider;
        defaults.account = "";
        defaults.lastsynctime = "0";
        defaults.status = "disabled"; //global status: disabled, OK, syncing, notsyncronized, nolightning, ...
        defaults.autosync = "0";
        defaults.accountname = "";

        return defaults;
    },
    
    getDefaultFolderEntries: function (accountID) {
        let provider = tbSync.db.getAccountSetting(accountID, "provider");
        let defaults = tbSync.providers[provider].api.getDefaultFolderEntries();
        
        //add system properties
        defaults.account = accountID;
        defaults.folderID = "";
        defaults.targetType = "unset";
        
        return defaults;
    },
}
