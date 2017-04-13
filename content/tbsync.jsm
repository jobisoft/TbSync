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


/* TODO
 - explizitly use if (error !== "") not if (error) - fails on "0"
 - loop over all properties when card copy
 - check "resync account folder" - maybe rework it
 - drop syncdata and use currentProcess only ???
 - fix blanks bug also for contacts group (not only for contacts2)
 - cancel current sync must recover all
 - display number of added/increasing contacts as feedback
*/

var tbSync = {

    enabled: false,
    initjobs: 0,
    bundle: Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tbsync/locale/tbSync.strings"),

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





    // SYNC QUEUE MANAGEMENT
    syncQueue : [],
    currentProzess : {},
    queueTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

    addAccountToSyncQueue: function (job, account = "") {
        if (account == "") {
            //Add all connected accounts to the queue
            let accounts = tbSync.db.getAccounts().IDs;
            for (let i=0; i<accounts.length; i++) {
                let newentry = job + "." + accounts[i];
                //do not add same job more than once
                if (tbSync.syncQueue.filter(item => item == newentry).length == 0) tbSync.syncQueue.push( newentry );
            }
        } else {
            //Add specified account to the queue
            tbSync.syncQueue.push( job + "." + account );
        }

        //after jobs have been aded to the queue, try to start working on the queue
        //we delay the "is idle" querry, to prevent race condition, also, this forces the sync into a background thread
        this.queueTimer.cancel();
        this.queueTimer.initWithCallback(tbSync.checkSyncQueue, 100, 0);
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

        let syncrequest = tbSync.syncQueue.shift().split(".");
        let job = syncrequest[0];
        let account = syncrequest[1];

        //workSyncQueue assumes, that it is allowed to start a new sync job
        switch (job) {
            case "sync":
            case "resync":
                tbSync[tbSync.db.getAccountSetting(account, "provider")].initSync(job, account);
                break;
            default:
                tbSync.dump("workSyncQueue()", "Unknow job for sync queue ("+ job + ")");
        }
    },

    setSyncState: function(state, syncdata = null) {
        //set new state
        tbSync.currentProzess.state = state;
        if (syncdata !== null) {
            tbSync.currentProzess.account = syncdata.account;
            tbSync.currentProzess.folderID = syncdata.folderID;
        } else {
            tbSync.currentProzess.account = "";
            tbSync.currentProzess.folderID = "";
        }

        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.notifyObservers(null, "tbsync.changedSyncstate", "");
    },

    resetSync: function () {
        //set state to idle
        tbSync.setSyncState("idle"); 
        //flush the queue
        tbSync.syncQueue = [];
        //get all accounts
        let accounts = tbSync.db.getAccounts();

        for (let i=0; i<accounts.IDs.length; i++) {
            if (accounts.data[accounts.IDs[i]].status == "syncing") tbSync.db.setAccountSetting(accounts.IDs[i], "status", "notsyncronized");
        }

        // set each folder with PENDING status to ABORTED
        let folders = tbSync.db.findFoldersWithSetting("status", "pending");
        for (let i=0; i < folders.length; i++) {
            tbSync.db.setFolderSetting(folders[i].account, folders[i].folderID, "status", "aborted");
        }
    },

    finishAccountSync: function (syncdata) {
        let state = tbSync.db.getAccountSetting(syncdata.account, "state");
        
        if (state == "connecting") {
                tbSync.db.setAccountSetting(syncdata.account, "state", "connected");
        }
        
        if (syncdata.status != "OK") {
            // set each folder with PENDING status to ABORTED
            let folders = tbSync.db.findFoldersWithSetting("status", "pending", syncdata.account);
            for (let i=0; i < folders.length; i++) {
                tbSync.db.setFolderSetting(syncdata.account, folders[i].folderID, "status", "aborted");
            }
        }

        //update account status
        tbSync.db.setAccountSetting(syncdata.account, "lastsynctime", Date.now());
        tbSync.db.setAccountSetting(syncdata.account, "status", syncdata.status);
        tbSync.setSyncState("accountdone", syncdata); 
                
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
            if (parts.length==2) localized = bundle.GetStringFromName(parts[0]).replace("##error##", parts[1]);
            else localized = bundle.GetStringFromName(msg);
            
        } catch (e) {}
        return localized;
    },

    dump: function (what, aMessage) {
        var consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
        consoleService.logStringMessage("[TbSync] " + what + " : " + aMessage);
    },

    debuglog : function (wbxml, aMessage) {
        let charcodes = [];
        for (let i=0; i< wbxml.length; i++) charcodes.push(wbxml.charCodeAt(i).toString(16));
        let bytestring = charcodes.join(" ");
        //let xml = decodeURIComponent(escape(wbxmltools.convert2xml(wbxml).split('><').join('>\n<')));
        let xml = tbSync.decode_utf8(tbSync.wbxmltools.convert2xml(wbxml).split('><').join('>\n<'));

        //tbSync.dump(aMessage + " (bytes)", bytestring);
        tbSync.dump(aMessage + " (xml)", xml);
        //tbSync.appendToFile("wbxml-debug.log", "\n\n" + aMessage + " (bytes)\n");
        //tbSync.appendToFile("wbxml-debug.log", bytestring);
        tbSync.appendToFile("wbxml-debug.log", "\n\n" + aMessage + " (xml)\n");
        tbSync.appendToFile("wbxml-debug.log", xml);
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
             * clean up delete log
             */
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                let folders =  tbSync.db.findFoldersWithSetting("target", aItem.URI);
                //It should not be possible to link a book to two different accounts, so we just take the first target found
                if (folders.length > 0) {
                    folders[0].target="";
                    folders[0].synckey="";
                    folders[0].lastsynctime= "";
                    folders[0].status= "aborted";

                    tbSync.db.saveFolders();
                    tbSync.db.setAccountSetting(folders[0].account, "status", "notsyncronized");
                    tbSync.db.clearChangeLog(aItem.URI);

                    //update settings window, if open
                    let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                    observerService.notifyObservers(null, "tbsync.changedSyncstate", folders[0].account);
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

    addNewCardFromServer: function (card, addressBook, account) {
        if (tbSync.db.getAccountSetting(account, "displayoverride") == "1") {
            card.setProperty("DisplayName", card.getProperty("FirstName", "") + " " + card.getProperty("LastName", ""));
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
        let testname = tbSync.db.getAccountSetting(account, "accountname") + "." + folder.name;
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
                newname = testname + "." + count;
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
                folders[0].status= "aborted";

                tbSync.db.saveFolders();
                tbSync.db.setAccountSetting(folders[0].account, "status", "notsyncronized");
                tbSync.db.clearChangeLog(aCalendar.id);

                //update settings window, if open
                let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                observerService.notifyObservers(null, "tbsync.changedSyncstate", folders[0].account);
            }
        },
    },

    calendarOperationObserver : { 
        onOperationComplete : function (aOperationType, aId, aDetail) {
            tbSync.dump("onOperationComplete",[aOperationType, aId, aDetail].join("|"));
        },
        
        onGetResult (aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
            //aItems is array with size_is(aCount), iid_is(aItemType)
            tbSync.dump("onGetResult",[aStatus,aItemType, aDetail, aCount].join("|"));
            for (let i=0; i<aItems.length; i++) {
                tbSync.dump("onGetResult(item)",aItems[i].title);
            }
        }
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

    checkCalender: function (account, folderID) {
        let folder = tbSync.db.getFolder(account, folderID);
        let calManager = cal.getCalendarManager();
        let targetCal = calManager.getCalendarById(folder.target);
        
        if (targetCal !== null) {
            return true;
        }

        
        // Get unique Name for new calendar
        let testname = tbSync.db.getAccountSetting(account, "accountname") + "." + folder.name;
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
                newname = testname + "." + count;
                count = count + 1;
            }
        } while (!unique);

        //Create the new calendar with the unique name
        let newCalendar = calManager.createCalendar("storage", cal.makeURL('moz-storage-calendar://'));
        newCalendar.id = cal.getUUID();
        newCalendar.name = newname;
        calManager.registerCalendar(newCalendar);
        newCalendar.setProperty("color","#c11d3b"); //any chance to get the color from the provider?
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

// load common subscripts into tbSync (each subscript will be able to access functions/members of other subscripts, loading order does not matter)
tbSync.includeJS("chrome://tbsync/content/db.js");

// load provider subscripts into tbSync 
for (let i=0;i<tbSync.syncProviderList.length;i++) {
    tbSync.dump("PROVIDER", tbSync.syncProviderList[i] + "::" + tbSync.syncProvider.getCharPref(tbSync.syncProviderList[i]));
    tbSync.includeJS("chrome://tbsync/content/provider/"+tbSync.syncProviderList[i]+"/" + tbSync.syncProviderList[i] +".js");
}
