/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";



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

    AbCard : class {
        constructor(abDirectory, card = null) {
            this._abDirectory = abDirectory;
            if (card)
                this._card = card;
            else
                this._card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
        }
        
        get UID() {
            return this._card.UID;
        }
        
        get isMailList() {
            return this._card.isMailList
        }
        
        //mailinglist aware method to get properties of cards
        //mailinglist properties cannot be stored in mailinglists themselves, so we store them in changelog
        getProperty(property, fallback = "") {
            if (this._card.isMailList) {
                let value = tbSync.db.getItemStatusFromChangeLog(this._card.directoryId, this._card.UID + "#" + property);
                return value ? value : fallback;    
            } else {
                return this._card.getProperty(property, fallback);
            }
        }

        //mailinglist aware method to set properties of cards
        //mailinglist properties cannot be stored in mailinglists themselves, so we store them in changelog
        setProperty(property, value) {
            if (this._card.isMailList) {
                tbSync.db.addItemToChangeLog(this._card.directoryId, this._card.UID + "#" + property, value);
            } else {
                this._card.setProperty(property, value);
            }
        }
        
        deleteProperty(property) {
            if (this._card.isMailList) {
                tbSync.db.removeItemFromChangeLog(this._card.directoryId, this._card.UID + "#" + property);
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
            return tbSync.db.getItemStatusFromChangeLog(this._abDirectory.UID, this.getProperty(this._abDirectory.changeLogKey,""));
        }

        set changelogStatus(status) {
            tbSync.db.addItemToChangeLog(this._abDirectory.UID, this.getProperty(this._abDirectory.changeLogKey,""), status);            
        }
    },

    AbDirectory : class {
        constructor(directory, folderData) {
            this._directory = directory;
            this._provider = folderData.accountData.getAccountSetting("provider");
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
            return new tbSync.addressbook.AbCard(this);
        }
        
        addCard(abCard) {
            if (this.changeLogKey) {
               abCard.changelogStatus = "added_by_server";
            }
            this._directory.addCard(abCard._card);
        }
        
        modifyCard(abCard) {
            if (this.changeLogKey && /*syncdata.revert ||*/  abCard.changelogStatus != "modified_by_user") {
                abCard.changelogStatus = "modified_by_server";
            }
            this._directory.modifyCard(card._card); 
        }        
        
        deleteCard(card) {
            if (this.changeLogKey) {
               abCard.changelogStatus = "deleted_by_server";
            }
            let delArray = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
            delArray.appendElement(card._card, true);
            this._directory.deleteCards(delArray);
        }
        
        getCardFromProperty(property, value) {
            //try to use the standard contact card method first
            let card = this._directory.getCardFromProperty(property, value, true);
            if (card) {
                return new tbSync.addressbook.AbCard(this, card);
            }
            
            //search for list cards
            let searchList = "(IsMailList,=,TRUE)"; //we could search for the prop directly in searchlist?
            let result = MailServices.ab.getDirectory(this._directory.URI +  "?(and" + searchList+")").childCards;
            while (result.hasMoreElements()) {
                let card = result.getNext().QueryInterface(Components.interfaces.nsIAbCard);
                //does this list card have the req prop?
                if (card.getProperty(card, property) == value) {
                        return new tbSync.addressbook.AbCard(this, card);
                }
            }
            return null;
        }

        getAddedItemsFromChangeLog(maxitems = 0) {             
            if (this.changeLogKey) {
                return tbSync.db.getItemsFromChangeLog(this._directory.UID, maxitems, "added_by_user").map(item => item.id);
            }
            return [];
        }

        getModifiedItemsFromChangeLog(maxitems = 0) {             
            if (this.changeLogKey) {
                return tbSync.db.getItemsFromChangeLog(this._directory.UID, maxitems, "modified_by_user").map(item => item.id);
            }
            return [];
        }
        
        getDeletedItemsFromChangeLog(maxitems = 0) {             
            if (this.changeLogKey) {
                return tbSync.db.getItemsFromChangeLog(this._directory.UID, maxitems, "deleted_by_user").map(item => item.id);
            }
            return [];
        }

        _regroup(obj) {
            let newObj = {};
            newObj.id = obj.id;
            newObj.status = obj.status;
            let card = this.getCardFromProperty(this.changeLogKey, obj.id);
            newObj.card = card ? card : null
            return newObj;
        }
        
        getItemsFromChangeLog(maxitems = 0) {             
            if (this.changeLogKey) {
                return tbSync.db.getItemsFromChangeLog(this._directory.UID, maxitems, "_by_user").map(this._regroup);
            }
            return [];
        }

        removeItemFromChangeLog(id) {             
            if (this.changeLogKey) {
                tbSync.db.removeItemFromChangeLog(this._directory.UID, id);
            }
        }
        
    },

    TargetData : class {
        constructor(folderData) {            
            this._targetType = folderData.getFolderSetting("targetType");
            this._folderData = folderData;
            this._targetObj = null;
        }
        
        get targetType() { // return the targetType, this was initialized with
            return this._targetType;
        }
        
        getTarget() {
            let directory = tbSync.addressbook.getAddressbook(this._folderData);
            
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
            let directory = tbSync.addressbook.getAddressbook(this._folderData);
            try {
                if (directory) {
                    MailServices.ab.deleteAddressBook(directory.URI);
                }
            } catch (e) {}
            // this will be catched by listeners, wo reset everything else
        }
        
        decoupleTarget(suffix, cacheFolder = false) {
            let directory = tbSync.addressbook.getAddressbook(this._folderData);

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
        while (directories.hasMoreElements()) {
            let directory = directories.getNext();
            if (directory instanceof Components.interfaces.nsIAbDirectory) {
                if (directory.UID == UID) return directory;
            }
        }       
        return null;
    },
    
    // returns the card and the directory representation of this ML and also its parent
    getListInfoFromUID: function(UID) {
        let directories = MailServices.ab.directories;
        while (directories.hasMoreElements()) {
            let directory = directories.getNext();
            if (directory instanceof Components.interfaces.nsIAbDirectory && !directory.isRemote) {
                let searchList = "(IsMailList,=,TRUE)(UID,=,"+UID+")";
                let result = MailServices.ab.getDirectory(directory.URI +  "?(and" + searchList+")").childCards;
                if (result.hasMoreElements()) {
                    let listCard = result.getNext().QueryInterface(Components.interfaces.nsIAbCard);
                    let listDirectory = MailServices.ab.getDirectory(listCard.mailListURI);
                    return {parentDirectory: directory, listCard: listCard, listDirectory: listDirectory};
                }
            }
        }       
        throw new Error("List with UID <" + UID + "> does not exists");
    },



    
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

                        tbSync.providers[folderData.accountData.getAccountSetting("provider")].addressbook.directoryObserver(aTopic, folderData);                        
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
                        
                        // during create it could happen, that this card comes without a UID Property - bug 1554782
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
                            
                            // update changelog based on old status
                            let changeLogKey = tbSync.providers[folderData.accountData.getAccountSetting("provider")].addressbook.changeLogKey;
                            if (changeLogKey) {
                                let changeLogKeyValue = aSubject.getProperty(changeLogKey, "");

                                let itemStatus = tbSync.db.getItemStatusFromChangeLog(bookUID, changeLogKeyValue);
                                if (itemStatus && itemStatus.endsWith("_by_server")) {
                                    //we caused this, ignore
                                    tbSync.db.removeItemFromChangeLog(bookUID, changeLogKeyValue);
                                    return;
                                }

                                switch (topic) {
                                    case "addrbook-contact-created":
                                    {
                                        switch (itemStatus) {
                                            case "added_by_user": 
                                                // double notification, which is probably impossible, ignore
                                                return;

                                            case "modified_by_user": 
                                                // late create notification
                                                tbSync.db.addItemToChangeLog(bookUID, changeLogKeyValue, "added_by_user");
                                                break;

                                            case "deleted_by_user":
                                                // unprocessed delete for this card, undo the delete (moved out and back in)
                                                tbSync.db.addItemToChangeLog(bookUID, changeLogKeyValue, "modified_by_user");
                                                break;
                                            
                                            default:
                                                // new card
                                                tbSync.db.addItemToChangeLog(bookUID, changeLogKeyValue, "added_by_user");
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
                                                tbSync.db.addItemToChangeLog(bookUID, changeLogKeyValue, "modified_by_user");
                                                break;
                                        }
                                    }
                                    break;
                                    
                                    case "addrbook-contact-removed":
                                    {
                                        switch (itemStatus) {
                                            case "added_by_user": 
                                                // unprocessed add for this card, revert
                                                tbSync.db.removeItemFromChangeLog(bookUID, changeLogKeyValue);
                                                return;

                                            case "modified_by_user": 
                                                // unprocessed mod for this card
                                            case "deleted_by_user":
                                                // double notification
                                            default: 
                                                tbSync.db.addItemToChangeLog(bookUID, changeLogKeyValue, "deleted_by_user");
                                                break;
                                        }
                                    }
                                    break;
                                }
                            }

                            tbSync.core.setTargetModified(folderData);
                            tbSync.providers[folderData.accountData.getAccountSetting("provider")].addressbook.cardObserver(topic, folderData, aSubject);
                        }
                    }
                }
                break;

                case "addrbook-list-created": 
                case "addrbook-list-removed": 
                {
                    //aSubject: nsIAbCard (ListCard)
                    aSubject.QueryInterface(Components.interfaces.nsIAbCard);
                    let listUID = aSubject.UID;
                    //aData: 128-bit unique identifier for the parent directory
                    let folderData = tbSync.addressbook.getFolderFromDirectoryUID(aData);
                    
                    if (folderData 
                            && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountSetting("provider"))
                            && folderData.getFolderSetting("targetType") == "addressbook") {

                        let abListData = new tbSync.AbListData(aSubject);
                        
                        // check changelog for pile up or other stuff 
                        //tbSync.providers[folderData.accountData.getAccountSetting("provider")].addressbook.listObserver(aTopic, folderData, abListData);
                    }
                }
                break;

                case "addrbook-list-updated": 
                {
                    //aSubject: nsIAbDirectory
                    aSubject.QueryInterface(Components.interfaces.nsIAbDirectory);
                    let listUID = aSubject.UID;
                    
                    // to get its parent, we need to do a global UID search, even though we have the directory already 
                    // there is no save way to get the parent of a directory
                    let listInfo = tbSync.addressbook.getListInfoFromUID(listUID);
                    let folderData = tbSync.addressbook.getFolderFromDirectoryUID(listInfo.parentDirectory.UID);
                    if (folderData 
                            && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountSetting("provider"))
                            && folderData.getFolderSetting("targetType") == "addressbook") {

                        let abListData = new tbSync.AbListData(listInfo.listCard);
                        
                        // check changelog for pile up or other stuff 
                        //tbSync.providers[folderData.accountData.getAccountSetting("provider")].addressbook.listObserver(aTopic, folderData, abListData);
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
                    let listInfo = tbSync.addressbook.getListInfoFromUID(aData);

                    let folderData = tbSync.addressbook.getFolderFromDirectoryUID(listInfo.parentDirectory.UID);
                    if (folderData 
                            && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountSetting("provider"))
                            && folderData.getFolderSetting("targetType") == "addressbook") {

                        let abListData = new tbSync.AbListData(listInfo.listCard);
                        
                        // check changelog for pile up or other stuff 
                        //tbSync.providers[folderData.accountData.getAccountSetting("provider")].addressbook.listObserver(aTopic, folderData, abListData);
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





    getAddressbook: function (folderData) {
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
    }
}
