/* eslint-disable object-shorthand */

// Get various parts of the WebExtension framework that we need.
var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

var ConversionHelper = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    // To be notified of the extension going away, call callOnClose with any object that has a
    // close function, such as this one.
    context.callOnClose(this);

    this.pathToConversionJSM = null;
    this.pathToOverlayJSM = null;
    this.pathToUnloadScript = null;
    this.chromeHandle = null;
    this.OM = null;

    const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);

    let that = this;
    
    return {
      ConversionHelper: {

        registerChromeUrl: async function(chromeData) {
          const manifestURI = Services.io.newURI(
            "manifest.json",
            null,
            context.extension.rootURI
          );
          that.chromeHandle = aomStartup.registerChrome(manifestURI, chromeData);          
        },

        registerApiFolder: async function(aPath) {
          // get the final path to ConversionHelper.JSM
          that.pathToConversionJSM = aPath.startsWith("chrome://") 
            ? aPath + "ConversionHelper.jsm"
            : context.extension.rootURI.resolve(aPath + "ConversionHelper.jsm");
          // try to load the JSM and set the extension context
          try {
            let JSM = ChromeUtils.import(that.pathToConversionJSM);
            JSM.ConversionHelper.context = context;
          } catch (e) {
            console.log("Failed to load <" + that.pathToConversionJSM + ">");
            Components.utils.reportError(e);
          }

          // get the final path to OverlayManager.JSM
          that.pathToOverlayJSM = aPath.startsWith("chrome://") 
            ? aPath + "OverlayManager.jsm"
            : context.extension.rootURI.resolve(aPath + "OverlayManager.jsm");
          // try to load the JSM and set the extension context
          try {
            let JSM = ChromeUtils.import(that.pathToOverlayJSM);
            that.OM = new JSM.OverlayManager();
            that.OM.extension = context.extension;
          } catch (e) {
            console.log("Failed to load <" + that.pathToOverlayJSM + ">");
            Components.utils.reportError(e);
          }
        },
        
        notifyStartupCompleted: async function() {
          if (!that.pathToConversionJSM) {
            throw new Error("Please call browser.ConversionHelper.registerApiFolder(aPath) first!");
          }
          let JSM = ChromeUtils.import(that.pathToConversionJSM);
          JSM.ConversionHelper.notifyStartupComplete();          
        },
        
        registerUnloadScript: async function(aPath) {
          that.pathToUnloadScript = aPath.startsWith("chrome://") 
            ? aPath
            : context.extension.rootURI.resolve(aPath);
        },
        
        setOverlayVerbosity: function(level) {
          if (!that.OM) throw new Error("Please call browser.ConversionHelper.registerApiFolder(aPath) first!");
          that.OM.options.verbose = level;          
        },

        getOverlayVerbosity: function() {
          if (!that.OM) throw new Error("Please call browser.ConversionHelper.registerApiFolder(aPath) first!");
          return that.OM.options.verbose;
        },

        activateOverlays: async function() {
          if (!that.OM) throw new Error("Please call browser.ConversionHelper.registerApiFolder(aPath) first!");
          that.OM.startObserving();
        },

        deactivateOverlays: async function() {
          if (!that.OM) throw new Error("Please call browser.ConversionHelper.registerApiFolder(aPath) first!");
          that.OM.stopObserving();
        },

        registerOverlay: async function(dst, overlay) {
          if (!that.OM) throw new Error("Please call browser.ConversionHelper.registerApiFolder(aPath) first!");
          await that.OM.registerOverlay(dst, overlay);
        }        
        
      },
    };
  }
  
  close() {
    // This function is called if the extension is disabled or removed, or Thunderbird closes.
    // We registered it with callOnClose, above.
    if (this.OM) this.OM.stopObserving();
    this.OM = null;

    // Execute registered unload script
    let unloadJS = {};
    try {
      if (this.pathToUnloadScript) Services.scriptloader.loadSubScript(this.pathToUnloadScript, unloadJS, "UTF-8");
    } catch (e) {
      Components.utils.reportError(e)
    }

    // Unload the JSM we imported above. This will cause Thunderbird to forget about the JSM, and
    // load it afresh next time `import` is called. (If you don't call `unload`, Thunderbird will
    // remember this version of the module and continue to use it, even if your extension receives
    // an update.) You should *always* unload JSMs provided by your extension.
    Cu.unload(this.pathToOverlayJSM);
    Cu.unload(this.pathToConversionJSM);
    
    // after unloading also flush all caches
    Services.obs.notifyObservers(null, "startupcache-invalidate");

    if (this.chromeHandle) {
      this.chromeHandle.destruct();
      this.chromeHandle = null;
    }

    console.log("ConversionHelper for " + this.extension.id + " unloaded!");
  }  
};
