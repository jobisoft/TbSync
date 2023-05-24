/*
 * This file is provided by the addon-developer-support repository at
 * https://github.com/thundernest/addon-developer-support
 *
 * Version: 1.21
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

function getThunderbirdVersion() {
  let parts = Services.appinfo.version.split(".");
  return {
    major: parseInt(parts[0]),
    minor: parseInt(parts[1]),
    revision: parts.length > 2 ? parseInt(parts[2]) : 0,
  }
}

function getMessenger(context) {
  let apis = ["storage", "runtime", "extension", "i18n"];

  function getStorage() {
    let localstorage = null;
    try {
      localstorage = context.apiCan.findAPIPath("storage");
      localstorage.local.get = (...args) =>
        localstorage.local.callMethodInParentProcess("get", args);
      localstorage.local.set = (...args) =>
        localstorage.local.callMethodInParentProcess("set", args);
      localstorage.local.remove = (...args) =>
        localstorage.local.callMethodInParentProcess("remove", args);
      localstorage.local.clear = (...args) =>
        localstorage.local.callMethodInParentProcess("clear", args);
    } catch (e) {
      console.info("Storage permission is missing");
    }
    return localstorage;
  }

  let messenger = {};
  for (let api of apis) {
    switch (api) {
      case "storage":
        XPCOMUtils.defineLazyGetter(messenger, "storage", () =>
          getStorage()
        );
        break;

      default:
        XPCOMUtils.defineLazyGetter(messenger, api, () =>
          context.apiCan.findAPIPath(api)
        );
    }
  }
  return messenger;
}

var BootstrapLoader_102 = class extends ExtensionCommon.ExtensionAPI {
  getCards(e) {
    // This gets triggered by real events but also manually by providing the outer window.
    // The event is attached to the outer browser, get the inner one.
    let doc;

    // 78,86, and 87+ need special handholding. *Yeah*.
    if (getThunderbirdVersion().major < 86) {
      let ownerDoc = e.document || e.target.ownerDocument;
      doc = ownerDoc.getElementById("html-view-browser").contentDocument;
    } else if (getThunderbirdVersion().major < 87) {
      let ownerDoc = e.document || e.target;
      doc = ownerDoc.getElementById("html-view-browser").contentDocument;
    } else {
      doc = e.document || e.target;
    }
    return doc.querySelectorAll("addon-card");
  }

  // Add pref entry to 68
  add68PrefsEntry(event) {
    let id = this.menu_addonPrefs_id + "_" + this.uniqueRandomID;

    // Get the best size of the icon (16px or bigger)
    let iconSizes = this.extension.manifest.icons
      ? Object.keys(this.extension.manifest.icons)
      : [];
    iconSizes.sort((a, b) => a - b);
    let bestSize = iconSizes.filter(e => parseInt(e) >= 16).shift();
    let icon = bestSize ? this.extension.manifest.icons[bestSize] : "";

    let name = this.extension.manifest.name;
    let entry = icon
      ? event.target.ownerGlobal.MozXULElement.parseXULToFragment(
        `<menuitem class="menuitem-iconic" id="${id}" image="${icon}" label="${name}" />`)
      : event.target.ownerGlobal.MozXULElement.parseXULToFragment(
        `<menuitem id="${id}" label="${name}" />`);

    event.target.appendChild(entry);
    let noPrefsElem = event.target.querySelector('[disabled="true"]');
    // using collapse could be undone by core, so we use display none
    // noPrefsElem.setAttribute("collapsed", "true");
    noPrefsElem.style.display = "none";
    event.target.ownerGlobal.document.getElementById(id).addEventListener("command", this);
  }

  // Event handler for the addon manager, to update the state of the options button.
  handleEvent(e) {
    switch (e.type) {
      // 68 add-on options menu showing
      case "popupshowing": {
        this.add68PrefsEntry(e);
      }
        break;

      // 78/88 add-on options menu/button click
      case "click": {
        e.preventDefault();
        e.stopPropagation();
        let BL = {}
        BL.extension = this.extension;
        BL.messenger = getMessenger(this.context);
        let w = Services.wm.getMostRecentWindow("mail:3pane");
        w.openDialog(this.pathToOptionsPage, "AddonOptions", "chrome,resizable,centerscreen", BL);
      }
        break;

      // 68 add-on options menu command
      case "command": {
        let BL = {}
        BL.extension = this.extension;
        BL.messenger = getMessenger(this.context);
        e.target.ownerGlobal.openDialog(this.pathToOptionsPage, "AddonOptions", "chrome,resizable,centerscreen", BL);
      }
        break;

      // update, ViewChanged and manual call for add-on manager options overlay
      default: {
        let cards = this.getCards(e);
        for (let card of cards) {
          // Setup either the options entry in the menu or the button
          if (card.addon.id == this.extension.id) {
            let optionsMenu =
              (getThunderbirdVersion().major > 78 && getThunderbirdVersion().major < 88) ||
              (getThunderbirdVersion().major == 78 && getThunderbirdVersion().minor < 10) ||
              (getThunderbirdVersion().major == 78 && getThunderbirdVersion().minor == 10 && getThunderbirdVersion().revision < 2);
            if (optionsMenu) {
              // Options menu in 78.0-78.10 and 79-87
              let addonOptionsLegacyEntry = card.querySelector(".extension-options-legacy");
              if (card.addon.isActive && !addonOptionsLegacyEntry) {
                let addonOptionsEntry = card.querySelector("addon-options panel-list panel-item[action='preferences']");
                addonOptionsLegacyEntry = card.ownerDocument.createElement("panel-item");
                addonOptionsLegacyEntry.setAttribute("data-l10n-id", "preferences-addon-button");
                addonOptionsLegacyEntry.classList.add("extension-options-legacy");
                addonOptionsEntry.parentNode.insertBefore(
                  addonOptionsLegacyEntry,
                  addonOptionsEntry
                );
                card.querySelector(".extension-options-legacy").addEventListener("click", this);
              } else if (!card.addon.isActive && addonOptionsLegacyEntry) {
                addonOptionsLegacyEntry.remove();
              }
            } else {
              // Add-on button in 88
              let addonOptionsButton = card.querySelector(".extension-options-button2");
              if (card.addon.isActive && !addonOptionsButton) {
                addonOptionsButton = card.ownerDocument.createElement("button");
                addonOptionsButton.classList.add("extension-options-button2");
                addonOptionsButton.style["min-width"] = "auto";
                addonOptionsButton.style["min-height"] = "auto";
                addonOptionsButton.style["width"] = "24px";
                addonOptionsButton.style["height"] = "24px";
                addonOptionsButton.style["margin"] = "0";
                addonOptionsButton.style["margin-inline-start"] = "8px";
                addonOptionsButton.style["-moz-context-properties"] = "fill";
                addonOptionsButton.style["fill"] = "currentColor";
                addonOptionsButton.style["background-image"] = "url('chrome://messenger/skin/icons/developer.svg')";
                addonOptionsButton.style["background-repeat"] = "no-repeat";
                addonOptionsButton.style["background-position"] = "center center";
                addonOptionsButton.style["padding"] = "1px";
                addonOptionsButton.style["display"] = "flex";
                addonOptionsButton.style["justify-content"] = "flex-end";
                card.optionsButton.parentNode.insertBefore(
                  addonOptionsButton,
                  card.optionsButton
                );
                card.querySelector(".extension-options-button2").addEventListener("click", this);
              } else if (!card.addon.isActive && addonOptionsButton) {
                addonOptionsButton.remove();
              }
            }
          }
        }
      }
    }
  }

  // Some tab/add-on-manager related functions
  getTabMail(window) {
    return window.document.getElementById("tabmail");
  }

  // returns the outer browser, not the nested browser of the add-on manager
  // events must be attached to the outer browser
  getAddonManagerFromTab(tab) {
    if (tab.browser && tab.mode.name == "contentTab") {
      let win = tab.browser.contentWindow;
      if (win && win.location.href == "about:addons") {
        return win;
      }
    }
  }

  getAddonManagerFromWindow(window) {
    let tabMail = this.getTabMail(window);
    for (let tab of tabMail.tabInfo) {
      let managerWindow = this.getAddonManagerFromTab(tab);
      if (managerWindow) {
        return managerWindow;
      }
    }
  }

  async getAddonManagerFromWindowWaitForLoad(window) {
    let { setTimeout } = Services.wm.getMostRecentWindow("mail:3pane");

    let tabMail = this.getTabMail(window);
    for (let tab of tabMail.tabInfo) {
      if (tab.browser && tab.mode.name == "contentTab") {
        // Instead of registering a load observer, wait until its loaded. Not nice,
        // but gets aroud a lot of edge cases.
        while (!tab.pageLoaded) {
          await new Promise(r => setTimeout(r, 150));
        }
        let managerWindow = this.getAddonManagerFromTab(tab);
        if (managerWindow) {
          return managerWindow;
        }
      }
    }
  }

  setupAddonManager(managerWindow, forceLoad = false) {
    if (!managerWindow) {
      return;
    }
    if (
      managerWindow &&
      managerWindow[this.uniqueRandomID] &&
      managerWindow[this.uniqueRandomID].hasAddonManagerEventListeners
    ) {
      return;
    }
    managerWindow.document.addEventListener("ViewChanged", this);
    managerWindow.document.addEventListener("update", this);
    managerWindow.document.addEventListener("view-loaded", this);
    managerWindow[this.uniqueRandomID] = {};
    managerWindow[this.uniqueRandomID].hasAddonManagerEventListeners = true;
    if (forceLoad) {
      this.handleEvent(managerWindow);
    }
  }

  getAPI(context) {
    this.uniqueRandomID = "AddOnNS" + context.extension.instanceId;
    this.menu_addonPrefs_id = "addonPrefs";


    this.pathToBootstrapScript = null;
    this.pathToOptionsPage = null;
    this.chromeHandle = null;
    this.chromeData = null;
    this.resourceData = null;
    this.bootstrappedObj = {};

    // make the extension object and the messenger object available inside
    // the bootstrapped scope
    this.bootstrappedObj.extension = context.extension;
    this.bootstrappedObj.messenger = getMessenger(this.context);

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

    // TabMonitor to detect opening of tabs, to setup the options button in the add-on manager.
    this.tabMonitor = {
      onTabTitleChanged(tab) { },
      onTabClosing(tab) { },
      onTabPersist(tab) { },
      onTabRestored(tab) { },
      onTabSwitched(aNewTab, aOldTab) { },
      async onTabOpened(tab) {
        if (tab.browser && tab.mode.name == "contentTab") {
          let { setTimeout } = Services.wm.getMostRecentWindow("mail:3pane");
          // Instead of registering a load observer, wait until its loaded. Not nice,
          // but gets aroud a lot of edge cases.
          while (!tab.pageLoaded) {
            await new Promise(r => setTimeout(r, 150));
          }
          self.setupAddonManager(self.getAddonManagerFromTab(tab));
        }
      },
    };

    return {
      BootstrapLoader: {

        registerOptionsPage(optionsUrl) {
          self.pathToOptionsPage = optionsUrl.startsWith("chrome://")
            ? optionsUrl
            : context.extension.rootURI.resolve(optionsUrl);
        },

        openOptionsDialog(windowId) {
          let window = context.extension.windowManager.get(windowId, context).window
          let BL = {}
          BL.extension = self.extension;
          BL.messenger = getMessenger(self.context);
          window.openDialog(self.pathToOptionsPage, "AddonOptions", "chrome,resizable,centerscreen", BL);
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

        registerBootstrapScript: async function (aPath) {
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
                if (getThunderbirdVersion().major < 78) {
                  let element_addonPrefs = window.document.getElementById(self.menu_addonPrefs_id);
                  element_addonPrefs.addEventListener("popupshowing", self);
                } else {
                  // Add a tabmonitor, to be able to setup the options button/menu in the add-on manager.
                  self.getTabMail(window).registerTabMonitor(self.tabMonitor);
                  window[self.uniqueRandomID] = {};
                  window[self.uniqueRandomID].hasTabMonitor = true;
                  // Setup the options button/menu in the add-on manager, if it is already open.
                  let managerWindow = await self.getAddonManagerFromWindowWaitForLoad(window);
                  self.setupAddonManager(managerWindow, true);
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
    if (isAppShutdown) {
      return; // the application gets unloaded anyway
    }

    //remove our entry in the add-on options menu
    if (this.pathToOptionsPage) {
      for (let window of Services.wm.getEnumerator("mail:3pane")) {
        if (getThunderbirdVersion().major < 78) {
          let element_addonPrefs = window.document.getElementById(this.menu_addonPrefs_id);
          element_addonPrefs.removeEventListener("popupshowing", this);
          // Remove our entry.
          let entry = window.document.getElementById(this.menu_addonPrefs_id + "_" + this.uniqueRandomID);
          if (entry) entry.remove();
          // Do we have to unhide the noPrefsElement?
          if (element_addonPrefs.children.length == 1) {
            let noPrefsElem = element_addonPrefs.querySelector('[disabled="true"]');
            noPrefsElem.style.display = "inline";
          }
        } else {
          // Remove event listener for addon manager view changes
          let managerWindow = this.getAddonManagerFromWindow(window);
          if (
            managerWindow && 
            managerWindow[this.uniqueRandomID] && 
            managerWindow[this.uniqueRandomID].hasAddonManagerEventListeners
          ) {
            managerWindow.document.removeEventListener("ViewChanged", this);
            managerWindow.document.removeEventListener("update", this);
            managerWindow.document.removeEventListener("view-loaded", this);
            managerWindow[this.uniqueRandomID].hasAddonManagerEventListeners = false;

            let cards = this.getCards(managerWindow);
            if (getThunderbirdVersion().major < 88) {
              // Remove options menu in 78-87
              for (let card of cards) {
                let addonOptionsLegacyEntry = card.querySelector(".extension-options-legacy");
                if (addonOptionsLegacyEntry) addonOptionsLegacyEntry.remove();
              }
            } else {
              // Remove options button in 88
              for (let card of cards) {
                if (card.addon.id == this.extension.id) {
                  let addonOptionsButton = card.querySelector(".extension-options-button2");
                  if (addonOptionsButton) addonOptionsButton.remove();
                  break;
                }
              }
            }
          }

          // Remove tabmonitor
          if (window[this.uniqueRandomID].hasTabMonitor) {
            this.getTabMail(window).unregisterTabMonitor(this.tabMonitor);
            window[this.uniqueRandomID].hasTabMonitor = false;
          }

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

// Removed all extra code for backward compatibility for better maintainability.
var BootstrapLoader_115 = class extends ExtensionCommon.ExtensionAPI {
  getCards(e) {
    // This gets triggered by real events but also manually by providing the outer window.
    // The event is attached to the outer browser, get the inner one.
    let doc = e.document || e.target;
    return doc.querySelectorAll("addon-card");
  }

  // Event handler for the addon manager, to update the state of the options button.
  handleEvent(e) {
    switch (e.type) {
      case "click": {
        e.preventDefault();
        e.stopPropagation();
        let BL = {}
        BL.extension = this.extension;
        BL.messenger = getMessenger(this.context);
        let w = Services.wm.getMostRecentWindow("mail:3pane");
        w.openDialog(
          this.pathToOptionsPage,
          "AddonOptions",
          "chrome,resizable,centerscreen",
          BL
        );
      }
        break;


      // update, ViewChanged and manual call for add-on manager options overlay
      default: {
        let cards = this.getCards(e);
        for (let card of cards) {
          // Setup either the options entry in the menu or the button
          if (card.addon.id == this.extension.id) {
            // Add-on button
            let addonOptionsButton = card.querySelector(
              ".windowlistener-options-button"
            );
            if (card.addon.isActive && !addonOptionsButton) {
              let origAddonOptionsButton = card.querySelector(".extension-options-button")
              origAddonOptionsButton.setAttribute("hidden", "true");

              addonOptionsButton = card.ownerDocument.createElement("button");
              addonOptionsButton.classList.add("windowlistener-options-button");
              addonOptionsButton.classList.add("extension-options-button");
              card.optionsButton.parentNode.insertBefore(
                addonOptionsButton,
                card.optionsButton
              );
              card
                .querySelector(".windowlistener-options-button")
                .addEventListener("click", this);
            } else if (!card.addon.isActive && addonOptionsButton) {
              addonOptionsButton.remove();
            }
          }
        }
      }
    }
  }

  // Some tab/add-on-manager related functions
  getTabMail(window) {
    return window.document.getElementById("tabmail");
  }

  // returns the outer browser, not the nested browser of the add-on manager
  // events must be attached to the outer browser
  getAddonManagerFromTab(tab) {
    if (tab.browser && tab.mode.name == "contentTab") {
      let win = tab.browser.contentWindow;
      if (win && win.location.href == "about:addons") {
        return win;
      }
    }
  }

  getAddonManagerFromWindow(window) {
    let tabMail = this.getTabMail(window);
    for (let tab of tabMail.tabInfo) {
      let managerWindow = this.getAddonManagerFromTab(tab);
      if (managerWindow) {
        return managerWindow;
      }
    }
  }

  async getAddonManagerFromWindowWaitForLoad(window) {
    let { setTimeout } = Services.wm.getMostRecentWindow("mail:3pane");

    let tabMail = this.getTabMail(window);
    for (let tab of tabMail.tabInfo) {
      if (tab.browser && tab.mode.name == "contentTab") {
        // Instead of registering a load observer, wait until its loaded. Not nice,
        // but gets aroud a lot of edge cases.
        while (!tab.pageLoaded) {
          await new Promise(r => setTimeout(r, 150));
        }
        let managerWindow = this.getAddonManagerFromTab(tab);
        if (managerWindow) {
          return managerWindow;
        }
      }
    }
  }

  setupAddonManager(managerWindow, forceLoad = false) {
    if (!managerWindow) {
      return;
    }
    if (!this.pathToOptionsPage) {
      return;
    }
    if (
      managerWindow &&
      managerWindow[this.uniqueRandomID] &&
      managerWindow[this.uniqueRandomID].hasAddonManagerEventListeners
    ) {
      return;
    }
    
    managerWindow.document.addEventListener("ViewChanged", this);
    managerWindow.document.addEventListener("update", this);
    managerWindow.document.addEventListener("view-loaded", this);
    managerWindow[this.uniqueRandomID] = {};
    managerWindow[this.uniqueRandomID].hasAddonManagerEventListeners = true;
    if (forceLoad) {
      this.handleEvent(managerWindow);
    }
  }

  getAPI(context) {
    this.uniqueRandomID = "AddOnNS" + context.extension.instanceId;
    this.menu_addonPrefs_id = "addonPrefs";


    this.pathToBootstrapScript = null;
    this.pathToOptionsPage = null;
    this.chromeHandle = null;
    this.chromeData = null;
    this.resourceData = null;
    this.bootstrappedObj = {};

    // make the extension object and the messenger object available inside
    // the bootstrapped scope
    this.bootstrappedObj.extension = context.extension;
    this.bootstrappedObj.messenger = getMessenger(this.context);

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

    // TabMonitor to detect opening of tabs, to setup the options button in the add-on manager.
    this.tabMonitor = {
      onTabTitleChanged(tab) { },
      onTabClosing(tab) { },
      onTabPersist(tab) { },
      onTabRestored(tab) { },
      onTabSwitched(aNewTab, aOldTab) { },
      async onTabOpened(tab) {
        if (tab.browser && tab.mode.name == "contentTab") {
          let { setTimeout } = Services.wm.getMostRecentWindow("mail:3pane");
          // Instead of registering a load observer, wait until its loaded. Not nice,
          // but gets aroud a lot of edge cases.
          while (!tab.pageLoaded) {
            await new Promise(r => setTimeout(r, 150));
          }
          self.setupAddonManager(self.getAddonManagerFromTab(tab));
        }
      },
    };

    return {
      BootstrapLoader: {

        registerOptionsPage(optionsUrl) {
          self.pathToOptionsPage = optionsUrl.startsWith("chrome://")
            ? optionsUrl
            : context.extension.rootURI.resolve(optionsUrl);
        },

        openOptionsDialog(windowId) {
          let window = context.extension.windowManager.get(windowId, context).window
          let BL = {}
          BL.extension = self.extension;
          BL.messenger = getMessenger(self.context);
          window.openDialog(self.pathToOptionsPage, "AddonOptions", "chrome,resizable,centerscreen", BL);
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

        registerBootstrapScript: async function (aPath) {
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
                if (getThunderbirdVersion().major < 78) {
                  let element_addonPrefs = window.document.getElementById(self.menu_addonPrefs_id);
                  element_addonPrefs.addEventListener("popupshowing", self);
                } else {
                  // Add a tabmonitor, to be able to setup the options button/menu in the add-on manager.
                  self.getTabMail(window).registerTabMonitor(self.tabMonitor);
                  window[self.uniqueRandomID] = {};
                  window[self.uniqueRandomID].hasTabMonitor = true;
                  // Setup the options button/menu in the add-on manager, if it is already open.
                  let managerWindow = await self.getAddonManagerFromWindowWaitForLoad(window);
                  self.setupAddonManager(managerWindow, true);
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
    if (isAppShutdown) {
      return; // the application gets unloaded anyway
    }

    //remove our entry in the add-on options menu
    if (this.pathToOptionsPage) {
      for (let window of Services.wm.getEnumerator("mail:3pane")) {
        if (getThunderbirdVersion().major < 78) {
          let element_addonPrefs = window.document.getElementById(this.menu_addonPrefs_id);
          element_addonPrefs.removeEventListener("popupshowing", this);
          // Remove our entry.
          let entry = window.document.getElementById(this.menu_addonPrefs_id + "_" + this.uniqueRandomID);
          if (entry) entry.remove();
          // Do we have to unhide the noPrefsElement?
          if (element_addonPrefs.children.length == 1) {
            let noPrefsElem = element_addonPrefs.querySelector('[disabled="true"]');
            noPrefsElem.style.display = "inline";
          }
        } else {
          // Remove event listener for addon manager view changes
          let managerWindow = this.getAddonManagerFromWindow(window);
          if (
            managerWindow && 
            managerWindow[this.uniqueRandomID] && 
            managerWindow[this.uniqueRandomID].hasAddonManagerEventListeners
          ) {
            managerWindow.document.removeEventListener("ViewChanged", this);
            managerWindow.document.removeEventListener("update", this);
            managerWindow.document.removeEventListener("view-loaded", this);
            managerWindow[this.uniqueRandomID].hasAddonManagerEventListeners = false;

            let cards = this.getCards(managerWindow);
            if (getThunderbirdVersion().major < 88) {
              // Remove options menu in 78-87
              for (let card of cards) {
                let addonOptionsLegacyEntry = card.querySelector(".extension-options-legacy");
                if (addonOptionsLegacyEntry) addonOptionsLegacyEntry.remove();
              }
            } else {
              // Remove options button in 88
              for (let card of cards) {
                if (card.addon.id == this.extension.id) {
                  let addonOptionsButton = card.querySelector(".extension-options-button2");
                  if (addonOptionsButton) addonOptionsButton.remove();
                  break;
                }
              }
            }
          }

          // Remove tabmonitor
          if (window[this.uniqueRandomID].hasTabMonitor) {
            this.getTabMail(window).unregisterTabMonitor(this.tabMonitor);
            window[this.uniqueRandomID].hasTabMonitor = false;
          }

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

var BootstrapLoader = getThunderbirdVersion().major < 111
  ? BootstrapLoader_102
  : BootstrapLoader_115;
