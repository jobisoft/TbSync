/* -*- Mode: javascript; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 ; js-indent-level: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */

/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/Task.jsm");
Components.utils.import("resource://gre/modules/osfile.jsm");

// observer to catch loading of thunderbird main window
let onLoadObserver = {
    observe: function(aSubject, aTopic, aData) {        
        let mainWindow = Services.wm.getMostRecentWindow("mail:3pane");
        if (mainWindow) {
            tbSync.load(mainWindow); 
        } else {
            tbSync.dump("FAIL", "Could not init TbSync, because mail:3pane window not found.");
        }
    }
}

function install(data, reason) {
}

function uninstall(data, reason) {
}

function startup(data, reason) {
    // do not do anything, if version > 60
    if (Services.vc.compare(Services.appinfo.platformVersion, "60.*") <= 0)  {     
        // possible reasons: APP_STARTUP, ADDON_ENABLE, ADDON_INSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE.

        // set default prefs
        let defaults = Services.prefs.getDefaultBranch("extensions.tbsync.");
        defaults.setIntPref("timeout", 90000);
        defaults.setBoolPref("debug.testoptions", false);

        defaults.setBoolPref("log.toconsole", false);
        defaults.setBoolPref("log.tofile", false);
        defaults.setIntPref("log.userdatalevel", 0); //0 - metadata only (except errors)   1 - including userdata,  2 - redacted xml , 3 - raw xml + wbxml

        Components.utils.import("chrome://tbsync/content/tbsync.jsm");
        
        //add startup observers
        Services.obs.addObserver(onLoadObserver, "mail-startup-done", false);

        if (reason != APP_STARTUP) {
            //during startup, we wait until mail-startup-done fired, for all other reasons we need to fire our own init
            onLoadObserver.observe();
        }
        
        //DO NOT ADD ANYTHING HERE!
        //If there is stuff to do after init is done, add it at the local onLoadDoneObserver
    }
}

function shutdown(data, reason) {
    //possible reasons: APP_SHUTDOWN, ADDON_DISABLE, ADDON_UNINSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE    
    if (Services.vc.compare(Services.appinfo.platformVersion, "60.*") <= 0)  {     
        tbSync.enabled = false;

        //remove startup observer
        Services.obs.removeObserver(onLoadObserver, "mail-startup-done");

        //unload tbSync module
        tbSync.dump("TbSync shutdown","Unloading TbSync modules.");
        tbSync.unload().then(function() {
            Components.utils.unload("chrome://tbsync/content/tbsync.jsm");
            Components.utils.unload("chrome://tbsync/content/OverlayManager.jsm");
            // HACK WARNING:
            //  - the Addon Manager does not properly clear all addon related caches on update;
            //  - in order to fully update images and locales, their caches need clearing here
            Services.obs.notifyObservers(null, "chrome-flush-caches", null);            
        });
    }
}
