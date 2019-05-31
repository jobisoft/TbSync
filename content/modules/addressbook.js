/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
 
var AbDirectoryData = class {
    constructor(UID) {
        this._directory = addressbook.getDirectoryFromDirectoryUID(UID);
     }

    get UID() {
        return this._directory.UID;
    }

    addCard(card) {
        //if (card.constructor.name != "AbCardData") throw new Error("Wrong datatype");
        tbSync.db.addItemToChangeLog(this._directory.UID, card.UID, "added_by_server");
        this._directory.addCard(card._card);
    }
    
    modifyCard(card) {
        if (/*syncdata.revert ||*/tbSync.db.getItemStatusFromChangeLog(this._directory.UID, card.UID) != "modified_by_user") {
            tbSync.db.addItemToChangeLog(this._directory.UID, card.UID, "modified_by_server");
        }
        this._directory.modifyCard(card._card); 
    }        
    
    deleteCard(card) {
        let delArray = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
        delArray.appendElement(card._card, true);
        this._directory.deleteCards(delArray);
    }
    
    getCardFromProperty(property, value) {
        //try to use the standard contact card method first
        let card = this._directory.getCardFromProperty(property, value, true);
        if (card) {
            return new AbCardData(card);
        }
        
        //search for list cards
        let searchList = "(IsMailList,=,TRUE)";
        let result = MailServices.ab.getDirectory(this._directory.URI +  "?(or" + searchList+")").childCards;
        while (result.hasMoreElements()) {
            let card = new AbCardData(result.getNext().QueryInterface(Components.interfaces.nsIAbCard));
            //does this list card have the req prop?
            if (card.getProperty(card, property) == value) {
                    return new AbCardData(card);
            }
        }
        return null;
    }
}

 var AbCardData = class {
    constructor(aCard = null) {
        if (aCard)
            this._card = aCard;
        else
            this._card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
    }
    
    get UID() {
        return this._card.UID;
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
            tbSync.db.removeItemFromChangeLog(this._card.directoryId, this._card.UID + "#" + propert);
        } else {
            this._card.deleteProperty(property);
        }
    }
}

var AbListData = class {
    constructor(aList) {
        this._list = aList;
    }
    
    get UID() {
        return this._list.getProperty("UID","");
    }
    
/*
   
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
        return this.getCardFromProperty(addressBook, "TBSYNCID", id);
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
*/    
}


var addressbook = {

    delayedCreation: [],
    
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
        let folders = tbSync.db.findFoldersWithSetting(["target"], [bookUID]);
        if (folders.length == 1) {
            return new tbSync.AccountData(folders[0].accountID, folders[0].folderID);
        }
        return null;
    },

    removeBook: function (UID) { 
        let directory = this.getDirectoryFromDirectoryUID(UID);
        try {
            if (directory) {
                MailServices.ab.deleteAddressBook(directory.URI);
            }
        } catch (e) {}
    },
    
    changeNameOfBook: function (UID, newname) { 
        let directory = this.getDirectoryFromDirectoryUID(UID);
        if (directory) {
            let orig = directory.dirName;
            directory.dirName = newname.replace("%ORIG%", orig);
        }
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
            Services.console.logStringMessage("[" + aTopic + "]");
            switch (aTopic) {
                // we do not need addrbook-created
                case "addrbook-updated":
                case "addrbook-removed":
                {
                    //aSubject: nsIAbDirectory (we can get URI and UID directly from the object, but the directory no longer exists)
                    aSubject.QueryInterface(Components.interfaces.nsIAbDirectory);
                    let bookUID = aSubject.UID;
                    
                    let folderData = tbSync.addressbook.getFolderFromDirectoryUID(bookUID);
                    if (folderData && tbSync.providers.loadedProviders.hasOwnProperty(folderData.getAccountSetting("provider"))) {
                        
                        switch(aTopic) {
                            case "addrbook-updated": 
                            {
                                //update name of target (if changed)
                                folderData.setFolderSetting("targetName", aSubject.dirName);                         
                                //update settings window, if open
                                 Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.account);
                            }
                            break;

                            case "addrbook-removed": 
                            {
                                //delete any pending changelog of the deleted book
                                tbSync.db.clearChangeLog(bookUID);			

                                //unselect book if deleted by user (book is cached if delete during disable) and update settings window, if open
                                if (folderData.getFolderSetting("selected") == "1" && folderData.getFolderSetting("cached") != "1") {
                                    folderData.setFolderSetting("selected", "0");
                                    //update settings window, if open
                                    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate",folderData.account);
                                }
                                
                                folderData.resetFolderSetting("target");
                            }
                            break;
                        }

                        tbSync.providers[folderData.getAccountSetting("provider")].addressbook.directoryObserver(aTopic, folderData);                        
                    }
                }
                break;             




                case "addrbook-contact-created":
                case "addrbook-contact-updated":
                case "addrbook-contact-removed":
                {
                    Services.console.logStringMessage("[" + aTopic + "] " +  aSubject.UID);

                    //aSubject: nsIAbCard
                    aSubject.QueryInterface(Components.interfaces.nsIAbCard);
                    //aData: 128-bit unique identifier for the parent directory
                    let folderData = tbSync.addressbook.getFolderFromDirectoryUID(aData);
                    
                    if (folderData && tbSync.providers.loadedProviders.hasOwnProperty(folderData.getAccountSetting("provider"))) {
                        
                        // during create it could happen, that this card comes without a UID Property - bug 1554782
                        if (aTopic == "addrbook-contact-created" && aSubject.getProperty("UID","") == "") {
                            // a call to .UID will generate a UID but will also send an update notification for the the card
                            addressbook.delayedCreation.push(aSubject.uuid); //uuid = directoryId+localId
                            aSubject.UID;
                            return;

                        } else {
                            let topic = aTopic;
                            let abCardData = new tbSync.AbCardData(aSubject);
                           
                            //check for delayedCreation
                            if (aTopic == "addrbook-contact-updated" && addressbook.delayedCreation.includes(aSubject.uuid)) {
                                topic = "addrbook-contact-created";
                                addressbook.delayedCreation = addressbook.delayedCreation.filter(item => item != aSubject.uuid);
                            }
                            
                            let cardUID = aSubject.UID;
                            let bookUID = aData;
                            let itemStatus = tbSync.db.getItemStatusFromChangeLog(bookUID, cardUID);
                            if (itemStatus && itemStatus.endsWith("_by_server")) {
                                //we caused this, ignore
                                tbSync.db.removeItemFromChangeLog(bookUID, cardUID);
                                return;
                            }
                                
                            Services.console.logStringMessage(" - [" + topic + "] " +  itemStatus);

                            // update changelog based on old status
                            if (folderData.getFolderSetting("useChangeLog") == "1") {
                                switch (topic) {
                                    case "addrbook-contact-created":
                                    {
                                        switch (itemStatus) {
                                            case "added_by_user": 
                                                // double notification, which is probably impossible, ignore
                                                return;

                                            case "modified_by_user": 
                                                // late create notification
                                                tbSync.db.addItemToChangeLog(bookUID, cardUID, "added_by_user");
                                                break;

                                            case "deleted_by_user":
                                                // unprocessed delete for this card, undo the delete (moved out and back in)
                                                tbSync.db.addItemToChangeLog(bookUID, cardUID, "modified_by_user");
                                                break;
                                            
                                            default:
                                                // new card
                                                tbSync.db.addItemToChangeLog(bookUID, cardUID, "added_by_user");
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
                                                tbSync.db.addItemToChangeLog(bookUID, cardUID, "modified_by_user");
                                                break;
                                        }
                                    }
                                    break;
                                    
                                    case "addrbook-contact-removed":
                                    {
                                        switch (itemStatus) {
                                            case "added_by_user": 
                                                // unprocessed add for this card, revert
                                                tbSync.db.removeItemFromChangeLog(bookUID, cardUID);
                                                return;

                                            case "modified_by_user": 
                                                // unprocessed mod for this card
                                            case "deleted_by_user":
                                                // double notification
                                            default: 
                                                tbSync.db.addItemToChangeLog(bookUID, cardUID, "deleted_by_user");
                                                break;
                                        }
                                    }
                                    break;
                                }
                            }

                            tbSync.core.setTargetModified(folderData);
                            tbSync.providers[folderData.getAccountSetting("provider")].addressbook.cardObserver(topic, folderData, abCardData);
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
                    
                    if (folderData && tbSync.providers.loadedProviders.hasOwnProperty(folderData.getAccountSetting("provider"))) {
                        let abListData = new tbSync.AbListData(aSubject);
                        
                        // check changelog for pile up or other stuff - also do folderData.getFolderSetting("useChangeLog")
                        //tbSync.providers[folderData.getAccountSetting("provider")].addressbook.listObserver(aTopic, folderData, abListData);
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
                    if (folderData && tbSync.providers.loadedProviders.hasOwnProperty(folderData.getAccountSetting("provider"))) {
                        let abListData = new tbSync.AbListData(listInfo.listCard);
                        
                        // check changelog for pile up or other stuff - also do folderData.getFolderSetting("useChangeLog")
                        //tbSync.providers[folderData.getAccountSetting("provider")].addressbook.listObserver(aTopic, folderData, abListData);
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
                    if (folderData && tbSync.providers.loadedProviders.hasOwnProperty(folderData.getAccountSetting("provider"))) {
                        let abListData = new tbSync.AbListData(listInfo.listCard);
                        
                        // check changelog for pile up or other stuff - also do folderData.getFolderSetting("useChangeLog")
                        //tbSync.providers[folderData.getAccountSetting("provider")].addressbook.listObserver(aTopic, folderData, abListData);
                    }
                }
                break;

            }
        }
    },
    

    addressbookListener: {

        onItemPropertyChanged: function addressbookListener_onItemPropertyChanged(aItem, aProperty, aOldValue, aNewValue) {
            Services.console.logStringMessage("   [onItemPropertyChanged] " + aItem);

            //redirect to addrbook-updated observers
            if (aItem instanceof Components.interfaces.nsIAbDirectory
                    && !aItem.isMailList) {
                tbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-updated", null);
            }
        },

        onItemRemoved: function addressbookListener_onItemRemoved (aParentDir, aItem) {
            Services.console.logStringMessage("   [onItemRemoved] " + aItem + " / " + aParentDir);

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
            Services.console.logStringMessage("   [onItemAdded] " + aItem + " / " + aParentDir);

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





    checkAddressbook: function (accountData) {
        let target = accountData.getFolderSetting("target");
        let targetObject = this.getDirectoryFromDirectoryUID(target);
        let provider = accountData.getAccountSetting("provider");
        
        if (targetObject !== null && targetObject instanceof Components.interfaces.nsIAbDirectory) {
            //check for double targets - just to make sure
            let folders = tbSync.db.findFoldersWithSetting("target", target);
            if (folders.length == 1) {
                return true;
            } else {
                throw "Target with multiple source folders found! Forcing hard fail ("+target+")."; 
            }
        }
        
        // Get cached or new unique name for new address book
        let cachedName = accountData.getFolderSetting("targetName");                         
        let basename = cachedName == "" ? accountData.getAccountSetting("accountname") + " (" + accountData.getFolderSetting("name")+ ")" : cachedName;

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
        let directory = tbSync.providers[accountData.getAccountSetting("provider")].api.createAddressBook(newname, accountData);
        if (directory && directory instanceof Components.interfaces.nsIAbDirectory) {
            directory.setStringValue("tbSyncProvider", provider);
            
            tbSync.providers[provider].api.onResetTarget(accountData);
            
            accountData.setFolderSetting("target", directory.UID);
            accountData.setFolderSetting("targetType", "addressbook");
            
            accountData.setFolderSetting("targetName", basename);
            //notify about new created address book
            Services.obs.notifyObservers(null, 'tbsync.observer.addressbook.created', null)
            return true;
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
}
