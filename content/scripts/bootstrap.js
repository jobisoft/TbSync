/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");
var gExtension = null;
var gAddon = null;

function startup(addon, extension, browser) {
  gExtension = extension;
  gAddon = addon;
  
  let defaults = Services.prefs.getDefaultBranch("extensions.tbsync.");
  defaults.setBoolPref("debug.testoptions", false);
  defaults.setBoolPref("log.toconsole", false);
  defaults.setIntPref("log.userdatalevel", 0); //0 - off   1 - userdata only on errors   2 - including full userdata,  3 - extra infos

  // Check if at least one main window has finished loading
  let windows = Services.wm.getEnumerator("mail:3pane");
  if (windows.hasMoreElements()) {
    let domWindow = windows.getNext();
    WindowListener.waitForWindow(domWindow);
  }

  // Wait for any new windows to open.
  Services.wm.addListener(WindowListener);
  
  //DO NOT ADD ANYTHING HERE!
}


function shutdown(addon, extension, browser) {
  // Stop listening for any new windows to open.
  Services.wm.removeListener(WindowListener);

  TbSync.enabled = false;

  //unload TbSync module
  TbSync.dump("TbSync shutdown","Unloading TbSync modules.");
  TbSync.unload().then(function() {
    Cu.unload("chrome://tbsync/content/tbsync.jsm");
    Cu.unload("chrome://tbsync/content/HttpRequest.jsm");
    Cu.unload("chrome://tbsync/content/OverlayManager.jsm");
  });
}



var WindowListener = {

  async waitForWindow(window) {
    if (window.document.readyState != "complete") {
      // Make sure the window load has completed.
      await new Promise(resolve => {
        window.addEventListener("load", resolve, { once: true });
      });
    }

    // Check if the opened window is the one we want to modify.
    if (window.document.documentElement.getAttribute("windowtype") === "mail:3pane") {
      // the main window has loaded, continue with init
      if (!TbSync.enabled) TbSync.load(window, gAddon, gExtension);
    }
  },


  unloadFromWindow(window) {
  },

  // nsIWindowMediatorListener functions
  onOpenWindow(xulWindow) {
    // A new window has opened.
    let domWindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
    // The domWindow.document.documentElement.getAttribute("windowtype") is not set before the load, so we cannot check it here
    this.waitForWindow(domWindow);
  },

  onCloseWindow(xulWindow) {
  },

  onWindowTitleChange(xulWindow, newTitle) {
  },
};
