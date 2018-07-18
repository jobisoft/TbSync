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


//Date has a toISOString method, which returns the Date obj as extended ISO 8601,
//however EAS MS-ASCAL uses compact/basic ISO 8601,
//extending Date obj by toBasicISOString method to return compact/basic ISO 8601.
if (!Date.prototype.toBasicISOString) {
  (function() {

    function pad(number) {
      if (number < 10) {
        return '0' + number;
      }
      return number.toString();
    }

    Date.prototype.toBasicISOString = function() {
      return pad(this.getUTCFullYear()) +
        pad(this.getUTCMonth() + 1) +
        pad(this.getUTCDate()) +
        'T' + 
        pad(this.getUTCHours()) +
        pad(this.getUTCMinutes()) +
        pad(this.getUTCSeconds()) +
        'Z';
    };

  }());
}



var tbSync = {

    enabled: false,
    window: null,
    versionInfo: {installed: "0.0.0", mozilla : {number: "0.0.0", url: ""}, stable : {number: "0.0.0", url: ""}, beta : {number: "0.0.0.0", url: ""}},
    lastVersionCheck: 0,
        
    lightningInitDone: false,
    cachedTimezoneData: null,
    defaultTimezoneInfo: null,
    windowsTimezoneMap: {},

    bundle: Services.strings.createBundle("chrome://tbsync/locale/tbSync.strings"),

    prefWindowObj: null,
    decoder: new TextDecoder(),
    encoder: new TextEncoder(),

    prefIDs: {},

    prefSettings: Services.prefs.getBranch("extensions.tbsync."),

    // define all registered provider
    providerList: {
        eas: {
            name: "Exchange ActiveSync (EAS)", 
            js: "//tbsync/content/provider/eas/eas.js", 
            newXul: "//tbsync/content/provider/eas/newaccount.xul", 
            accountXul: "//tbsync/content/provider/eas/accountSettings.xul",
            downloadUrl: "",
            enabled: true,
        },  
        ews: {
            name: "Exchange WebServices (EWS)", 
            js: "//ews4tbsync/content/ews.js" , 
            newXul: "//ews4tbsync/content/newaccount.xul", 
            accountXul: "//ews4tbsync/content/accountSettings.xul",
            downloadUrl: "https://github.com/jobisoft/EWS-4-TbSync",
            enabled: false,
        },
        dav: {
            name: "sabre/dav (CalDAV/CardDAV)", 
            js: "//dav4tbsync/content/dav.js" , 
            newXul: "//dav4tbsync/content/newaccount.xul", 
            accountXul: "//dav4tbsync/content/accountSettings.xul",
            downloadUrl: "https://github.com/jobisoft/DAV-4-TbSync",
            enabled: false,
        },
    },
    
    storageDirectory : OS.Path.join(OS.Constants.Path.profileDir, "TbSync"),





    // GLOBAL INIT
    init: Task.async (function* (window)  { 

        tbSync.dump("TbSync init","Start");
        tbSync.window = window;
        Services.obs.addObserver(tbSync.initSyncObserver, "tbsync.initSync", false);
        Services.obs.addObserver(tbSync.syncstateObserver, "tbsync.updateSyncstate", false);
        Services.obs.addObserver(tbSync.removeProviderObserver, "tbsync.removeProvider", false);
        Services.obs.addObserver(tbSync.addProviderObserver, "tbsync.addProvider", false);

        // Inject UI before init finished, to give user the option to see Oops message and report bug
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/messenger.xul", "chrome://tbsync/content/overlays/messenger.xul");        
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/messengercompose/messengercompose.xul", "chrome://tbsync/content/overlays/messengercompose.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://tbsync/content/overlays/abServerSearch.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abContactsPanel.xul", "chrome://tbsync/content/overlays/abServerSearch.xul");
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
        
        //Wait for all other addons
        if (Services.vc.compare(Services.appinfo.platformVersion, "61.*") >= 0)  {
            let addons = yield AddonManager.getAllAddons();
            yield tbSync.finalizeInitByWaitingForAddons(addons);
        } else {
            AddonManager.getAllAddons(tbSync.finalizeInitByWaitingForAddons);
        }
    }),
        
    finalizeInitByWaitingForAddons: Task.async (function* (addons) {
        let lightning = false;
        for (let a=0; a < addons.length; a++) {
            if (addons[a].isActive) {
                tbSync.dump("Active AddOn", addons[a].name + " (" + addons[a].version + ", " + addons[a].id + ")");
                switch (addons[a].id.toString()) {
                    case "{e2fda1a4-762b-4020-b5ad-a41df1933103}":
                        lightning = true;
                        break;
                    case "tbsync@jobisoft.de":
                        tbSync.versionInfo.installed = addons[a].version.toString();
                        break;
                    case "ews4tbsync@jobisoft.de":
                        tbSync.providerList.ews.enabled = true;
                        break;
                    case "dav4tbsync@jobisoft.de":
                        tbSync.providerList.dav.enabled = true;
                        break;
                }
            }
        }
        
        if (lightning) {
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
                
                //get timezone info of default timezone (old cal. without dtz are depricated)
                tbSync.defaultTimezone = (cal.dtz && cal.dtz.defaultTimezone) ? cal.dtz.defaultTimezone : cal.calendarDefaultTimezone();
                tbSync.utcTimezone = (cal.dtz && cal.dtz.UTC) ? cal.dtz.UTC : cal.UTC();
                //if default timezone is not defined, use utc as default
                if (tbSync.defaultTimezone.icalComponent) {
                    tbSync.defaultTimezoneInfo = tbSync.getTimezoneInfo(tbSync.defaultTimezone);
                } else {
                    tbSync.synclog("Critical Warning","Default timezone is not defined, using UTC!");
                    tbSync.defaultTimezoneInfo = tbSync.getTimezoneInfo(tbSync.utcTimezone);
                }
                
                //get windows timezone data from CSV
                let csvData = yield tbSync.fetchFile("chrome://tbsync/content/timezonedata/WindowsTimezone.csv");
                for (let i = 0; i<csvData.length; i++) {
                    let lData = csvData[i].split(",");
                    if (lData.length<3) continue;
                    
                    let windowsZoneName = lData[0].toString().trim();
                    let zoneType = lData[1].toString().trim();
                    let ianaZoneName = lData[2].toString().trim();
                    
                    if (zoneType == "001") tbSync.windowsTimezoneMap[windowsZoneName] = ianaZoneName;
                    if (ianaZoneName == tbSync.defaultTimezoneInfo.std.id) tbSync.defaultTimezoneInfo.std.windowsZoneName = windowsZoneName;
                }

                //inject UI elements
                if (tbSync.window.document.getElementById("calendar-synchronize-button")) {
                    tbSync.window.document.getElementById("calendar-synchronize-button").addEventListener("click", function(event){Services.obs.notifyObservers(null, 'tbsync.initSync', null);}, false);
                }
                if (tbSync.window.document.getElementById("task-synchronize-button")) {
                    tbSync.window.document.getElementById("task-synchronize-button").addEventListener("click", function(event){Services.obs.notifyObservers(null, 'tbsync.initSync', null);}, false);
                }
                
                //indicate, that we have initialized 
                tbSync.lightningInitDone = true;
                tbSync.dump("Check4Lightning","Done");                            
            } else {
                tbSync.dump("Check4Lightning","Failed!");
            }
        }

        //load provider subscripts into tbSync 
        for (let provider in tbSync.providerList) {
            if (tbSync.providerList[provider].enabled) tbSync.includeJS("chrome:" + tbSync.providerList[provider].js);
        }

        //init provider 
        for (let provider in tbSync.providerList) {
            if (tbSync.providerList[provider].enabled) {
                tbSync.dump("PROVIDER", provider + "::" + tbSync.providerList[provider].name);
                yield tbSync[provider].init(tbSync.lightningIsAvailable());
            }
        }
        
        //init stuff for address book
        tbSync.addressbookListener.add();
        tbSync.scanPrefIdsOfAddressBooks();        

        //init stuff for sync process
        tbSync.resetSync();

        //enable TbSync
        tbSync.enabled = true;

        //notify others about finished init of TbSync
        Services.obs.notifyObservers(null, 'tbsync.init.done', null)

        //activate sync timer
        tbSync.syncTimer.start();

        tbSync.dump("TbSync init","Done");

        //check for updates
        yield tbSync.check4updates();
    }),
        
    cleanup: function() {
        //cancel sync timer
        tbSync.syncTimer.cancel();

        //remove observer
        Services.obs.removeObserver(tbSync.syncstateObserver, "tbsync.updateSyncstate");
        Services.obs.removeObserver(tbSync.initSyncObserver, "tbsync.initSync");
        Services.obs.removeObserver(tbSync.removeProviderObserver, "tbsync.removeProvider");
        Services.obs.removeObserver(tbSync.addProviderObserver, "tbsync.addProvider");

        //close window (if open)
        if (tbSync.prefWindowObj !== null) tbSync.prefWindowObj.close();
        
        //remove listener
        tbSync.addressbookListener.remove();

        //remove tbSync autocomplete
        tbSync.abAutoComplete.shutdown();

        if (tbSync.lightningInitDone) {
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
    },

    openManagerWindow: function(event) {
        if (!event.button) { //catches 0 or undefined
            if (tbSync.enabled) {
                // check, if a window is already open and just put it in focus
                if (tbSync.prefWindowObj === null) tbSync.prefWindowObj = tbSync.window.open("chrome://tbsync/content/manager/accountManager.xul", "TbSyncAccountManagerWindow", "chrome,centerscreen");
                tbSync.prefWindowObj.focus();
            } else {
                tbSync.popupNotEnabled();
            }
        }
    },

    popupNotEnabled: function () {
        let msg = "Oops! TbSync was not able to start!\n\n";
        tbSync.dump("Oops", "Trying to open account manager, but init sequence not yet finished");
        
        if (!tbSync.prefSettings.getBoolPref("log.tofile")) {
            if (tbSync.window.confirm(msg + "It is not possible to trace this error, because debug log is currently not enabled. Do you want to enable debug log now, to help fix this error?")) {
                tbSync.prefSettings.setBoolPref("log.tofile", true);
                tbSync.window.alert("TbSync debug log has been enabled, please restart Thunderbird and again try to open TbSync.");
            }
        } else {
            if (tbSync.window.confirm(msg + "To help fix this error, you could send a debug log to the TbSync developer. Prepare that email now?")) {
                tbSync.createBugReport();
            }
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
                    for (let i=0; i<accounts.IDs.length && idle; i++) {
                        //set idle to false, if at least one account is syncing
                        if (tbSync.isSyncing(accounts.IDs[i])) idle = false;
                
                        //check for errors
                        switch (tbSync.db.getAccountSetting(accounts.IDs[i], "status")) {
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
                    
                    if (tbSync.updatesAvailable()) label = label + " (" + tbSync.getLocalizedMessage("update_available") + ")";
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

    //Observer to add provider
    addProviderObserver: {
        observe: Task.async (function* (aSubject, aTopic, aData) {
            //Security: only allow to load pre-registered providers
            if (tbSync.enabled && tbSync.providerList.hasOwnProperty(aData) && !tbSync.providerList[aData].enabled) {
                //close window (if open)
                if (tbSync.prefWindowObj !== null) tbSync.prefWindowObj.close();

                //enable and load provider
                tbSync.providerList[aData].enabled = true;
                tbSync.dump("PROVIDER", aData + "::" + tbSync.providerList[aData].name);
                tbSync.includeJS("chrome:" + tbSync.providerList[aData].js);

                //init provider 
                yield tbSync[aData].init(tbSync.lightningIsAvailable());                
            }
        })
    },

    //Observer to remove provider
    removeProviderObserver: {
        observe: Task.async (function* (aSubject, aTopic, aData) {
            //Security: only allow to unload pre-registered providers
            if (tbSync.enabled &&  tbSync.providerList.hasOwnProperty(aData) && tbSync.providerList[aData].enabled) {
                
                tbSync.providerList[aData].enabled = false;
                if (tbSync[aData]) tbSync[aData] = {};
                //close window (if open)
                if (tbSync.prefWindowObj !== null) tbSync.prefWindowObj.close();
            }
        })
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
                    //get all accounts and check, which one needs sync (accounts array is without order, extract keys (ids) and loop over them)
                    let accounts = tbSync.db.getAccounts();
                    for (let i=0; i<accounts.IDs.length; i++) {
                        let syncInterval = accounts.data[accounts.IDs[i]].autosync * 60 * 1000;
                        let lastsynctime = accounts.data[accounts.IDs[i]].lastsynctime;
                        
                        if (tbSync.isEnabled(accounts.IDs[i]) && (syncInterval > 0) && ((Date.now() - lastsynctime) > syncInterval)) {
                        tbSync.syncAccount("sync",accounts.IDs[i]);
                        }
                    }

                    //also use this timer to check for updates
                    let checkInterval = tbSync.prefSettings.getIntPref("updateCheckInterval") * 60 * 60 * 1000;
                    if ((Date.now() - tbSync.lastVersionCheck) > checkInterval) {
                        tbSync.check4updates();
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
        let numberOfFoundFolders = tbSync.db.findFoldersWithSetting("cached", "0", account).length;
        return (status != "disabled" && numberOfFoundFolders > 0);
    },
    
    prepareSyncDataObj: function (account, forceResetOfSyncData = false) {
        if (!tbSync.syncDataObj.hasOwnProperty(account)) {
            tbSync.syncDataObj[account] = new Object();          
        }
        
        if (forceResetOfSyncData) {
            tbSync.syncDataObj[account] = {};
        }
    
        tbSync.syncDataObj[account].account = account;
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
   
    resetSync: function () {
        //get all accounts and set all with syncing status to notsyncronized
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i<accounts.IDs.length; i++) {
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
    },

    setTargetModified : function (folder) {
        if (folder.status == "OK" && tbSync.isEnabled(folder.account)) {
            tbSync.db.setAccountSetting(folder.account, "status", tbSync.db.getFolderSetting(folder.account, folder.folderID, "downloadonly") == "1" ? "needtorevert" : "notsyncronized");
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
            if ((cal.item && cal.item.isEvent(aItem)) || cal.isEvent(aItem)) return "tb-event";
            if ((cal.item && cal.item.isToDo(aItem)) || cal.isToDo(aItem)) return "tb-todo";
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
    
    //rename target, clear changelog and remove from DB
    takeTargetOffline: function(provider, folder, _suffix = "") {
        if (folder.target != "") {
            let d = new Date();
            let suffix = _suffix ? _suffix : " [lost contact on " + d.getDate().toString().padStart(2,"0") + "." + (d.getMonth()+1).toString().padStart(2,"0") + "." + d.getFullYear() +"]"

            //if there are local changes, append an  (*) to the name of the target
            let c = 0;
            let a = tbSync.db.getItemsFromChangeLog(folder.target, 0, "_by_user");
            for (let i=0; i<a.length; i++) c++;
            if (c>0) suffix += " (*)";

            //this is the only place, where we manually have to call clearChangelog, because the target is not deleted
            //(on delete, changelog is cleared automatically)
            tbSync.db.clearChangeLog(folder.target);
            
            switch (tbSync[provider].getThunderbirdFolderType(folder.type)) {
                case "tb-event":
                case "tb-todo":
                    tbSync.appendSuffixToNameOfCalendar(folder.target, suffix);
                    break;
                case "tb-contact":
                    tbSync.appendSuffixToNameOfBook(folder.target, suffix);
                    break;
                default:
                    tbSync.dump("tbSync.takeTargetOffline","Unknown type <"+folder.type+">");
            }
            
            tbSync.db.deleteFolder(folder.account, folder.folderID);            
        }
    },

    //remove folder from DB (with cache support)
    removeAllFolders: function(account) {
        let provider = tbSync.db.getAccountSetting(account, "provider");
        let folders = tbSync.db.getFolders(account);
        for (let i in folders) {
            let folderID = folders[i].folderID;
            let target = folders[i].target;
            let type = tbSync[provider].getThunderbirdFolderType(folders[i].type);            
            
            //Allways cache
            folders[i].cached = "1";
            folders[i].folderID = "cached-"+folderID;
            tbSync.db.addFolder(folders[i]);
            tbSync.db.deleteFolder(account, folderID); 

            if (target != "") {
                tbSync.removeTarget(target, type);
            }
        }
    },

    //set all selected folders to pending
    setSelectedFoldersToPending: function(account) {
        //set selected folders to pending, so they get synced
        //also clean up leftover folder entries in DB during resync
        let folders = tbSync.db.getFolders(account);
        for (let f in folders) {
            //remove all cached folders
            if (folders[f].cached == "1") {
                tbSync.db.deleteFolder(account, folders[f].folderID);
                continue;
            }
                            
            if (folders[f].selected == "1") {
                tbSync.db.setFolderSetting(folders[f].account, folders[f].folderID, "status", "pending");
            }
        }
    },

    getSyncStatusMsg: function (folder, syncdata, provider) {
        let status = "";
        
        if (folder.selected == "1") {
            //default
            status = tbSync.getLocalizedMessage("status." + folder.status, provider);

            switch (folder.status) {
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

                    status = status + " ...";
                    break;            
            }
        } else {
            //remain empty if not selected
        }        

        return status;
    },

    updateListItemCell: function (e, attribs, value) {
        if (e.getAttribute(attribs[0]) != value) {
            for (let i=0; i<attribs.length; i++) {
                e.setAttribute(attribs[i],value);
            }
        }
    },

    finishAccountSync: function (syncdata, error) {
        // set each folder with PENDING status to ABORTED
        let folders = tbSync.db.findFoldersWithSetting("status", "pending", syncdata.account);
        for (let i=0; i < folders.length; i++) {
            tbSync.db.setFolderSetting(syncdata.account, folders[i].folderID, "status", "aborted");
        }

        //update account status
        let status = "OK";
        if (error == "" || error == "OK") {
            //search for folders with error
            folders = tbSync.db.findFoldersWithSetting("selected", "1", syncdata.account);
            for (let i in folders) {
                let folderstatus = folders[i].status.split(".")[0];
                if (folderstatus != "" && folderstatus != "OK" && folderstatus != "aborted") {
                    status = folders[i].status;
                    break;
                }
            }
        } else {
            status = error;
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
        
        let info = tbSync.db.getAccountSetting(syncdata.account, "accountname");
        if (syncdata.folderID != "") {
            info += "." + tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name");
        }
        
        if (error !== "") {
            status = error;
            time = "";
        }
        tbSync.dump("finishFolderSync(" + info + ")", tbSync.getLocalizedMessage("status." + status, tbSync.db.getAccountSetting(syncdata.account, "provider")));
        
        if (syncdata.folderID != "") {
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "status", status);
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "lastsynctime", time);
        } 

        tbSync.setSyncState("done", syncdata.account);
    },
    
    setSyncState: function(syncstate, account = "", folderID = "") {
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

 




    // TOOLS    
    breakpoint: function (v) {
        let u = tbSync.prefSettings.getIntPref("debug.breakpoint");
        if (u>0 && v>=u) throw "TbSync: Aborted after breakpoint <"+v+">";
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

    openLink: function (url) {
        let ioservice = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);
        let uriToOpen = ioservice.newURI(url, null, null);
        let extps = Components.classes["@mozilla.org/uriloader/external-protocol-service;1"].getService(Components.interfaces.nsIExternalProtocolService);
        extps.loadURI(uriToOpen, null);    
    },

    openFileTab: function (file) {
        return tbSync.openTBtab(tbSync.getAbsolutePath(file));
    },

    createBugReport: function () {
        let fields = Components.classes["@mozilla.org/messengercompose/composefields;1"].createInstance(Components.interfaces.nsIMsgCompFields); 
        let params = Components.classes["@mozilla.org/messengercompose/composeparams;1"].createInstance(Components.interfaces.nsIMsgComposeParams); 

        fields.to = "john.bieling@gmx.de"; 
        fields.subject = "TbSync " + tbSync.versionInfo.installed + " bug report: ADD SHORT DESCRIPTION "; 
        fields.body = "Hi John,\n\nattached you find my debug.log.\n\nBUG DESCRIPTION"; 

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
    
    getHost4PasswordManager: function (accountdata) {
        let parts = accountdata.user.split("@");
        if (parts.length > 1) {
            return accountdata.provider + "://" + parts[1];
        } else {
            return accountdata.provider + "://" + accountdata.accountname;
        }
    },

    getPassword: function (accountdata) {
        let host4PasswordManager = tbSync.getHost4PasswordManager(accountdata);
        let logins = Services.logins.findLogins({}, host4PasswordManager, null, "TbSync");
        for (let i = 0; i < logins.length; i++) {
            if (logins[i].username == accountdata.user) {
                return logins[i].password;
            }
        }
        //No password found - we should ask for one - this will be triggered by the 401 response, which also catches wrong passwords
        return null;
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
    
    setPassword: function (accountdata, newPassword) {
        let host4PasswordManager = tbSync.getHost4PasswordManager(accountdata);
        tbSync.setLoginInfo(host4PasswordManager, "TbSync", accountdata.user, newPassword);
    },
    
    getAbsolutePath: function(filename) {
        return OS.Path.join(tbSync.storageDirectory, filename);
    },

    check4updates: Task.async (function* () {
        let versions = null;
        let urls = ["https://tbsync.jobisoft.de/VERSION.info", "https://raw.githubusercontent.com/jobisoft/TbSync/master/VERSION.info"];

        //we do not want to ask the server every 60s if the request failed for some reason, so we set the lastVersionCheck on each ATTEMPT, not on each SUCCESS
        tbSync.lastVersionCheck = Date.now();
        
        for (let u=0; u<urls.length && versions === null; u++) {
            try {
                //get latest version info
                versions = yield tbSync.fetchFile(urls[u]);
            } catch (ex) {
                tbSync.dump("Get version info failed!", urls[u]);
            }
        }
    
        if (versions) {
            for (let i = 0; i<versions.length; i++) {
                let parts = versions[i].split(" ");
                if (parts.length == 3) {
                    let info = {};
                    info.number = parts[1];
                    info.url = parts[2];
                    tbSync.versionInfo[parts[0]] = info;
                }
            }
            //update UI
            Services.obs.notifyObservers(null, "tbsync.updateSyncstate", null);
            Services.obs.notifyObservers(null, "tbsync.refreshUpdateButton", null);
        }        
    }),
    
    //read file from within the XPI package
    fetchFile: function (aURL, returnType = "Array") {
        return new Promise((resolve, reject) => {
            let uri = Services.io.newURI(aURL);
            let channel = Services.io.newChannelFromURI2(uri,
                                 null,
                                 Services.scriptSecurityManager.getSystemPrincipal(),
                                 null,
                                 Components.interfaces.nsILoadInfo.SEC_REQUIRE_SAME_ORIGIN_DATA_INHERITS,
                                 Components.interfaces.nsIContentPolicy.TYPE_OTHER);

            NetUtil.asyncFetch(channel, (inputStream, status) => {
                if (!Components.isSuccessCode(status)) {
                    reject(status);
                    return;
                }

                try {
                    let data = NetUtil.readInputStreamToString(inputStream, inputStream.available());
                    if (returnType == "Array") {
                        resolve(data.replace("\r","").split("\n"))
                    } else {
                        resolve(data);
                    }
                } catch (ex) {
                    reject(ex);
                }
            });
        });
    },

    //taken from https://stackoverflow.com/questions/6832596/how-to-compare-software-version-number-using-js-only-number
    cmpVersions: function (a, b) {
        let i, diff;
        let regExStrip0 = /(\.0+)+$/;
        let segmentsA = a.replace(regExStrip0, '').split('.');
        let segmentsB = b.replace(regExStrip0, '').split('.');
        let l = Math.min(segmentsA.length, segmentsB.length);

        for (i = 0; i < l; i++) {
            diff = parseInt(segmentsA[i], 10) - parseInt(segmentsB[i], 10);
            if (diff) {
                return diff;
            }
        }
        return segmentsA.length - segmentsB.length;
    },

    isBeta: function () {
        return (tbSync.versionInfo.installed.split(".").length > 3);
    },

    updatesAvailable: function (showBeta = tbSync.prefSettings.getBoolPref("notify4beta")) {
        let updateBeta = (showBeta || tbSync.isBeta()) && (tbSync.cmpVersions(tbSync.versionInfo.beta.number, tbSync.versionInfo.installed) > 0);
        let updateStable = (tbSync.cmpVersions(tbSync.versionInfo.stable.number, tbSync.versionInfo.installed)> 0);
        return (updateBeta || updateStable);
    },
    
    includeJS: function (file) {
        Services.scriptloader.loadSubScript(file, this);
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

    //obsolete pass trough - since we EncodeUrlComponent everything, there is no need to do char transcoding
    encode_utf8: function (string) {
        return string;
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

    synclog: function (type, message, details = null) {
        //placeholder function, until a synclog is implemented
        tbSync.dump("SyncLog ("+type+")", message + (details !== null ? "\n" + details : ""));
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

    consoleListener: {
        observe : function (aMessage) {
            if (tbSync.prefSettings.getBoolPref("log.tofile")) {
                let now = new Date();
                aMessage.QueryInterface(Components.interfaces.nsIScriptError);
                //errorFlag	0x0	Error messages. A pseudo-flag for the default, error case.
                //warningFlag	0x1	Warning messages.
                //exceptionFlag	0x2	An exception was thrown for this case - exception-aware hosts can ignore this.
                //strictFlag	0x4	One of the flags declared in nsIScriptError.
                //infoFlag	0x8	Just a log message
                if (!(aMessage.flags & 0x1 || aMessage.flags & 0x8)) tbSync.appendToFile("debug.log", "** " + now.toString() + " **\n" + aMessage + "\n\n");
            }
        }
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
        //adapted from :
        //https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/How_to_check_the_secruity_state_of_an_XMLHTTPRequest_over_SSL		
        let status = xhr.channel.QueryInterface(Components.interfaces.nsIRequest).status;

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
                let folders =  tbSync.db.findFoldersWithSetting("target", aItem.URI);
                if (folders.length > 0) {
                        //store current/new name of target
                        tbSync.db.setFolderSetting(folders[0].account, folders[0].folderID, "targetName", tbSync.getAddressBookName(folders[0].target));                         
                        //update settings window, if open
                         Services.obs.notifyObservers(null, "tbsync.updateSyncstate", folders[0].account);
                }
            }

            if (aItem instanceof Components.interfaces.nsIAbCard && !aItem.isMailList) {
                let aParentDirURI = tbSync.getUriFromPrefId(aItem.directoryId.split("&")[0]);
                if (aParentDirURI) { //could be undefined

                    let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
                    if (folders.length > 0) {
                                                
                        //THIS CODE ONLY ACTS ON TBSYNC CARDS
                        let cardId = aItem.getProperty("TBSYNCID", "");
                        if (cardId) {
                            //Problem: A card modified by server should not trigger a changelog entry, so they are pretagged with modified_by_server
                            let itemStatus = tbSync.db.getItemStatusFromChangeLog(aParentDirURI, cardId);
                            if (itemStatus == "modified_by_server") {
                                tbSync.db.removeItemFromChangeLog(aParentDirURI, cardId);
                            } else  if (itemStatus != "added_by_user") { //if it is a local unprocessed add do not add it to changelog
                                tbSync.setTargetModified(folders[0]);
                                tbSync.db.addItemToChangeLog(aParentDirURI, cardId, "modified_by_user");
                            }
                        }
                        //END
                        
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
            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory && !aItem.isMailList) {
                let folders = tbSync.db.findFoldersWithSetting("target", aParentDir.URI);
                if (folders.length > 0) {
                    
                    //THIS CODE ONLY ACTS ON TBSYNC CARDS
                    let cardId = aItem.getProperty("TBSYNCID", "");
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
                let folders =  tbSync.db.findFoldersWithSetting("target", aItem.URI);

                //delete any pending changelog of the deleted book
                tbSync.db.clearChangeLog(aItem.URI);			

                //It should not be possible to link a book to two different accounts, so we just take the first target found
                if (folders.length > 0) {

                    folders[0].target="";
                    folders[0].synckey="";
                    folders[0].lastsynctime= "";
                    folders[0].status = "";

                    //update settings window, if open
                    if (folders[0].selected == "1") {
                        folders[0].status= "aborted";
                        if (tbSync.isEnabled(folders[0].account)) tbSync.db.setAccountSetting(folders[0].account, "status", "notsyncronized");

                        //update settings window, if open
                         Services.obs.notifyObservers(null, "tbsync.updateSyncstate", folders[0].account);
                    }
                    tbSync.db.saveFolders();
                    
                }
            }
        },

        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {
            //if a new book is added, get its prefId (which we need to get the parentDir of a modified card)
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                if (!aItem.isRemote && aItem.dirPrefId) {
                    tbSync.prefIDs[aItem.dirPrefId] = aItem.URI;
                    tbSync.dump("PREFID: Single Add", "<" + aItem.dirPrefId + "> = <" + aItem.URI + ">")
                }
                return;
            }
            
            if (aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            }

            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory && !aItem.isMailList) {
                
                let folders = tbSync.db.findFoldersWithSetting("target", aParentDir.URI);
                if (folders.length > 0) {

                    //check if this is a temp search result card and ignore add
                    let searchResultProvider = aItem.getProperty("X-Server-Searchresult", "");
                    if (searchResultProvider) return;

                    let cardId = aItem.getProperty("TBSYNCID", "");
                    if (cardId) {
                        let itemStatus = tbSync.db.getItemStatusFromChangeLog(aParentDir.URI, cardId);
                        if (itemStatus == "added_by_server") {
                            tbSync.db.removeItemFromChangeLog(aParentDir.URI, cardId);
                            return;
                        } 
                    }
                    
                    //if this point is reached, either new card (no TBSYNCID), or moved card (old TBSYNCID) -> reset TBSYNCID 
                    tbSync.setTargetModified(folders[0]);
                    tbSync.db.addItemToChangeLog(aParentDir.URI, aItem.localId, "added_by_user");
                    aItem.setProperty("TBSYNCID", aItem.localId);
                    aParentDir.modifyCard(aItem);
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

    removeBook: function (uri) { 
        // get all address books
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        try {
            if (abManager.getDirectory(uri) instanceof Components.interfaces.nsIAbDirectory) {
                abManager.deleteAddressBook(uri);
            }
        } catch (e) {}
    },

    appendSuffixToNameOfBook: function (uri, suffix) { 
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        let allAddressBooks = abManager.directories;
        while (allAddressBooks.hasMoreElements()) {
            let addressBook = allAddressBooks.getNext();
            if (addressBook instanceof Components.interfaces.nsIAbDirectory && addressBook.URI == uri) {
                addressBook.dirName += suffix;
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

    getUriFromPrefId : function(id) {
        return tbSync.prefIDs[id];
    },
        
    scanPrefIdsOfAddressBooks : function () {
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);        
        let allAddressBooks = abManager.directories;
        while (allAddressBooks.hasMoreElements()) {
            let addressBook = allAddressBooks.getNext().QueryInterface(Components.interfaces.nsIAbDirectory);
            if (!addressBook.isRemote&& addressBook.dirPrefId) {
                tbSync.dump("PREFID: Group Add", "<" + addressBook.dirPrefId + "> = <" + addressBook.URI + ">")
                tbSync.prefIDs[addressBook.dirPrefId] = addressBook.URI;
            }
        }
    },
    
    checkAddressbook: function (account, folderID) {
        let folder = tbSync.db.getFolder(account, folderID);
        let targetName = tbSync.getAddressBookName(folder.target);
        let targetObject = tbSync.getAddressBookObject(folder.target);
        
        if (targetName !== null && targetObject !== null && targetObject instanceof Components.interfaces.nsIAbDirectory) return true;
        
        // Get cached or new unique name for new address book
        let testname = folder.name + " (" + tbSync.db.getAccountSetting(account, "accountname") + ")";
        let cachedName = tbSync.db.getFolderSetting(account, folderID, "targetName");                         

        let newname = (cachedName == "" ? testname : cachedName);
        let count = 1;
        let unique = false;
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
                tbSync.db.setFolderSetting(account, folderID, "target", data.URI); 
                tbSync.dump("checkAddressbook("+account+", "+folderID+")", "Creating new address book (" + newname + ", " + data.URI + ")");
                return true;
            }
        }
        
        return false;
    },

    addphoto: function (photo, card, data) {	
        let dest = [];
        //the TbSync storage must be set as last
        dest.push(["Photos", photo]);
        dest.push(["TbSync","Photos", photo]);
        
        let filePath = "";
        for (let i=0; i < dest.length; i++) {
            let file = FileUtils.getFile("ProfD",  dest[i]);

            let foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
            foStream.init(file, 0x02 | 0x08 | 0x20, 0x180, 0); // write, create, truncate
            let binary = atob(data);
            foStream.write(binary, binary.length);
            foStream.close();

            filePath = 'file:///' + file.path.replace(/\\/g, '\/').replace(/^\s*\/?/, '').replace(/\ /g, '%20');
        }
    
        card.setProperty("PhotoName", photo);
        card.setProperty("PhotoType", "file");
        card.setProperty("PhotoURI", filePath);
        return filePath;
    },

    getphoto: function (card) {	
        let photo = card.getProperty("PhotoName", "");
        let data = "";

        if (photo) {
            let file = FileUtils.getFile("ProfD", ["Photos", photo]);

            let fiStream = Components.classes["@mozilla.org/network/file-input-stream;1"].createInstance(Components.interfaces.nsIFileInputStream);
            fiStream.init(file, -1, -1, false);
            
            let bstream = Components.classes["@mozilla.org/binaryinputstream;1"].createInstance(Components.interfaces.nsIBinaryInputStream);
            bstream.setInputStream(fiStream);

            data = btoa(bstream.readBytes(bstream.available()));
            fiStream.close();
        }
        return data;
    },

    promisifyAddressbook: function (addressbook) {
    /* 
        Return obj with identical interface to promisifyCalendar. But we currently do not need a promise. 
            adoptItem(card)
            modifyItem(newcard, existingcard)
            deleteItem(card)
            getItem(id)

        Avail API:
            addressBook.modifyCard(card);
            addressBook.getCardFromProperty("localId", ClientId, false);
            addressBook.deleteCards(cardsToDelete);
            card.setProperty('ServerId', ServerId);
    */
        let apiWrapper = {
            adoptItem: function (item) { 
                /* add card to addressbook */
                addressbook.addCard(item.card);
            },

            modifyItem: function (newitem, existingitem) {
                /* modify card */
                addressbook.modifyCard(newitem.card);
            },

            deleteItem: function (item) {
                /* remove card from addressBook */
                let cardsToDelete = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
                cardsToDelete.appendElement(item.card, "");
                addressbook.deleteCards(cardsToDelete);
            },

            getItem: function (searchId) {
                /* return array of items matching */
                let items = [];
                let card = addressbook.getCardFromProperty("TBSYNCID", searchId, true); //3rd param enables case sensitivity
                
                if (card) {
                    items.push(tbSync.eas.sync.Contacts.createItem(card));
                }
                
                return items;
            }
        };
    
        return apiWrapper;
    },


    // CALENDAR FUNCTIONS

    // Convert TB date to UTC and return it as  basic or extended ISO 8601  String
    getIsoUtcString: function(origdate, requireExtendedISO = false, fakeUTC = false) {
        let date = origdate.clone();
        //floating timezone cannot be converted to UTC (cause they float) - we have to overwrite it with the local timezone
        if (date.timezone.tzid == "floating") date.timezone = tbSync.defaultTimezoneInfo.timezone;
        //to get the UTC string we could use icalString (which does not work on allDayEvents, or calculate it from nativeTime)
        date.isDate = 0;
        let UTC = date.getInTimezone(tbSync.utcTimezone);        
        if (fakeUTC) UTC = date.clone();
        
        function pad(number) {
            if (number < 10) {
                return '0' + number;
            }
            return number;
        }
        
        if (requireExtendedISO) {
            return UTC.year + 
                    "-" + pad(UTC.month + 1 ) + 
                    "-" + pad(UTC.day) +
                    "T" + pad(UTC.hour) +
                    ":" + pad(UTC.minute) + 
                    ":" + pad(UTC.second) + 
                    "." + "000" +
                    "Z";            
        } else {            
            return UTC.icalString;
        }
    },

    //Save replacement for cal.createDateTime, which accepts compact/basic and also extended ISO 8601, 
    //cal.createDateTime only supports compact/basic
    createDateTime: function(str) {
        let datestring = str;
        if (str.indexOf("-") == 4) {
            //this looks like extended ISO 8601
            let tempDate = new Date(str);
            datestring = tempDate.toBasicISOString();
        }
        return cal.createDateTime(datestring);
    },



    //guess the IANA timezone (used by TB) based on the current offset (standard or daylight)
    guessTimezoneByCurrentOffset: function(curOffset, utcDateTime) {
        //if we only now the current offset and the current date, we need to actually try each TZ.
        let tzService = cal.getTimezoneService();

        //first try default tz
        let test = utcDateTime.getInTimezone(tbSync.defaultTimezoneInfo.timezone);
        tbSync.dump("Matching TZ via current offset: " + test.timezone.tzid + " @ " + curOffset, test.timezoneOffset/-60);
        if (test.timezoneOffset/-60 == curOffset) return test.timezone;
        
        //second try UTC
        test = utcDateTime.getInTimezone(tbSync.utcTimezone);
        tbSync.dump("Matching TZ via current offset: " + test.timezone.tzid + " @ " + curOffset, test.timezoneOffset/-60);
        if (test.timezoneOffset/-60 == curOffset) return test.timezone;
        
        //third try all others
        let enumerator = tzService.timezoneIds;
        while (enumerator.hasMore()) {
            let id = enumerator.getNext();
            let test = utcDateTime.getInTimezone(tzService.getTimezone(id));
            tbSync.dump("Matching TZ via current offset: " + test.timezone.tzid + " @ " + curOffset, test.timezoneOffset/-60);
            if (test.timezoneOffset/-60 == curOffset) return test.timezone;
        }
        
        //return default TZ as fallback
        return tbSync.defaultTimezoneInfo.timezone;
    },
    
    //guess the IANA timezone (used by TB) based on stdandard offset, daylight offset and standard name
    guessTimezoneByStdDstOffset: function(stdOffset, dstOffset, stdName = "") {
                    
            //get a list of all zones
            //alternativly use cal.fromRFC3339 - but this is only doing this:
            //https://dxr.mozilla.org/comm-central/source/calendar/base/modules/calProviderUtils.jsm

            //cache timezone data on first attempt
            if (tbSync.cachedTimezoneData === null) {
                tbSync.cachedTimezoneData = {};
                tbSync.cachedTimezoneData.iana = {};
                tbSync.cachedTimezoneData.abbreviations = {};
                tbSync.cachedTimezoneData.stdOffset = {};
                tbSync.cachedTimezoneData.bothOffsets = {};                    
                    
                let tzService = cal.getTimezoneService();

                //cache timezones data from internal IANA data
                let enumerator = tzService.timezoneIds;
                while (enumerator.hasMore()) {
                    let id = enumerator.getNext();
                    let timezone = tzService.getTimezone(id);
                    let tzInfo = tbSync.getTimezoneInfo(timezone);

                    tbSync.cachedTimezoneData.bothOffsets[tzInfo.std.offset+":"+tzInfo.dst.offset] = timezone;
                    tbSync.cachedTimezoneData.stdOffset[tzInfo.std.offset] = timezone;

                    tbSync.cachedTimezoneData.abbreviations[tzInfo.std.abbreviation] = id;
                    tbSync.cachedTimezoneData.iana[id] = tzInfo;
                    
                    //tbSync.dump("TZ ("+ tzInfo.std.id + " :: " + tzInfo.dst.id +  " :: " + tzInfo.std.displayname + " :: " + tzInfo.dst.displayname + " :: " + tzInfo.std.offset + " :: " + tzInfo.dst.offset + ")", tzService.getTimezone(id));
                }

                //make sure, that UTC timezone is there
                tbSync.cachedTimezoneData.bothOffsets["0:0"] = tbSync.utcTimezone;

                //multiple TZ share the same offset and abbreviation, make sure the default timezone is present
                tbSync.cachedTimezoneData.abbreviations[tbSync.defaultTimezoneInfo.std.abbreviation] = tbSync.defaultTimezoneInfo.std.id;
                tbSync.cachedTimezoneData.bothOffsets[tbSync.defaultTimezoneInfo.std.offset+":"+tbSync.defaultTimezoneInfo.dst.offset] = tbSync.defaultTimezoneInfo.timezone;
                tbSync.cachedTimezoneData.stdOffset[tbSync.defaultTimezoneInfo.std.offset] = tbSync.defaultTimezoneInfo.timezone;
                
            }

            /*
                1. Try to find name in Windows names and map to IANA -> if found, does the stdOffset match? -> if so, done
                2. Try to parse our own format, split name and test each chunk for IANA -> if found, does the stdOffset match? -> if so, done
                3. Try if one of the chunks matches international code -> if found, does the stdOffset match? -> if so, done
                4. Fallback: Use just the offsets  */


            //check for windows timezone name
            if (tbSync.windowsTimezoneMap[stdName] && tbSync.cachedTimezoneData.iana[tbSync.windowsTimezoneMap[stdName]] && tbSync.cachedTimezoneData.iana[tbSync.windowsTimezoneMap[stdName]].std.offset == stdOffset ) {
                //the windows timezone maps multiple IANA zones to one (Berlin*, Rome, Bruessel)
                //check the windowsZoneName of the default TZ and of the winning, if they match, use default TZ
                //so Rome could win, even Berlin is the default IANA zone
                if (tbSync.defaultTimezoneInfo.std.windowsZoneName && tbSync.windowsTimezoneMap[stdName] != tbSync.defaultTimezoneInfo.std.id && tbSync.cachedTimezoneData.iana[tbSync.windowsTimezoneMap[stdName]].std.offset == tbSync.defaultTimezoneInfo.std.offset && stdName == tbSync.defaultTimezoneInfo.std.windowsZoneName) {
                    tbSync.dump("Timezone matched via windows timezone name ("+stdName+") with default TZ overtake", tbSync.windowsTimezoneMap[stdName] + " -> " + tbSync.defaultTimezoneInfo.std.id);
                    return tbSync.defaultTimezoneInfo.timezone;
                }
                
                tbSync.dump("Timezone matched via windows timezone name ("+stdName+")", tbSync.windowsTimezoneMap[stdName]);
                return tbSync.cachedTimezoneData.iana[tbSync.windowsTimezoneMap[stdName]].timezone;
            }

            let parts = stdName.replace(/[;,()\[\]]/g," ").split(" ");
            for (let i = 0; i < parts.length; i++) {
                //check for IANA
                if (tbSync.cachedTimezoneData.iana[parts[i]] && tbSync.cachedTimezoneData.iana[parts[i]].std.offset == stdOffset) {
                    tbSync.dump("Timezone matched via IANA", parts[i]);
                    return tbSync.cachedTimezoneData.iana[parts[i]].timezone;
                }

                //check for international abbreviation for standard period (CET, CAT, ...)
                if (tbSync.cachedTimezoneData.abbreviations[parts[i]] && tbSync.cachedTimezoneData.iana[tbSync.cachedTimezoneData.abbreviations[parts[i]]].std.offset == stdOffset) {
                    tbSync.dump("Timezone matched via international abbreviation (" + parts[i] +")", tbSync.cachedTimezoneData.abbreviations[parts[i]]);
                    return tbSync.cachedTimezoneData.iana[tbSync.cachedTimezoneData.abbreviations[parts[i]]].timezone;
                }
            }

            //fallback to zone based on stdOffset and dstOffset, if we have that cached
            if (tbSync.cachedTimezoneData.bothOffsets[stdOffset+":"+dstOffset]) {
                tbSync.dump("Timezone matched via both offsets (std:" + stdOffset +", dst:" + dstOffset + ")", tbSync.cachedTimezoneData.bothOffsets[stdOffset+":"+dstOffset].tzid);
                return tbSync.cachedTimezoneData.bothOffsets[stdOffset+":"+dstOffset];
            }

            //fallback to zone based on stdOffset only, if we have that cached
            if (tbSync.cachedTimezoneData.stdOffset[stdOffset]) {
                tbSync.dump("Timezone matched via std offset (" + stdOffset +")", tbSync.cachedTimezoneData.stdOffset[stdOffset].tzid);
                return tbSync.cachedTimezoneData.stdOffset[stdOffset];
            }
            
            //return default timezone, if everything else fails
            tbSync.dump("Timezone could not be matched via offsets (std:" + stdOffset +", dst:" + dstOffset + "), using default timezone", tbSync.defaultTimezoneInfo.std.id);
            return tbSync.defaultTimezoneInfo.timezone;
    },

    //extract standard and daylight timezone data
    getTimezoneInfo: function (timezone) {        
        let tzInfo = {};

        tzInfo.std = tbSync.getTimezoneInfoObject(timezone, "standard");
        tzInfo.dst = tbSync.getTimezoneInfoObject(timezone, "daylight");
        
        if (tzInfo.dst === null) tzInfo.dst  = tzInfo.std;        

        tzInfo.timezone = timezone;
        return tzInfo;
    },

    //get timezone info for standard/daylight
    getTimezoneInfoObject: function (timezone, standardOrDaylight) {       
        
        //handle UTC
        if (timezone.isUTC) {
            let obj = {}
            obj.id = "UTC";
            obj.offset = 0;
            obj.abbreviation = "UTC";
            obj.displayname = "Coordinated Universal Time (UTC)";
            return obj;
        }
                
        //we could parse the icalstring by ourself, but I wanted to use ICAL.parse - TODO try catch
        let info = ICAL.parse("BEGIN:VCALENDAR\r\n" + timezone.icalComponent.toString() + "\r\nEND:VCALENDAR");
        let comp = new ICAL.Component(info);
        let vtimezone =comp.getFirstSubcomponent("vtimezone");
        let id = vtimezone.getFirstPropertyValue("tzid").toString();
        let zone = vtimezone.getFirstSubcomponent(standardOrDaylight);

        if (zone) { 
            let obj = {};
            obj.id = id;
            
            //get offset
            let utcOffset = zone.getFirstPropertyValue("tzoffsetto").toString();
            let o = parseInt(utcOffset.replace(":","")); //-330 =  - 3h 30min
            let h = Math.floor(o / 100); //-3 -> -180min
            let m = o - (h*100) //-330 - -300 = -30
            obj.offset = -1*((h*60) + m);

            //get international abbreviation (CEST, CET, CAT ... )
            obj.abbreviation = "";
            try {
                obj.abbreviation = zone.getFirstPropertyValue("tzname").toString();
            } catch(e) {
                tbSync.dump("Failed TZ", timezone.icalComponent.toString());
            }
            
            //get displayname
            obj.displayname = /*"("+utcOffset+") " +*/ obj.id;// + ", " + obj.abbreviation;
                
            //get DST switch date
            let rrule = zone.getFirstPropertyValue("rrule");
            let dtstart = zone.getFirstPropertyValue("dtstart");
            if (rrule && dtstart) {
                /*

                    THE switchdate PART OF THE OBJECT IS MICROSOFT SPECIFIC, EVERYTHING ELSE IS THUNDERBIRD GENERIC, I LET IT SIT HERE ANYHOW
                    
                    https://msdn.microsoft.com/en-us/library/windows/desktop/ms725481(v=vs.85).aspx

                    To select the correct day in the month, set the wYear member to zero, the wHour and wMinute members to
                    the transition time, the wDayOfWeek member to the appropriate weekday, and the wDay member to indicate
                    the occurrence of the day of the week within the month (1 to 5, where 5 indicates the final occurrence during the
                    month if that day of the week does not occur 5 times).

                    Using this notation, specify 02:00 on the first Sunday in April as follows: 
                        wHour = 2, wMonth = 4, wDayOfWeek = 0, wDay = 1. 
                    Specify 02:00 on the last Thursday in October as follows: 
                        wHour = 2, wMonth = 10, wDayOfWeek = 4, wDay = 5.
                        
                    So we have to parse the RRULE to exract wDay
                    RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10 */         

                let parts =rrule.toString().split(";");
                let rules = {};
                for (let i = 0; i< parts.length; i++) {
                    let sub = parts[i].split("=");
                    if (sub.length == 2) rules[sub[0]] = sub[1];
                }
                
                if (rules.FREQ == "YEARLY" && rules.BYDAY && rules.BYMONTH && rules.BYDAY.length > 2) {
                    obj.switchdate = {};
                    obj.switchdate.month = parseInt(rules.BYMONTH);

                    let days = ["SU","MO","TU","WE","TH","FR","SA"];
                    obj.switchdate.dayOfWeek = days.indexOf(rules.BYDAY.substring(rules.BYDAY.length-2));                
                    obj.switchdate.weekOfMonth = parseInt(rules.BYDAY.substring(0, rules.BYDAY.length-2));
                    if (obj.switchdate.weekOfMonth<0 || obj.switchdate.weekOfMonth>5) obj.switchdate.weekOfMonth = 5;

                    //get switch time from dtstart
                    let dttime = tbSync.createDateTime(dtstart.toString());
                    obj.switchdate.hour = dttime.hour;
                    obj.switchdate.minute = dttime.minute;
                    obj.switchdate.second = dttime.second;                                    
                }            
            }

            return obj;
        }
        return null;
    },
    




    
    calendarObserver : { 
        onStartBatch : function () {},
        onEndBatch : function () {},
        onLoad : function (aCalendar) { tbSync.dump("calendarObserver::onLoad","<" + aCalendar.name + "> was loaded."); },

        onAddItem : function (aItem) { 
            let itemStatus = tbSync.db.getItemStatusFromChangeLog(aItem.calendar.id, aItem.id)

            //if an event in one of the synced calendars is added, update status of target and account
            let folders = tbSync.db.findFoldersWithSetting("target", aItem.calendar.id);
            if (folders.length > 0) {
                if (itemStatus == "added_by_server") {
                    tbSync.db.removeItemFromChangeLog(aItem.calendar.id, aItem.id);
                } else {
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
                    let newFolders = tbSync.db.findFoldersWithSetting("target", aNewItem.calendar.id);
                    if (newFolders.length > 0) {
                        //check if t was added by the server
                        let itemStatus = tbSync.db.getItemStatusFromChangeLog(aNewItem.calendar.id, aNewItem.id)

                        if (itemStatus == "modified_by_server") {
                            tbSync.db.removeItemFromChangeLog(aNewItem.calendar.id, aNewItem.id);
                        } else if (itemStatus != "added_by_user") { //if it is a local unprocessed add do not add it to changelog
                            //update status of target and account
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
                //if an event in one of the synced calendars is modified, update status of target and account
                let folders = tbSync.db.findFoldersWithSetting("target", aDeletedItem.calendar.id);
                if (folders.length > 0) {
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

        //Properties of the calendar itself (name, color etc.)
        onPropertyChanged : function (aCalendar, aName, aValue, aOldValue) {
            tbSync.dump("calendarObserver::onPropertyChanged","<" + aName + "> changed from <"+aOldValue+"> to <"+aValue+">");
            let folders = tbSync.db.findFoldersWithSetting("target", aCalendar.id);
            if (folders.length > 0) {
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

        onPropertyDeleting : function (aCalendar, aName) {
            tbSync.dump("calendarObserver::onPropertyDeleting","<" + aName + "> was deleted");
            switch (aName) {
                case "name":
                    let folders = tbSync.db.findFoldersWithSetting("target", aCalendar.id);
                    if (folders.length > 0) {
                        //update settings window, if open
                        Services.obs.notifyObservers(null, "tbsync.updateSyncstate", folders[0].account);
                    }
                    break;
            }
        }
    },

    calendarManagerObserver : {
        onCalendarRegistered : function (aCalendar) { tbSync.dump("calendarManagerObserver::onCalendarRegistered","<" + aCalendar.name + "> was registered."); },
        onCalendarUnregistering : function (aCalendar) { tbSync.dump("calendarManagerObserver::onCalendarUnregistering","<" + aCalendar.name + "> was unregisterd."); },
        onCalendarDeleting : function (aCalendar) {
            tbSync.dump("calendarManagerObserver::onCalendarDeleting","<" + aCalendar.name + "> was deleted.");

            //delete any pending changelog of the deleted calendar
            tbSync.db.clearChangeLog(aCalendar.id);

            let folders =  tbSync.db.findFoldersWithSetting("target", aCalendar.id);
            //It should not be possible to link a calendar to two different accounts, so we just take the first target found
            if (folders.length > 0) {

                folders[0].target="";
                folders[0].synckey="";
                folders[0].lastsynctime= "";
                folders[0].status = "";
                
                if (folders[0].selected == "1") {
                    folders[0].status= "aborted";
                    if (tbSync.isEnabled(folders[0].account)) tbSync.db.setAccountSetting(folders[0].account, "status", "notsyncronized");

                    //update settings window, if open
                    Services.obs.notifyObservers(null, "tbsync.updateSyncstate", folders[0].account);
                }
                tbSync.db.saveFolders();
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

    appendSuffixToNameOfCalendar: function(id, suffix) {
        try {
            let targetCal = cal.getCalendarManager().getCalendarById(id);
            if (targetCal !== null) {
                targetCal.name += suffix;
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
        
        if (targetCal !== null) {
            return true;
        }
        
        // If there is a known/cached value, than use that as starting point to generate unique name for new calendar 
        let cachedName = tbSync.db.getFolderSetting(account, folderID, "targetName");
        let testname = (cachedName == "" ? folder.name + " (" + tbSync.db.getAccountSetting(account, "accountname") + ")" : cachedName);

        let newname = testname;
        let count = 1;
        let unique = false;
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

        //use cachedColor, if there is one
        let cachedColor = tbSync.db.getFolderSetting(account, folderID, "targetColor");        
        let color = (cachedColor == "" ? freeColors[0].color : cachedColor);

        //create and register new calendar
        let newCalendar = tbSync[tbSync.db.getAccountSetting(account, "provider")].createCalendar(newname, account, folderID, color);

        //store id of calendar as target in DB
        tbSync.dump("tbSync::checkCalendar("+account+", "+folderID+")", "Creating new calendar (" + newname + ")");
        tbSync.db.setFolderSetting(account, folderID, "target", newCalendar.id); 
        tbSync.db.setFolderSetting(account, folderID, "targetName", newname); 
        tbSync.db.setFolderSetting(account, folderID, "targetColor", color); 
        return true;        
    }

};


//TODO: Invites
/*
if (tbSync.lightningIsAvailable()) {
    cal.itip.checkAndSendOrigial = cal.itip.checkAndSend;
    cal.itip.checkAndSend = function(aOpType, aItem, aOriginalItem) {
        //if this item is added_by_user, do not call checkAndSend yet, because the UID is wrong, we need to sync first to get the correct ID - TODO
        tbSync.dump("cal.checkAndSend", aOpType);
        cal.itip.checkAndSendOrigial(aOpType, aItem, aOriginalItem);
    }
}
*/


//clear debug log on start
tbSync.initFile("debug.log");
tbSync.dump("Init","Please send this log to john.bieling@gmx.de, if you have encountered an error.");
Services.console.registerListener(tbSync.consoleListener);
