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
    decoder : new TextDecoder(),
    encoder : new TextEncoder(),

    prefSettings: Services.prefs.getBranch("extensions.tbsync."),
    syncProviderPref: Services.prefs.getBranch("extensions.tbsync.provider."),
    syncProviderList: Services.prefs.getBranch("extensions.tbsync.provider.").getChildList("", {}),


    storageDirectory : OS.Path.join(OS.Constants.Path.profileDir, "TbSync"),





    // GLOBAL INIT
    init: Task.async (function* (window)  { 

        tbSync.dump("TbSync init","Start");
        tbSync.window = window;

        Services.obs.addObserver(tbSync.openManagerObserver, "tbsync.openManager", false);
        Services.obs.addObserver(tbSync.initSyncObserver, "tbsync.initSync", false);
        Services.obs.addObserver(tbSync.syncstateObserver, "tbsync.changedSyncstate", false);
        
        //Inject UI - statusbar
        let statuspanel = tbSync.window.document.createElement('statusbarpanel');
        statuspanel.setAttribute("label","TbSync");
        statuspanel.setAttribute("id","tbsync.status");
        statuspanel.onclick = function (event) {if (event.button == 0) Services.obs.notifyObservers(null, 'tbsync.openManager', null);};
        tbSync.window.document.getElementById("status-bar").appendChild(statuspanel);

        //Inject UI - menuitem - if possible above "menu_accountmgr", wherever that is, if not found, fall back to taskPopup as container
        let menuitem = tbSync.window.document.createElement('menuitem');
        menuitem.setAttribute("label", tbSync.getLocalizedMessage("menu.settingslabel"));
        menuitem.setAttribute("id","tbsync.menuitem");
        menuitem.onclick = function (event) {Services.obs.notifyObservers(null, 'tbsync.openManager', null);};

        let accountManagerMenuItem = tbSync.window.document.getElementById("menu_accountmgr");
        let taskPopup = tbSync.window.document.getElementById("taskPopup");
        
        if (accountManagerMenuItem && accountManagerMenuItem.parentNode) {
          accountManagerMenuItem.parentNode.insertBefore(menuitem, accountManagerMenuItem);
        } else if (taskPopup) {
          tbSync.window.document.getElementById("taskPopup").appendChild(menuitem);	
        }
        
        //print information about Thunderbird version and OS
        tbSync.dump(Services.appinfo.name, Services.appinfo.platformVersion + " on " + OS.Constants.Sys.Name);
        
        // load common subscripts into tbSync (each subscript will be able to access functions/members of other subscripts, loading order does not matter)
        tbSync.includeJS("chrome://tbsync/content/db.js");

        //init DB
        yield tbSync.db.init();

        //convert database when migrating from connect state to enable state (keep this in 0.7 branch)
        let accounts = tbSync.db.getAccounts();
        for (let i = 0; i < accounts.IDs.length; i++) {
            if (accounts.data[accounts.IDs[i]].state == "connected") accounts.data[accounts.IDs[i]].state = "enabled";
        }

        //load provider subscripts into tbSync 
        for (let i=0;i<tbSync.syncProviderList.length;i++) {
            tbSync.dump("PROVIDER", tbSync.syncProviderList[i] + "::" + tbSync.syncProviderPref.getCharPref(tbSync.syncProviderList[i]));
            tbSync.includeJS("chrome://tbsync/content/provider/"+tbSync.syncProviderList[i]+"/" + tbSync.syncProviderList[i] +".js");
        }
        
        //init provider 
        for (let i=0;i<tbSync.syncProviderList.length;i++) {
            yield tbSync[tbSync.syncProviderList[i]].init();
        }

        //init stuff for address book
        tbSync.addressbookListener.add();
        tbSync.scanPrefIdsOfAddressBooks();
        
        //init stuff for lightning (and dump any other installed AddOn)
        //TODO: If lightning is converted to restartless, use AddonManager.addAddonListener() to get notification of enable/disable
        AddonManager.getAllAddons(Task.async (function* (addons) {
          for (let a=0; a < addons.length; a++) {
            if (addons[a].isActive) {
                tbSync.dump("Active AddOn", addons[a].name + " (" + addons[a].version + ", " + addons[a].id + ")");
                if (addons[a].id.toString() == "{e2fda1a4-762b-4020-b5ad-a41df1933103}") tbSync.onLightningLoad.start()
                if (addons[a].id.toString() == "tbsync@jobisoft.de") {
                    tbSync.versionInfo.installed = addons[a].version.toString();

                    //init stuff for sync process
                    tbSync.resetSync();
                    
                    //enable TbSync
                    tbSync.enabled = true;
                    
                    //activate sync timer
                    tbSync.syncTimer.start();

                    tbSync.dump("TbSync init","Done");

                    //check for updates
                    yield tbSync.check4updates();
                }
            }
          }
        }));
                
    }),
    
    onLightningLoad: {
        timer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

        start: function () {
            this.timer.cancel();
            this.timer.initWithCallback(this.event, 2000, 0); //run timer in 2s
        },

        cancel: function () {
            this.timer.cancel();
        },

        event: {
            notify: Task.async (function* (timer) {
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

                    //are there any other init4lightning we need to call?
                    for (let i=0;i<tbSync.syncProviderList.length;i++) {
                        yield tbSync[tbSync.syncProviderList[i]].init4lightning();
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
                    tbSync.dump("Check4Lightning","Failed, re-scheduling!");
                    this.start();
                }

            })
        }
    },
    
    cleanup: function() {
        //cancel sync timer
        tbSync.syncTimer.cancel();

        //remove observer
        Services.obs.removeObserver(tbSync.openManagerObserver, "tbsync.openManager");
        Services.obs.removeObserver(tbSync.syncstateObserver, "tbsync.changedSyncstate");
        Services.obs.removeObserver(tbSync.initSyncObserver, "tbsync.initSync");

        //close window (if open)
        if (tbSync.prefWindowObj !== null) tbSync.prefWindowObj.close();
        
        //remove UI elements
        if (tbSync.window && tbSync.window.document) {
            //remove statuspanel
            if (tbSync.window.document.getElementById("tbsync.status")) tbSync.window.document.getElementById("status-bar").removeChild(tbSync.window.document.getElementById("tbsync.status"));
        
            //remove menuitem
            let menuitem = tbSync.window.document.getElementById("tbsync.menuitem");
            if (menuitem && menuitem.parentNode) menuitem.parentNode.removeChild(menuitem);
        }

        //remove listener
        tbSync.addressbookListener.remove();

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

            //are there any other cleanup4lightning we need to call?
            for (let i=0;i<tbSync.syncProviderList.length;i++) {
                tbSync[tbSync.syncProviderList[i]].cleanup4lightning();
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
                
                if (tbSync.updatesAvailable()) label = label + " (update available)";
                status.label = label;      
                
            }
        }
    },

    //Observer to open the account manager
    openManagerObserver: {
        observe: function (aSubject, aTopic, aData) {
            if (tbSync.enabled) {
                // check, if a window is already open and just put it in focus
                if (tbSync.prefWindowObj === null) tbSync.prefWindowObj = tbSync.window.open("chrome://tbsync/content/manager/accountManager.xul", "TbSyncAccountManagerWindow", "chrome,centerscreen");
                tbSync.prefWindowObj.focus();
            } else {
                tbSync.popupNotEnabled();
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
        //I think using the global status is more safe ???
        //let syncstate = tbSync.getSyncData(account,"synstate"); //individual syncstates
        //return (syncstate != "accountdone" && syncstate != "");
        let status = tbSync.db.getAccountSetting(account, "status"); //global status of the account
        return (status == "syncing");
    },
    
    isEnabled: function (account) {
        let state = tbSync.db.getAccountSetting(account, "state"); //enabled, disabled
        return  (state == "enabled");
    },

    isConnected: function (account) {
        let state = tbSync.db.getAccountSetting(account, "state"); //enabled, disabled
        let numberOfFoundFolders = tbSync.db.findFoldersWithSetting("cached", "0", account).length;
        return (state == "enabled" && numberOfFoundFolders > 0);
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
            tbSync[tbSync.db.getAccountSetting(accountsToDo[i], "provider")].start(tbSync.getSyncData(accountsToDo[i]), job, folderID);
        }
        
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

        Services.obs.notifyObservers(null, "tbsync.changedSyncstate", account);
    },
    
    resetSync: function () {
        //get all accounts and set all with syncing state to notsyncronized
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






    // TOOLS
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
            Services.obs.notifyObservers(null, "tbsync.changedSyncstate", null);
            Services.obs.notifyObservers(null, "tbsync.refreshUpdateButton", null);
        }        
    }),
    
    //read file from within the XPI package
    fetchFile: function (aURL) {
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
                    let data = NetUtil.readInputStreamToString(inputStream, inputStream.available()).replace("\r","").split("\n");
                    resolve(data);
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

    //async sleep function using Promise
    sleep : function (delay) {
        let timer =  Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
        return new Promise(function(resolve, reject) {
            let event = {
                notify: function(timer) {
                    resolve();
                }
            }            
            timer.initWithCallback(event,delay, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
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
    
    setTargetModified : function (folder) {
        if (folder.status == "OK") {
            tbSync.db.setAccountSetting(folder.account, "status", "notsyncronized");
            tbSync.db.setFolderSetting(folder.account, folder.folderID, "status", "modified");
            //notify settings gui to update status
             Services.obs.notifyObservers(null, "tbsync.changedSyncstate", folder.account);
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
                         Services.obs.notifyObservers(null, "tbsync.changedSyncstate", folders[0].account);
                }
            }

            if (aItem instanceof Components.interfaces.nsIAbCard) {
                let aParentDirURI = tbSync.getUriFromPrefId(aItem.directoryId.split("&")[0]);
                if (aParentDirURI) { //could be undefined

                    let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
                    if (folders.length > 0) {
                        let cardId = aItem.getProperty("ServerId", "");
                        //Cards without ServerId have not yet been synced to the server, therefore this is a hidden modification.
                        //Next time we sync, this entire card will be added, regardless if it was modified or not
                        if (cardId) {
                            //Problem: A card modified by server should not trigger a changelog entry, so they are pretagged with modified_by_server
                            let itemStatus = tbSync.db.getItemStatusFromChangeLog(aParentDirURI, cardId);
                            if (itemStatus == "modified_by_server") {
                                tbSync.db.removeItemFromChangeLog(aParentDirURI, cardId);
                            } else {
                                tbSync.setTargetModified(folders[0]);
                                tbSync.db.addItemToChangeLog(aParentDirURI, cardId, "modified_by_user");
                            }
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
                let folders = tbSync.db.findFoldersWithSetting("target", aParentDir.URI);
                if (folders.length > 0) {
                    let cardId = aItem.getProperty("ServerId", "");
                    if (cardId) {
                        //Problem: A card deleted by server should not trigger a changelog entry, so they are pretagged with deleted_by_server
                        let itemStatus = tbSync.db.getItemStatusFromChangeLog(aParentDir.URI, cardId);
                        if (itemStatus == "deleted_by_server") {
                            tbSync.db.removeItemFromChangeLog(aParentDir.URI, cardId);
                        } else {
                            tbSync.db.addItemToChangeLog(aParentDir.URI, cardId, "deleted_by_user");
                            tbSync.setTargetModified(folders[0]);
                        }
                    }
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
                        tbSync.db.setAccountSetting(folders[0].account, "status", "notsyncronized");

                        //update settings window, if open
                         Services.obs.notifyObservers(null, "tbsync.changedSyncstate", folders[0].account);
                    }
                    tbSync.db.saveFolders();
                    
                }
            }
        },

        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {
            //if a new book is added, get its prefId (which we need to get the parentDir of a modified card)
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                tbSync.scanPrefIdsOfAddressBooks();
            }
            
            if (aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            }

            /* * *
             * If cards get moved between books or if the user imports new cards, we always have to strip the serverID (if present). The only valid option
             * to introduce a new card with a serverID is during sync, when the server pushes a new card. To catch this, the sync code is adjusted to 
             * actually add the new card without serverID and modifies it right after addition, so this addressbookListener can safely strip any serverID 
             * off added cards, because they are introduced by user actions (move, copy, import) and not by a sync. */
            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                let ServerId = aItem.getProperty("ServerId", "");
                if (ServerId != "") {
                    aItem.setProperty("ServerId", "");
                    aParentDir.modifyCard(aItem);
                }
                //also update target status - no need to update changelog, because every added card is without serverid
                let folders = tbSync.db.findFoldersWithSetting("target", aParentDir.URI);
                if (folders.length > 0) tbSync.setTargetModified(folders[0]);
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
        
    addBook: function (name) {
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        return abManager.newAddressBook(name, "", 2); /* kPABDirectory - return abManager.newAddressBook(name, "moz-abmdbdirectory://", 2); */
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

    addNewCardFromServer: function (card, addressBook) {
        //Remove the ServerID from the card, add the card without serverId and modify the added card later on - otherwise the ServerId will be removed by the onAddItem-listener
        let curID = card.getProperty("ServerId", "");
        //preload the changelog with modified_by_server
        tbSync.db.addItemToChangeLog(addressBook.URI, curID, "modified_by_server");
        
        card.setProperty("ServerId", "");
        let addedCard = addressBook.addCard(card);
        
        addedCard.setProperty("ServerId", curID);
        addressBook.modifyCard(addedCard);
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
        return this._prefIDs[id];
    },
        
    scanPrefIdsOfAddressBooks : function () {
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);        
        let allAddressBooks = abManager.directories;
        this._prefIDs = {};
        while (allAddressBooks.hasMoreElements()) {
            let addressBook = allAddressBooks.getNext().QueryInterface(Components.interfaces.nsIAbDirectory);
            if (addressBook.isRemote) continue;
            this._prefIDs[addressBook.dirPrefId] = addressBook.URI;
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
        let dirPrefId = tbSync.addBook(newname);
        
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

    addphoto: function (card, data) {
        let photo = card.getProperty("ServerId", "") + '.jpg';
        let file = FileUtils.getFile("ProfD", ["TbSync","Photos", photo] );

        let foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
        foStream.init(file, 0x02 | 0x08 | 0x20, 0x180, 0); // write, create, truncate
        let binary = atob(data);
        foStream.write(binary, binary.length);
        foStream.close();

        let filePath = 'file:///' + file.path.replace(/\\/g, '\/').replace(/^\s*\/?/, '').replace(/\ /g, '%20');
        card.setProperty("PhotoName", photo);
        card.setProperty("PhotoType", "file");
        card.setProperty("PhotoURI", filePath);

        return filePath;
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
        /*                
            TbSync is sending timezone as detailed as possible using IANA and international abbreviations:

                    [Send TZ] : Test Lord Howe
                    utcOffset: -630
                    standardName: Australia/Lord_Howe, LHST
                    standardDate: 0-4-1, 0, 2:0:0.0
                    standardBias: 0
                    daylightName: Australia/Lord_Howe, LHDT
                    daylightDate: 0-10-1, 0, 2:0:0.0
                    daylightBias: -30

                    ** Fri Mar 16 2018 11:11:30 GMT+0100 **
                    [Send TZ] : Test Europe/Berlin
                    utcOffset: -60
                    standardName: Europe/Berlin, CET
                    standardDate: 0-10-5, 0, 3:0:0.0
                    standardBias: 0
                    daylightName: Europe/Berlin, CEST
                    daylightDate: 0-3-5, 0, 2:0:0.0
                    daylightBias: -60

                This is, how it comes back from Outlook:
                
                    standardName: Lord Howe Standard Time
                    daylightName: (UTC+10:30) Lord Howe Island

                    standardName: Europe/Berlin, CET
                    daylightName: Customized Time Zone
                
                SOGo & Horde are not sending back anything in standardName and daylightName */
                    
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
            //tbSync.dump("Info cal.onModifyItem", aNewItem.id + " | " + aOldItem.id);                
            if (aNewItem && aNewItem.calendar && aOldItem && aOldItem.calendar) {
                if (aNewItem.calendar.id == aOldItem.calendar.id) {

                    //check, if it is an event in one of the synced calendars
                    let newFolders = tbSync.db.findFoldersWithSetting("target", aNewItem.calendar.id);
                    if (newFolders.length > 0) {
                        //check if t was added by the server
                        let itemStatus = tbSync.db.getItemStatusFromChangeLog(aNewItem.calendar.id, aNewItem.id)

/*
                        if (cal.isInvitation(aNewItem)) { //TODO
                            //did attendee.participationStatus change?
                            //with eas 14.0 it is not possible to directly ack a meeting request (via EAS), the user has to send an email back to the organizer, 
                            //which is auto interpreted and on the next sync the ack is forwarded to us via EAS (thats what I have understood at least)
                            //can we send that email via EAS? This would even work, if the user does not have the email account setup in TB
                            //https://msdn.microsoft.com/en-us/library/ff631378(v=exchg.80).aspx
                            //https://msdn.microsoft.com/en-us/library/ee158682(v=exchg.80).aspx
                            //https://blogs.msdn.microsoft.com/exchangedev/2011/07/22/working-with-meeting-requests-in-exchange-activesync/

                            let parentCalendar = cal.getCalendarManager().getCalendarById(aNewItem.calendar.id);
                            let selfAttendeeNew = aNewItem.getAttendeeById(parentCalendar.getProperty("organizerId"));
                            let selfAttendeeOld = (aOldItem ? aOldItem.getAttendeeById(parentCalendar.getProperty("organizerId")) : null);
                            
                            if (!(selfAttendeeNew && selfAttendeeOld && selfAttendeeNew.participationStatus == selfAttendeeOld.participationStatus)) {
                                //something changed
                                if (selfAttendeeOld) tbSync.dump("Invitation status of selfAttendee", selfAttendeeNew.participationStatus + " vs " + selfAttendeeOld.participationStatus);
                                else  tbSync.dump("Invitation status of selfAttendee", selfAttendeeNew.participationStatus); 
                            }
                        }
*/                        
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
            //tbSync.dump("Info cal.onDeleteItem", aDeletedItem.id);                
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
                        Services.obs.notifyObservers(null, "tbsync.changedSyncstate", folders[0].account);
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
                        Services.obs.notifyObservers(null, "tbsync.changedSyncstate", folders[0].account);
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
                    tbSync.db.setAccountSetting(folders[0].account, "status", "notsyncronized");

                    //update settings window, if open
                    Services.obs.notifyObservers(null, "tbsync.changedSyncstate", folders[0].account);
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
    
    checkCalender: function (account, folderID) {
        tbSync.dump("checkCalender", account + "." + folderID);
        let folder = tbSync.db.getFolder(account, folderID);
        let calManager = cal.getCalendarManager();
        let targetCal = calManager.getCalendarById(folder.target);
        
        if (targetCal !== null) {
            return true;
        }

        
        // If there is a known/cached value, than get unique name for new calendar 
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

        //Alternative calendar, which uses calTbSyncCalendar
        //let newCalendar = calManager.createCalendar("TbSync", Services.io.newURI('tbsync-calendar://'));

        //Create the new standard calendar with a unique name
        let newCalendar = calManager.createCalendar("storage", Services.io.newURI("moz-storage-calendar://"));
        newCalendar.id = cal.getUUID();
        newCalendar.name = newname;
        calManager.registerCalendar(newCalendar);
        newCalendar.setProperty("color", color); //any chance to get the color from the provider?
        newCalendar.setProperty("relaxedMode", true); //sometimes we get "generation too old for modifyItem", check can be disabled with relaxedMode
    
        newCalendar.setProperty("calendar-main-in-composite",true);

        //is there an email identity we can associate this calendar to? 
        //getIdentityKey returns "" if none found, which removes any association
        let key = tbSync.getIdentityKey(tbSync.db.getAccountSetting(account, "user"));
        newCalendar.setProperty("fallbackOrganizerName", newCalendar.getProperty("organizerCN"));
        newCalendar.setProperty("imip.identity.key", key);
        if (key === "") {
            //there is no matching email identity - use current default value as best guess and remove association
            //use current best guess 
            newCalendar.setProperty("organizerCN", newCalendar.getProperty("fallbackOrganizerName"));
            newCalendar.setProperty("organizerId", cal.prependMailTo(tbSync.db.getAccountSetting(account, "user")));
        }

        //store id of calendar as target in DB
        tbSync.dump("tbSync::checkCalendar("+account+", "+folderID+")", "Creating new calendar (" + newname + ")");
        tbSync.db.setFolderSetting(account, folderID, "target", newCalendar.id); 
        tbSync.db.setFolderSetting(account, folderID, "targetName", newname); 
        tbSync.db.setFolderSetting(account, folderID, "targetColor", color); 
        return true;

        /*            
            // add custom observer to calender - besides the global one added in tbSync.init()
            calendar.addObserver(tbSync.calendarObserver2);
            
            //get all items of a calendar - results are catched by the listener and finished by a onOperationComplete
            //Flags : https://dxr.mozilla.org/comm-central/source/calendar/base/public/calICalendar.idl#243
            calendar.getItems(0xFFFF,
                             0,
                             null,
                             null,
                             calendarsync.calendarOperationObserver);
        */
        
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
