const tbSyncApiVersion = "3.0";
var providers = {};
var enabled = false;
messenger.browserAction.disable();

var Provider = class {
    constructor(id, port) {
        this.id = id;
        this.port = port;
        this.portMap = new Map();
        this.portMessageId = 0;
        
        this.port.onMessage.addListener(this.portReceiver.bind(this));
        this.port.onDisconnect.addListener(() => {
            this.port.onMessage.removeListener(this.portReceiver.bind(this));
            this.port = null;
            messenger.BootstrapLoader.notifyExperiment({command: "unloadProvider", id: this.id});
        });
        console.log(`TbSync established connection with ${this.id}`);
    }

    portReceiver(message, port) {
        // port.name should be "ProviderConnection"
        const {origin, id, data} = message;
        if (origin == "TbSync") {
            // This is an answer for one of our own requests.
            const resolve = this.portMap.get(id);
            this.portMap.delete(id);
            resolve(data);
        } else {
            // This is a request from a provider.
            let rv = "juhu";
            this.port.postMessage({origin, id, data: rv});    
        }
    }

    // https://stackoverflow.com/questions/61307980/sendresponse-in-port-postmessage
    portSend(data) {
        return new Promise(resolve => {
            const id = ++this.portMessageId;
            this.portMap.set(id, resolve);
            this.port.postMessage({origin: "TbSync", id, data});
        });
    }
    
    get addon() {
        if (!this._addon) {
            this._addon = messenger.management.get(this.id);
        }
        return this._addon;
    }
}

// Wait for connections attempts from providers.
messenger.runtime.onMessageExternal.addListener(async (message, sender) => { 
    if (message == "InitiateConnect") {      
        port = messenger.runtime.connect(sender.id, {name: "ProviderConnection"});      
        if (port && !port.error) {
            // Store port per provider.       
            let provider = new Provider(sender.id, port);
            let providerApiVersion = await provider.portSend({command: "getApiVersion"});
            if (providerApiVersion != tbSyncApiVersion) {
                let addon = await provider.addon;
                messenger.notifications.create("TbSync", {
                    "type": "basic",
                    "iconUrl": messenger.runtime.getURL("/content/skin/tbsync64.png"),
                    "title": "Incompatible Provider",
                    "message": `TbSync cannot load ${addon.name} because it is using an incompatible API version. Check for updated versions.`
                });
            } else {
                providers[sender.id] = provider;
                // The legacy load of providers should wait after TbSync has finished loading.
                if (enabled) {
                    messenger.BootstrapLoader.notifyExperiment({command: "loadProvider", id: sender.id});
                }
            }
        }
    }
});

messenger.BootstrapLoader.onNotifyBackground.addListener(async (info) => {
    switch (info.command) {
    case "enabled":
        enabled = true;
        
        // Legacy load all providers which have connected already.
        for (let provider of Object.values(providers)) {
            messenger.BootstrapLoader.notifyExperiment({command: "loadProvider", id: provider.id});
        }

        messenger.browserAction.onClicked.addListener(tab => messenger.BootstrapLoader.openOptionsDialog(tab.windowId));
        messenger.browserAction.enable();        
        break;

    default:
        // Any other request is probably a request which should be forwarded to a provider
        return providers[info.id].portSend();
  }
});

// Startup of legacy part
async function startLegacy() {
    await messenger.BootstrapLoader.registerChromeUrl([ ["content", "tbsync", "content/"] ]);
    await messenger.BootstrapLoader.registerOptionsPage("chrome://tbsync/content/manager/addonoptions.xhtml");
    await messenger.BootstrapLoader.registerBootstrapScript("chrome://tbsync/content/scripts/bootstrap.js");  
}
startLegacy();
