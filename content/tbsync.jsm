"use strict";

var EXPORTED_SYMBOLS = ["tbSync"];

//global objects (not exported, not available outside this module)
const Cc = Components.classes;
const Ci = Components.interfaces;


//import calUtils if avail
if ("calICalendar" in Components.interfaces) {
    Components.utils.import("resource://calendar/modules/calUtils.jsm");
}

Components.utils.import("resource://gre/modules/FileUtils.jsm");
Components.utils.import("resource://gre/modules/osfile.jsm");
Components.utils.import("resource://gre/modules/Task.jsm");

var tbSync = {

    enabled: false,
    initjobs: 0,
    bundle: Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tbsync/locale/tbSync.strings"),
    mozConsoleService : Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService),

    prefWindowObj: null,
    decoder : new TextDecoder(),
    encoder : new TextEncoder(),

    syncProvider: Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("extensions.tbsync.provider."),
    syncProviderList: Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("extensions.tbsync.provider.").getChildList("", {}),

    prefSettings: Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("extensions.tbsync."),

    storageDirectory : OS.Path.join(OS.Constants.Path.profileDir, "TbSync"),



    // GLOBAL INIT (this init function is called by the init of each provider + messenger)
    init: function () { 
        tbSync.initjobs++;

        if (tbSync.initjobs > tbSync.syncProviderList.length) { //one extra, because messenger needs to init as well
            //init stuff for address book
            tbSync.addressbookListener.add();
            tbSync.scanPrefIdsOfAddressBooks();

            //init stuff for calendar (only if lightning is installed)
            if ("calICalendar" in Components.interfaces) {
                //adding a global observer, or one for each "known" book?
                cal.getCalendarManager().addCalendarObserver(tbSync.calendarObserver);
                cal.getCalendarManager().addObserver(tbSync.calendarManagerObserver)
            }

            //init stuff for sync process
            tbSync.resetSync();
            
            //enable
            tbSync.enabled = true;
        }
    },

    unload: function () {
        tbSync.db.changelogTimer.cancel();
        tbSync.db.accountsTimer.cancel();
        tbSync.db.foldersTimer.cancel();
        tbSync.writeAsyncJSON(tbSync.db.accounts, tbSync.db.accountsFile);
        tbSync.writeAsyncJSON(tbSync.db.folders, tbSync.db.foldersFile);
        tbSync.writeAsyncJSON(tbSync.db.changelog, tbSync.db.changelogFile);

        if (tbSync.prefWindowObj !== null) tbSync.prefWindowObj.close();
    },



    // SYNC QUEUE MANAGEMENT
    syncQueue : [],
    currentProzess : {},
    queueTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

    //used by UI to find out, if any job for this account is scheduled
    accountScheduledForSync: function (account) {
        return (tbSync.syncQueue.filter(item => item.includes("."+account + ".")).length > 0);
    },

    //used by addAccountToSyncQueue to find out, if a specific job is scheduled
    jobScheduledForSync: function (jobdescription) {
        return (tbSync.syncQueue.filter(item => item.includes(jobdescription)).length > 0);
    },

    addAccountToSyncQueue: function (job, account = "", folderID = "") {
        if (account == "") {
            //Add all connected accounts to the queue
            let accounts = tbSync.db.getAccounts();
            for (let i=0; i<accounts.IDs.length; i++) {
                let newentry = job + "." + accounts.IDs[i] + ".";
                //do not add the same job more than once
                if (accounts.data[accounts.IDs[i]].state != "disconnected" && !tbSync.jobScheduledForSync(newentry)) {
                    tbSync.syncQueue.push(newentry);
                }
            }
        } else {
            let newentry = job + "." + account + "." + folderID;
            if (!tbSync.jobScheduledForSync(newentry)) {
                //Add specified job to the queue
                tbSync.syncQueue.push(newentry);
            }
        }

        //update gui
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.notifyObservers(null, "tbsync.changedSyncstate", "");

        //after jobs have been aded to the queue, try to start working on the queue
        //we delay the "is idle" querry, to prevent race condition, also, this forces the sync into a background thread
        this.queueTimer.cancel();
        this.queueTimer.initWithCallback(tbSync.checkSyncQueue, 500, 0);
    },

    checkSyncQueue: {
        notify: function (timer) {
            if (tbSync.currentProzess.state == "idle") tbSync.workSyncQueue();
        }
    },

    workSyncQueue: function () {
        //if no more jobs in queue, do nothing
        if (tbSync.syncQueue.length == 0) {
            tbSync.setSyncState("idle"); 
            return;
        }

        tbSync.currentProzess.forceAbort = false;

        let syncrequest = tbSync.syncQueue.shift().split(".");
        let job = syncrequest[0];
        let account = syncrequest[1];
        let folderID = syncrequest[2];
        let provider = tbSync.db.getAccountSetting(account, "provider");
        
        //workSyncQueue assumes, that it is allowed to start a new sync job
        switch (job) {
            case "sync":
            case "resync":
                tbSync[provider].initSync(job, account);
                return;
            case "deletefolder":
                if (provider == "eas") {
                    tbSync[provider].initSync(job, account, folderID);
                    return;
                }
            default:
                tbSync.dump("workSyncQueue()", "Adding unknow job <"+ job +"> for provider <"+ provider +"> to sync queue!");
        }
    },

    setSyncState: function(state, account = "", folderID = "") {
        //set new state
        let msg = "State: " + state;
        if (account !== "") msg += ", Account: " + tbSync.db.getAccountSetting(account, "accountname");
        if (folderID !== "") msg += ", Folder: " + tbSync.db.getFolderSetting(account, folderID, "name");
        tbSync.dump("setSyncState", msg);

        tbSync.currentProzess.laststate = tbSync.currentProzess.state;
        tbSync.currentProzess.state = state;
        if (tbSync.currentProzess.state != tbSync.currentProzess.laststate) tbSync.currentProzess.chunks = 0;

        if (account !== "") {
            tbSync.currentProzess.account = account;
            tbSync.currentProzess.folderID = folderID;
        } else {
            tbSync.currentProzess.account = "";
            tbSync.currentProzess.folderID = "";
        }

        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.notifyObservers(null, "tbsync.changedSyncstate", "");
    },

    getSyncChunks: function() {
        if (tbSync.currentProzess.chunks > 0) return " #" + tbSync.currentProzess.chunks;
        else return "";
    },
    
    resetSync: function () {
        //flush the queue
        tbSync.syncQueue = [];
        //abort further sync execution (must be implemented by provider!)
        tbSync.currentProzess.forceAbort = true;

        //get all accounts and set all with syncing state to notsyncronized
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i<accounts.IDs.length; i++) {
            if (accounts.data[accounts.IDs[i]].status == "syncing") tbSync.db.setAccountSetting(accounts.IDs[i], "status", "notsyncronized");
        }

        // set each folder with PENDING status to ABORTED
        let folders = tbSync.db.findFoldersWithSetting("status", "pending");
        for (let i=0; i < folders.length; i++) {
            tbSync.db.setFolderSetting(folders[i].account, folders[i].folderID, "status", "aborted");
        }

        //end current sync and switch to idle
        tbSync.setSyncState("accountdone", tbSync.currentProzess.account); 
        tbSync.setSyncState("idle"); 
    },

    finishAccountSync: function (account) {
        let state = tbSync.db.getAccountSetting(account, "state");

        // set each folder with PENDING status to ABORTED
        let folders = tbSync.db.findFoldersWithSetting("status", "pending", account);
        for (let i=0; i < folders.length; i++) {
            tbSync.db.setFolderSetting(account, folders[i].folderID, "status", "aborted");
        }

        //update account status
        tbSync.db.setAccountSetting(account, "lastsynctime", Date.now());
        
        //if global status is OK, scan all folders of this account and if any of them is not ok, set global status
        if (tbSync.db.getAccountSetting(account, "status") == "syncing") {
            let status = "OK";
            folders = tbSync.db.findFoldersWithSetting("selected", "1", account);
            for (let i=0; i < folders.length && status == "OK"; i++) {
                if (folders[i].status != "OK") status = "notsyncronized";
            }
            tbSync.db.setAccountSetting(account, "status", status);
        }

        //done
        tbSync.setSyncState("accountdone", account); 

        //work on the queue
        tbSync.workSyncQueue();
    },





    // TOOLS
    getAbsolutePath: function(filename) {
        return OS.Path.join(tbSync.storageDirectory, filename);
    },
    
    writeAsyncJSON: function (obj, filename) {
        let filepath = tbSync.getAbsolutePath(filename);
        Task.spawn(function* () {
            //MDN states, instead of checking if dir exists, just create it and catch error on exist (but it does not even throw)
            yield OS.File.makeDir(tbSync.storageDirectory);
            yield OS.File.writeAtomic(filepath, tbSync.encoder.encode(JSON.stringify(obj)), {tmpPath: filepath + ".tmp"});
        }).then(null, Components.utils.reportError);
    },
    
    includeJS: function (file) {
        let loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"].getService(Components.interfaces.mozIJSSubScriptLoader);
        loader.loadSubScript(file, this);
    },

    decode_utf8: function (s) {
        let platformVer = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo).platformVersion;
        if (platformVer >= 40) {
            return s;
        } else {
            try {
                return decodeURIComponent(escape(s));
            } catch (e) {
                return s;
            }
        }
    },

    encode_utf8: function (string) {
        let appInfo = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo);
        let platformVer = appInfo.platformVersion;
        if (platformVer >= 50) {
            return string;
        } else {
            string = string.replace(/\r\n/g, "\n");
            let utf8string = "";
            for (let n = 0; n < string.length; n++) {
                let c = string.charCodeAt(n);
                if (c < 128) {
                    utf8string += String.fromCharCode(c);
                } else if ((c > 127) && (c < 2048)) {
                    utf8string += String.fromCharCode((c >> 6) | 192);
                    utf8string += String.fromCharCode((c & 63) | 128);
                } else {
                    utf8string += String.fromCharCode((c >> 12) | 224);
                    utf8string += String.fromCharCode(((c >> 6) & 63) | 128);
                    utf8string += String.fromCharCode((c & 63) | 128);
                }
            }
            return utf8string;
        }
    },

    getLocalizedMessage: function (msg, provider = "") {
        let localized = msg;
        let parts = msg.split("::");
        let bundle = (provider == "") ? tbSync.bundle : tbSync[provider].bundle;
            
        try {
            //spezial treatment of strings with :: like status.httperror::403
            if (parts.length==2) localized = bundle.GetStringFromName(parts[0]).replace("##replace##", parts[1]);
            else localized = bundle.GetStringFromName(msg);
            
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
    
    quickdump: function (what, aMessage) {
        tbSync.mozConsoleService.logStringMessage("[TbSync] " + what + " : " + aMessage);
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
        //create a strem to write to that file
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





    // ADDRESS BOOK FUNCTIONS
    addressbookListener: {

        //if a contact in one of the synced books is modified, update status of target and account
        onItemPropertyChanged: function addressbookListener_onItemPropertyChanged(aItem, aProperty, aOldValue, aNewValue) {
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
                //delete any pending changelog of the deleted book
                tbSync.db.clearChangeLog(aItem.URI);			
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
            if (aNewItem.calendar.id == aOldItem.calendar.id) { // aNewItem.calendar could be null ??? throw up on server pushed deletes as well ??? TODO

                let itemStatus = tbSync.db.getItemStatusFromChangeLog(aNewItem.calendar.id, aNewItem.id)
                //check, if it is an event in one of the synced calendars

                let newFolders = tbSync.db.findFoldersWithSetting("target", aNewItem.calendar.id);
                if (newFolders.length > 0) {
                    if (itemStatus == "modified_by_server") {
                        tbSync.db.removeItemFromChangeLog(aNewItem.calendar.id, aNewItem.id);
                    } else if (itemStatus != "added_by_user") { //if it is a local unprocessed add, do not set it to modified
                        //update status of target and account
                        tbSync.setTargetModified(newFolders[0]);
                        tbSync.db.addItemToChangeLog(aNewItem.calendar.id, aNewItem.id, "modified_by_user");

                    }
                }
                
            }
        },

        onDeleteItem : function (aDeletedItem) {
            let itemStatus = tbSync.db.getItemStatusFromChangeLog(aDeletedItem.calendar.id, aDeletedItem.id)

            //if an event in one of the synced calendars is modified, update status of target and account
            let folders = tbSync.db.findFoldersWithSetting("target", aDeletedItem.calendar.id);
            if (folders.length > 0) {
                if (itemStatus == "deleted_by_server" || itemStatus == "added_by_user") {
                    //if it is a delete pushed from the server, simply acknowledge (do nothing) 
                    //a local add, which has not yet been processed (synced) is deleted -> remove all traces
                    tbSync.db.removeItemFromChangeLog(aDeletedItem.calendar.id, aDeletedItem.id);
                } else {
                    tbSync.setTargetModified(folders[0]);
                    tbSync.db.addItemToChangeLog(aDeletedItem.calendar.id, aDeletedItem.id, "deleted_by_user");
                }
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
            //delete any pending changelog of the deleted calendar
            tbSync.db.clearChangeLog(aCalendar.id);
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

    checkCalender: function (account, folderID) {
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
        //let newCalendar = calManager.createCalendar("TbSync", cal.makeURL('tbsync-calendar://'));

        //Create the new standard calendar with a unique name
        let newCalendar = calManager.createCalendar("storage", cal.makeURL('moz-storage-calendar://'));
        newCalendar.id = cal.getUUID();
        newCalendar.name = newname;
        calManager.registerCalendar(newCalendar);
        newCalendar.setProperty("color", color); //any chance to get the color from the provider?
	
        newCalendar.setProperty("calendar-main-in-composite",true);
        tbSync.dump("tbSync::checkCalendar("+account+", "+folderID+")", "Creating new calendar (" + newname + ")");
        
        //store id of calendar as target in DB
        tbSync.db.setFolderSetting(account, folderID, "target", newCalendar.id); 
        return true;

/*
            // - https://dxr.mozilla.org/comm-central/source/calendar/base/public/calIEvent.idl
            // - https://dxr.mozilla.org/comm-central/source/calendar/base/public/calIItemBase.idl
            // - https://dxr.mozilla.org/comm-central/source/calendar/base/public/calICalendar.idl
            
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

//clear debug log on start
tbSync.initFile("debug.log");
tbSync.mozConsoleService.registerListener(tbSync.consoleListener);

// load common subscripts into tbSync (each subscript will be able to access functions/members of other subscripts, loading order does not matter)
tbSync.includeJS("chrome://tbsync/content/db.js");

// load provider subscripts into tbSync 
for (let i=0;i<tbSync.syncProviderList.length;i++) {
    tbSync.dump("PROVIDER", tbSync.syncProviderList[i] + "::" + tbSync.syncProvider.getCharPref(tbSync.syncProviderList[i]));
    tbSync.includeJS("chrome://tbsync/content/provider/"+tbSync.syncProviderList[i]+"/" + tbSync.syncProviderList[i] +".js");
}
