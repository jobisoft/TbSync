"use strict";

var EXPORTED_SYMBOLS = ["tbSync"];

//global objects (not exported, not available outside this module)
const Cc = Components.classes;
const Ci = Components.interfaces;

//import calUtils if avail
if ("calICalendar" in Components.interfaces) {
    Components.utils.import("resource://calendar/modules/calUtils.jsm");
    Components.utils.import("resource://calendar/modules/ical.js");    
}

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/FileUtils.jsm");
Components.utils.import("resource://gre/modules/osfile.jsm");
Components.utils.import("resource://gre/modules/Task.jsm");
Components.utils.import("resource://gre/modules/AddonManager.jsm");
Components.utils.import("resource://gre/modules/NetUtil.jsm");
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
    initjobs: 0,

    bundle: Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tbsync/locale/tbSync.strings"),
    mozConsoleService : Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService),

    prefWindowObj: null,
    decoder : new TextDecoder(),
    encoder : new TextEncoder(),

    syncProviderPref: Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("extensions.tbsync.provider."),
    syncProviderList: Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("extensions.tbsync.provider.").getChildList("", {}),

    prefSettings: Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("extensions.tbsync."),

    storageDirectory : OS.Path.join(OS.Constants.Path.profileDir, "TbSync"),



    // GLOBAL INIT
    init: Task.async (function* ()  { 

        tbSync.dump("TbSync init","start");

        //init DB
        yield tbSync.db.init();

        //init provider 
        for (let i=0;i<tbSync.syncProviderList.length;i++) {
            yield tbSync[tbSync.syncProviderList[i]].init();
        }

        //init stuff for address book
        tbSync.addressbookListener.add();
        tbSync.scanPrefIdsOfAddressBooks();
        
        //convert database when migrating from connect state to enable state (keep this in 0.7 branch)
        let accounts = tbSync.db.getAccounts();
        for (let i = 0; i < accounts.IDs.length; i++) {
            if (accounts.data[accounts.IDs[i]].state == "connected") accounts.data[accounts.IDs[i]].state = "enabled";
        }

        //init stuff for calendar (only if lightning is installed)
        tbSync.cachedTimezoneData = null;
        tbSync.defaultTimezoneInfo = null;
        tbSync.windowsTimezoneMap = {};
        if ("calICalendar" in Components.interfaces) {
            //adding a global observer, or one for each "known" book?
            cal.getCalendarManager().addCalendarObserver(tbSync.calendarObserver);
            cal.getCalendarManager().addObserver(tbSync.calendarManagerObserver);
            
            //get timezone info of default timezone (old cal. without dtz are depricated)
            tbSync.defaultTimezoneInfo = tbSync.getTimezoneInfo((cal.dtz && cal.dtz.defaultTimezone) ? cal.dtz.defaultTimezone : cal.calendarDefaultTimezone());
            tbSync.utcTimezone = (cal.dtz && cal.dtz.UTC) ? cal.dtz.UTC : cal.UTC();
            
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
            
        }

        //init stuff for sync process
        tbSync.resetSync();

        //enable
        tbSync.enabled = true;

        tbSync.dump("TbSync init","done");
    }),

    unload: function () {
        if (tbSync.enabled) {
            tbSync.db.changelogTimer.cancel();
            tbSync.db.accountsTimer.cancel();
            tbSync.db.foldersTimer.cancel();
            tbSync.writeAsyncJSON(tbSync.db.accounts, tbSync.db.accountsFile);
            tbSync.writeAsyncJSON(tbSync.db.folders, tbSync.db.foldersFile);
            tbSync.writeAsyncJSON(tbSync.db.changelog, tbSync.db.changelogFile);
        }
        if (tbSync.prefWindowObj !== null) tbSync.prefWindowObj.close();
    },


    //example async sleep function using Promise
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
    

    // SYNC MANAGEMENT
    syncDataObj : {},

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

        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.notifyObservers(null, "tbsync.changedSyncstate", account);
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
        var tabmail = null;
        var mail3PaneWindow =
            Components.classes["@mozilla.org/appshell/window-mediator;1"]
            .getService(Components.interfaces.nsIWindowMediator)
            .getMostRecentWindow("mail:3pane");
        if (mail3PaneWindow) {
            tabmail = mail3PaneWindow.document.getElementById("tabmail");
            mail3PaneWindow.focus();
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

    getAbsolutePath: function(filename) {
        return OS.Path.join(tbSync.storageDirectory, filename);
    },

    writeAsyncJSON: function (obj, filename) {
        let filepath = tbSync.getAbsolutePath(filename);
        Task.spawn(function* () {
            //MDN states, instead of checking if dir exists, just create it and catch error on exist (but it does not even throw)
            yield OS.File.makeDir(tbSync.storageDirectory);
            yield OS.File.writeAtomic(filepath, tbSync.encoder.encode(JSON.stringify(obj)), {tmpPath: filepath + ".tmp"});
        }).catch(Components.utils.reportError);
    },

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

    includeJS: function (file) {
        let loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"].getService(Components.interfaces.mozIJSSubScriptLoader);
        loader.loadSubScript(file, this);
    },

    //probably obsolete
    encode_utf8: function (string) {
        let utf8string = string;

// FIRST, the test platformVer > 50 fails, because platformVer is something like 50.3.2
// SECOND, since we EncodeUrlComponent everything, there is no need to do char transcoding
//
//        let appInfo = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo);
//        let platformVer = appInfo.platformVersion;
//        if (platformVer >= 50) {
//            utf8string = string;
//        } else {
//            //What?
//            string = string.replace(/\r\n/g, "\n");
//            for (let n = 0; n < string.length; n++) {
//                let c = string.charCodeAt(n);
//                if (c < 128) {
//                    utf8string += String.fromCharCode(c);
//                } else if ((c > 127) && (c < 2048)) {
//                    utf8string += String.fromCharCode((c >> 6) | 192);
//                    utf8string += String.fromCharCode((c & 63) | 128);
//                } else {
//                    utf8string += String.fromCharCode((c >> 12) | 224);
//                    utf8string += String.fromCharCode(((c >> 6) & 63) | 128);
//                    utf8string += String.fromCharCode((c & 63) | 128);
//                }
//            }
//        }

        return utf8string;
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
            tbSync.mozConsoleService.logStringMessage("[TbSync] " + what + " : " + aMessage);
        }
        
        if (tbSync.prefSettings.getBoolPref("log.tofile")) {
            let now = new Date();
            tbSync.appendToFile("debug.log", "** " + now.toString() + " **\n[" + what + "] : " + aMessage + "\n\n");
        }
    },

    synclog: function (type, message, details) {
	//placeholder function, until a synclog is implemented
	tbSync.dump("SyncLog ("+type+")", message + "\n" + details);
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
            let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
            observerService.notifyObservers(null, "tbsync.changedSyncstate", folder.account);
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
                        //update settings window, if open
                        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                        observerService.notifyObservers(null, "tbsync.changedSyncstate", folders[0].account);
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
                        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                        observerService.notifyObservers(null, "tbsync.changedSyncstate", folders[0].account);
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

    addNewCardFromServer: function (card, addressBook, account) {
        if (tbSync.db.getAccountSetting(account, "displayoverride") == "1") {
           card.setProperty("DisplayName", card.getProperty("FirstName", "") + " " + card.getProperty("LastName", ""));

        if (card.getProperty("DisplayName", "" ) == " " )
           card.setProperty("DisplayName", card.getProperty("Company", card.getProperty("PrimaryEmail", "")));
        }
        
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
        
        // Get unique Name for new address book
        let testname = folder.name + " (" + tbSync.db.getAccountSetting(account, "accountname") + ")";
        let newname = testname;
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
            obj.abbreviation = zone.getFirstPropertyValue("tzname").toString();
            
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
            switch (aName) {
                case "name":
                    let folders = tbSync.db.findFoldersWithSetting("target", aCalendar.id);
                    if (folders.length > 0) {
                        //update settings window, if open
                        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                        observerService.notifyObservers(null, "tbsync.changedSyncstate", folders[0].account);
                    }
                    break;
            }
        },

        onPropertyDeleting : function (aCalendar, aName) {
            tbSync.dump("calendarObserver::onPropertyDeleting","<" + aName + "> was deleted");
            switch (aName) {
                case "name":
                    let folders = tbSync.db.findFoldersWithSetting("target", aCalendar.id);
                    if (folders.length > 0) {
                        //update settings window, if open
                        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                        observerService.notifyObservers(null, "tbsync.changedSyncstate", folders[0].account);
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
                    let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                    observerService.notifyObservers(null, "tbsync.changedSyncstate", folders[0].account);
                }
                tbSync.db.saveFolders();
            }
        },
    },

    getCalendarName: function (id) {
        if ("calICalendar" in Components.interfaces) {
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

        
        // Get unique Name for new calendar
        let testname = folder.name + " (" + tbSync.db.getAccountSetting(account, "accountname") + ")";
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
        let color = freeColors[0].color;        

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
if ("calICalendar" in Components.interfaces) {
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

tbSync.mozConsoleService.registerListener(tbSync.consoleListener);

let appInfo =  Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo);
tbSync.dump(appInfo.name, appInfo.platformVersion + " on " + OS.Constants.Sys.Name);
AddonManager.getAllAddons(function(addons) {
  for (let a=0; a < addons.length; a++) {
    if (addons[a].isActive) tbSync.dump("Active AddOn", addons[a].name + " (" + addons[a].version +")");
  }
});

// load common subscripts into tbSync (each subscript will be able to access functions/members of other subscripts, loading order does not matter)
tbSync.includeJS("chrome://tbsync/content/db.js");

// load provider subscripts into tbSync 
for (let i=0;i<tbSync.syncProviderList.length;i++) {
    tbSync.dump("PROVIDER", tbSync.syncProviderList[i] + "::" + tbSync.syncProviderPref.getCharPref(tbSync.syncProviderList[i]));
    tbSync.includeJS("chrome://tbsync/content/provider/"+tbSync.syncProviderList[i]+"/" + tbSync.syncProviderList[i] +".js");
}
