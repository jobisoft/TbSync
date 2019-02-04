/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var EXPORTED_SYMBOLS = ["tbSync"];

//global objects (not exported, not available outside this module)
const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/FileUtils.jsm");
Components.utils.import("resource://gre/modules/osfile.jsm");
Components.utils.import("resource://gre/modules/Task.jsm");
Components.utils.import("resource://gre/modules/AddonManager.jsm");
Components.utils.import("resource://gre/modules/NetUtil.jsm");
Components.utils.import("resource:///modules/mailServices.js")
Components.utils.importGlobalProperties(["XMLHttpRequest"]);





var tbSync = {

    enabled: false,
    window: null,
    
    lightning: null,
    cardbook: null,
    addon: null,
    
    version: 0,
    debugMode: false,
    
    lightningInitDone: false,

    errors: [],
    
    //list of default providers (available in add menu, even if not installed)
    defaultProviders: {
        "dav" : {
            name: "CalDAV & CardDAV", 
            homepageUrl: "https://addons.thunderbird.net/addon/dav-4-tbsync/"},
        "eas" : {
            name: "Exchange ActiveSync", 
            homepageUrl: "https://addons.thunderbird.net/addon/eas-4-tbsync/"},
    },
    loadedProviders: {},
    loadedProviderAddOns: {},

    bundle: Services.strings.createBundle("chrome://tbsync/locale/tbSync.strings"),

    prefWindowObj: null,
    passWindowObj: {}, //hold references to passWindows for every account
    
    decoder: new TextDecoder(),
    encoder: new TextEncoder(),

    prefSettings: Services.prefs.getBranch("extensions.tbsync."),

    storageDirectory : OS.Path.join(OS.Constants.Path.profileDir, "TbSync"),





    // GLOBAL INIT
    init: Task.async (function* (window)  { 

        //clear debug log on start
        tbSync.initFile("debug.log");

        tbSync.window = window;
        tbSync.addon = yield tbSync.getAddonByID("tbsync@jobisoft.de");
        tbSync.dump("TbSync init","Start (" + tbSync.addon.version.toString() + ")");

        Services.obs.addObserver(tbSync.initSyncObserver, "tbsync.initSync", false);
        Services.obs.addObserver(tbSync.syncstateObserver, "tbsync.updateSyncstate", false);
        Services.obs.addObserver(tbSync.syncstateObserver, "tbsync.init.done", false);

        // Inject UI before init finished, to give user the option to see Oops message and report bug
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/messenger.xul", "chrome://tbsync/content/overlays/messenger.xul");        
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/messengercompose/messengercompose.xul", "chrome://tbsync/content/overlays/messengercompose.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://tbsync/content/overlays/abServerSearch.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abContactsPanel.xul", "chrome://tbsync/content/overlays/abServerSearch.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://tbsync/content/overlays/addressbookoverlay.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abEditCardDialog.xul", "chrome://tbsync/content/overlays/abCardWindow.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://tbsync/content/overlays/abCardWindow.xul");
        
        tbSync.overlayManager.injectAllOverlays(tbSync.window);

        //print information about Thunderbird version and OS
        tbSync.dump(Services.appinfo.name, Services.appinfo.platformVersion + " on " + OS.Constants.Sys.Name);

        // load common subscripts into tbSync (each subscript will be able to access functions/members of other subscripts, loading order does not matter)
        tbSync.includeJS("chrome://tbsync/content/db.js");
        tbSync.includeJS("chrome://tbsync/content/abServerSearch.js");
        tbSync.includeJS("chrome://tbsync/content/abAutoComplete.js");

        //init DB
        yield tbSync.db.init();

        //init tbSync autocomplete in addressbook
        tbSync.abAutoComplete.init();
        
        //check for cardbook
        tbSync.cardbook = yield tbSync.getAddonByID("cardbook@vigneau.philippe") ;
        
        //check for lightning
        tbSync.lightning = yield tbSync.getAddonByID("{e2fda1a4-762b-4020-b5ad-a41df1933103}");
        if (tbSync.lightning !== null) {
            tbSync.dump("Check4Lightning","Start");

            //try to import
            if ("calICalendar" in Components.interfaces && typeof cal == 'undefined') {
                Components.utils.import("resource://calendar/modules/calUtils.jsm");
                Components.utils.import("resource://calendar/modules/ical.js");    
            }

            if (typeof cal !== 'undefined') {
                //adding a global observer
                cal.getCalendarManager().addCalendarObserver(tbSync.calendarObserver);
                cal.getCalendarManager().addObserver(tbSync.calendarManagerObserver);

                //indicate, that we have initialized 
                tbSync.lightningInitDone = true;
                tbSync.dump("Check4Lightning","Done");                            
            } else {
                tbSync.dump("Check4Lightning","Failed!");
            }
        }

        
        //init stuff for address book
        tbSync.addressbookListener.add();
        
        //was debug mode enabled during startuo?
        tbSync.debugMode = tbSync.prefSettings.getBoolPref("log.tofile");
        
        //enable TbSync
        tbSync.enabled = true;

        //notify others about finished init of TbSync
        Services.obs.notifyObservers(null, 'tbsync.init.done', null)

        //activate sync timer
        tbSync.syncTimer.start();

        tbSync.dump("TbSync init","Done");
    }),

    loadProvider:  Task.async (function* (addonId, provider, js) {
        //only load, if not yet loaded
        if (!tbSync.loadedProviders.hasOwnProperty(provider)) {
            try {
                //load provider subscripts into tbSync 
                tbSync.includeJS("chrome:" + js);

                //keep track of loaded providers of this provider add-on
                if (!tbSync.loadedProviderAddOns.hasOwnProperty(addonId)) {
                    let addon = yield tbSync.getAddonByID(addonId);
                    tbSync.loadedProviderAddOns[addonId] = {addon: addon, providers: []};
                }
                tbSync.loadedProviderAddOns[addonId].providers.push(provider);

                //Store some quick access data for each provider
                tbSync.loadedProviders[provider] = {};
                tbSync.loadedProviders[provider].addonId = addonId;
                tbSync.loadedProviders[provider].version = tbSync.loadedProviderAddOns[addonId].addon.version.toString();
                    
                //load provider
                yield tbSync[provider].load(tbSync.lightningIsAvailable());
                yield tbSync.overlayManager.registerOverlay("chrome://tbsync/content/manager/editAccount.xul?provider="+provider, tbSync[provider].getEditAccountOverlayUrl());        
                tbSync.dump("Loaded provider", provider + "::" + tbSync[provider].getNiceProviderName() + " ("+tbSync.loadedProviders[provider].version+")");
                tbSync.resetSync(provider);
                Services.obs.notifyObservers(null, "tbsync.updateAccountsList", provider);

            } catch (e) {
                tbSync.dump("FAILED to load provider", provider);
                throw e;
            }

        }
    }),

    unloadProviderAddon:  function (addonId) {
        
        //unload all loaded providers of this provider add-on
        if (tbSync.loadedProviderAddOns.hasOwnProperty(addonId) ) {
            for (let i=0; i < tbSync.loadedProviderAddOns[addonId].providers.length; i++) {
                let provider = tbSync.loadedProviderAddOns[addonId].providers[i];
                
                //only unload, if loaded
                if (tbSync.loadedProviders.hasOwnProperty(provider)) {
                    tbSync[provider].unload(tbSync.lightningIsAvailable());
                    tbSync[provider] = {};
                    delete tbSync.loadedProviders[provider];
                    Services.obs.notifyObservers(null, "tbsync.updateAccountsList", provider);                    
                    Services.obs.notifyObservers(null, "tbsync.updateSyncstate", provider);
                }
            }

            //remove all traces
            delete tbSync.loadedProviderAddOns[addonId];
        }
        
    },
    

    cleanup: function() {
        //cancel sync timer
        tbSync.syncTimer.cancel();

        //remove observer
        if (tbSync.enabled === true) {
            Services.obs.removeObserver(tbSync.syncstateObserver, "tbsync.updateSyncstate");
            Services.obs.removeObserver(tbSync.initSyncObserver, "tbsync.initSync");
            Services.obs.removeObserver(tbSync.syncstateObserver, "tbsync.init.done");

            //close window (if open)
            if (tbSync.prefWindowObj !== null) tbSync.prefWindowObj.close();

            //close all open password prompts
            for (var w in tbSync.passWindowObj) {
                if (tbSync.passWindowObj.hasOwnProperty(w) && tbSync.passWindowObj[w] !== null) {
                    tbSync.passWindowObj[w].close();
                }
            }
        
            //remove listener
            tbSync.addressbookListener.remove();

            //remove tbSync autocomplete
            tbSync.abAutoComplete.shutdown();

            if (tbSync.lightningIsAvailable()) {
                //removing global observer
                cal.getCalendarManager().removeCalendarObserver(tbSync.calendarObserver);
                cal.getCalendarManager().removeObserver(tbSync.calendarManagerObserver);

                //remove listeners on global sync buttons
                if (tbSync.window.document.getElementById("calendar-synchronize-button")) {
                    tbSync.window.document.getElementById("calendar-synchronize-button").removeEventListener("click", function(event){Services.obs.notifyObservers(null, 'tbsync.initSync', null);}, false);
                }
                if (tbSync.window.document.getElementById("task-synchronize-button")) {
                    tbSync.window.document.getElementById("task-synchronize-button").removeEventListener("click", function(event){Services.obs.notifyObservers(null, 'tbsync.initSync', null);}, false);
                }
            }
        }
    },

    openErrorLog: function (accountID = null, folderID = null) {
        tbSync.prefWindowObj.open("chrome://tbsync/content/manager/errorlog/errorlog.xul", "TbSyncErrorLog", "centerscreen,chrome,resizable");
    },

    openManagerWindow: function(event) {
        if (!event.button) { //catches 0 or undefined
            if (tbSync.enabled) {
                // check, if a window is already open and just put it in focus
                if (tbSync.prefWindowObj === null) {
                    tbSync.prefWindowObj = tbSync.window.open("chrome://tbsync/content/manager/accountManager.xul", "TbSyncAccountManagerWindow", "chrome,centerscreen");
                }
                tbSync.prefWindowObj.focus();
            } else {
                tbSync.popupNotEnabled();
            }
        }
    },

    popupNotEnabled: function () {
        tbSync.dump("Oops", "Trying to open account manager, but init sequence not yet finished");
        let msg = tbSync.getLocalizedMessage("OopsMessage") + "\n\n";
        let v = Services.appinfo.platformVersion; 
        if (Services.vc.compare(v, "60.*") <= 0 && Services.vc.compare(v, "52.0") >= 0) {
            if (!tbSync.prefSettings.getBoolPref("log.tofile")) {
                if (tbSync.window.confirm(msg + tbSync.getLocalizedMessage("UnableToTraceError"))) {
                    tbSync.prefSettings.setBoolPref("log.tofile", true);
                    tbSync.window.alert(tbSync.getLocalizedMessage("RestartThunderbirdAndTryAgain"));
                }
            } else {
                if (tbSync.window.confirm(msg + tbSync.getLocalizedMessage("HelpFixStartupError"))) {
                    tbSync.createBugReport("john.bieling@gmx.de", msg, "");
                }
            }
        } else {
            tbSync.window.alert(msg + tbSync.getLocalizedMessage("VersionOfThunderbirdNotSupported"));
        }
    },



    // OBSERVERS
    
    //Observer to catch changing syncstate and to update the status bar.
    syncstateObserver: {
        observe: function (aSubject, aTopic, aData) {
            //update status bar
            if (tbSync) {
                let status = tbSync.window.document.getElementById("tbsync.status");
                if (status) {

                    let label = "TbSync: ";

                    //check if any account is syncing, if not switch to idle
                    let accounts = tbSync.db.getAccounts();
                    let idle = true;
                    let err = false;
            
                    for (let i=0; i<accounts.allIDs.length && idle; i++) {
                        if (!accounts.IDs.includes(accounts.allIDs[i])) {
                            err = true;
                            continue;
                        }
            
                        //set idle to false, if at least one account is syncing
                        if (tbSync.isSyncing(accounts.allIDs[i])) idle = false;
                
                        //check for errors
                        switch (tbSync.db.getAccountSetting(accounts.allIDs[i], "status")) {
                            case "OK":
                            case "disabled":
                            case "notsyncronized":
                            case "nolightning":
                            case "syncing":
                                break;
                            default:
                                err = true;
                        }
                    }

                    if (idle) {
                        if (err) label +=tbSync.getLocalizedMessage("info.error");   
                        else label += tbSync.getLocalizedMessage("info.idle");   
                    } else {
                        label += tbSync.getLocalizedMessage("info.sync");
                    }
                    
                    status.label = label;
                }
            }
        }
    },
    
    //Observer to init sync
    initSyncObserver: {
        observe: function (aSubject, aTopic, aData) {
            if (tbSync.enabled) {
                tbSync.syncAccount('sync');
            } else {
                tbSync.popupNotEnabled();
            }
        }
    },



    // SYNC MANAGEMENT
    syncDataObj : {},

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
                if (tbSync.enabled) {
                    //get all accounts and check, which one needs sync
                    let accounts = tbSync.db.getAccounts();
                    for (let i=0; i<accounts.IDs.length; i++) {
                        let syncInterval = accounts.data[accounts.IDs[i]].autosync * 60 * 1000;
                        let lastsynctime = accounts.data[accounts.IDs[i]].lastsynctime;
                        
                        if (tbSync.isEnabled(accounts.IDs[i]) && (syncInterval > 0) && ((Date.now() - lastsynctime) > syncInterval)) {
                        tbSync.syncAccount("sync",accounts.IDs[i]);
                        }
                    }
                }
            }
        }
    },

    lightningIsAvailable: function () {
        //if it is known - and still valid - just return true
        return (tbSync.lightningInitDone && typeof cal !== 'undefined');
    },

    //used by UI to find out, if this account is beeing synced
    isSyncing: function (account) {
        let status = tbSync.db.getAccountSetting(account, "status"); //global status of the account
        return (status == "syncing");
    },
    
    isEnabled: function (account) {
        let status = tbSync.db.getAccountSetting(account, "status");
        return  (status != "disabled");
    },

    isConnected: function (account) {
        let status = tbSync.db.getAccountSetting(account, "status");
        let folders =  tbSync.db.getFolders(account);
        //check for well defined cached state
        let numberOfValidFolders = Object.keys(folders).filter(f => folders[f].cached == "0").length;
        return (status != "disabled" && numberOfValidFolders > 0);
    },
    
    prepareSyncDataObj: function (account, forceResetOfSyncData = false) {
        if (!tbSync.syncDataObj.hasOwnProperty(account)) {
            tbSync.syncDataObj[account] = new Object();          
        }
        
        if (forceResetOfSyncData) {
            tbSync.syncDataObj[account] = {};
        }
    
        tbSync.syncDataObj[account].account = account;
        tbSync.syncDataObj[account].provider = tbSync.db.getAccountSetting(account, "provider");
    },
    
    getSyncData: function (account, field = "") {
        tbSync.prepareSyncDataObj(account);
        if (field == "") {
            //return entire syncdata obj
            return tbSync.syncDataObj[account];
        } else {
            //return the reqested field with fallback value
            if (tbSync.syncDataObj[account].hasOwnProperty(field)) {
                return tbSync.syncDataObj[account][field];
            } else {
                return "";
            }
        }
    },
        
    setSyncData: function (account, field, value) {
        tbSync.prepareSyncDataObj(account);
        tbSync.syncDataObj[account][field] = value;
    },

    syncAccount: function (job, account = "", folderID = "") {
        //get info of all accounts
        let accounts = tbSync.db.getAccounts();

        //if no account given, loop over all accounts, otherwise only use the provided one
        let accountsToDo = [];        
        if (account == "") {
            //add all enabled accounts to the queue
            for (let i=0; i < accounts.IDs.length; i++) {
                accountsToDo.push(accounts.IDs[i]);
            }
        } else {
            accountsToDo.push(account);
        }
        
        //update gui
        for (let i = 0; i < accountsToDo.length; i++) {
            //do not init sync if there is a sync running or account is not enabled
            if (!tbSync.isEnabled(accountsToDo[i]) || tbSync.isSyncing(accountsToDo[i])) continue;

            //create syncdata object for each account (to be able to have parallel XHR)
            tbSync.prepareSyncDataObj(accountsToDo[i], true);
            
            tbSync.db.setAccountSetting(accountsToDo[i], "status", "syncing");
            tbSync.setSyncData(accountsToDo[i], "syncstate",  "syncing");            
            tbSync.setSyncData(accountsToDo[i], "folderID", folderID);            
            //send GUI into lock mode (syncstate == syncing)
            Services.obs.notifyObservers(null, "tbsync.updateAccountSettingsGui", accountsToDo[i]);
            
            tbSync[tbSync.db.getAccountSetting(accountsToDo[i], "provider")].start(tbSync.getSyncData(accountsToDo[i]), job);
        }
        
    },
   
    resetSync: function (provider = null) {
        //get all accounts and set all with syncing status to notsyncronized
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i<accounts.IDs.length; i++) {
            if (provider === null || tbSync.loadedProviders.hasOwnProperty(accounts.data[accounts.IDs[i]].provider)) {
                //reset sync objects
                tbSync.prepareSyncDataObj(accounts.IDs[i], true);
                //set all accounts which are syncing to notsyncronized 
                if (accounts.data[accounts.IDs[i]].status == "syncing") tbSync.db.setAccountSetting(accounts.IDs[i], "status", "notsyncronized");

                // set each folder with PENDING status to ABORTED
                let folders = tbSync.db.findFoldersWithSetting("status", "pending", accounts.IDs[i]);
                for (let f=0; f < folders.length; f++) {
                    tbSync.db.setFolderSetting(accounts.IDs[i], folders[f].folderID, "status", "aborted");
                }
                
                //end current sync and switch to idle
                tbSync.setSyncState("accountdone", accounts.IDs[i]); 
            }
        }
    },

    setTargetModified : function (folder) {
        if (/*folder.status == "OK" && */ tbSync.isEnabled(folder.account)) {
            tbSync.db.setAccountSetting(folder.account, "status", "notsyncronized");
            tbSync.db.setFolderSetting(folder.account, folder.folderID, "status", "modified");
            //notify settings gui to update status
             Services.obs.notifyObservers(null, "tbsync.updateSyncstate", folder.account);
        }
    },

    //returns if item is todo, event, contactcard or something else
    getItemType: function (aItem) {        
        if (aItem instanceof Components.interfaces.nsIAbCard) {
            return "tb-contact"
        } else {
            if (cal.item.isEvent(aItem)) return "tb-event";
            if (cal.item.isToDo(aItem)) return "tb-todo";
        }
        return "unknown";
    },

    //actually remove address books / calendars from TB, based on TB type
    removeTarget: function(target, type) {
        switch (type) {
            case "tb-event":
            case "tb-todo":
                tbSync.removeCalendar(target);
                break;
            case "tb-contact":
                tbSync.removeBook(target);
                break;
            default:
                tbSync.dump("tbSync.removeTarget","Unknown type <"+type+">");
        }
    },
    
    //rename target, clear changelog (and remove from DB)
    takeTargetOffline: function(provider, folder, suffix, deleteFolder = true) {
        //decouple folder and target
        let target = folder.target;
        tbSync.db.resetFolderSetting(folder.account, folder.folderID, "target");

        if (target != "") {
            //if there are local changes, append an  (*) to the name of the target
            let c = 0;
            let a = tbSync.db.getItemsFromChangeLog(target, 0, "_by_user");
            for (let i=0; i<a.length; i++) c++;
            if (c>0) suffix += " (*)";

            //this is the only place, where we manually have to call clearChangelog, because the target is not deleted
            //(on delete, changelog is cleared automatically)
            tbSync.db.clearChangeLog(target);
            if (suffix) {
                switch (tbSync[provider].getThunderbirdFolderType(folder.type)) {
                    case "tb-event":
                    case "tb-todo":
                        tbSync.changeNameOfCalendarAndDisable(target, "Local backup of: %ORIG% " + suffix);
                        break;
                    case "tb-contact":
                        tbSync.changeNameOfBook(target, "Local backup of: %ORIG% " + suffix);
                        break;
                    default:
                        tbSync.dump("tbSync.takeTargetOffline","Unknown type <"+folder.type+">");
                }
            }
            
            if (deleteFolder) tbSync.db.deleteFolder(folder.account, folder.folderID);            
        }
    },

    getSyncStatusMsg: function (folder, syncdata, provider) {
        let status = "";
        
        if (folder.selected == "1") {
            //default
            status = tbSync.getLocalizedMessage("status." + folder.status, provider).split("||")[0];

            switch (folder.status.split(".")[0]) { //the status may have a sub-decleration
                case "OK":
                case "modified":
                    switch (tbSync[provider].getThunderbirdFolderType(folder.type)) {
                        case "tb-todo": 
                        case "tb-event": 
                            status = tbSync.lightningIsAvailable() ? status + ": "+ tbSync.getCalendarName(folder.target) : tbSync.getLocalizedMessage("status.nolightning", provider);
                            break;
                        case "tb-contact": 
                            status =status + ": "+ tbSync.getAddressBookName(folder.target);
                            break;
                    }
                    break;
                    
                case "pending":
                    if (syncdata && folder.folderID == syncdata.folderID) {
                        //syncing (there is no extra state for this)
                        status = tbSync.getLocalizedMessage("status.syncing", provider);
                        if (["send","eval","prepare"].includes(syncdata.syncstate.split(".")[0]) && (syncdata.todo + syncdata.done) > 0) {
                            //add progress information
                            status = status + " (" + syncdata.done + (syncdata.todo > 0 ? "/" + syncdata.todo : "") + ")"; 
                        }
                    }

                    break;            
            }
        } else {
            //remain empty if not selected
        }        

        return status;
    },

    finishAccountSync: function (syncdata, error) {
        // set each folder with PENDING status to ABORTED
        let folders = tbSync.db.findFoldersWithSetting("status", "pending", syncdata.account);
        for (let i=0; i < folders.length; i++) {
            tbSync.db.setFolderSetting(syncdata.account, folders[i].folderID, "status", "aborted");
        }

        //update account status
        let status = "OK";
        if (error.type == "JavaScriptError") {
            status = error.type;
            tbSync.errorlog("warning", syncdata, status, error.message + "\n\n" + error.stack);
        } else if (!error.failed) {
            //account itself is ok, search for folders with error
            folders = tbSync.db.findFoldersWithSetting("selected", "1", syncdata.account);
            for (let i in folders) {
                let folderstatus = folders[i].status.split(".")[0];
                if (folderstatus != "" && folderstatus != "OK" && folderstatus != "aborted") {
                    status = "foldererror";
                    break;
                }
            }
        } else {
            status = error.message;
            //log this error, if it has not been logged already
            if (!error.logged) { 
                tbSync.errorlog("warning", syncdata, status, error.details ? error.details : null);
            }
        }
        
        //done
        tbSync.db.setAccountSetting(syncdata.account, "lastsynctime", Date.now());
        tbSync.db.setAccountSetting(syncdata.account, "status", status);
        tbSync.setSyncState("accountdone", syncdata.account); 
    },

    finishFolderSync: function (syncdata, error) {
        //a folder has been finished, update status
        let time = Date.now();
        let status = "OK";

        if (error.type == "JavaScriptError") {
            status = error.type;
            time = "";
            //do not log javascript errors here, let finishAccountSync handle that
        } else if (error.failed) {
            status = error.message;
            time = "";
            tbSync.errorlog("warning", syncdata, status, error.details ? error.details : null);
            //set this error as logged so it does not get logged again by finishAccountSync in case of re-throw
            error.logged = true;
        } else {
            //succeeded, but custom msg?
            if (error.message) {
                status = error.message;
            }
        }

        if (syncdata.folderID != "") {
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "status", status);
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "lastsynctime", time);
        } 

        tbSync.setSyncState("done", syncdata.account);
    },
    
    setSyncState: function (syncstate, account = "", folderID = "") {
        //set new syncstate
        let msg = "State: " + syncstate;
        if (account !== "") msg += ", Account: " + tbSync.db.getAccountSetting(account, "accountname");
        if (folderID !== "") msg += ", Folder: " + tbSync.db.getFolderSetting(account, folderID, "name");

        if (account && syncstate.split(".")[0] == "send") {
            //add timestamp to be able to display timeout countdown
            syncstate = syncstate + "||" + Date.now();
        }

        tbSync.setSyncData(account, "syncstate", syncstate);
        tbSync.dump("setSyncState", msg);

        Services.obs.notifyObservers(null, "tbsync.updateSyncstate", account);
    },



    enableAccount: function(account) {
        let provider = tbSync.db.getAccountSetting(account, "provider");
        tbSync[provider].onEnableAccount(account);
        tbSync.db.setAccountSetting(account, "status", "notsyncronized");
    },

    disableAccount: function(account) {
        let provider = tbSync.db.getAccountSetting(account, "provider");
        tbSync[provider].onDisableAccount(account);
        tbSync.db.setAccountSetting(account, "status", "disabled");
        
        let folders = tbSync.db.getFolders(account);
        for (let i in folders) {
            //cache folder - this must be done before removing the folder to be able to differ between "deleted by user" and "deleted by disable"
            tbSync.db.setFolderSetting(folders[i].account, folders[i].folderID, "cached", "1");

            let target = folders[i].target;
            let type = tbSync[provider].getThunderbirdFolderType(folders[i].type);            
            if (target != "") {
                //remove associated target and clear its changelog
                tbSync.removeTarget(target, type);
            }
        }
    },

    //set all selected folders to "pending", so they are marked for syncing 
    //this also removes all leftover cached folders and sets all other folders to a well defined cached = "0"
    //which will set this account as connected (if at least one folder with cached == "0" is present)
    prepareFoldersForSync: function(account) {
        let folders = tbSync.db.getFolders(account);
        for (let f in folders) {
            //delete all leftover cached folders
            if (folders[f].cached == "1") {
                tbSync.db.deleteFolder(folders[f].account, folders[f].folderID);
                continue;
            } else {
                //set well defined cache state
                tbSync.db.setFolderSetting(folders[f].account, folders[f].folderID, "cached", "0");
            }

            //set selected folders to pending, so they get synced
            if (folders[f].selected == "1") {
                tbSync.db.setFolderSetting(folders[f].account, folders[f].folderID, "status", "pending");
            }
        }
    },




    // TOOLS    

    // Promisified implementation AddonManager.getAddonByID() (only needed in TB60)
    getAddonByID  : Task.async (function* (id) {        
        return new Promise(function(resolve, reject) {
            function callback (addon) {
                resolve(addon);
            }
            AddonManager.getAddonByID(id, callback);
        })
    }),

    isString: function (s) {
        return (typeof s == 'string' || s instanceof String);
    },
    
    openTBtab: function (url) {
        let tabmail = null;
        if (tbSync.window) {
            tabmail = tbSync.window.document.getElementById("tabmail");
            tbSync.window.focus();
            tabmail.openTab("contentTab", {
                contentPage: url
            });
        }
        return (tabmail !== null);
    },

    openTranslatedLink: function (url) {
        let googleCode = tbSync.getLocalizedMessage("google.translate.code");
        if (googleCode != "en" && googleCode != "google.translate.code") {
            tbSync.openLink("https://translate.google.com/translate?hl=en&sl=en&tl="+tbSync.getLocalizedMessage("google.translate.code")+"&u="+url);
        } else {
            tbSync.openLink(url);
        }
    },

    openLink: function (url) {
        let ioservice = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);
        let uriToOpen = ioservice.newURI(url, null, null);
        let extps = Components.classes["@mozilla.org/uriloader/external-protocol-service;1"].getService(Components.interfaces.nsIExternalProtocolService);
        extps.loadURI(uriToOpen, null);    
    },

    openFileTab: function (file) {
        return tbSync.openTBtab(tbSync.getAbsolutePath(file));
    },
    
    prepareBugReport: function () {
        if (Services.vc.compare(Services.appinfo.platformVersion, "60.*") <= 0 && Services.vc.compare(Services.appinfo.platformVersion, "52.0") >= 0) {
            if (!tbSync.debugMode) {
                tbSync.prefWindowObj.alert(tbSync.getLocalizedMessage("NoDebugLog"));
            } else {
                tbSync.prefWindowObj.openDialog("chrome://tbsync/content/manager/support-wizard/support-wizard.xul", "support-wizard", "dialog,centerscreen,chrome,resizable=no");
            }
        } else {
            tbSync.prefWindowObj.alert(tbSync.getLocalizedMessage("VersionOfThunderbirdNotSupported"));
        }
    },
    
    createBugReport: function (email, subject, description) {
        let fields = Components.classes["@mozilla.org/messengercompose/composefields;1"].createInstance(Components.interfaces.nsIMsgCompFields); 
        let params = Components.classes["@mozilla.org/messengercompose/composeparams;1"].createInstance(Components.interfaces.nsIMsgComposeParams); 

        fields.to = email; 
        fields.subject = "TbSync " + tbSync.addon.version.toString() + " bug report: " + subject; 
        fields.body = "Hi,\n\n" +
            "attached you find my debug.log for the following error:\n\n" + 
            description; 

        params.composeFields = fields; 
        params.format = Components.interfaces.nsIMsgCompFormat.PlainText; 

        let attachment = Components.classes["@mozilla.org/messengercompose/attachment;1"].createInstance(Components.interfaces.nsIMsgAttachment);
        attachment.contentType = "text/plain";
        attachment.url =  'file://' + tbSync.getAbsolutePath("debug.log");
        attachment.name = "debug.log";
        attachment.temporary = false;

        params.composeFields.addAttachment(attachment);        
        MailServices.compose.OpenComposeWindowWithParams (null, params);    
    },
    
    getHost4PasswordManager: function (provider, url) {
        let uri = Services.io.newURI("http://" + url.replace("https://","").replace("http://",""));
        return provider + "://" + uri.host;
    },

    setLoginInfo: function(origin, realm, user, password) {
        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");

        //remove any existing entry
        let logins = Services.logins.findLogins({}, origin, null, realm);
        for (let i = 0; i < logins.length; i++) {
            if (logins[i].username == user) {
                let currentLoginInfo = new nsLoginInfo(origin, null, realm, user, logins[i].password, "", "");
                try {
                    Services.logins.removeLogin(currentLoginInfo);
                } catch (e) {
                    tbSync.dump("Error removing loginInfo", e);
                }
            }
        }
        
        let newLoginInfo = new nsLoginInfo(origin, null, realm, user, password, "", "");
        try {
            Services.logins.addLogin(newLoginInfo);
        } catch (e) {
            tbSync.dump("Error adding loginInfo", e);
        }
    },
    
    getLoginInfo: function(origin, realm, user) {
        let logins = Services.logins.findLogins({}, origin, null, realm);
        for (let i = 0; i < logins.length; i++) {
            if (logins[i].username == user) {
                return logins[i].password;
            }
        }
        return null;
    },
    
    getAbsolutePath: function(filename) {
        return OS.Path.join(tbSync.storageDirectory, filename);
    },

    includeJS: function (file, that=this) {
        Services.scriptloader.loadSubScript(file, that, "UTF-8");
    },

    //async sleep function using Promise to postpone actions to keep UI responsive
    sleep : function (_delay, useRequestIdleCallback = true) {
        let useIdleCallback = false;
        let delay = _delay;
        if (tbSync.window.requestIdleCallback && useRequestIdleCallback) {
            useIdleCallback = true;
            delay= 2;
        }
        let timer =  Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
        
        return new Promise(function(resolve, reject) {
            let event = {
                notify: function(timer) {
                    if (useIdleCallback) {
                        tbSync.window.requestIdleCallback(resolve);                        
                    } else {
                        resolve();
                    }
                }
            }            
            timer.initWithCallback(event, delay, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
        });
    },

    //this is derived from: http://jonisalonen.com/2012/from-utf-16-to-utf-8-in-javascript/
    //javascript strings are utf16, btoa needs utf8 , so we need to encode
    toUTF8: function (str) {
        var utf8 = "";
        for (var i=0; i < str.length; i++) {
            var charcode = str.charCodeAt(i);
            if (charcode < 0x80) utf8 += String.fromCharCode(charcode);
            else if (charcode < 0x800) {
                utf8 += String.fromCharCode(0xc0 | (charcode >> 6), 
                          0x80 | (charcode & 0x3f));
            }
            else if (charcode < 0xd800 || charcode >= 0xe000) {
                utf8 += String.fromCharCode(0xe0 | (charcode >> 12), 
                          0x80 | ((charcode>>6) & 0x3f), 
                          0x80 | (charcode & 0x3f));
            }

            // surrogate pair
            else {
                i++;
                // UTF-16 encodes 0x10000-0x10FFFF by
                // subtracting 0x10000 and splitting the
                // 20 bits of 0x0-0xFFFFF into two halves
                charcode = 0x10000 + (((charcode & 0x3ff)<<10)
                          | (str.charCodeAt(i) & 0x3ff))
                utf8 += String.fromCharCode(0xf0 | (charcode >>18), 
                          0x80 | ((charcode>>12) & 0x3f), 
                          0x80 | ((charcode>>6) & 0x3f), 
                          0x80 | (charcode & 0x3f));
            }
        }
        return utf8;
    },
    
    b64encode: function (str) {
        return btoa(tbSync.toUTF8(str));
    },

    getLocalizedMessage: function (msg, provider = "") {
        let localized = msg;
        let parts = msg.split("::");

        let bundle = (provider == "") ? tbSync.bundle : tbSync[provider].bundle;
            
        try {
            //spezial treatment of strings with :: like status.httperror::403
            localized = bundle.GetStringFromName(parts[0]);
            for (let i = 0; i<parts.length; i++) {
                let regex = new RegExp( "##replace\."+i+"##", "g");
                localized = localized.replace(regex, parts[i]);
            }
        } catch (e) {}

        return localized;
    },

    dump: function (what, aMessage) {
        if (tbSync.prefSettings.getBoolPref("log.toconsole")) {
            Services.console.logStringMessage("[TbSync] " + what + " : " + aMessage);
        }
        
        if (tbSync.prefSettings.getBoolPref("log.tofile")) {
            let now = new Date();
            tbSync.appendToFile("debug.log", "** " + now.toString() + " **\n[" + what + "] : " + aMessage + "\n\n");
        }
    },

    //from syncdata this uses account and folderID
    errorlog: function (type, syncdata, message, details = null) {
        let entry = {
            timestamp: Date.now(),
            message: message, 
            type: type,
            link: null, 
            details: details
        };
    
        if (syncdata && syncdata.account) {
            entry.account = syncdata.account;
            entry.provider = tbSync.db.getAccountSetting(syncdata.account, "provider");
            entry.accountname = tbSync.db.getAccountSetting(syncdata.account, "accountname");
            entry.foldername = (syncdata.folderID) ? tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name") : "";
        } else {
            if (syncdata.provider) entry.provider = syncdata.provider
            if (syncdata.accountname) entry.accountname = syncdata.accountname
            if (syncdata.foldername) entry.foldername = syncdata.foldername
        }

        let localized = "";
        let link = "";        
        if (entry.provider) {
            localized = tbSync.getLocalizedMessage("status." + message, entry.provider);
            link = tbSync.getLocalizedMessage("helplink." + message, entry.provider);
        } else {
            //try to get localized string from message from tbSync
            localized = tbSync.getLocalizedMessage("status." + message);
            link = tbSync.getLocalizedMessage("helplink." + message);
        }
    
        //can we provide a localized version of the error msg?
        if (localized != "status."+message) {
            entry.message = localized;
        }

        //is there a help link?
        if (link != "helplink." + message) {
            entry.link = link;
        }

        //dump the non-localized message into debug log
        tbSync.dump("ErrorLog", message + (entry.details !== null ? "\n" + entry.details : ""));
        tbSync.errors.push(entry);
        if (tbSync.errors.length > 100) tbSync.errors.shift();
        Services.obs.notifyObservers(null, "tbSyncErrorLog.update", null);
    },

    getIdentityKey: function (email) {
        let acctMgr = Components.classes["@mozilla.org/messenger/account-manager;1"].getService(Components.interfaces.nsIMsgAccountManager);
        let accounts = acctMgr.accounts;
        for (let a = 0; a < accounts.length; a++) {
            let account = accounts.queryElementAt(a, Components.interfaces.nsIMsgAccount);
            if (account.defaultIdentity && account.defaultIdentity.email == email) return account.defaultIdentity.key;
        }
        return "";
    },            

    initFile: function (filename) {
        let file = FileUtils.getFile("ProfD", ["TbSync",filename]);
        //create a stream to write to that file
        let foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
        foStream.init(file, 0x02 | 0x08 | 0x20, parseInt("0666", 8), 0); // write, create, truncate
        foStream.close();
    },

    appendToFile: function (filename, data) {
        let file = FileUtils.getFile("ProfD", ["TbSync",filename]);
        //create a strem to write to that file
        let foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
        foStream.init(file, 0x02 | 0x08 | 0x10, parseInt("0666", 8), 0); // write, create, append
        foStream.write(data, data.length);
        foStream.close();
    },
    
    //XHR FUNCTIONS
    createTCPErrorFromFailedXHR: function (xhr) {
        return tbSync.createTCPErrorFromFailedChannel(xhr.channel.QueryInterface(Components.interfaces.nsIRequest));
    },
    
    createTCPErrorFromFailedChannel: function (request) {
        //adapted from :
        //https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/How_to_check_the_secruity_state_of_an_XMLHTTPRequest_over_SSL		
        let status = request.status;

        if ((status & 0xff0000) === 0x5a0000) { // Security module
            const nsINSSErrorsService = Components.interfaces.nsINSSErrorsService;
            let nssErrorsService = Components.classes['@mozilla.org/nss_errors_service;1'].getService(nsINSSErrorsService);
            
            // NSS_SEC errors (happen below the base value because of negative vals)
            if ((status & 0xffff) < Math.abs(nsINSSErrorsService.NSS_SEC_ERROR_BASE)) {

                // The bases are actually negative, so in our positive numeric space, we
                // need to subtract the base off our value.
                let nssErr = Math.abs(nsINSSErrorsService.NSS_SEC_ERROR_BASE) - (status & 0xffff);
                switch (nssErr) {
                    case 11: return 'security::SEC_ERROR_EXPIRED_CERTIFICATE';
                    case 12: return 'security::SEC_ERROR_REVOKED_CERTIFICATE';
                    case 13: return 'security::SEC_ERROR_UNKNOWN_ISSUER';
                    case 20: return 'security::SEC_ERROR_UNTRUSTED_ISSUER';
                    case 21: return 'security::SEC_ERROR_UNTRUSTED_CERT';
                    case 36: return 'security::SEC_ERROR_CA_CERT_INVALID';
                    case 90: return 'security::SEC_ERROR_INADEQUATE_KEY_USAGE';
                    case 176: return 'security::SEC_ERROR_CERT_SIGNATURE_ALGORITHM_DISABLED';
                }
                return 'security::UNKNOWN_SECURITY_ERROR';
                
            } else {

                // Calculating the difference 		  
                let sslErr = Math.abs(nsINSSErrorsService.NSS_SSL_ERROR_BASE) - (status & 0xffff);		
                switch (sslErr) {
                    case 3: return 'security::SSL_ERROR_NO_CERTIFICATE';
                    case 4: return 'security::SSL_ERROR_BAD_CERTIFICATE';
                    case 8: return 'security::SSL_ERROR_UNSUPPORTED_CERTIFICATE_TYPE';
                    case 9: return 'security::SSL_ERROR_UNSUPPORTED_VERSION';
                    case 12: return 'security::SSL_ERROR_BAD_CERT_DOMAIN';
                }
                return 'security::UNKOWN_SSL_ERROR';
              
            }

        } else { //not the security module
            
            switch (status) {
                case 0x804B000C: return 'network::NS_ERROR_CONNECTION_REFUSED';
                case 0x804B000E: return 'network::NS_ERROR_NET_TIMEOUT';
                case 0x804B001E: return 'network::NS_ERROR_UNKNOWN_HOST';
                case 0x804B0047: return 'network::NS_ERROR_NET_INTERRUPT';
            }
            return 'network::UNKNOWN_NETWORK_ERROR';

        }
        return null;	 
    },





    // ADDRESS BOOK FUNCTIONS
    addressbookListener: {

        //if a contact in one of the synced books is modified, update status of target and account
        onItemPropertyChanged: function addressbookListener_onItemPropertyChanged(aItem, aProperty, aOldValue, aNewValue) {
            // change on book itself, or on card?
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                let folders =  tbSync.db.findFoldersWithSetting(["target"], [aItem.URI]); //changelog is not used here, we should always catch these changes
                if (folders.length == 1) {
                    //store current/new name of target
                    tbSync.db.setFolderSetting(folders[0].account, folders[0].folderID, "targetName", tbSync.getAddressBookName(folders[0].target));                         
                    //update settings window, if open
                     Services.obs.notifyObservers(null, "tbsync.updateSyncstate", folders[0].account);
                }
            }

            if (aItem instanceof Components.interfaces.nsIAbCard) {
                let aParentDirURI = tbSync.getUriFromDirectoryId(aItem.directoryId);
                if (aParentDirURI) { //could be undefined
                    let folders = tbSync.db.findFoldersWithSetting(["target","useChangeLog"], [aParentDirURI,"1"]);
                    if (folders.length == 1) {

                        let cardId = tbSync.getPropertyOfCard(aItem, "TBSYNCID");
                        
                        if (aItem.isMailList) {
                            if (cardId) {
                                let itemStatus = tbSync.db.getItemStatusFromChangeLog(aParentDirURI, cardId);
                                if (itemStatus == "locked_by_mailinglist_operations") {
                                    //Mailinglist operations from the server side produce tons of notifications on the added/removed cards and
                                    //we cannot precatch all of them, so a special lock mode (locked_by_mailinglist_operations) is used to
                                    //disable notifications during these operations.
                                    //The last step of such a Mailinglist operation is to actually write the modifications into the mailListCard,
                                    //which will trigger THIS notification, which we use to unlock all cards again.
                                    tbSync.db.removeAllItemsFromChangeLogWithStatus(aParentDirURI, "locked_by_mailinglist_operations");
                                    
                                    //We do not care at all about notifications for ML, because we get notifications for its members. The only
                                    //purpose of locked_by_mailinglist_operations is to supress the local modification status when the server is
                                    //updating mailinglists
                                    
                                    //We have to manually check on each sync, if the ML data actually changed.
                                }
                            }

                        } else {
                            //THIS CODE ONLY ACTS ON TBSYNC CARDS
                            if (cardId) {
                                //Problem: A card modified by server should not trigger a changelog entry, so they are pretagged with modified_by_server
                                let itemStatus = tbSync.db.getItemStatusFromChangeLog(aParentDirURI, cardId);
                                if (itemStatus == "modified_by_server") {
                                    tbSync.db.removeItemFromChangeLog(aParentDirURI, cardId);
                                } else if (itemStatus != "locked_by_mailinglist_operations" && itemStatus != "added_by_user" && itemStatus != "added_by_server") { 
                                    //added_by_user -> it is a local unprocessed add do not re-add it to changelog
                                    //added_by_server -> it was just added by the server but our onItemAdd has not yet seen it, do not overwrite it - race condition - this local change is probably not caused by the user - ignore it?
                                    tbSync.setTargetModified(folders[0]);
                                    tbSync.db.addItemToChangeLog(aParentDirURI, cardId, "modified_by_user");
                                }
                            }
                            //END

                        }
                    }
                }
            }
        },

        onItemRemoved: function addressbookListener_onItemRemoved (aParentDir, aItem) {
            if (aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            }

            /* * *
             * If a card is removed from the addressbook we are syncing, keep track of the
             * deletions and log them to a file in the profile folder
             */
            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                let folders = tbSync.db.findFoldersWithSetting(["target","useChangeLog"], [aParentDir.URI,"1"]);
                if (folders.length == 1) {
                    
                    //THIS CODE ONLY ACTS ON TBSYNC CARDS
                    let cardId = tbSync.getPropertyOfCard(aItem, "TBSYNCID");
                    if (cardId) {
                        //Problem: A card deleted by server should not trigger a changelog entry, so they are pretagged with deleted_by_server
                        let itemStatus = tbSync.db.getItemStatusFromChangeLog(aParentDir.URI, cardId);
                        if (itemStatus == "deleted_by_server" || itemStatus == "added_by_user") {
                            //if it is a delete pushed from the server, simply acknowledge (do nothing) 
                            //a local add, which has not yet been processed (synced) is deleted -> remove all traces
                            tbSync.db.removeItemFromChangeLog(aParentDir.URI, cardId);
                        } else {
                            tbSync.db.addItemToChangeLog(aParentDir.URI, cardId, "deleted_by_user");
                            tbSync.setTargetModified(folders[0]);
                        }
                    }
                    //END
                    
                }
            }

            /* * *
             * If the entire book we are currently syncing is deleted, remove it from sync and
             * clean up change log
             */
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                //It should not be possible to link a book to two different accounts, so we just take the first target found
                let folders =  tbSync.db.findFoldersWithSetting("target", aItem.URI);
                if (folders.length == 1) {
                    //delete any pending changelog of the deleted book
                    tbSync.db.clearChangeLog(aItem.URI);			

                    //unselect book if deleted by user (book is cached if delete during disable) and update settings window, if open
                    if (folders[0].selected == "1" && folders[0].cached != "1") {
                        tbSync.db.setFolderSetting(folders[0].account, folders[0].folderID, "selected", "0");
                        //update settings window, if open
                         Services.obs.notifyObservers(null, "tbsync.updateSyncstate", folders[0].account);
                    }
                    
                    tbSync.db.resetFolderSetting(folders[0].account, folders[0].folderID, "target");
                }
            }
        },

        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {          
            if (aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            }

            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory && !aItem.isMailList) {
                //we cannot set the ID of new lists before they are created, so we cannot detect this case
                
                let folders = tbSync.db.findFoldersWithSetting(["target","useChangeLog"], [aParentDir.URI,"1"]);
                if (folders.length == 1) {

                    //check if this is a temp search result card and ignore add
                    let searchResultProvider = aItem.getProperty("X-Server-Searchresult", "");
                    if (searchResultProvider) return;

                    let itemStatus = null;
                    let cardId = tbSync.getPropertyOfCard (aItem, "TBSYNCID");
                    if (cardId) {
                        itemStatus = tbSync.db.getItemStatusFromChangeLog(aParentDir.URI, cardId);
                        if (itemStatus == "added_by_server") {
                            tbSync.db.removeItemFromChangeLog(aParentDir.URI, cardId);
                            return;
                        }
                    }
                                
                    //if this point is reached, either new card (no TBSYNCID), or moved card (old TBSYNCID) -> reset TBSYNCID 
                    //whatever happens, if this item has an entry in the changelog, it is not a new item added by the user
                    if (itemStatus === null) {
                        let provider = tbSync.db.getAccountSetting(folders[0].account, "provider");
                        tbSync.setTargetModified(folders[0]);
                        let newCardID = tbSync[provider].getNewCardID(aItem, folders[0]);
                        tbSync.db.addItemToChangeLog(aParentDir.URI, newCardID, "added_by_user");
                        
                        //mailinglist aware property setter
                        tbSync.setPropertyOfCard (aItem, "TBSYNCID", newCardID);
                        aParentDir.modifyCard(aItem);
                    }
                }
                
            }
        },

        add: function addressbookListener_add () {
            let flags = Components.interfaces.nsIAbListener;
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .addAddressBookListener(tbSync.addressbookListener, flags.all);
        },

        remove: function addressbookListener_remove () {
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .removeAddressBookListener(tbSync.addressbookListener);
        }
    },

    //mailinglist aware method to get card based on a property (mailinglist properties need to be stored in prefs of parent book)
    getCardFromProperty: function (addressBook, property, value) {
        //try to use the standard contact card method first
        let card = addressBook.getCardFromProperty(property, value, true);
        if (card) {
            return card;
        }
        
        //search for list cards
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        let searchList = "(IsMailList,=,TRUE)";
        let result = abManager.getDirectory(addressBook.URI +  "?(or" + searchList+")").childCards;
        while (result.hasMoreElements()) {
            let card = result.getNext().QueryInterface(Components.interfaces.nsIAbCard);
            //does this list card have the req prop?
            if (tbSync.getPropertyOfCard(card, property) == value) {
                    return card;
            }
        }
        return null;
    },
    
    //mailinglist aware method to get properties of cards (mailinglist properties cannot be stored in mailinglists themselves)
    getPropertyOfCard: function (card, property, fallback = "") {
        if (card.isMailList) {
            let value = tbSync.db.getItemStatusFromChangeLog(tbSync.getUriFromDirectoryId(card.directoryId), card.mailListURI + "#" + property);
            return value ? value : fallback;    
        } else {
            return card.getProperty(property, fallback);
        }
    },

    //mailinglist aware method to set properties of cards (mailinglist properties need to be stored in prefs of parent book)
    setPropertyOfCard: function (card, property, value) {
        if (card.isMailList) {
            tbSync.db.addItemToChangeLog(tbSync.getUriFromDirectoryId(card.directoryId), card.mailListURI + "#" + property, value);
        } else {
            card.setProperty(property, value);
        }
    },
    
    createMailingListCard: function (addressBook, name, id) {
        //prepare new mailinglist directory
        let mailList = Components.classes["@mozilla.org/addressbook/directoryproperty;1"].createInstance(Components.interfaces.nsIAbDirectory);
        mailList.isMailList = true;
        mailList.dirName = name;
        let mailListDirectory = addressBook.addMailList(mailList);

        //We do not get the list card after creating the list directory and would not be able to find the card without ID,
        //so we add the TBSYNCID property manually
        tbSync.db.addItemToChangeLog(addressBook.URI, mailListDirectory.URI + "#" + "TBSYNCID", id);

        //Furthermore, we cannot create a list with a given ID, so we can also not precatch this creation, because it would not find the entry in the changelog
        
        //find the list card (there is no way to get the card from the directory directly)
        return tbSync.getCardFromProperty(addressBook, "TBSYNCID", id);
    },
    
    //helper function to find a mailinglist member by some property 
    //I could not get nsIArray.indexOf() working, so I have to loop with queryElementAt()
    findIndexOfMailingListMemberWithProperty: function(dir, prop, value, startIndex = 0) {
        for (let i=startIndex; i < dir.addressLists.length; i++) {
            let member = dir.addressLists.queryElementAt(i, Components.interfaces.nsIAbCard);
            if (member.getProperty(prop, "") == value) {
                return i;
            }
        }
        return -1;
    },

    removeBook: function (uri) { 
        // get all address books
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        try {
            if (abManager.getDirectory(uri) instanceof Components.interfaces.nsIAbDirectory) {
                abManager.deleteAddressBook(uri);
            }
        } catch (e) {}
    },

    changeNameOfBook: function (uri, newname) { 
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        let allAddressBooks = abManager.directories;
        while (allAddressBooks.hasMoreElements()) {
            let addressBook = allAddressBooks.getNext();
            if (addressBook instanceof Components.interfaces.nsIAbDirectory && addressBook.URI == uri) {
                let orig = addressBook.dirName;
                addressBook.dirName = newname.replace("%ORIG%", orig);
            }
        }
    },

    getAddressBookObject: function (uri) {
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        try {
            let addressBook = abManager.getDirectory(uri);
            if (addressBook instanceof Components.interfaces.nsIAbDirectory) {
                return addressBook;
            }
        } catch (e) {}
        return null;
    },

    getAddressBookName: function (uri) {
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        let allAddressBooks = abManager.directories;
        while (allAddressBooks.hasMoreElements()) {
            let addressBook = allAddressBooks.getNext();
            if (addressBook instanceof Components.interfaces.nsIAbDirectory && addressBook.URI == uri) {
                return addressBook.dirName;
            }
        }
        return null;
    },

    getUriFromDirectoryId : function(directoryId) {
        let prefId = directoryId.split("&")[0];
        if (prefId) {
            let prefs = Services.prefs.getBranch(prefId + ".");
            switch (prefs.getIntPref("dirType")) {
                case 2:
                    return "moz-abmdbdirectory://" + prefs.getStringPref("filename");
            }
        }
        return null;
    },
        
    checkAddressbook: function (account, folderID) {
        let folder = tbSync.db.getFolder(account, folderID);
        let targetName = tbSync.getAddressBookName(folder.target);
        let targetObject = tbSync.getAddressBookObject(folder.target);
        let provider = tbSync.db.getAccountSetting(account, "provider");
        
        if (targetName !== null && targetObject !== null && targetObject instanceof Components.interfaces.nsIAbDirectory) {
            //check for double targets - just to make sure
            let folders = tbSync.db.findFoldersWithSetting("target", folder.target);
            if (folders.length == 1) {
                return true;
            } else {
                throw "Target with multiple source folders found! Forcing hard fail ("+folder.target+")."; 
            }
        }
        
        // Get cached or new unique name for new address book
        let cachedName = tbSync.db.getFolderSetting(account, folderID, "targetName");                         
        let testname = cachedName == "" ? folder.name + " (" + tbSync.db.getAccountSetting(account, "accountname") + ")" : cachedName;

        let count = 1;
        let unique = false;
        let newname = testname;
        do {
            unique = true;
            let booksIter = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager).directories;
            while (booksIter.hasMoreElements()) {
                let data = booksIter.getNext();
                if (data instanceof Components.interfaces.nsIAbDirectory && data.dirName == newname) {
                    unique = false;
                    break;
                }
            }
            if (!unique) {
                newname = testname + " #" + count;
                count = count + 1;
            }
        } while (!unique);
        
        //Create the new book with the unique name
        let dirPrefId = tbSync[tbSync.db.getAccountSetting(account, "provider")].createAddressBook(newname, account, folderID);
        
        //find uri of new book and store in DB
        let booksIter = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager).directories;
        while (booksIter.hasMoreElements()) {
            let data = booksIter.getNext();
            if (data instanceof Components.interfaces.nsIAbDirectory && data.dirPrefId == dirPrefId) {
                tbSync[provider].onResetTarget(account, folderID);
                tbSync.db.setFolderSetting(account, folderID, "target", data.URI); 
                //tbSync.db.setFolderSetting(account, folderID, "targetName", newname); 
                return true;
            }
        }
        
        return false;
    },

    addphoto: function (photo, book, card, data) {	
        let dest = [];
        //the TbSync storage must be set as last
        let book64 = btoa(book);
        let photo64 = btoa(photo);	    
        let photoName64 = book64 + "_" + photo64;
        
        tbSync.dump("PhotoName", photoName64);
        
        dest.push(["Photos", photoName64]);
        dest.push(["TbSync","Photos", book64, photo64]);
        
        let filePath = "";
        for (let i=0; i < dest.length; i++) {
            let file = FileUtils.getFile("ProfD",  dest[i]);

            let foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
            foStream.init(file, 0x02 | 0x08 | 0x20, 0x180, 0); // write, create, truncate
            let binary = atob(data.split(" ").join(""));
            foStream.write(binary, binary.length);
            foStream.close();

            filePath = 'file:///' + file.path.replace(/\\/g, '\/').replace(/^\s*\/?/, '').replace(/\ /g, '%20');
        }
        card.setProperty("PhotoName", photoName64);
        card.setProperty("PhotoType", "file");
        card.setProperty("PhotoURI", filePath);
        return filePath;
    },

    getphoto: function (card) {	
        let photo = card.getProperty("PhotoName", "");
        let data = "";

        if (photo) {
            try {
                let file = FileUtils.getFile("ProfD", ["Photos", photo]);

                let fiStream = Components.classes["@mozilla.org/network/file-input-stream;1"].createInstance(Components.interfaces.nsIFileInputStream);
                fiStream.init(file, -1, -1, false);
                
                let bstream = Components.classes["@mozilla.org/binaryinputstream;1"].createInstance(Components.interfaces.nsIBinaryInputStream);
                bstream.setInputStream(fiStream);

                data = btoa(bstream.readBytes(bstream.available()));
                fiStream.close();
            } catch (e) {}
        }
        return data;
    },

    





    // CALENDAR FUNCTIONS 
    calendarObserver : { 
        onStartBatch : function () {},
        onEndBatch : function () {},
        onLoad : function (aCalendar) { tbSync.dump("calendarObserver::onLoad","<" + aCalendar.name + "> was loaded."); },

        onAddItem : function (aItem) { 
            let itemStatus = tbSync.db.getItemStatusFromChangeLog(aItem.calendar.id, aItem.id)

            //if an event in one of the synced calendars is added, update status of target and account
            let folders = tbSync.db.findFoldersWithSetting(["target","useChangeLog"], [aItem.calendar.id, "1"]);
            if (folders.length == 1) {
                if (itemStatus == "added_by_server") {
                    tbSync.db.removeItemFromChangeLog(aItem.calendar.id, aItem.id);
                } else if (itemStatus === null) {
                    tbSync.setTargetModified(folders[0]);
                    tbSync.db.addItemToChangeLog(aItem.calendar.id, aItem.id, "added_by_user");
                }
            }
        },

        onModifyItem : function (aNewItem, aOldItem) {
            //check, if it is a pure modification within the same calendar
            if (aNewItem && aNewItem.calendar && aOldItem && aOldItem.calendar) {
                if (aNewItem.calendar.id == aOldItem.calendar.id) {

                    //check, if it is an event in one of the synced calendars
                    let newFolders = tbSync.db.findFoldersWithSetting(["target","useChangeLog"], [aNewItem.calendar.id, "1"]);
                    if (newFolders.length == 1) {
                        //check if t was modified by the server
                        let itemStatus = tbSync.db.getItemStatusFromChangeLog(aNewItem.calendar.id, aNewItem.id)

                        if (itemStatus == "modified_by_server") {
                            tbSync.db.removeItemFromChangeLog(aNewItem.calendar.id, aNewItem.id);
                        } else  if (itemStatus != "added_by_user" && itemStatus != "added_by_server") {
                            //added_by_user -> it is a local unprocessed add do not re-add it to changelog
                            //added_by_server -> it was just added by the server but our onItemAdd has not yet seen it, do not overwrite it - race condition - this local change is probably not caused by the user - ignore it?
                            tbSync.setTargetModified(newFolders[0]);
                            tbSync.db.addItemToChangeLog(aNewItem.calendar.id, aNewItem.id, "modified_by_user");
                        }
                    }
                    
                }
            } else {
                tbSync.dump("Error cal.onModifyItem", aNewItem.id + " has no calendar property");                
            }
        },

        onDeleteItem : function (aDeletedItem) {
            if (aDeletedItem && aDeletedItem.calendar) {
                //if an event in one of the synced calendars is deleted, update status of target and account
                let folders = tbSync.db.findFoldersWithSetting(["target","useChangeLog"], [aDeletedItem.calendar.id,"1"]);
                if (folders.length == 1) {
                    let itemStatus = tbSync.db.getItemStatusFromChangeLog(aDeletedItem.calendar.id, aDeletedItem.id)
                    if (itemStatus == "deleted_by_server" || itemStatus == "added_by_user") {
                        //if it is a delete pushed from the server, simply acknowledge (do nothing) 
                        //a local add, which has not yet been processed (synced) is deleted -> remove all traces
                        tbSync.db.removeItemFromChangeLog(aDeletedItem.calendar.id, aDeletedItem.id);
                    } else {
                        tbSync.setTargetModified(folders[0]);
                        tbSync.db.addItemToChangeLog(aDeletedItem.calendar.id, aDeletedItem.id, "deleted_by_user");
                    }
                }
            } else {
                tbSync.dump("Error cal.onDeleteItem", aDeletedItem.id + " has no calendar property");                
            }
        },
            
        onError : function (aCalendar, aErrNo, aMessage) { tbSync.dump("calendarObserver::onError","<" + aCalendar.name + "> had error #"+aErrNo+"("+aMessage+")."); },

        //Changed properties of the calendar itself (name, color etc.) - IF A PROVIDER NEEDS TO DO CUSTOM STUFF HERE, HE NEEDS TO ADD ITS OWN LISTENER
        onPropertyChanged : function (aCalendar, aName, aValue, aOldValue) {
            tbSync.dump("calendarObserver::onPropertyChanged","<" + aName + "> changed from <"+aOldValue+"> to <"+aValue+">");
            let folders = tbSync.db.findFoldersWithSetting(["target"], [aCalendar.id]);
            if (folders.length == 1) {
                switch (aName) {
                    case "color":
                        //update stored color to recover after disable
                        tbSync.db.setFolderSetting(folders[0].account, folders[0].folderID, "targetColor", aValue); 
                        break;
                    case "name":
                        //update stored name to recover after disable
                        tbSync.db.setFolderSetting(folders[0].account, folders[0].folderID, "targetName", aValue);                         
                        //update settings window, if open
                        Services.obs.notifyObservers(null, "tbsync.updateSyncstate", folders[0].account);
                        break;
                }
            }
        },

        //Deleted properties of the calendar itself (name, color etc.) - IF A PROVIDER NEEDS TO DO CUSTOM STUFF HERE, HE NEEDS TO ADD ITS OWN LISTENER
        onPropertyDeleting : function (aCalendar, aName) {
            tbSync.dump("calendarObserver::onPropertyDeleting","<" + aName + "> was deleted");
            let folders = tbSync.db.findFoldersWithSetting(["target"], [aCalendar.id]);
            if (folders.length == 1) {
                switch (aName) {
                    case "color":
                    case "name":
                        //update settings window, if open
                        Services.obs.notifyObservers(null, "tbsync.updateSyncstate", folders[0].account);
                    break;
                }
            }
        }
    },

    calendarManagerObserver : {
        onCalendarRegistered : function (aCalendar) { tbSync.dump("calendarManagerObserver::onCalendarRegistered","<" + aCalendar.name + "> was registered."); },
        onCalendarUnregistering : function (aCalendar) { tbSync.dump("calendarManagerObserver::onCalendarUnregistering","<" + aCalendar.name + "> was unregisterd."); },
        onCalendarDeleting : function (aCalendar) {
            tbSync.dump("calendarManagerObserver::onCalendarDeleting","<" + aCalendar.name + "> was deleted.");

            //It should not be possible to link a calendar to two different accounts, so we just take the first target found
            let folders =  tbSync.db.findFoldersWithSetting("target", aCalendar.id);
            if (folders.length == 1) {
                //delete any pending changelog of the deleted calendar
                tbSync.db.clearChangeLog(aCalendar.id);

                //unselect calendar if deleted by user (calendar is cached if delete during disable) and update settings window, if open
                if (folders[0].selected == "1" && folders[0].cached != "1") {
                    tbSync.db.setFolderSetting(folders[0].account, folders[0].folderID, "selected", "0");
                    //update settings window, if open
                    Services.obs.notifyObservers(null, "tbsync.updateSyncstate", folders[0].account);
                }
                
                tbSync.db.resetFolderSetting(folders[0].account, folders[0].folderID, "target");
            }
        },
    },

    getCalendarName: function (id) {
        if (tbSync.lightningIsAvailable()) {
            let targetCal = cal.getCalendarManager().getCalendarById(id);
            if (targetCal !== null) return targetCal.name;
            else return "";
        } else {
            return "";
        }
    },
    
    removeCalendar: function(id) {
        try {
            let targetCal = cal.getCalendarManager().getCalendarById(id);
            if (targetCal !== null) {
                cal.getCalendarManager().removeCalendar(targetCal);
            }
        } catch (e) {}
    },

    changeNameOfCalendarAndDisable: function(id, newname) {
        try {
            let targetCal = cal.getCalendarManager().getCalendarById(id);
            if (targetCal !== null) {
                let orig = targetCal.name;
                targetCal.name =  newname.replace("%ORIG%", orig);
                targetCal.setProperty("disabled", true);
            }
        } catch (e) {}
    },

    setCalItemProperty: function (item, prop, value) {
        if (value == "unset") item.deleteProperty(prop);
        else item.setProperty(prop, value);
    },
    
    getCalItemProperty: function (item, prop) {
        if (item.hasProperty(prop)) return item.getProperty(prop);
        else return "unset";
    },
    
    //this function actually creates a calendar if missing
    checkCalender: function (account, folderID) {
        let folder = tbSync.db.getFolder(account, folderID);
        let calManager = cal.getCalendarManager();
        let targetCal = calManager.getCalendarById(folder.target);
        
        if (targetCal !== null)  {
            //check for double targets - just to make sure
            let folders = tbSync.db.findFoldersWithSetting("target", folder.target);
            if (folders.length == 1) {
                return true;
            } else {
                throw "Target with multiple source folders found! Forcing hard fail."; 
            }
        }

        
        //check if  there is a known/cached name, and use that as starting point to generate unique name for new calendar 
        let cachedName = tbSync.db.getFolderSetting(account, folderID, "targetName");                         
        let testname = cachedName == "" ? folder.name + " (" + tbSync.db.getAccountSetting(account, "accountname") + ")" : cachedName;

        let count = 1;
        let unique = false;
        let newname = testname;
        do {
            unique = true;
            for (let calendar of calManager.getCalendars({})) {
                if (calendar.name == newname) {
                    unique = false;
                    break;
                }
            }
            if (!unique) {
                newname = testname + " #" + count;
                count = count + 1;
            }
        } while (!unique);


        //check if there is a cached or preloaded color - if not, chose one
        if (!tbSync.db.getFolderSetting(account, folderID, "targetColor")) {
            //define color set
            let allColors = [
                "#3366CC",
                "#DC3912",
                "#FF9900",
                "#109618",
                "#990099",
                "#3B3EAC",
                "#0099C6",
                "#DD4477",
                "#66AA00",
                "#B82E2E",
                "#316395",
                "#994499",
                "#22AA99",
                "#AAAA11",
                "#6633CC",
                "#E67300",
                "#8B0707",
                "#329262",
                "#5574A6",
                "#3B3EAC"];
            
            //find all used colors
            let usedColors = [];
            for (let calendar of calManager.getCalendars({})) {
                if (calendar && calendar.getProperty("color")) {
                    usedColors.push(calendar.getProperty("color").toUpperCase());
                }
            }

            //we do not want to change order of colors, we want to FILTER by counts, so we need to find the least count, filter by that and then take the first one
            let minCount = null;
            let statColors = [];
            for (let i=0; i< allColors.length; i++) {
                let count = usedColors.filter(item => item == allColors[i]).length;
                if (minCount === null) minCount = count;
                else if (count < minCount) minCount = count;

                let obj = {};
                obj.color = allColors[i];
                obj.count = count;
                statColors.push(obj);
            }
            
            //filter by minCount
            let freeColors = statColors.filter(item => (minCount == null || item.count == minCount));
            tbSync.db.setFolderSetting(account, folderID, "targetColor", freeColors[0].color);        
        }
        
        //create and register new calendar
        let provider = tbSync.db.getAccountSetting(account, "provider");
        let newCalendar = tbSync[provider].createCalendar(newname, account, folderID);

        //store id of calendar as target in DB
        tbSync[provider].onResetTarget(account, folderID);
        tbSync.db.setFolderSetting(account, folderID, "target", newCalendar.id); 
        //tbSync.db.setFolderSetting(account, folderID, "targetName", newCalendar.name); 
        tbSync.db.setFolderSetting(account, folderID, "targetColor",  newCalendar.getProperty("color"));
        return true;        
    }

};
