/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

import * as tools from './scripts/tools.js'

const tbSyncApiVersion = "3.0";
var installedProviders = new Map();
var enabled = false;
var queuedRequests = [];
messenger.browserAction.disable();

var Provider = class {
    constructor(addon, provider, port) {
        this.addon = addon;
        this.provider = provider;
        this.port = port;
        this.portMap = new Map();
        this.portMessageId = 0;

        this.port.onMessage.addListener(this.portReceiver.bind(this));
        this.port.onDisconnect.addListener(() => {
            this.port.onMessage.removeListener(this.portReceiver.bind(this));
            this.port = null;
            console.log(`TbSync: Lost connection to ${this.addon.id}`);
            //messenger.BootstrapLoader.notifyExperiment({command: "unloadProvider", provider: this.provider});
        });
        console.log(`TbSync:  Established connection to ${this.addon.id}`);
    }

    // Is async dangerous here? Do we have multiple such listeners?
    async portReceiver(message, port) {
        // port.name should be "ProviderConnection"
        const { origin, id, data } = message;
        if (origin == "TbSync") {
            // This is an answer for one of our own requests.
            const resolve = this.portMap.get(id);
            this.portMap.delete(id);
            resolve(data);
        } else {
            // This is a request from a provider.
            let rv;
            switch (message.data.command) {
                case "getString":
                    rv = tools.getString(...message.data.parameters);
                    break;
                default:
                    // Forward to legacy: only pass on the data, id and origin are not needed in the Experiment.
                    rv = await messenger.BootstrapLoader.notifyExperiment(message.data);
            }
            this.port.postMessage({ origin, id, data: rv });
        }
    }

    // https://stackoverflow.com/questions/61307980/sendresponse-in-port-postmessage
    // Send data to a remote location (another provider add-on) and store a callback which
    // is resolved when an answer is received by portReceiver().
    portSend(data) {
        return new Promise(resolve => {
            const id = ++this.portMessageId;
            this.portMap.set(id, resolve);
            this.port.postMessage({ origin: "TbSync", id, data });
        });
    }
}


// Setup local storage for our own preferences.
localStorageHandler.init({
    "log.userdatalevel": 0,
});

// Enable listeners for messaging based storage access, which
// takes care of default handling.
localStorageHandler.enableListeners();




// Wait for connections attempts from providers.
messenger.runtime.onMessageExternal.addListener(async (message, sender) => {
    if (message.command == "InitiateConnect") {
        let port = messenger.runtime.connect(sender.id, { name: "ProviderConnection" });
        if (port && !port.error) {
            let addon = await messenger.management.get(sender.id);
            let provider = new Provider(addon, message.provider, port);

            let providerApiVersion = message.info.apiVersion;
            if (providerApiVersion != tbSyncApiVersion) {
                messenger.notifications.create("TbSync", {
                    "type": "basic",
                    "iconUrl": messenger.runtime.getURL("/content/skin/tbsync64.png"),
                    "title": "Incompatible Provider",
                    "message": `TbSync cannot load ${addon.name} because it is using an incompatible API version. Check for updated versions.`
                });
            } else {
                // Store provider. SHORTNAME HAS TO GO 
                installedProviders.set(sender.id, { provider, info: message.info });
                let request = { command: "loadProvider", providerID: sender.id, provider: message.provider }
                console.log(message);

                // The legacy load of providers should wait after TbSync has finished loading.
                // PURGE!!!
                if (enabled) {
                    messenger.BootstrapLoader.notifyExperiment(request);
                } else {
                    queuedRequests.push(request);
                }
            }
        }
    }
});

messenger.runtime.onMessage.addListener((message, sender) => {
    switch (message.command) {
        case "getInstalledProviders":
            return Promise.resolve(installedProviders);
            break;
    }
});

// PURGE!!!
messenger.BootstrapLoader.onNotifyBackground.addListener(async (info) => {
    switch (info.command) {
        case "enabled":
            enabled = true;
            
            // Legacy load all providers which have connected already.
            for (let request of queuedRequests) {
                messenger.BootstrapLoader.notifyExperiment(request);
            }
            queuedRequests = [];
            break;
        
        case "getString":
            return tools.getString(...info.arguments);

        default:
            // Any other request is probably a request which should be forwarded to a provider 
            console.log(installedProviders.get(info.providerID));
            if (info.command.startsWith("Base.") && installedProviders.has(info.providerID)) {
                return installedProviders.get(info.providerID).provider.portSend(info);
            }
    }
});



function openTbSyncManager(windowId) {
    messenger.windows.create({
        allowScriptsToClose: true,
        height: 620,
        width: 760,
        type: "popup",
        url: "/content/manager/accountManager.html"
    })
}
messenger.browserAction.enable();
messenger.browserAction.onClicked.addListener(tab => openTbSyncManager(tab.windowId));


// Startup of legacy part, only used for DB stuff, will be purged soon
async function startLegacy() {
    await messenger.BootstrapLoader.registerChromeUrl([["content", "tbsync", "content/"]]);
    await messenger.BootstrapLoader.registerBootstrapScript("chrome://tbsync/content/bootstrap.js");
}
startLegacy();


