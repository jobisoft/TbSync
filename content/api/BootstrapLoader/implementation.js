/*
 * This file is provided by the addon-developer-support repository at
 * https://github.com/thundernest/addon-developer-support
 *
 * Version: 1.1
 * Author: John Bieling (john@thunderbird.net)
 * 
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

// Get various parts of the WebExtension framework that we need.
var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { AddonManager } = ChromeUtils.import("resource://gre/modules/AddonManager.jsm");

var BootstrapLoader = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    this.pathToBootstrapScript = null;
    this.chromeHandle = null;
    this.chromeData = null;    
    this.bootstrappedObj = {};

    // make the extension object and the messenger object available inside
    // the bootstrapped scope
    this.bootstrappedObj.extension = context.extension;
    this.bootstrappedObj.messenger = Array.from(context.extension.views)
                      .find(view => view.viewType === "background")
                      .xulBrowser.contentWindow.wrappedJSObject.browser;        
    
    
    this.BOOTSTRAP_REASONS = {
      APP_STARTUP: 1,
      APP_SHUTDOWN: 2,
      ADDON_ENABLE: 3,
      ADDON_DISABLE: 4,
      ADDON_INSTALL: 5,
      ADDON_UNINSTALL: 6, // not supported
      ADDON_UPGRADE: 7,
      ADDON_DOWNGRADE: 8,
    };
    
    let self = this;

    return {
      BootstrapLoader: {

        registerChromeUrl: async function(chromeData) {
          const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
          const manifestURI = Services.io.newURI(
            "manifest.json",
            null,
            context.extension.rootURI
          );
          self.chromeHandle = aomStartup.registerChrome(manifestURI, chromeData);
          self.chromeData = chromeData;          
        },
       
        registerBootstrapScript: async function(aPath) {
          self.pathToBootstrapScript = aPath.startsWith("chrome://") 
            ? aPath
            : context.extension.rootURI.resolve(aPath);

          // Get the addon object belonging to this extension.
          let addon = await AddonManager.getAddonByID(context.extension.id);
          //make the addon globally awailable in the bootstrapped scope
          self.bootstrappedObj.addon = addon;
          
          // add BOOTSTRAP_REASONS to scope
          for (let reason of Object.keys(self.BOOTSTRAP_REASONS)) {
            self.bootstrappedObj[reason] = self.BOOTSTRAP_REASONS[reason];
          }
          
          // Load registered bootstrap scripts and execute its startup() function.
          try {
            if (self.pathToBootstrapScript) Services.scriptloader.loadSubScript(self.pathToBootstrapScript, self.bootstrappedObj, "UTF-8");
            if (self.bootstrappedObj.startup) self.bootstrappedObj.startup.call(self.bootstrappedObj, self.extension.addonData, self.BOOTSTRAP_REASONS[self.extension.startupReason]);
          } catch (e) {
            Components.utils.reportError(e)
          }
        }
      }
    };
  }
  
  onShutdown(isAppShutdown) {  
    // Execute registered shutdown()
    try {
      if (this.bootstrappedObj.shutdown) {
        this.bootstrappedObj.shutdown(
          this.extension.addonData,
          isAppShutdown 
            ? this.BOOTSTRAP_REASONS.APP_SHUTDOWN
            : this.BOOTSTRAP_REASONS.ADDON_DISABLE);
      }
    } catch (e) {
      Components.utils.reportError(e)
    }
    
    if (this.chromeHandle) {
      this.chromeHandle.destruct();
      this.chromeHandle = null;
    }

    console.log("BootstrapLoader for " + this.extension.id + " unloaded!");
  }
};
