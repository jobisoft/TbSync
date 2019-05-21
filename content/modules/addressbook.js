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
        //Services.obs.addObserver(this.addressbookObserver, "addrbook-contact-created", false);
        //Services.obs.addObserver(this.addressbookObserver, "addrbook-contact-updated", false);
        //Services.obs.addObserver(this.addressbookObserver, "addrbook-list-member-added", false);
        //Services.obs.addObserver(this.addressbookObserver, "addrbook-list-updated", false);
        //Services.obs.addObserver(this.addressbookObserver, "tbsync.observer.addrbook.listCreated", false);
        //Services.obs.addObserver(this.addressbookObserver, "tbsync.observer.addrbook.cardCreated", false);
        this.addressbookListener.add();

        //missing
        // addrbook-contact-deleted
        // addrbook-list-created (do we need empty lists?)
    },

    unload : function () {
            //Services.obs.removeObserver(this.addressbookObserver, "addrbook-contact-created");
            //Services.obs.removeObserver(this.addressbookObserver, "addrbook-contact-updated");
            //Services.obs.removeObserver(this.addressbookObserver, "addrbook-list-member-added");
            //Services.obs.removeObserver(this.addressbookObserver, "addrbook-list-updated");
            //Services.obs.removeObserver(this.addressbookObserver, "tbsync.observer.addrbook.listCreated");
            //Services.obs.removeObserver(this.addressbookObserver, "tbsync.observer.addrbook.cardCreated");
        
            //remove listener
            this.addressbookListener.remove();
    },

    /*addressbookObserver: {
        observe: function (aSubject, aTopic, aData) {
            Services.console.logStringMessage("[addressbookObserver] "  + aTopic);
            Services.console.logStringMessage("[aSubject] "  + aSubject);
            Services.console.logStringMessage("[aData] "  + aData);

            //aData is UID of parent directory
            let folders = tbSync.db.findFoldersWithSetting(["target"], [aData]);
                if (folders.length == 1) {
                    let provider = tbSync.db.getAccountSetting(folders[0].account, "provider");
                    Services.console.logStringMessage("[addressbookObserver] mailingitem created "  + 
                        "card UID: " + aItem.getProperty("UID", "") + "\n"  + 
                        "mailListURI: " + aItem.mailListURI + "\n" + 
                        provider);
                }
                
            //aSubject is item
            //aData is parent URI or UUID
            
            Services.console.logStringMessage("[addressbookObserver1] " + aSubject + " : " aSubject.getProperty("UID", "") + " : " + aSubject.uuid + " : " + aTopic + " : " + aData);
        }
    },*/
    
    addressbookListener: {

        //if a contact in one of the synced books is modified, update status of target and account
        onItemPropertyChanged: function addressbookListener_onItemPropertyChanged(aItem, aProperty, aOldValue, aNewValue) {
            // change on book itself, or on card?
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                let folders =  tbSync.db.findFoldersWithSetting(["target"], [aItem.URI]); //changelog is not used here, we should always catch these changes
                if (folders.length == 1) {
                    //store current/new name of target
                    tbSync.db.setFolderSetting(folders[0].account, folders[0].folderID, "targetName", tbSync.addressbook.getAddressBookName(folders[0].target));                         
                    //update settings window, if open
                     Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folders[0].account);
                }
            }

            if (aItem instanceof Components.interfaces.nsIAbCard) {
                let aParentDirURI = tbSync.addressbook.getUriFromDirectoryId(aItem.directoryId);
                if (aParentDirURI) { //could be undefined
                    let folders = tbSync.db.findFoldersWithSetting(["target","useChangeLog"], [aParentDirURI,"1"]);
                    if (folders.length == 1) {

                        let cardId = tbSync.addressbook.getPropertyOfCard(aItem, "TBSYNCID");
                        
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
                                    tbSync.core.setTargetModified(folders[0]);
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
                    let cardId = tbSync.addressbook.getPropertyOfCard(aItem, "TBSYNCID");
                    if (cardId) {
                        //Problem: A card deleted by server should not trigger a changelog entry, so they are pretagged with deleted_by_server
                        let itemStatus = tbSync.db.getItemStatusFromChangeLog(aParentDir.URI, cardId);
                        if (itemStatus == "deleted_by_server" || itemStatus == "added_by_user") {
                            //if it is a delete pushed from the server, simply acknowledge (do nothing) 
                            //a local add, which has not yet been processed (synced) is deleted -> remove all traces
                            tbSync.db.removeItemFromChangeLog(aParentDir.URI, cardId);
                        } else {
                            tbSync.db.addItemToChangeLog(aParentDir.URI, cardId, "deleted_by_user");
                            tbSync.core.setTargetModified(folders[0]);
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
                         Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folders[0].account);
                    }
                    
                    tbSync.db.resetFolderSetting(folders[0].account, folders[0].folderID, "target");
                }
            }
        },

        onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {          
            if (aParentDir instanceof Components.interfaces.nsIAbDirectory) {
                aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
            }

            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory && aItem.isMailList) {
                //tbSync.addressbook.addressbookObserver.observe(aItem, "tbsync-addrbook-list-created", aParentDir.URI);
            }
            
            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory && !aItem.isMailList) {
                //tbSync.addressbook.addressbookObserver.observe(aItem, "tbsync-addrbook-card-created", aParentDir.URI);
            }            

            if (aItem instanceof Components.interfaces.nsIAbCard && aParentDir instanceof Components.interfaces.nsIAbDirectory && !aItem.isMailList) {
                //we cannot set the ID of new lists before they are created, so we cannot detect this case
                
                let folders = tbSync.db.findFoldersWithSetting(["target","useChangeLog"], [aParentDir.URI,"1"]);
                if (folders.length == 1) {

                    //check if this is a temp search result card and ignore add
                    let searchResultProvider = aItem.getProperty("X-Server-Searchresult", "");
                    if (searchResultProvider) return;

                    let itemStatus = null;
                    let cardId = tbSync.addressbook.getPropertyOfCard (aItem, "TBSYNCID");
                    if (cardId) {
                        itemStatus = tbSync.db.getItemStatusFromChangeLog(aParentDir.URI, cardId);
                        if (itemStatus == "added_by_server") {
                            tbSync.db.removeItemFromChangeLog(aParentDir.URI, cardId);
                            return;
                        }
                    }
                                
                    //if this point is reached, either new card (no TBSYNCID), or moved card (old TBSYNCID) -> reset TBSYNCID 
                    //whatever happens, if this item has an entry in the changelog, it is not a new item added by the user
                    // ^ THIS IS NOT TRUE!
                    //          If a card is moved from one ab to another, it gets a "modified" notification 
                    //          before it gets the "added" notification -> it has modified_by_user flag if this is reached!
                    //          We must allow itemStatus !== null here as well
                    let provider = tbSync.db.getAccountSetting(folders[0].account, "provider");
                    tbSync.core.setTargetModified(folders[0]);
                    //remove any changelog entries, if the card already had an ID and an entry
                    if (cardId) {
                        tbSync.db.removeItemFromChangeLog(aParentDir.URI, cardId);
                    }
                    let newCardID = tbSync.providers[provider].api.getNewCardID(aItem, folders[0]);
                    tbSync.db.addItemToChangeLog(aParentDir.URI, newCardID, "added_by_user");
                    
                    //mailinglist aware property setter
                    //this.setPropertyOfCard (aItem, "TBSYNCID", newCardID);
                    //aParentDir.modifyCard(aItem);
                }
                
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

    //mailinglist aware method to get card based on a property (mailinglist properties need to be stored in prefs of parent book)
    getCardFromProperty: function (addressBook, property, value) {
        //try to use the standard contact card method first
        let card = addressBook.getCardFromProperty(property, value, true);
        if (card) {
            return card;
        }
        
        //search for list cards
        let searchList = "(IsMailList,=,TRUE)";
        let result = MailServices.ab.getDirectory(addressBook.URI +  "?(or" + searchList+")").childCards;
        while (result.hasMoreElements()) {
            let card = result.getNext().QueryInterface(Components.interfaces.nsIAbCard);
            //does this list card have the req prop?
            if (this.getPropertyOfCard(card, property) == value) {
                    return card;
            }
        }
        return null;
    },
    
    //mailinglist aware method to get properties of cards (mailinglist properties cannot be stored in mailinglists themselves)
    getPropertyOfCard: function (card, property, fallback = "") {
        if (card.isMailList) {
            let value = tbSync.db.getItemStatusFromChangeLog(this.getUriFromDirectoryId(card.directoryId), card.mailListURI + "#" + property);
            return value ? value : fallback;    
        } else {
            return card.getProperty(property, fallback);
        }
    },

    //mailinglist aware method to set properties of cards (mailinglist properties need to be stored in prefs of parent book)
    setPropertyOfCard: function (card, property, value) {
        if (card.isMailList) {
            tbSync.db.addItemToChangeLog(this.getUriFromDirectoryId(card.directoryId), card.mailListURI + "#" + property, value);
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

    removeBook: function (uri) { 
        // get all address books
        try {
            if (MailServices.ab.getDirectory(uri) instanceof Components.interfaces.nsIAbDirectory) {
                MailServices.ab.deleteAddressBook(uri);
            }
        } catch (e) {}
    },

    changeNameOfBook: function (uri, newname) { 
        let allAddressBooks = MailServices.ab.directories;
        while (allAddressBooks.hasMoreElements()) {
            let addressBook = allAddressBooks.getNext();
            if (addressBook instanceof Components.interfaces.nsIAbDirectory && addressBook.URI == uri) {
                let orig = addressBook.dirName;
                addressBook.dirName = newname.replace("%ORIG%", orig);
            }
        }
    },

    getAddressBookObject: function (uri) {
        try {
            let addressBook = MailServices.ab.getDirectory(uri);
            if (addressBook instanceof Components.interfaces.nsIAbDirectory) {
                return addressBook;
            }
        } catch (e) {}
        return null;
    },

    getAddressBookName: function (uri) {
        let allAddressBooks = MailServices.ab.directories;
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
        
    checkAddressbook: function (accountData) {
        let target = accountData.getFolderSetting("target");
        let targetName = this.getAddressBookName(target);
        let targetObject = this.getAddressBookObject(target);
        let provider = accountData.getAccountSetting("provider");
        
        if (targetName !== null && targetObject !== null && targetObject instanceof Components.interfaces.nsIAbDirectory) {
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
        let testname = cachedName == "" ? accountData.getAccountSetting("accountname") + " (" + accountData.getFolderSetting("name")+ ")" : cachedName;

        let count = 1;
        let unique = false;
        let newname = testname;
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
                newname = testname + " #" + count;
                count = count + 1;
            }
        } while (!unique);
        
        //Create the new book with the unique name
        let directory = tbSync.providers[accountData.getAccountSetting("provider")].api.createAddressBook(newname, accountData);
        if (directory && directory instanceof Components.interfaces.nsIAbDirectory) {
            directory.setStringValue("tbSyncProvider", provider);
            
            tbSync.providers[provider].api.onResetTarget(accountData);
            
            accountData.setFolderSetting("target", directory.URI);
            //accountData.setFolderSetting("targetName", newname);
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
