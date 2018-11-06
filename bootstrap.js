/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
//no need to create namespace, we are in a sandbox

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/Task.jsm");
Components.utils.import("resource://gre/modules/osfile.jsm");

let window = null;

//Observer to catch loading of thunderbird main window
let onLoadObserver = {
    observe: function(aSubject, aTopic, aData) {        
        if (window === null) {
            window = Services.wm.getMostRecentWindow("mail:3pane");
            if (window) {
                //init TbSync
                window.tbSync = tbSync;
                tbSync.init(window); 
            } else {
                tbSync.dump("FAIL", "Could not init TbSync, because mail:3pane window not found.");
            }
        }
    }
}

let onLoadDoneObserver = {
    observe: function(aSubject, aTopic, aData) {        
        forEachOpenWindow(loadIntoWindow);  
        Services.wm.addListener(WindowListener);
    }
}

function install(data, reason) {
}

function uninstall(data, reason) {
}

function startup(data, reason) {
    //Do not do anything, if version > 60
    if (Services.vc.compare(Services.appinfo.platformVersion, "60.*") <= 0)  {     
        //possible reasons: APP_STARTUP, ADDON_ENABLE, ADDON_INSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE.

        //set default prefs
        let branch = Services.prefs.getDefaultBranch("extensions.tbsync.");
        branch.setBoolPref("notify4beta", false);
        branch.setIntPref("updateCheckInterval", 6);
        branch.setIntPref("timeout", 90000);
        
        branch.setBoolPref("debug.testoptions", false);

        branch.setBoolPref("log.toconsole", false);
        branch.setBoolPref("log.tofile", false);
        branch.setIntPref("log.userdatalevel", 0); //0 - metadata (no incomming xml/wbxml, only parsed data without userdata (except failing items))   1 - including userdata,  2 - raw xml , 3 - raw wbxml

        branch.setIntPref("eas.synclimit", 7);
        branch.setIntPref("eas.maxitems", 50);
        branch.setCharPref("eas.clientID.type", "TbSync");
        branch.setCharPref("eas.clientID.useragent", "Thunderbird ActiveSync");    
        branch.setBoolPref("eas.fix4freedriven", false);

        Components.utils.import("chrome://tbsync/content/tbsync.jsm");
        Components.utils.import("chrome://tbsync/content/OverlayManager.jsm");

        //Map local writeAsyncJSON into tbSync
        tbSync.writeAsyncJSON = writeAsyncJSON;
        
        //add startup observers
        Services.obs.addObserver(onLoadObserver, "mail-startup-done", false);
        Services.obs.addObserver(onLoadObserver, "tbsync.init", false);
        Services.obs.addObserver(onLoadDoneObserver, "tbsync.init.done", false);

        tbSync.addonData = data;
        tbSync.overlayManager = new OverlayManager(data, {verbose:0});

        if (reason != APP_STARTUP) {
            //during startup, we wait until mail-startup-done fired, for all other reasons we need to fire our own init
            Services.obs.notifyObservers(null, 'tbsync.init', null)
        }
        
        //DO NOT ADD ANYTHING HERE!
        //The final init of TbSync was triggered by issuing a "tbsync.init". If that is done, it will issue a "tbsync.init.done".
        //So if there is stuff to do after init is done, add it at the local onLoadDoneObserver
    }
}

function shutdown(data, reason) {
    if (Services.vc.compare(Services.appinfo.platformVersion, "60.*") <= 0)  {     
        //possible reasons: APP_SHUTDOWN, ADDON_DISABLE, ADDON_UNINSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE    

        //remove startup observer
        Services.obs.removeObserver(onLoadObserver, "mail-startup-done");
        Services.obs.removeObserver(onLoadObserver, "tbsync.init");
        Services.obs.removeObserver(onLoadDoneObserver, "tbsync.init.done");
        
        //call cleanup of the tbSync module
        forEachOpenWindow(unloadFromWindow);
        Services.wm.removeListener(WindowListener);
        tbSync.cleanup();
        
        //abort write timers and write current file content to disk 
        if (tbSync.enabled) {
            tbSync.db.changelogTimer.cancel();
            tbSync.db.accountsTimer.cancel();
            tbSync.db.foldersTimer.cancel();
            writeAsyncJSON(tbSync.db.accounts, tbSync.db.accountsFile);
            writeAsyncJSON(tbSync.db.folders, tbSync.db.foldersFile);
            writeAsyncJSON(tbSync.db.changelog, tbSync.db.changelogFile);
        }

        //unload tbSync module
        tbSync.dump("TbSync shutdown","Unloading TbSync module.");
        Components.utils.unload("chrome://tbsync/content/tbsync.jsm");
        Components.utils.unload("chrome://tbsync/content/OverlayManager.jsm");
        
        // HACK WARNING:
        //  - the Addon Manager does not properly clear all addon related caches on update;
        //  - in order to fully update images and locales, their caches need clearing here
        Services.obs.notifyObservers(null, "chrome-flush-caches", null);
    }
}





function forEachOpenWindow(todo)  // Apply a function to all open windows
{
    var windows = Services.wm.getEnumerator(null);
    while (windows.hasMoreElements()) {
        todo(windows.getNext().QueryInterface(Components.interfaces.nsIDOMWindow));
    }
}

function loadIntoWindow(window) {
    //do not inject into main window, because we have done that in tbSync.init() to provide an option to the user to get the Ooops message, 
    //in case something went wrong during init (and we do not reach this point)
    if (window.location.href != "chrome://messenger/content/messenger.xul" && tbSync.overlayManager.hasRegisteredOverlays(window)) {
        window.tbSync = tbSync;
        tbSync.overlayManager.injectAllOverlays(window);
    }
}
    
function unloadFromWindow(window) {
    if (tbSync.overlayManager.hasRegisteredOverlays(window)) {
        tbSync.overlayManager.removeAllOverlays(window);
        window.tbSync = null;
    }
}

var WindowListener =
{
    onOpenWindow: function(xulWindow)
    {
        var window = xulWindow.QueryInterface(Components.interfaces.nsIInterfaceRequestor).getInterface(Components.interfaces.nsIDOMWindow);
        function onWindowLoad()
        {
            window.removeEventListener("load", onWindowLoad);
            loadIntoWindow(window);
        }
        window.addEventListener("load", onWindowLoad);
    },
    onCloseWindow: function(xulWindow) { },
    onWindowTitleChange: function(xulWindow, newTitle) { }
};

/* 
 could be replaced in TB61:
  - https://dxr.mozilla.org/comm-central/rev/18881dd127e3b0c0d3f97390c9094e309d4dd9c1/mail/test/resources/jsbridge/jsbridge/extension/bootstrap.js#17
  - https://dxr.mozilla.org/comm-central/rev/18881dd127e3b0c0d3f97390c9094e309d4dd9c1/common/src/extensionSupport.jsm#151
*/




function writeAsyncJSON (obj, filename) {
    let filepath = tbSync.getAbsolutePath(filename);
    let storageDirectory = tbSync.storageDirectory;
    let json = tbSync.encoder.encode(JSON.stringify(obj));
    
    //no tbSync function/methods inside spawn, because it could run after tbSync was unloaded
    Task.spawn(function* () {
        //MDN states, instead of checking if dir exists, just create it and catch error on exist (but it does not even throw)
        yield OS.File.makeDir(storageDirectory);
        yield OS.File.writeAtomic(filepath, json, {tmpPath: filepath + ".tmp"});
    }).catch(Components.utils.reportError);
}
