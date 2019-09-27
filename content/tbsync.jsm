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
  apiVersion: "2.2",

  bundle: Services.strings.createBundle("chrome://tbsync/locale/tbSync.properties"),
  prefs: Services.prefs.getBranch("extensions.tbsync."),
  
  decoder: new TextDecoder(),
  encoder: new TextEncoder(),

  modules : [],
  
  // global load
  load: async function (window) { 
    
    //public module and IO module needs to be loaded beforehand
    Services.scriptloader.loadSubScript("chrome://tbsync/content/modules/public.js", this, "UTF-8");
    Services.scriptloader.loadSubScript("chrome://tbsync/content/modules/io.js", this, "UTF-8");

    //clear debug log on start
    this.io.initFile("debug.log");

    this.window = window;
    this.addon = await AddonManager.getAddonByID("tbsync@jobisoft.de");
    this.dump("TbSync init","Start (" + this.addon.version.toString() + ")");

    //print information about Thunderbird version and OS
    this.dump(Services.appinfo.name, Services.appinfo.platformVersion + " on " + OS.Constants.Sys.Name);

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
          await this[module.name].load();
          module.state = 2;
          this.dump("Initializing module <" + module.name + ">", "OK");
        } catch (e) {
          this.dump("Initializing module <" + module.name + ">", "FAILED!");
          Components.utils.reportError(e);
        }
      }
    }
    
    //was debug mode enabled during startup?
    this.debugMode = (this.prefs.getIntPref("log.userdatalevel") > 0);

    //enable TbSync
    this.enabled = true;

    //notify about finished init of TbSync
    Services.obs.notifyObservers(null, 'tbsync.observer.initialized', null)

    //activate sync timer
    this.syncTimer.start();

    this.dump("TbSync init","Done");
  },
  
  // global unload
  unload: async function() {
    //cancel sync timer
    this.syncTimer.cancel();
    
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
            let syncInterval = accounts.data[accounts.IDs[i]].autosync * 60 * 1000;
            let lastsynctime = accounts.data[accounts.IDs[i]].lastsynctime;
            if (TbSync.core.isEnabled(accounts.IDs[i]) && (syncInterval > 0) && ((Date.now() - lastsynctime) > syncInterval)) {
              TbSync.core.syncAccount(accounts.IDs[i]);
            }
          }
        }
      }
    }
  }
};
