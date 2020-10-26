/*
 * This file is provided by the addon-developer-support repository at
 * https://github.com/thundernest/addon-developer-support
 *
 * Version 1.4
 * - add registerOptionsPage
 *
 * Version: 1.3
 * - flush cache
 *
 * Version: 1.2
 * - add support for resource urls
 *
 * Author: John Bieling (john@thunderbird.net)
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// Get various parts of the WebExtension framework that we need.
var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { ExtensionSupport } = ChromeUtils.import("resource:///modules/ExtensionSupport.jsm");
var { AddonManager } = ChromeUtils.import("resource://gre/modules/AddonManager.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

var BootstrapLoader = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    this.uniqueRandomID = "AddOnNS" + context.extension.instanceId;
    this.menu_addonsManager_id ="addonsManager";
    this.menu_addonsManager_prefs_id = "addonsManager_prefs_revived";
    this.menu_addonPrefs_id = "addonPrefs_revived";

    this.pathToBootstrapScript = null;
    this.pathToOptionsPage = null;
    this.chromeHandle = null;
    this.chromeData = null;
    this.resourceData = null;    
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

    const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
    const resProto = Cc["@mozilla.org/network/protocol;1?name=resource"].getService(Ci.nsISubstitutingProtocolHandler);
    
    let self = this;

    return {
      BootstrapLoader: {

        registerOptionsPage(optionsUrl) {
          self.pathToOptionsPage = optionsUrl.startsWith("chrome://")
            ? optionsUrl
            : context.extension.rootURI.resolve(optionsUrl);
        },

        registerChromeUrl(data) {
          let chromeData = [];
          let resourceData = [];
          for (let entry of data) {
            if (entry[0] == "resource") resourceData.push(entry);
            else chromeData.push(entry)
          }

          if (chromeData.length > 0) {
            const manifestURI = Services.io.newURI(
              "manifest.json",
              null,
              context.extension.rootURI
            );
            self.chromeHandle = aomStartup.registerChrome(manifestURI, chromeData);
          }

          for (let res of resourceData) {
            // [ "resource", "shortname" , "path" ]
            let uri = Services.io.newURI(
              res[2],
              null,
              context.extension.rootURI
            );
            resProto.setSubstitutionWithFlags(
              res[1],
              uri,
              resProto.ALLOW_CONTENT_ACCESS
            );
          }

          self.chromeData = chromeData;
          self.resourceData = resourceData;
        },

        registerBootstrapScript: async function(aPath) {
          self.pathToBootstrapScript = aPath.startsWith("chrome://")
            ? aPath
            : context.extension.rootURI.resolve(aPath);

          // Get the addon object belonging to this extension.
          let addon = await AddonManager.getAddonByID(context.extension.id);
          //make the addon globally available in the bootstrapped scope
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
          
          // Register window listener for main TB window
          if (self.pathToOptionsPage) {
            ExtensionSupport.registerWindowListener("injectListener_" + self.uniqueRandomID, {
              chromeURLs: [
                "chrome://messenger/content/messenger.xul",
                "chrome://messenger/content/messenger.xhtml",              
              ],
              async onLoadWindow(window) {
                try {
                  // add the add-on options menu if needed
                  if (!window.document.getElementById(self.menu_addonsManager_prefs_id)) {
                    let addonprefs = window.MozXULElement.parseXULToFragment(`
                      <menu id="${self.menu_addonsManager_prefs_id}" label="&addonPrefs.label;">
                        <menupopup id="${self.menu_addonPrefs_id}">
                        </menupopup>
                      </menu>
                    `, ["chrome://messenger/locale/messenger.dtd"]);

                    let element_addonsManager = window.document.getElementById(self.menu_addonsManager_id);
                    element_addonsManager.parentNode.insertBefore(addonprefs, element_addonsManager.nextSibling);
                  }

                  // add the options entry
                  let element_addonPrefs = window.document.getElementById(self.menu_addonPrefs_id);
                  let id = self.menu_addonPrefs_id + "_" + self.uniqueRandomID;

                  // Get the best size of the icon (16px or bigger)
                  let iconSizes = Object.keys(self.extension.manifest.icons);
                  iconSizes.sort((a,b)=>a-b);
                  let bestSize = iconSizes.filter(e => parseInt(e) >= 16).shift();
                  let icon = bestSize ? self.extension.manifest.icons[bestSize] : "";

                  let name = self.extension.manifest.name;
                  let entry = window.MozXULElement.parseXULToFragment(
                    `<menuitem class="menuitem-iconic" id="${id}" image="${icon}" label="${name}" />`);
                  element_addonPrefs.appendChild(entry);
                  let BL = {}
                  BL.extension = self.extension;
                  BL.messenger = Array.from(self.extension.views).find(
                    view => view.viewType === "background").xulBrowser.contentWindow
                    .wrappedJSObject.browser;
                  window.document.getElementById(id).addEventListener("command", function() {window.openDialog(self.pathToOptionsPage, "AddonOptions", null, BL)});
                } catch (e) {
                  Components.utils.reportError(e)
                }
              },

              onUnloadWindow(window) {          
              }
            });
          }
        }
      }
    };
  }

  onShutdown(isAppShutdown) {
    //remove our entry in the add-on options menu
    if (this.pathToOptionsPage) {
      for (let window of Services.wm.getEnumerator("mail:3pane")) {
        let id = this.menu_addonPrefs_id + "_" + this.uniqueRandomID;
        window.document.getElementById(id).remove();

        //do we have to remove the entire add-on options menu?
        let element_addonPrefs = window.document.getElementById(this.menu_addonPrefs_id);
        if (element_addonPrefs.children.length == 0) {
          window.document.getElementById(this.menu_addonsManager_prefs_id).remove();
        }
      }
      // Stop listening for new windows.
      ExtensionSupport.unregisterWindowListener("injectListener_" + this.uniqueRandomID);
    }

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

    if (this.resourceData) {
      const resProto = Cc["@mozilla.org/network/protocol;1?name=resource"].getService(Ci.nsISubstitutingProtocolHandler);
      for (let res of this.resourceData) {
        // [ "resource", "shortname" , "path" ]
        resProto.setSubstitution(
          res[1],
          null,
        );
      }
    }

    if (this.chromeHandle) {
      this.chromeHandle.destruct();
      this.chromeHandle = null;
    }
    // Flush all caches
    Services.obs.notifyObservers(null, "startupcache-invalidate");
    console.log("BootstrapLoader for " + this.extension.id + " unloaded!");
  }
};
