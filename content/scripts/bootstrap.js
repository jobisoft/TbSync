/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

 
 function startup(data, reason) {
  // possible reasons: APP_STARTUP, ADDON_ENABLE, ADDON_INSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE.

  // set default prefs
  let defaults = Services.prefs.getDefaultBranch("extensions.tbsync.");
  defaults.setBoolPref("debug.testoptions", false);
  defaults.setBoolPref("log.toconsole", false);
  defaults.setIntPref("log.userdatalevel", 0); //0 - off   1 - userdata only on errors   2 - including full userdata,  3 - extra infos

  // Check if at least one main window has finished loading
  let windows = Services.wm.getEnumerator("mail:3pane");
  if (windows.hasMoreElements()) {
    let domWindow = windows.getNext();
    WindowListener.loadIntoWindow(domWindow);
  }

  // Wait for any new windows to open.
  Services.wm.addListener(WindowListener);
  
  //DO NOT ADD ANYTHING HERE!
}

function shutdown(data, reason) {
  //possible reasons: APP_SHUTDOWN, ADDON_DISABLE, ADDON_UNINSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE

  // Stop listening for any new windows to open.
  Services.wm.removeListener(WindowListener);

  var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");
  TbSync.enabled = false;
  TbSync.unload().then(function() {
    Cu.unload("chrome://tbsync/content/tbsync.jsm");
    Cu.unload("chrome://tbsync/content/OverlayManager.jsm");
    // HACK WARNING:
    //  - the Addon Manager does not properly clear all addon related caches on update;
    //  - in order to fully update images and locales, their caches need clearing here
    Services.obs.notifyObservers(null, "startupcache-invalidate");
    Services.obs.notifyObservers(null, "chrome-flush-caches"); 
  });
}


var WindowListener = {

  async loadIntoWindow(window) {
    if (window.document.readyState != "complete") {
      // Make sure the window load has completed.
      await new Promise(resolve => {
        window.addEventListener("load", resolve, { once: true });
      });
    }

    // Check if the opened window is the one we want to modify.
    if (window.document.documentElement.getAttribute("windowtype") === "mail:3pane") {
      // the main window has loaded, continue with init
      var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");
      if (!TbSync.enabled) TbSync.load(window, addon, extension);
    }
  },


  unloadFromWindow(window) {
  },

  // nsIWindowMediatorListener functions
  onOpenWindow(xulWindow) {
    // A new window has opened.
    let domWindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
    // The domWindow.document.documentElement.getAttribute("windowtype") is not set before the load, so we cannot check it here
    this.loadIntoWindow(domWindow);
  },

  onCloseWindow(xulWindow) {
  },

  onWindowTitleChange(xulWindow, newTitle) {
  },
};
