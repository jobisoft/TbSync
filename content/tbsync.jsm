/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var EXPORTED_SYMBOLS = ["TbSync"];

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { FileUtils } = ChromeUtils.import("resource://gre/modules/FileUtils.jsm");
var { OS }  =ChromeUtils.import("resource://gre/modules/osfile.jsm");
var { AddonManager } = ChromeUtils.import("resource://gre/modules/AddonManager.jsm");
var { NetUtil } = ChromeUtils.import("resource://gre/modules/NetUtil.jsm");
var { MailServices } = ChromeUtils.import("resource:///modules/MailServices.jsm");
var { OverlayManager } = ChromeUtils.import("chrome://tbsync/content/OverlayManager.jsm");

var TbSync = {

  enabled: false,
  shutdown: false,
  
  window: null,
  addon: null,
  version: 0,
  debugMode: false,
  apiVersion: "2.4",

  prefs: Services.prefs.getBranch("extensions.tbsync."),
  
  decoder: new TextDecoder(),
  encoder: new TextEncoder(),

  modules : [],
  extension : null,
  
  request: function (providerID, command, parameters) {
    return TbSync.notifyTools.notifyBackground({
      providerID:  TbSync.providers.loadedProviders[providerID].addonId,
      command,
      parameters
    });
  },

  // global load
  load: async function (window, addon, extension) {
	  //public module and IO module needs to be loaded beforehand
    Services.scriptloader.loadSubScript("chrome://tbsync/content/modules/public.js", this, "UTF-8");
    Services.scriptloader.loadSubScript("chrome://tbsync/content/modules/io.js", this, "UTF-8");
    Services.scriptloader.loadSubScript("chrome://tbsync/content/scripts/notifyTools/notifyTools.js", this, "UTF-8");
    this.notifyTools.enable();

    //clear debug log on start
    this.io.initFile("debug.log");

    this.window = window;
    this.addon = addon;
    this.addon.contributorsURL = "https://github.com/jobisoft/TbSync/blob/master/CONTRIBUTORS.md";
    this.extension = extension;
    this.dump("TbSync init","Start (" + this.addon.version.toString() + ")");

    //print information about Thunderbird version and OS
    this.dump(Services.appinfo.name, Services.appinfo.version + " on " + OS.Constants.Sys.Name);

    // register modules to be used by TbSync
    this.modules.push({name: "db", state: 0});
    this.modules.push({name: "abAutoComplete", state: 0});
    this.modules.push({name: "addressbook", state: 0});
    this.modules.push({name: "lightning", state: 0});
    this.modules.push({name: "cardbook", state: 0});
    this.modules.push({name: "eventlog", state: 0});
    this.modules.push({name: "core", state: 0});
    this.modules.push({name: "passwordManager", state: 0});
    this.modules.push({name: "network", state: 0});
    this.modules.push({name: "tools", state: 0});
    this.modules.push({name: "manager", state: 0});
    this.modules.push({name: "providers", state: 0});
    this.modules.push({name: "messenger", state: 0});

    //load modules
    for (let module of this.modules) {
      try {
        Services.scriptloader.loadSubScript("chrome://tbsync/content/modules/" + module.name + ".js", this, "UTF-8");
        module.state = 1;
        this.dump("Loading module <" + module.name + ">", "OK");
      } catch (e) {
        this.dump("Loading module <" + module.name + ">", "FAILED!");
        Components.utils.reportError(e);
      }
    }

    //call init function of loaded modules
    for (let module of this.modules) {
      if (module.state == 1) {
        try {
          this.dump("Initializing module", "<" + module.name + ">");
          await this[module.name].load();
          module.state = 2;
        } catch (e) {
          this.dump("Initialization of module <" + module.name + "> FAILED", e.message + "\n" + e.stack);
          Components.utils.reportError(e);
        }
      }
    }
    
    //was debug mode enabled during startup?
    this.debugMode = (this.prefs.getIntPref("log.userdatalevel") > 0);

    // Forward requests from the background page.
    this.notifyTools.registerListener(data => {
      switch (data.command) {
        case "loadProvider":
          TbSync.providers.loadProvider(data.providerID);
          break;
        case "unloadProvider":
          TbSync.providers.unloadProvider(data.providerID);
          break;

        // These are public functions callable by other add-ons / providers.
        // When TbSync modules are moved out of the legacy blob into the
        // WebExtension part, they could use these as well, so we only have
        // to maintain a single Interface.
        case "getAccountProperties":
        case "setAccountProperties":
        case "resetAccountProperties":
        case "getFolderProperties":
        case "setFolderProperties":
        case "resetFolderProperties":
        case "getAccountProperty":
        case "setAccountProperty":
        case "resetAccountProperty":
        case "getFolderProperty":
        case "setFolderProperty":
        case "resetFolderProperty":
        case "findFolders": 
          return TbSync.db[data.command](...data.parameters);
          
        case "getAllAccounts":
          return Object.keys(TbSync.db.accounts.data).filter(accountID => TbSync.db.accounts.data[accountID].provider == data.providerID).sort((a, b) => a - b);

        case "getAllFolders": 
          return TbSync.db.findFolders({"cached": false}, {"accountID":data.parameters[0]}).map(folder => folder.folderID);
      }
    });

    //enable TbSync
    this.enabled = true;
    this.notifyTools.notifyBackground({command: "enabled"});

    //notify about finished init of TbSync
    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);
    Services.obs.notifyObservers(null, 'tbsync.observer.initialized', null);

    //activate sync timer
    this.syncTimer.start();

    this.dump("TbSync init","Done");
  },
  
  // global unload
  unload: async function() {
    //cancel sync timer
    this.syncTimer.cancel();
    this.notifyTools.disable();    
	  
    //unload modules in reverse order
    this.modules.reverse();
    for (let module of this.modules) {
      if (module.state == 2) {
        try {
          await this[module.name].unload();
          this.dump("Unloading module <" + module.name + ">", "OK");
        } catch (e) {
          this.dump("Unloading module <" + module.name + ">", "FAILED!");
          Components.utils.reportError(e);
        }
      }
    }
  },

  // timer for periodic sync
  syncTimer: {
    timer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

    start: function () {
      this.timer.cancel();
      this.timer.initWithCallback(this.event, 60000, 3); //run timer every 60s
    },

    cancel: function () {
      this.timer.cancel();
    },

    event: {
      notify: function (timer) {
        if (TbSync.enabled) {
          //get all accounts and check, which one needs sync
          let accounts = TbSync.db.getAccounts();
          for (let i=0; i<accounts.IDs.length; i++) {
            let now = Date.now();
            let syncInterval = accounts.data[accounts.IDs[i]].autosync * 60 * 1000;
            let lastsynctime = accounts.data[accounts.IDs[i]].lastsynctime;
            let noAutosyncUntil = accounts.data[accounts.IDs[i]].noAutosyncUntil || 0;
            if (TbSync.core.isEnabled(accounts.IDs[i]) && (syncInterval > 0) && (now > (lastsynctime + syncInterval)) && (now > noAutosyncUntil)) {
                TbSync.core.syncAccount(accounts.IDs[i]);
            }
          }
        }
      }
    }
  }
};
