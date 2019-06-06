/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
/*

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

*/


var addressbook = {
    
    load : function () {
        Services.obs.addObserver(this.addressbookObserver, "addrbook-contact-created", false);
        Services.obs.addObserver(this.addressbookObserver, "addrbook-contact-updated", false);
        Services.obs.addObserver(this.addressbookObserver, "addrbook-list-member-added", false);
        Services.obs.addObserver(this.addressbookObserver, "addrbook-list-updated", false);
        this.addressbookListener.add();
    },

    unload : function () {
            Services.obs.removeObserver(this.addressbookObserver, "addrbook-contact-created");
            Services.obs.removeObserver(this.addressbookObserver, "addrbook-contact-updated");
            Services.obs.removeObserver(this.addressbookObserver, "addrbook-list-member-added");
            Services.obs.removeObserver(this.addressbookObserver, "addrbook-list-updated");
            this.addressbookListener.remove();
    },




    
    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    // * AbItem and AbDirectory Objects
    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    
    AbItem : class {
        constructor(abDirectory, item) {
            if (!abDirectory)
                throw new Error("AbItem::constructor is missing its first parameter!");

            if (!item)
                throw new Error("AbItem::constructor is missing its second parameter!");

            this._abDirectory = abDirectory;
            this._card = null;
            this._tempListDirectory = null;
            this._isMailList = false;
            
            if (item instanceof Components.interfaces.nsIAbDirectory) {
                this._tempListDirectory = item;
                this._isMailList = true;
            } else {
                this._card = item;
                this._isMailList = item.isMailList;
            }
        }
        
        get UID() {
            if (this._tempListDirectory) return this._tempListDirectory.UID;
            return this._card.UID;
        }
        
        get isMailList() {
            return this._isMailList;
        }
        
        //mailinglist aware method to get properties of cards
        //mailinglist properties cannot be stored in mailinglists themselves, so we store them in changelog
        getProperty(property, fallback = "") {
            if (property == "UID")
                return this.UID;
            
            if (this._isMailList) {
                let value = tbSync.db.getItemStatusFromChangeLog(this._abDirectory.UID, this.UID + "#" + property);
                return value ? value : fallback;    
            } else {
                return this._card.getProperty(property, fallback);
            }
        }

        //mailinglist aware method to set properties of cards
        //mailinglist properties cannot be stored in mailinglists themselves, so we store them in changelog
        setProperty(property, value) {
            // UID cannot be changed (currently)
            if (property == "UID")
                return;

            if (this._isMailList) {
                tbSync.db.addItemToChangeLog(this._abDirectory.UID, this.UID + "#" + property, value);
            } else {
                this._card.setProperty(property, value);
            }
        }
        
        deleteProperty(property) {
            if (this._isMailList) {
                tbSync.db.removeItemFromChangeLog(this._abDirectory.UID, this.UID + "#" + property);
            } else {
                this._card.deleteProperty(property);
            }
        }
        
        addPhoto(photo, bookUID, data) {	
            let dest = [];
            let card = this._card;
            
            //the TbSync storage must be set as last
            let book64 = btoa(bookUID);
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
                let binary = "";
                try {
                    binary = atob(data.split(" ").join(""));
                } catch (e) {
                    tbSync.dump("Failed to decode base64 string:", data);
                }
                foStream.write(binary, binary.length);
                foStream.close();

                filePath = 'file:///' + file.path.replace(/\\/g, '\/').replace(/^\s*\/?/, '').replace(/\ /g, '%20');
            }
            card.setProperty("PhotoName", photoName64);
            card.setProperty("PhotoType", "file");
            card.setProperty("PhotoURI", filePath);
            return filePath;
        }

        getPhoto() {	
            let card = this._card;
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
        }
        
        get changelogStatus() {
            // use UID as fallback key
            let key = this._abDirectory.changeLogKey;
            let value = key ? this.getProperty(key) : this.UID;
            return tbSync.db.getItemStatusFromChangeLog(this._abDirectory.UID, value);
        }

        set changelogStatus(status) {            
            //use UID as fallback key
            let key = this._abDirectory.changeLogKey;
            let value = key ? this.getProperty(key) : this.UID;

            if (value) {
                if (!status) {
                    tbSync.db.removeItemFromChangeLog(this._abDirectory.UID, value);
                    return;
                }            

                if (this._abDirectory.logUserChanges || value.endsWith("_by_server")) {
                    tbSync.db.addItemToChangeLog(this._abDirectory.UID, value, status);
                }
            }
        }
    },

    AbDirectory : class {
        constructor(directory, folderData) {
            this._directory = directory;
            this._provider = folderData.accountData.getAccountSetting("provider");
         }

        get logUserChanges() {
            return tbSync.providers[this._provider].addressbook.logUserChanges;
        }
        
        get changeLogKey() {
            return tbSync.providers[this._provider].addressbook.changeLogKey;
        }
        
        get UID() {
            return this._directory.UID;
        }

        get URI() {
            return this._directory.URI;
        }

        createNewCard() {
            let card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);                    
            return new tbSync.addressbook.AbItem(this, card);
        }

        createNewList() {
            let listDirectory = Components.classes["@mozilla.org/addressbook/directoryproperty;1"].createInstance(Components.interfaces.nsIAbDirectory);
            listDirectory.isMailList = true;
            return new tbSync.addressbook.AbItem(this, listDirectory);
        }

        add(abItem) {
           abItem.changelogStatus = "added_by_server";
            if (abItem.isMailList && abItem._tempListDirectory) {
                // update directory props first
                abItem._tempListDirectory.dirName = abItem.getProperty("ListName");
                abItem._tempListDirectory.listNickName = abItem.getProperty("ListNickName");
                abItem._tempListDirectory.description = abItem.getProperty("ListDescription");
                this._directory.addMailList(abItem._tempListDirectory);
                
                // the list has been added and we can now get the corresponding card via its UID
                let found = this.getItemFromProperty("UID", abItem.UID);
                abItem._tempListDirectory = null;
                abItem._card = found._card;

            } else if (!abItem.isMailList) {
                this._directory.addCard(abItem._card);

            } else {
                throw new Error("Cannot re-add a list to a directory.");
            }
        }
        
        modify(abItem) {
            if (abItem.changelogStatus != "modified_by_user") {
                abItem.changelogStatus = "modified_by_server";
            }
            if (abItem.isMailList) {                
                // get mailListDirectory
                let mailListDirectory = MailServices.ab.getDirectory(abItem._card.mailListURI);
                
                //update directory props
                mailListDirectory.dirName = abItem.getProperty("ListName");
                mailListDirectory.listNickName = abItem.getProperty("ListNickName");
                mailListDirectory.description = abItem.getProperty("ListDescription");

                // members:
                //mailListDirectory.addressLists.appendElement(newCard, false);

                // store
                mailListDirectory.editMailListToDatabase(abItem._card);
            } else {
                this._directory.modifyCard(abItem._card); 
            }
        }        
        
        remove(abItem) {
            abItem.changelogStatus = "deleted_by_server";
            let delArray = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
            delArray.appendElement(abItem._card, true);
            this._directory.deleteCards(delArray);
        }
        
        getItemFromProperty(property, value) {
            // try to use the standard card method first
            let card = this._directory.getCardFromProperty(property, value, true);
            if (card) {
                return new tbSync.addressbook.AbItem(this, card);
            }
            
            // search for list cards
            // we cannot search for the prop directly, because for mailinglists
            // they are not part of the card (expect UID) but stored in a custom storage
            let searchList = "(IsMailList,=,TRUE)"; 
            let result = MailServices.ab.getDirectory(this._directory.URI +  "?(or" + searchList+")").childCards;
            while (result.hasMoreElements()) {
                let card = new tbSync.addressbook.AbItem(this, result.getNext().QueryInterface(Components.interfaces.nsIAbCard));
                //does this list card have the req prop?
                if (card.getProperty(property) == value) {
                    return card;
                }
            }
            return null;
        }

        getAddedItemsFromChangeLog(maxitems = 0) {             
            return tbSync.db.getItemsFromChangeLog(this._directory.UID, maxitems, "added_by_user").map(item => item.id);
        }

        getModifiedItemsFromChangeLog(maxitems = 0) {             
            return tbSync.db.getItemsFromChangeLog(this._directory.UID, maxitems, "modified_by_user").map(item => item.id);
        }
        
        getDeletedItemsFromChangeLog(maxitems = 0) {             
            return tbSync.db.getItemsFromChangeLog(this._directory.UID, maxitems, "deleted_by_user").map(item => item.id);
        }
        
        getItemsFromChangeLog(maxitems = 0) {             
            let changes = [];
            let dbChanges = tbSync.db.getItemsFromChangeLog(this._directory.UID, maxitems, "_by_user");
            for (let change of dbChanges) {
                change.card = this.getItemFromProperty(this.changeLogKey, change.id);
                changes.push(change);
            }
            return changes;
        }

        removeItemFromChangeLog(id) {             
            tbSync.db.removeItemFromChangeLog(this._directory.UID, id);
        }
        
    },




    
    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    // * TargetData implementation 
    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    
    TargetData : class {
        constructor(folderData) {            
            this._targetType = folderData.getFolderSetting("targetType");
            this._folderData = folderData;
            this._targetObj = null;
        }
        
        get targetType() { // return the targetType, this was initialized with
            return this._targetType;
        }
        
        checkTarget() {
            return tbSync.addressbook.checkAddressbook(this._folderData);
        }

        getTarget() {
            let directory = tbSync.addressbook.checkAddressbook(this._folderData);
            
            if (!directory) {
                // create a new addressbook and store its UID in folderData
                directory = tbSync.addressbook.createAddressbook(this._folderData);
                if (!directory)
                    throw new Error("CouldNotGetOrCreateTarget");
            }
            
            if (!this._targetObj || this._targetObj.UID != directory.UID)
                this._targetObj = new tbSync.addressbook.AbDirectory(directory, this._folderData);

            return this._targetObj;
        }
        
        removeTarget() {
            let directory = tbSync.addressbook.checkAddressbook(this._folderData);
            tbSync.db.addItemToChangeLog(directory.UID, "self", "deleted_by_server");

            try {
                if (directory) {
                    MailServices.ab.deleteAddressBook(directory.URI);
                }
            } catch (e) {}
            // this will be catched by listeners, wo reset everything else
        }
        
        decoupleTarget(suffix, cacheFolder = false) {
            let directory = tbSync.addressbook.checkAddressbook(this._folderData);

            if (directory) {
                // decouple directory from the connected folder
                let target = this._folderData.getFolderSetting("target");
                this._folderData.resetFolderSetting("target");

                //if there are local changes, append an  (*) to the name of the target
                let c = 0;
                let a = tbSync.db.getItemsFromChangeLog(target, 0, "_by_user");
                for (let i=0; i<a.length; i++) c++;
                if (c>0) suffix += " (*)";

                //this is the only place, where we manually have to call clearChangelog, because the target is not deleted
                //(on delete, changelog is cleared automatically)
                tbSync.db.clearChangeLog(target);
                if (suffix) {
                    let orig = directory.dirName;
                    directory.dirName = "Local backup of: " + orig + " " + suffix;
                }
            }
            
            //should we remove the folder by setting its state to cached?
           if (cacheFolder) {
               this._folderData.setFolderSetting("cached", "1");
           }
        }     
    },




    
    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    // * Internal Functions
    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    
    checkAddressbook: function (folderData) {
        if (folderData.getFolderSetting("cached") != "1") {
            let target = folderData.getFolderSetting("target");
            let directory = this.getDirectoryFromDirectoryUID(target);
            
            if (directory !== null && directory instanceof Components.interfaces.nsIAbDirectory) {
                //check for double targets - just to make sure
                let folders = tbSync.db.findFoldersWithSetting(["target", "cached"], [target, "0"], "account", folderData.accountID);
                if (folders.length == 1) {
                    return directory;
                } else {
                    throw "Target with multiple source folders found! Forcing hard fail ("+target+")."; 
                }
            }
        }
        
        return null;
    },

    createAddressbook: function (folderData) {
        let target = folderData.getFolderSetting("target");
        let provider = folderData.accountData.getAccountSetting("provider");
        
        // Get cached or new unique name for new address book
        let cachedName = folderData.getFolderSetting("targetName");                         
        let basename = cachedName == "" ? folderData.accountData.getAccountSetting("accountname") + " (" + folderData.getFolderSetting("name")+ ")" : cachedName;

        let count = 1;
        let unique = false;
        let newname = basename;
        do {
            unique = true;
            let booksIter = MailServices.ab.directories;
            while (booksIter.hasMoreElements()) {
                let data = booksIter.getNext();
                if (data instanceof Components.interfaces.nsIAbDirectory && data.dirName == newname) {
                    unique = false;
                    break;
                }
            }
            if (!unique) {
                newname = basename + " #" + count;
                count = count + 1;
            }
        } while (!unique);
        
        //Create the new book with the unique name
        let directory = tbSync.providers[folderData.accountData.getAccountSetting("provider")].addressbook.createAddressBook(newname, folderData);
        if (directory && directory instanceof Components.interfaces.nsIAbDirectory) {
            directory.setStringValue("tbSyncProvider", provider);
            
            tbSync.providers[provider].api.onResetTarget(folderData);
            
            folderData.setFolderSetting("target", directory.UID);            
            folderData.setFolderSetting("targetName", basename);
            //notify about new created address book
            Services.obs.notifyObservers(null, 'tbsync.observer.addressbook.created', null)
            return directory;
        }
        
        return null;
    },

    //deprecate!!!
    getUriFromDirectoryId : function(directoryId) {
        //alternative: use UID only, loop over all directory to get the prefid, use MailServices.ab.getDirectoryFromId(dirId); to get the directoyr - do not use URLs anymore
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

    getFolderFromDirectoryUID: function(bookUID) {
        let folders = tbSync.db.findFoldersWithSetting(["target", "cached"], [bookUID, "0"]);
        if (folders.length == 1) {
            let accountData = new tbSync.AccountData(folders[0].accountID);
            return new tbSync.FolderData(accountData, folders[0].folderID);
        }
        return null;
    },
    
    getDirectoryFromDirectoryUID: function(UID) {
        let directories = MailServices.ab.directories;
        while (UID && directories.hasMoreElements()) {
            let directory = directories.getNext();
            if (directory instanceof Components.interfaces.nsIAbDirectory) {
                if (directory.UID == UID) return directory;
            }
        }       
        return null;
    },
    
    getListInfoFromListUID: function(UID) {
        let directories = MailServices.ab.directories;
        while (directories.hasMoreElements()) {
            let directory = directories.getNext();
            if (directory instanceof Components.interfaces.nsIAbDirectory && !directory.isRemote) {
                let searchList = "(IsMailList,=,TRUE)(UID,=,"+UID+")";
                let result = MailServices.ab.getDirectory(directory.URI +  "?(and" + searchList+")").childCards;
                if (result.hasMoreElements()) {
                    let listCard = result.getNext().QueryInterface(Components.interfaces.nsIAbCard);
                    return {directory, listCard};
                }
            }
        }       
        throw new Error("List with UID <" + UID + "> does not exists");
    },




    
    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    // * Addressbook Observer and Listener
    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    
    addressbookObserver: {
        observe: function (aSubject, aTopic, aData) {
            switch (aTopic) {
                // we do not need addrbook-created
                case "addrbook-updated":
                case "addrbook-removed":
                {
                    //aSubject: nsIAbDirectory (we can get URI and UID directly from the object, but the directory no longer exists)
                    aSubject.QueryInterface(Components.interfaces.nsIAbDirectory);
                    let bookUID = aSubject.UID;
                    
                    let folderData = tbSync.addressbook.getFolderFromDirectoryUID(bookUID);
                    if (folderData 
                        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountSetting("provider"))
                        && folderData.getFolderSetting("targetType") == "addressbook") {

                        let itemStatus = tbSync.db.getItemStatusFromChangeLog(bookUID, "self");
                        let serverAction = false;
                        if (itemStatus && itemStatus.endsWith("_by_server")) {
                            //we caused this, ignore
                            tbSync.db.removeItemFromChangeLog(bookUID, "self");
                            serverAction = true;
                        }
                            
                        switch(aTopic) {
                            case "addrbook-updated": 
                            {
                                //update name of target (if changed)
                                folderData.setFolderSetting("targetName", aSubject.dirName);                         
                                //update settings window, if open
                                 Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);
                            }
                            break;

                            case "addrbook-removed": 
                            {
                                //delete any pending changelog of the deleted book
                                tbSync.db.clearChangeLog(bookUID);			

                                //unselect book if deleted by user and update settings window, if open
                                if (folderData.getFolderSetting("selected") == "1") {
                                    folderData.setFolderSetting("selected", "0");
                                    //update settings window, if open
                                    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);
                                }
                                
                                folderData.resetFolderSetting("target");
                            }
                            break;
                        }
                        if (!serverAction) {
                            tbSync.providers[folderData.accountData.getAccountSetting("provider")].addressbook.directoryObserver(aTopic, folderData);                        
                        }
                    }
                }
                break;             

                case "addrbook-contact-created":
                case "addrbook-contact-updated":
                case "addrbook-contact-removed":
                {
                    //aSubject: nsIAbCard
                    aSubject.QueryInterface(Components.interfaces.nsIAbCard);
                    //aData: 128-bit unique identifier for the parent directory
                    let bookUID = aData;

                    let folderData = tbSync.addressbook.getFolderFromDirectoryUID(bookUID);                    
                    if (folderData 
                        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountSetting("provider"))
                        && folderData.getFolderSetting("targetType") == "addressbook") {
                        
                        let directory = tbSync.addressbook.getDirectoryFromDirectoryUID(bookUID);
                        let abDirectory = new tbSync.addressbook.AbDirectory(directory, folderData);
                        let abItem = new tbSync.addressbook.AbItem(abDirectory, aSubject);

                        // during create it could happen, that this card comes without a UID Property - bug 1554782
                        // we must use the raw aSubject, as abItem will redirect this call to .UID
                        if (aTopic == "addrbook-contact-created" && aSubject.getProperty("UID","") == "") {
                            // a call to .UID will generate a UID but will also send an update notification for the the card
                            tbSync.db.addItemToChangeLog(bookUID, aSubject.uuid + "#delayedCreation", "true"); //uuid = directoryId+localId
                            aSubject.UID;
                            return;

                        } else {
                            let topic = aTopic;
                           
                            //check for delayedCreation
                            if (aTopic == "addrbook-contact-updated" && tbSync.db.getItemStatusFromChangeLog(bookUID, aSubject.uuid + "#delayedCreation") == "true") {;
                                topic = "addrbook-contact-created";
                                tbSync.db.removeItemFromChangeLog(bookUID, aSubject.uuid + "#delayedCreation");
                            }
                        
                            let itemStatus = abItem.changelogStatus;
                            if (itemStatus && itemStatus.endsWith("_by_server")) {
                                //we caused this, ignore
                                abItem.changelogStatus = "";
                                return;
                            }

                            // update changelog based on old status
                            switch (topic) {
                                case "addrbook-contact-created":
                                {
                                    switch (itemStatus) {
                                        case "added_by_user": 
                                            // double notification, which is probably impossible, ignore
                                            return;

                                        case "modified_by_user": 
                                            // late create notification
                                            abItem.changelogStatus = "added_by_user";
                                            break;

                                        case "deleted_by_user":
                                            // unprocessed delete for this card, undo the delete (moved out and back in)
                                            abItem.changelogStatus = "modified_by_user";
                                            break;
                                        
                                        default:
                                            // new card
                                            abItem.changelogStatus = "added_by_user";
                                    }
                                }
                                break;

                                case "addrbook-contact-updated":
                                {
                                    switch (itemStatus) {
                                        case "added_by_user": 
                                            // unprocessed add for this card, keep status
                                            break;

                                        case "modified_by_user": 
                                            // double notification, keep status
                                            break;

                                        case "deleted_by_user":
                                            // race? unprocessed delete for this card, moved out and back in and modified
                                        default: 
                                            abItem.changelogStatus = "modified_by_user";
                                            break;
                                    }
                                }
                                break;
                                
                                case "addrbook-contact-removed":
                                {
                                    switch (itemStatus) {
                                        case "added_by_user": 
                                            // unprocessed add for this card, revert
                                            abItem.changelogStatus = "";
                                            return;

                                        case "modified_by_user": 
                                            // unprocessed mod for this card
                                        case "deleted_by_user":
                                            // double notification
                                        default: 
                                            abItem.changelogStatus = "deleted_by_user";
                                            break;
                                    }
                                }
                                break;
                            }

                            tbSync.core.setTargetModified(folderData);
                            tbSync.providers[folderData.accountData.getAccountSetting("provider")].addressbook.cardObserver(topic, folderData, abItem);
                        }
                    }
                }
                break;

                case "addrbook-list-created": 
                case "addrbook-list-removed": 
                {
                    //aSubject: nsIAbCard (ListCard)
                    aSubject.QueryInterface(Components.interfaces.nsIAbCard);
                    //aData: 128-bit unique identifier for the parent directory
                    let bookUID = aData;

                    let folderData = tbSync.addressbook.getFolderFromDirectoryUID(bookUID);
                    if (folderData 
                        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountSetting("provider"))
                        && folderData.getFolderSetting("targetType") == "addressbook") {

                        let directory = tbSync.addressbook.getDirectoryFromDirectoryUID(bookUID);
                        let abDirectory = new tbSync.addressbook.AbDirectory(directory, folderData);
                        let abItem = new tbSync.addressbook.AbItem(abDirectory, aSubject);
                    
                        let itemStatus = abItem.changelogStatus;
                        if (itemStatus && itemStatus.endsWith("_by_server")) {
                            //we caused this, ignore
                            abItem.changelogStatus = "";
                            return;
                        }

                        // update changelog based on old status
                        switch (aTopic) {
                            case "addrbook-list-created":
                            {
                                switch (itemStatus) {
                                    case "added_by_user": 
                                        // double notification, which is probably impossible, ignore
                                        return;

                                    case "modified_by_user": 
                                        // late create notification
                                        abItem.changelogStatus = "added_by_user";
                                        break;

                                    case "deleted_by_user":
                                        // unprocessed delete for this card, undo the delete (moved out and back in)
                                        abItem.changelogStatus = "modified_by_user";
                                        break;
                                    
                                    default:
                                        // new list
                                        abItem.changelogStatus = "added_by_user";
                                        break;
                                }
                            }
                            break;

                            case "addrbook-list-removed":
                            {
                                switch (itemStatus) {
                                    case "added_by_user": 
                                        // unprocessed add for this card, revert
                                        abItem.changelogStatus = "";
                                        return;

                                    case "modified_by_user": 
                                        // unprocessed mod for this card
                                    case "deleted_by_user":
                                        // double notification
                                    default: 
                                        abItem.changelogStatus = "deleted_by_user";
                                        break;
                                }
                            }
                            break;
                        }

                        tbSync.core.setTargetModified(folderData);
                        tbSync.providers[folderData.accountData.getAccountSetting("provider")].addressbook.listObserver(aTopic, folderData, abItem, null);
                    }
                }
                break;

                case "addrbook-list-updated": 
                {
                    // aSubject: nsIAbDirectory
                    aSubject.QueryInterface(Components.interfaces.nsIAbDirectory);
                    // get the card representation of this list, including its parent directory
                    let listInfo = tbSync.addressbook.getListInfoFromListUID(aSubject.UID);
                    let bookUID = listInfo.directory.UID;

                    let folderData = tbSync.addressbook.getFolderFromDirectoryUID(bookUID);
                    if (folderData 
                        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountSetting("provider"))
                        && folderData.getFolderSetting("targetType") == "addressbook") {

                        let abDirectory = new tbSync.addressbook.AbDirectory(listInfo.directory, folderData);
                        let abItem = new tbSync.addressbook.AbItem(abDirectory, listInfo.listCard);

                        let itemStatus = abItem.changelogStatus;
                        if (itemStatus && itemStatus.endsWith("_by_server")) {
                            //we caused this, ignore
                            abItem.changelogStatus = "";
                            return;
                        }

                        // update changelog based on old status
                        switch (aTopic) {
                            case "addrbook-list-updated":
                            {
                                switch (itemStatus) {
                                    case "added_by_user": 
                                        // unprocessed add for this card, keep status
                                        break;

                                    case "modified_by_user": 
                                        // double notification, keep status
                                        break;

                                    case "deleted_by_user":
                                        // race? unprocessed delete for this card, moved out and back in and modified
                                    default: 
                                        abItem.changelogStatus = "modified_by_user";
                                        break;
                                }
                            }
                            break;
                        }
                        
                        // To simplify mail list management, we shadow its core properties, need to update them now
                        abItem.setProperty("ListName", aSubject.dirName);
                        abItem.setProperty("ListNickName", aSubject.listNickName);
                        abItem.setProperty("ListDescription", aSubject.description);
                        
                        tbSync.core.setTargetModified(folderData);
                        tbSync.providers[folderData.accountData.getAccountSetting("provider")].addressbook.listObserver(aTopic, folderData, abItem, null);
                    }
                }
                break;
                
                // unknow, if called for programatically added members as well, probably not
                case "addrbook-list-member-added": //exclude contact without Email - notification is wrongly send
                case "addrbook-list-member-removed":
                {
                    //aSubject: nsIAbCard of Member
                    aSubject.QueryInterface(Components.interfaces.nsIAbCard);
                    //aData: 128-bit unique identifier for the list
                    let listInfo = tbSync.addressbook.getListInfoFromListUID(aData);
                    let bookUID = listInfo.directory.UID;

                    let folderData = tbSync.addressbook.getFolderFromDirectoryUID(bookUID);
                    if (folderData 
                        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountSetting("provider"))
                        && folderData.getFolderSetting("targetType") == "addressbook") {
                        
                        let abDirectory = new tbSync.addressbook.AbDirectory(listInfo.directory, folderData);
                        let abItem = new tbSync.addressbook.AbItem(abDirectory, listInfo.listCard);
                        let abMember = new tbSync.addressbook.AbItem(abDirectory, aSubject);

                        tbSync.core.setTargetModified(folderData);
                        tbSync.providers[folderData.accountData.getAccountSetting("provider")].addressbook.listObserver(aTopic, folderData, abItem, abMember);
                    }
                }
                break;

            }
        }
    },
    

    // Geoff added new observers but these observers cannot catch everything
    // Use the listeners to make up for that
    addressbookListener: {

        onItemPropertyChanged: function addressbookListener_onItemPropertyChanged(aItem, aProperty, aOldValue, aNewValue) {
            //redirect to addrbook-updated observers
            if (aItem instanceof Components.interfaces.nsIAbDirectory
                    && !aItem.isMailList) {
                tbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-updated", null);
            }
        },

        onItemRemoved: function addressbookListener_onItemRemoved (aParentDir, aItem) {
            // redirect to addrbook-list-member-removed observers 
            // unsafe and buggy - see bug 1555294 - can be removed after that landed
            if (aItem instanceof Components.interfaces.nsIAbCard
                    && aParentDir instanceof Components.interfaces.nsIAbDirectory 
                    && !aItem.isMailList
                    && aParentDir.isMailList) {
                tbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-list-member-removed", aParentDir.UID)
            }

            //redirect to addrbook-contact-removed observers
            if (aItem instanceof Components.interfaces.nsIAbCard 
                    && aParentDir instanceof Components.interfaces.nsIAbDirectory 
                    && !aItem.isMailList
                    && !aParentDir.isMailList) {
                tbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-contact-removed", aParentDir.UID)
            }

            //redirect to addrbook-list-removed observers
            if (aItem instanceof Components.interfaces.nsIAbCard 
                    && aParentDir instanceof Components.interfaces.nsIAbDirectory 
                    && aItem.isMailList
                    && !aParentDir.isMailList) {
                tbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-list-removed", aParentDir.UID)
            }

            //redirect to addrbook-removed observers
            if (aItem instanceof Components.interfaces.nsIAbDirectory
                    && !aItem.isMailList) {
                tbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-removed", null)
            }
        },

        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {          
            //redirect to addrbook-list-created observers
            if (aItem instanceof Components.interfaces.nsIAbCard 
                    && aParentDir instanceof Components.interfaces.nsIAbDirectory 
                    && aItem.isMailList
                    && !aParentDir.isMailList) {
                tbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-list-created", aParentDir.UID)
            } 
            
            //redirect to addrbook-contact-created observers
            if (aItem instanceof Components.interfaces.nsIAbCard 
                    && aParentDir instanceof Components.interfaces.nsIAbDirectory 
                    && aItem.getProperty("UID","") == "" //detect the only case where the original addrbook-contact-created observer fails to notify
                    && !aItem.isMailList
                    && !aParentDir.isMailList) {
                tbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-contact-created", aParentDir.UID)
            } 
        },

        add: function addressbookListener_add () {
            let flags = Components.interfaces.nsIAbListener;
            MailServices.ab.addAddressBookListener(this, flags.all);
        },

        remove: function addressbookListener_remove () {
            MailServices.ab.removeAddressBookListener(this);
        }
    },
}
