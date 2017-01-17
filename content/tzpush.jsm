"use strict";

var EXPORTED_SYMBOLS = ["tzPush"];

//global objects (not exported, not available outside this module)
const Cc = Components.classes;
const Ci = Components.interfaces;
var bundle = Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tzpush/locale/strings");


//import calUtils if avail
if ("calICalendar" in Components.interfaces) {
    Components.utils.import("resource://calendar/modules/calUtils.jsm");
}

Components.utils.import("resource://gre/modules/FileUtils.jsm");


/* TODO
 - explizitly use if (error !== "") not if (error) - fails on "0"
 - loop over all properties when card copy
 - check "resync account folder" - maybe rework it
 - drop syncdata and use currentProcess only ???

 - fix blanks bug also for contacts group (not only for contacts2)

*/

var tzPush = {

    prefWindowObj: null,

    // INIT
    
    init: function () {
        //init stuff for address book
        tzPush.addressbookListener.add();
        tzPush.scanPrefIdsOfAddressBooks();

        //init stuff for calendar (only if lightning is installed)
        if ("calICalendar" in Components.interfaces) {
            //adding a global observer, or one for each "known" book?
            cal.getCalendarManager().addCalendarObserver(tzPush.calendarObserver);
            cal.getCalendarManager().addObserver(tzPush.calendarManagerObserver)
        }

        //init stuff for sync process
        tzPush.sync.resetSync();
    },





    // TOOLS

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

    getLocalizedMessage: function (msg) {
        let localized = msg;
        try {
            localized = bundle.GetStringFromName(msg);
        } catch (e) {}
        return localized;
    },

    dump: function (what, aMessage) {
        var consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
        consoleService.logStringMessage("[TzPush] " + what + " : " + aMessage);
    },

    debuglog : function (wbxml, aMessage) {
        let charcodes = [];
        for (let i=0; i< wbxml.length; i++) charcodes.push(wbxml.charCodeAt(i).toString(16));
        let bytestring = charcodes.join(" ");
        //let xml = decodeURIComponent(escape(wbxmltools.convert2xml(wbxml).split('><').join('>\n<')));
        let xml = tzPush.decode_utf8(tzPush.wbxmltools.convert2xml(wbxml).split('><').join('>\n<'));

        tzPush.dump(aMessage + " (bytes)", bytestring);
        tzPush.dump(aMessage + " (xml)", xml);
        tzPush.appendToFile("wbxml-debug.log", "\n\n" + aMessage + " (bytes)\n");
        tzPush.appendToFile("wbxml-debug.log", bytestring);
        tzPush.appendToFile("wbxml-debug.log", "\n\n" + aMessage + " (xml)\n");
        tzPush.appendToFile("wbxml-debug.log", xml);
    },

    



    // FILESYSTEM FUNCTION

    appendToFile: function (filename, data) {
        let file = FileUtils.getFile("ProfD", ["ZPush",filename]);
        //create a strem to write to that file
        let foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
        foStream.init(file, 0x02 | 0x08 | 0x10, parseInt("0666", 8), 0); // write, create, append
        foStream.write(data, data.length);
        foStream.close();
    },


    addphoto: function (card, data) {
        let photo = card.getProperty("ServerId", "") + '.jpg';
        let file = FileUtils.getFile("ProfD", ["ZPush","Photos", photo] );

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





    // GENERAL STUFF

    getConnection: function(account) {
        let connection = {
            protocol: (tzPush.db.getAccountSetting(account, "https") == "1") ? "https://" : "http://",
            set host(newHost) { tzPush.db.setAccountSetting(account, "host", newHost); },
            get server() { return tzPush.db.getAccountSetting(account, "host"); },
            get host() { return this.protocol + tzPush.db.getAccountSetting(account, "host"); },
            get url() { return this.host + "/Microsoft-Server-ActiveSync"; },
            user: tzPush.db.getAccountSetting(account, "user"),
        };
        return connection;
    },

    getPassword: function (connection) {
        let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
        let logins = myLoginManager.findLogins({}, connection.host, connection.url, null);
        for (let i = 0; i < logins.length; i++) {
            if (logins[i].username == connection.user) {
                return logins[i].password;
            }
        }
        //No password found - we should ask for one - this will be triggered by the 401 response, which also catches wrong passwords
        return null;
    },

    setPassword: function (account, newPassword) {
        let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
        let connection = this.getConnection(account);
        let curPassword = this.getPassword(connection);
        
        //Is there a loginInfo for this connection?
        if (curPassword !== null) {
            //remove current login info
            let currentLoginInfo = new nsLoginInfo(connection.host, connection.url, null, connection.user, curPassword, "USER", "PASSWORD");
            try {
                myLoginManager.removeLogin(currentLoginInfo);
            } catch (e) {
                this.dump("Error removing loginInfo", e);
            }
        }
        
        //create loginInfo with new password
        if (newPassword != "") {
            let newLoginInfo = new nsLoginInfo(connection.host, connection.url, null, connection.user, newPassword, "USER", "PASSWORD");
            try {
                myLoginManager.addLogin(newLoginInfo);
            } catch (e) {
                this.dump("Error adding loginInfo", e);
            }
        }
    } ,

    setTargetModified : function (folder) {
        if (folder.status == "OK") {
            tzPush.db.setAccountSetting(folder.account, "status", "notsyncronized");
            tzPush.db.setFolderSetting(folder.account, folder.folderID, "status", "modified");
            //notify settings gui to update status
            let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
            observerService.notifyObservers(null, "tzpush.changedSyncstate", folder.account);
        }
    },

    removeTarget: function(target, type) {
        switch (type) {
            case "8":
            case "13":
                tzPush.removeCalendar(target);
                break;
            case "9":
            case "14":
                tzPush.removeBook(target);
                break;
            default:
                tzPush.dump("tzPush::removeTarget","Unknown type <"+type+">");
        }
    },





    // ADDRESS BOOK FUNCTIONS

    addressbookListener: {

        //if a contact in one of the synced books is modified, update status of target and account
        onItemPropertyChanged: function addressbookListener_onItemPropertyChanged(aItem, aProperty, aOldValue, aNewValue) {
            if (aItem instanceof Components.interfaces.nsIAbCard) {
                let aParentDirURI = tzPush.getUriFromPrefId(aItem.directoryId.split("&")[0]);
                let folders = tzPush.db.findFoldersWithSetting("target", aParentDirURI);
                if (folders.length > 0) tzPush.setTargetModified(folders[0]);
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
                let folders = tzPush.db.findFoldersWithSetting("target", aParentDir.URI);
                if (folders.length > 0) {
                    let cardId = aItem.getProperty("ServerId", "");
                    if (cardId) tzPush.db.addItemToChangeLog(aParentDir.URI, cardId, "delete");
                    tzPush.setTargetModified(folders[0]);
                }
            }

            /* * *
             * If the entire book we are currently syncing is deleted, remove it from sync and
             * clean up delete log
             */
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                let folders =  tzPush.db.findFoldersWithSetting("target", aItem.URI);
                //It should not be possible to link a book to two different accounts, so we just take the first target found
                if (folders.length > 0) {
                    folders[0].target="";
                    folders[0].synckey="";
                    folders[0].lastsynctime= "";
                    folders[0].status= "aborted";
                    tzPush.db.setFolder(folders[0]);
                    tzPush.db.setAccountSetting(folders[0].account, "status", "notsyncronized");
                    //not needed - tzPush.db.setAccountSetting(owner[0], "policykey", ""); //- this is identical to tzPush.sync.resync() without the actual sync

                    tzPush.db.clearChangeLog(aItem.URI);

                    //update settings window, if open
                    let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                    observerService.notifyObservers(null, "tzpush.changedSyncstate", folders[0].account);
                }
            }
        },

        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {
            //if a new book is added, get its prefId (which we need to get the parentDir of a modified card)
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                tzPush.scanPrefIdsOfAddressBooks();
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
                //also update target status
                let folders = tzPush.db.findFoldersWithSetting("target", aParentDir.URI);
                if (folders.length > 0) tzPush.setTargetModified(folders[0]);
            }
        },

        add: function addressbookListener_add () {
            let flags = Components.interfaces.nsIAbListener;
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .addAddressBookListener(tzPush.addressbookListener, flags.all);
        },

        remove: function addressbookListener_remove () {
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .removeAddressBookListener(tzPush.addressbookListener);
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
        if (this.db.getAccountSetting(account, "displayoverride") == "1") {
            card.setProperty("DisplayName", card.getProperty("FirstName", "") + " " + card.getProperty("LastName", ""));
        }
        
        //Remove the ServerID from the card, add the card without serverId and modify the added card later on - otherwise the ServerId will be removed by the onAddItem-listener
        let curID = card.getProperty("ServerId", "");
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
        let folder = tzPush.db.getFolder(account, folderID);
        let targetName = tzPush.getAddressBookName(folder.target);
        let targetObject = tzPush.getAddressBookObject(folder.target);
        
        if (targetName !== null && targetObject !== null && targetObject instanceof Components.interfaces.nsIAbDirectory) return true;
        
        // Get unique Name for new address book
        let testname = tzPush.db.getAccountSetting(account, "accountname") + "." + folder.name;
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
        let dirPrefId = tzPush.addBook(newname);
        
        //find uri of new book and store in DB
        let booksIter = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager).directories;
        while (booksIter.hasMoreElements()) {
            let data = booksIter.getNext();
            if (data instanceof Components.interfaces.nsIAbDirectory && data.dirPrefId == dirPrefId) {
                tzPush.db.setFolderSetting(account, folderID, "target", data.URI); 
                tzPush.dump("checkAddressbook("+account+", "+folderID+")", "Creating new address book (" + newname + ", " + data.URI + ")");
                return true;
            }
        }
        
        return false;
    },





    // CALENDAR FUNCTIONS

    calendarObserver : { 
        onStartBatch : function () {},
        onEndBatch : function () {},
        onLoad : function (aCalendar) { tzPush.dump("calendarObserver::onLoad","<" + aCalendar.name + "> was loaded."); },

        onAddItem : function (aItem) { 
            //if an event in one of the synced calendars is added, update status of target and account
            let folders = tzPush.db.findFoldersWithSetting("target", aItem.calendar.id);
            if (folders.length > 0) {
                if (aItem.calendar.getMetaData(aItem.id) == "added_by_server") {
                    aItem.calendar.deleteMetaData(aItem.id);
                } else {
                    tzPush.setTargetModified(folders[0]);
                    tzPush.db.addItemToChangeLog(aItem.calendar.id, aItem.id, "add");
                    //aItem.calendar.setMetaData(aItem.id, "added_by_user");
                }
            }
        },

        onModifyItem : function (aNewItem, aOldItem) {
            //check, if it is a pure modification within the same calendar
            if (aNewItem.calendar.id == aOldItem.calendar.id) { // aNewItem.calendar could be null ??? throw up on server pushed deletes as well ??? TODO
                //check, if it is an event in one of the synced calendars
                let newFolders = tzPush.db.findFoldersWithSetting("target", aNewItem.calendar.id);
                if (newFolders.length > 0) {
                    if (aNewItem.calendar.getMetaData(aNewItem.id) == "modified_by_server") {
                        aNewItem.calendar.deleteMetaData(aNewItem.id);
                    } else {
                        //update status of target and account
                        tzPush.setTargetModified(newFolders[0]);
                        tzPush.db.addItemToChangeLog(aNewItem.calendar.id, aNewItem.id, "change");
                        //aNewItem.calendar.setMetaData(aNewItem.id, "modified_by_user");
                    }
                }
            }
        },

        onDeleteItem : function (aDeletedItem) {
            //if an event in one of the synced calendars is modified, update status of target and account
            let folders = tzPush.db.findFoldersWithSetting("target", aDeletedItem.calendar.id);
            if (folders.length > 0) {
                if (aDeletedItem.calendar.getMetaData(aDeletedItem.id) == "deleted_by_server") {
                    aDeletedItem.calendar.deleteMetaData(aDeletedItem.id);
                } else {
                    tzPush.setTargetModified(folders[0]);
                    tzPush.db.addItemToChangeLog(aDeletedItem.calendar.id, aDeletedItem.id, "delete");
                    //aDeletedItem.calendar.setMetaData(aDeletedItem.id, "deleted_by_user");
                }
            }
        },
            
        onError : function (aCalendar, aErrNo, aMessage) { tzPush.dump("calendarObserver::onError","<" + aCalendar.name + "> had error #"+aErrNo+"("+aMessage+")."); },

        //Properties of the calendar itself (name, color etc.)
        onPropertyChanged : function (aCalendar, aName, aValue, aOldValue) {
            tzPush.dump("calendarObserver::onPropertyChanged","<" + aName + "> changed from <"+aOldValue+"> to <"+aValue+">");
            switch (aName) {
                case "name":
                    let folders = tzPush.db.findFoldersWithSetting("target", aCalendar.id);
                    if (folders.length > 0) {
                        //update settings window, if open
                        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                        observerService.notifyObservers(null, "tzpush.changedSyncstate", folders[0].account);
                    }
                    break;
            }
        },

        onPropertyDeleting : function (aCalendar, aName) {
            tzPush.dump("calendarObserver::onPropertyDeleting","<" + aName + "> was deleted");
            switch (aName) {
                case "name":
                    let folders = tzPush.db.findFoldersWithSetting("target", aCalendar.id);
                    if (folders.length > 0) {
                        //update settings window, if open
                        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                        observerService.notifyObservers(null, "tzpush.changedSyncstate", folders[0].account);
                    }
                    break;
            }
        }
    },

    calendarManagerObserver : {
        onCalendarRegistered : function (aCalendar) { tzPush.dump("calendarManagerObserver::onCalendarRegistered","<" + aCalendar.name + "> was registered."); },
        onCalendarUnregistering : function (aCalendar) { tzPush.dump("calendarManagerObserver::onCalendarUnregistering","<" + aCalendar.name + "> was unregisterd."); },
        onCalendarDeleting : function (aCalendar) {
            let folders =  tzPush.db.findFoldersWithSetting("target", aCalendar.id);
            //It should not be possible to link a calendar to two different accounts, so we just take the first target found
            if (folders.length > 0) {
                folders[0].target="";
                folders[0].synckey="";
                folders[0].lastsynctime= "";
                folders[0].status= "aborted";
                tzPush.db.setFolder(folders[0]);
                tzPush.db.setAccountSetting(folders[0].account, "status", "notsyncronized");

                tzPush.db.clearChangeLog(aCalendar.id);

                //update settings window, if open
                let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
                observerService.notifyObservers(null, "tzpush.changedSyncstate", folders[0].account);
            }
        },
    },

    calendarOperationObserver : { 
        onOperationComplete : function (aOperationType, aId, aDetail) {
            tzPush.dump("onOperationComplete",[aOperationType, aId, aDetail].join("|"));
        },
        
        onGetResult (aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
            //aItems is array with size_is(aCount), iid_is(aItemType)
            tzPush.dump("onGetResult",[aStatus,aItemType, aDetail, aCount].join("|"));
            for (let i=0; i<aItems.length; i++) {
                tzPush.dump("onGetResult(item)",aItems[i].title);
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
        let folder = tzPush.db.getFolder(account, folderID);
        let calManager = cal.getCalendarManager();
        let targetCal = calManager.getCalendarById(folder.target);
        
        if (targetCal !== null) {
            return true;
        }

        
        // Get unique Name for new calendar
        let testname = tzPush.db.getAccountSetting(account, "accountname") + "." + folder.name;
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
        tzPush.dump("tzPush::checkCalendar("+account+", "+folderID+")", "Creating new calendar (" + newname + ")");
        
        //store id of calendar as target in DB
        tzPush.db.setFolderSetting(account, folderID, "target", newCalendar.id); 
        return true;

/*
            // - https://dxr.mozilla.org/comm-central/source/calendar/base/public/calIEvent.idl
            // - https://dxr.mozilla.org/comm-central/source/calendar/base/public/calIItemBase.idl
            // - https://dxr.mozilla.org/comm-central/source/calendar/base/public/calICalendar.idl
            
            // add custom observer to calender - besides the global one added in tzPush.init()
            calendar.addObserver(tzPush.calendarObserver2);
            
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





let loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"].getService(Components.interfaces.mozIJSSubScriptLoader);

// load all subscripts into tzPush
//- each subscript will be able to access functions/members of other subscripts
//- loading order does not matter
loader.loadSubScript("chrome://tzpush/content/subscripts/db.js", tzPush);
loader.loadSubScript("chrome://tzpush/content/subscripts/sync.js", tzPush);
loader.loadSubScript("chrome://tzpush/content/subscripts/contactsync.js", tzPush);
loader.loadSubScript("chrome://tzpush/content/subscripts/calendarsync.js", tzPush);
loader.loadSubScript("chrome://tzpush/content/subscripts/wbxmltools.js", tzPush);
