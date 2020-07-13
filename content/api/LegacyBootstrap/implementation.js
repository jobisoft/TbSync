// Get various parts of the WebExtension framework that we need.
var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { AddonManager } = ChromeUtils.import("resource://gre/modules/AddonManager.jsm");

var LegacyBootstrap = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    // To be notified of the extension going away, call callOnClose with any object that has a
    // close function, such as this one.
    context.callOnClose(this);

    this.pathToBootstrapScript = null;
    this.chromeHandle = null;
    this.bootstrapObj = {};
    this.extension = context.extension;
    
    let self = this;

    return {
      LegacyBootstrap: {

        registerChromeUrl: async function(chromeData) {
          const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
          const manifestURI = Services.io.newURI(
            "manifest.json",
            null,
            context.extension.rootURI
          );
          self.chromeHandle = aomStartup.registerChrome(manifestURI, chromeData);          
        },
       
        registerBootstrapScript: async function(aPath) {
          self.pathToBootstrapScript = aPath.startsWith("chrome://") 
            ? aPath
            : context.extension.rootURI.resolve(aPath);
          
          // Get the browser obj
          self.browser = Array.from(context.extension.views).find(
                view => view.viewType === "background").xulBrowser.contentWindow
                .wrappedJSObject.browser;
          // Get the addon object belonging to this extension.
          self.addon = await AddonManager.getAddonByID(context.extension.id);
          // Load registered bootstrap scripts and execute its startup() function.
          try {
            if (self.pathToBootstrapScript) Services.scriptloader.loadSubScript(self.pathToBootstrapScript, self.bootstrapObj, "UTF-8");
            if (self.bootstrapObj.startup) self.bootstrapObj.startup.call(self.bootstrapObj, self.addon, self.extension, self.browser);
          } catch (e) {
            Components.utils.reportError(e)
          }
        }
      }
    };
  }
  
  close() {
    // This function is called if the extension is disabled or removed, or Thunderbird closes.

    // Execute registered shutdown()
    try {
      if (this.bootstrapObj.shutdown) this.bootstrapObj.shutdown.call(this.bootstrapObj, this.addon, this.extension, this.browser);
    } catch (e) {
      Components.utils.reportError(e)
    }
  
    // after unloading also flush all caches
    Services.obs.notifyObservers(null, "startupcache-invalidate");

    if (this.chromeHandle) {
      this.chromeHandle.destruct();
      this.chromeHandle = null;
    }

    console.log("LegacyBootstrap for " + this.extension.id + " unloaded!");
  }  
};
