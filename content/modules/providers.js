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
            this.unloadProvider(provider);
        }
    },



    
    
    loadProvider:  async function (addonId, provider, js) {
        //only load, if not yet loaded
        if (!this.loadedProviders.hasOwnProperty(provider)) {
            try {
                //load provider subscripts into tbSync 
                tbSync.includeJS("chrome:" + js);

                let addon = await tbSync.getAddonByID(addonId);

                //Store some quick access data for each provider
                this.loadedProviders[provider] = {};
                this.loadedProviders[provider].addon = addon;
                this.loadedProviders[provider].addonId = addonId;
                this.loadedProviders[provider].version = addon.version.toString();
                    
                //load provider
                await tbSync[provider].load(tbSync.lightning.isAvailable());
                await tbSync.messenger.overlayManager.registerOverlay("chrome://tbsync/content/manager/editAccount.xul?provider="+provider, tbSync[provider].getEditAccountOverlayUrl());        
                tbSync.dump("Loaded provider", provider + "::" + tbSync[provider].getNiceProviderName() + " ("+this.loadedProviders[provider].version+")");
                tbSync.core.resetSync(provider);
                Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountsList", provider);

            } catch (e) {
                tbSync.dump("FAILED to load provider", provider);
                Components.utils.reportError(e);
            }

        }
    },

    unloadProvider:  function (provider) {        
        if (this.loadedProviders.hasOwnProperty(provider)) {
            tbSync.dump("Unloading provider", provider);
            tbSync[provider].unload(tbSync.lightning.isAvailable());
            tbSync[provider] = {};
            delete this.loadedProviders[provider];
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountsList", provider);                    
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);
        }
    },
}
