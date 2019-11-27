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
    // Geoffs addrbook-contact-created observer does not fire on moves, so we do not use it
    // Services.obs.addObserver(this.addressbookObserver, "addrbook-contact-created", false);
    Services.obs.addObserver(this.addressbookObserver, "addrbook-contact-updated", false);
    Services.obs.addObserver(this.addressbookObserver, "addrbook-list-member-added", false);
    Services.obs.addObserver(this.addressbookObserver, "addrbook-list-updated", false);
    this.addressbookListener.add();
  },

  unload : function () {
    // Geoffs addrbook-contact-created observer does not fire on moves, so we do not use it
    // Services.obs.removeObserver(this.addressbookObserver, "addrbook-contact-created");
    Services.obs.removeObserver(this.addressbookObserver, "addrbook-contact-updated");
    Services.obs.removeObserver(this.addressbookObserver, "addrbook-list-member-added");
    Services.obs.removeObserver(this.addressbookObserver, "addrbook-list-updated");
    this.addressbookListener.remove();
  },


  // needed due to sogo issue not implementing this method in their Ab
  getStringValue : function (ab, value, fallback) {
    try {
      return ab.getStringValue(value, fallback);
    } catch (e) {
      return fallback;
    }
  },
  
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  // * AdvancedTargetData, an extended TargetData implementation, providers
  // * can use this as their own TargetData by extending it and just
  // * defining the extra methods
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  
  AdvancedTargetData : class {
    constructor(folderData) {            
      this._folderData = folderData;
      this._targetObj = null;
    }

    
    // Check, if the target exists and return true/false.
    hasTarget() { 
      let target = this._folderData.getFolderProperty("target");
      let directory = TbSync.addressbook.getDirectoryFromDirectoryUID(target);
      return directory ? true : false;
    }

    // Returns the target obj, which TbSync should return as the target. It can
    // be whatever you want and is returned by FolderData.targetData.getTarget().
    // If the target does not exist, it should be created. Throw a simple Error, if that
    // failed.
    async getTarget() { 
      let target = this._folderData.getFolderProperty("target");
      let directory = TbSync.addressbook.getDirectoryFromDirectoryUID(target);
      
      if (!directory) {
        // create a new addressbook and store its UID in folderData
        directory = await TbSync.addressbook.prepareAndCreateAddressbook(this._folderData);
        if (!directory)
          throw new Error("notargets");
      }
      
      if (!this._targetObj || this._targetObj.UID != directory.UID)
        this._targetObj = new TbSync.addressbook.AbDirectory(directory, this._folderData);

      return this._targetObj;
    }
    
    /**
     * Removes the target from the local storage. If it does not exist, return
     * silently. A call to ``hasTarget()`` should return false, after this has
     * been executed.
     *
     */
    removeTarget() {
      let target = this._folderData.getFolderProperty("target");
      let directory = TbSync.addressbook.getDirectoryFromDirectoryUID(target);
      try {
        if (directory) {
          MailServices.ab.deleteAddressBook(directory.URI);
        }
      } catch (e) {}

      TbSync.db.clearChangeLog(target);
      this._folderData.resetFolderProperty("target");        
    }
    
    /**
     * Disconnects the target in the local storage from this TargetData, but
     * does not delete it, so it becomes a stale "left over" . A call
     * to ``hasTarget()`` should return false, after this has been executed.
     * 
     */
    disconnectTarget() {
      let target = this._folderData.getFolderProperty("target");
      let directory = TbSync.addressbook.getDirectoryFromDirectoryUID(target);
      if (directory) {
        let changes = TbSync.db.getItemsFromChangeLog(target, 0, "_by_user");        
        if (changes.length > 0) {
          this.targetName = this.targetName + " (*)";
        }        
        directory.setStringValue("tbSyncIcon", "orphaned");
        directory.setStringValue("tbSyncProvider", "orphaned");
        directory.setStringValue("tbSyncAccountID", "");
      }
      TbSync.db.clearChangeLog(target);
      this._folderData.resetFolderProperty("target");      
    }     
    
    set targetName(newName) {
      let target = this._folderData.getFolderProperty("target");
      let directory = TbSync.addressbook.getDirectoryFromDirectoryUID(target);
      if (directory) {
        directory.dirName = newName;
      } else {
        throw new Error("notargets");
      }
    }
  
    get targetName() {
      let target = this._folderData.getFolderProperty("target");
      let directory = TbSync.addressbook.getDirectoryFromDirectoryUID(target);
      if (directory) {
        return directory.dirName;
      } else {
        throw new Error("notargets");
      }
    }
    
    setReadOnly(value) {
    }


    // * * * * * * * * * * * * * * * * *
    // * AdvancedTargetData extension  * 
    // * * * * * * * * * * * * * * * * *
    
    get isAdvancedAddressbookTargetData() {
      return true;
    }
    
    get folderData() {
      return this._folderData;
    }
    
    // define a card property, which should be used for the changelog
    // basically your primary key for the abItem properties
    // UID will be used, if nothing specified
    get primaryKeyField() {
      return "UID";
    }

    generatePrimaryKey() {
       return TbSync.generateUUID();
    }
        
    // enable or disable changelog
    get logUserChanges() {
      return true;
    }

    directoryObserver(aTopic) {
      switch (aTopic) {
        case "addrbook-removed":
        case "addrbook-updated":
          //Services.console.logStringMessage("["+ aTopic + "] " + folderData.getFolderProperty("foldername"));
          break;
      }
    }
        
    cardObserver(aTopic, abCardItem) {
      switch (aTopic) {
        case "addrbook-contact-updated":
        case "addrbook-contact-removed":
        case "addrbook-contact-created":
          //Services.console.logStringMessage("["+ aTopic + "] " + abCardItem.getProperty("DisplayName"));
          break;
      }
    }

    listObserver(aTopic, abListItem, abListMember) {
      switch (aTopic) {
        case "addrbook-list-member-added":
        case "addrbook-list-member-removed":
          //Services.console.logStringMessage("["+ aTopic + "] MemberName: " + abListMember.getProperty("DisplayName"));
          break;
        
        case "addrbook-list-removed":
        case "addrbook-list-updated":
          //Services.console.logStringMessage("["+ aTopic + "] ListName: " + abListItem.getProperty("ListName"));
          break;
        
        case "addrbook-list-created": 
          //Services.console.logStringMessage("["+ aTopic + "] Created new X-DAV-UID for List <"+abListItem.getProperty("ListName")+">");
          break;
      }
    }

    // replace this with your own implementation to create the actual addressbook,
    // when this class is extended
    async createAddressbook(newname) {
      let dirPrefId = MailServices.ab.newAddressBook(newname, "", 2);
      let directory = MailServices.ab.getDirectoryFromId(dirPrefId);
      return directory;
    }    
  },




  
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  // * AbItem and AbDirectory Classes
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
    
    get abDirectory() {
      return this._abDirectory;
    }
    
    get isMailList() {
      return this._isMailList;
    }





    get nativeItem() {
      return this._card;
    }

    get UID() {
      if (this._tempListDirectory) return this._tempListDirectory.UID;
      return this._card.UID;
    }
    
    get primaryKey() {
      //use UID as fallback
      let key = this._abDirectory.primaryKeyField;
      return key ? this.getProperty(key) : this.UID;  
    }

    set primaryKey(value) {
      //use UID as fallback
      let key = this._abDirectory.primaryKeyField;
      if (key) this.setProperty(key, value)
      else throw ("TbSync.addressbook.AbItem.set primaryKey: UID is used as primaryKeyField but changing the UID of an item is currently not supported. Please use a custom primaryKeyField.");
    }

    clone() { //no real clone ... this is just here to match the calendar target
      return new TbSync.addressbook.AbItem(this._abDirectory, this._card);
    }
    
    toString() {
      return this._card.displayName + " (" + this._card.firstName + ", " + this._card.lastName + ") <"+this._card.primaryEmail+">";
    }
    
    // mailinglist aware method to get properties of cards
    // mailinglist properties cannot be stored in mailinglists themselves, so we store them in changelog
    getProperty(property, fallback = "") {
      if (property == "UID")
        return this.UID;
      
      if (this._isMailList) {
        let value = TbSync.db.getItemStatusFromChangeLog(this._abDirectory.UID + "#" + this.UID, property);
        return value ? value : fallback;    
      } else {
        return this._card.getProperty(property, fallback);
      }
    }

    // mailinglist aware method to set properties of cards
    // mailinglist properties cannot be stored in mailinglists themselves, so we store them in changelog
    setProperty(property, value) {
      // UID cannot be changed (currently)
      if (property == "UID") {
        throw ("TbSync.addressbook.AbItem.setProperty: UID cannot be changed currently.");
        return;
      }
      
      if (this._isMailList) {
        TbSync.db.addItemToChangeLog(this._abDirectory.UID + "#" + this.UID, property, value);
      } else {
        this._card.setProperty(property, value);
      }
    }
    
    deleteProperty(property) {
      if (this._isMailList) {
        TbSync.db.removeItemFromChangeLog(this._abDirectory.UID + "#" + this.UID, property);
      } else {
        this._card.deleteProperty(property);
      }
    }
   
    get changelogData() {         
      return TbSync.db.getItemDataFromChangeLog(this._abDirectory.UID, this.primaryKey);
    }

    get changelogStatus() {         
      return TbSync.db.getItemStatusFromChangeLog(this._abDirectory.UID, this.primaryKey);
    }

    set changelogStatus(status) {            
      let value = this.primaryKey;         
                  
      if (value) {
        if (!status) {
          TbSync.db.removeItemFromChangeLog(this._abDirectory.UID, value);
          return;
        }

        if (this._abDirectory.logUserChanges || status.endsWith("_by_server")) {
          TbSync.db.addItemToChangeLog(this._abDirectory.UID, value, status);
        }
      }
    }    





    // get the property given from all members and return it as an array (that property better be uniqe)
    getMembersPropertyList(property) {
      let members = [];
      if (this._card && this._card.isMailList) {
        // get mailListDirectory
        let mailListDirectory = MailServices.ab.getDirectory(this._card.mailListURI);                
        for (let i = 0; i < mailListDirectory.addressLists.length; i++) {
          let member = mailListDirectory.addressLists.queryElementAt(i, Components.interfaces.nsIAbCard);
          let id = member.getProperty(property, "");
          if (id) members.push(id);
        }
      }
      return members;
    }
    
    // update mail list with a the given member list, each entry being the value of the given property for each member
    setMembersByPropertyList(property, members) {
      if (this._card && this._card.isMailList) {            
        // get mailListDirectory
        let mailListDirectory = MailServices.ab.getDirectory(this._card.mailListURI);
        let list = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
        for (let member of members) {
          let card = this._abDirectory._directory.getCardFromProperty(property, member, true);
          if (card) list.appendElement(card, false);
        }
        mailListDirectory.addressLists = list;
        if (this.changelogStatus != "modified_by_user") {
          this.changelogStatus = "modified_by_server";
        }
        mailListDirectory.editMailListToDatabase(this._card);                
      }
    }
    
    addPhoto(photo, data) {	
      let dest = [];
      let card = this._card;
      let bookUID = this.abDirectory.UID;
      
      // TbSync storage must be set as last
      let book64 = btoa(bookUID);
      let photo64 = btoa(photo);	    
      let photoName64 = book64 + "_" + photo64;
      
      TbSync.dump("PhotoName", photoName64);
      
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
          TbSync.dump("Failed to decode base64 string:", data);
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
  },

  AbDirectory : class {
    constructor(directory, folderData) {
      this._directory = directory;
      this._folderData = folderData;
     }

    get directory() {
      return this._directory;
    }
    
    get logUserChanges() {
      return this._folderData.targetData.logUserChanges;
    }
    
    get primaryKeyField() {
      return this._folderData.targetData.primaryKeyField;
    }
    
    get UID() {
      return this._directory.UID;
    }

    get URI() {
      return this._directory.URI;
    }

    createNewCard() {
      let card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);                    
      return new TbSync.addressbook.AbItem(this, card);
    }

    createNewList() {
      let listDirectory = Components.classes["@mozilla.org/addressbook/directoryproperty;1"].createInstance(Components.interfaces.nsIAbDirectory);
      listDirectory.isMailList = true;
      return new TbSync.addressbook.AbItem(this, listDirectory);
    }

    addItem(abItem, pretagChangelogWithByServerEntry = true) {
      if (this.primaryKeyField && !abItem.getProperty(this.primaryKeyField)) {
        abItem.setProperty(this.primaryKeyField, this._folderData.targetData.generatePrimaryKey());
        //Services.console.logStringMessage("[AbDirectory::addItem] Generated primary key!");
      }
      
      if (pretagChangelogWithByServerEntry) {
        abItem.changelogStatus = "added_by_server";
      }
      
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
    
    modifyItem(abItem, pretagChangelogWithByServerEntry = true) {
      // only add entry if the current entry does not start with _by_user
      let status = abItem.changelogStatus ? abItem.changelogStatus : "";
      if (pretagChangelogWithByServerEntry && !status.endsWith("_by_user")) {
        abItem.changelogStatus = "modified_by_server";
      }
      
      if (abItem.isMailList) {                
        // get mailListDirectory
        let mailListDirectory = MailServices.ab.getDirectory(abItem._card.mailListURI);
        
        //update directory props
        mailListDirectory.dirName = abItem.getProperty("ListName");
        mailListDirectory.listNickName = abItem.getProperty("ListNickName");
        mailListDirectory.description = abItem.getProperty("ListDescription");

        // store
        mailListDirectory.editMailListToDatabase(abItem._card);
      } else {
        this._directory.modifyCard(abItem._card); 
      }
    }        
    
    deleteItem(abItem, pretagChangelogWithByServerEntry = true) {
      if (pretagChangelogWithByServerEntry) {
        abItem.changelogStatus = "deleted_by_server";
      }
      let delArray = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
      delArray.appendElement(abItem._card, true);
      this._directory.deleteCards(delArray);
    }

    getItem(searchId) {
      //use UID as fallback
      let key = this.primaryKeyField ? this.primaryKeyField : "UID";
      return this.getItemFromProperty(key, searchId);
    }

    getItemFromProperty(property, value) {
      // try to use the standard card method first
      let card = this._directory.getCardFromProperty(property, value, true);
      if (card) {
        return new TbSync.addressbook.AbItem(this, card);
      }
      
      // search for list cards
      // we cannot search for the prop directly, because for mailinglists
      // they are not part of the card (expect UID) but stored in a custom storage
      let searchList = "(IsMailList,=,TRUE)"; 
      let result = MailServices.ab.getDirectory(this._directory.URI +  "?(or" + searchList+")").childCards;
      while (result.hasMoreElements()) {
        let card = new TbSync.addressbook.AbItem(this, result.getNext().QueryInterface(Components.interfaces.nsIAbCard));
        //does this list card have the req prop?
        if (card.getProperty(property) == value) {
          return card;
        }
      }
      return null;
    }
    
    getAllItems () {
      let rv = [];
      let cards = this._directory.childCards;
      while (true) {
        let more = false;
        try { more = cards.hasMoreElements() } catch (e) { Components.utils.reportError(e); }
        if (!more) break;

        let card = new TbSync.addressbook.AbItem( this._directory, cards.getNext().QueryInterface(Components.interfaces.nsIAbCard));
        rv.push(card);
      }
      return rv;
    }





    getAddedItemsFromChangeLog(maxitems = 0) {             
      return TbSync.db.getItemsFromChangeLog(this._directory.UID, maxitems, "added_by_user").map(item => item.itemId);
    }

    getModifiedItemsFromChangeLog(maxitems = 0) {             
      return TbSync.db.getItemsFromChangeLog(this._directory.UID, maxitems, "modified_by_user").map(item => item.itemId);
    }
    
    getDeletedItemsFromChangeLog(maxitems = 0) {             
      return TbSync.db.getItemsFromChangeLog(this._directory.UID, maxitems, "deleted_by_user").map(item => item.itemId);
    }
    
    getItemsFromChangeLog(maxitems = 0) { // Document what this returns         
      return TbSync.db.getItemsFromChangeLog(this._directory.UID, maxitems, "_by_user");
    }

    removeItemFromChangeLog(id, moveToEndInsteadOfDelete = false) {             
      TbSync.db.removeItemFromChangeLog(this._directory.UID, id, moveToEndInsteadOfDelete);
    }
    
    clearChangelog() {
      TbSync.db.clearChangeLog(this._directory.UID);
    }
    
  },




  
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  // * Internal Functions
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

  prepareAndCreateAddressbook: async function (folderData) {
    let target = folderData.getFolderProperty("target");
    let provider = folderData.accountData.getAccountProperty("provider");
    
    // Get cached or new unique name for new address book
    let cachedName = folderData.getFolderProperty("targetName");                         
    let newname = cachedName == "" ? folderData.accountData.getAccountProperty("accountname") + " (" + folderData.getFolderProperty("foldername")+ ")" : cachedName;
   
    //Create the new book with the unique name
    let directory = await folderData.targetData.createAddressbook(newname);
    if (directory && directory instanceof Components.interfaces.nsIAbDirectory) {
      directory.setStringValue("tbSyncProvider", provider);
      directory.setStringValue("tbSyncAccountID", folderData.accountData.accountID);
      
      // Prevent gContactSync to inject its stuff into New/EditCard dialogs
      // https://github.com/jdgeenen/gcontactsync/pull/127
      directory.setStringValue("gContactSyncSkipped", "true");

      folderData.setFolderProperty("target", directory.UID);            
      folderData.setFolderProperty("targetName", directory.dirName);
      //notify about new created address book
      Services.obs.notifyObservers(null, 'tbsync.observer.addressbook.created', null)
      return directory;
    }
    
    return null;
  },

  getFolderFromDirectoryUID: function(bookUID) {
    let folders = TbSync.db.findFolders({"target": bookUID});
    if (folders.length == 1) {
      let accountData = new TbSync.AccountData(folders[0].accountID);
      return new TbSync.FolderData(accountData, folders[0].folderID);
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
          
          let folderData = TbSync.addressbook.getFolderFromDirectoryUID(bookUID);
          if (folderData 
            && folderData.targetData 
            && folderData.targetData.isAdvancedAddressbookTargetData) {
              
            switch(aTopic) {
              case "addrbook-updated": 
              {
                //update name of target (if changed)
                folderData.setFolderProperty("targetName", aSubject.dirName);                         
                //update settings window, if open
                 Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);
              }
              break;

              case "addrbook-removed": 
              {
                //delete any pending changelog of the deleted book
                TbSync.db.clearChangeLog(bookUID);			

                //unselect book if deleted by user and update settings window, if open
                if (folderData.getFolderProperty("selected")) {
                  folderData.setFolderProperty("selected", false);
                  //update settings window, if open
                  Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);
                }
                
                folderData.resetFolderProperty("target");
              }
              break;
            }
            
            folderData.targetData.directoryObserver(aTopic);                        
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

          let folderData = TbSync.addressbook.getFolderFromDirectoryUID(bookUID);                    
          if (folderData 
            && folderData.targetData 
            && folderData.targetData.isAdvancedAddressbookTargetData) {
            
            let directory = TbSync.addressbook.getDirectoryFromDirectoryUID(bookUID);
            let abDirectory = new TbSync.addressbook.AbDirectory(directory, folderData);
            let abItem = new TbSync.addressbook.AbItem(abDirectory, aSubject);
            let itemStatus = abItem.changelogStatus;

            // during create the following can happen
            // card has no UID
            // card has no primary key
            // another process could try to mod
            //  -> we need to identify this card with an always available ID and block any other MODS until we free it again
            // -> store creation type
            if (aTopic == "addrbook-contact-created") {
              TbSync.db.addItemToChangeLog(bookUID, aSubject.uuid + "#DelayedCreation", itemStatus == "added_by_server" ? itemStatus : "added_by_user"); //uuid = directoryId+localId
              TbSync.db.addItemToChangeLog(bookUID, aSubject.uuid + "#DelayedCreationOriginalPrimaryKey", abDirectory.primaryKeyField ? abItem.getProperty(abDirectory.primaryKeyField) : ""); //uuid = directoryId+localId
            } 
            // during follow up MODs we can identify this card via
            let delayedCreation = TbSync.db.getItemStatusFromChangeLog(bookUID, aSubject.uuid + "#DelayedCreation");
            let delayedCreationOriginalPrimaryKey = TbSync.db.getItemStatusFromChangeLog(bookUID, aSubject.uuid + "#DelayedCreationOriginalPrimaryKey");
              
            // during create it could happen, that this card comes without a UID Property - bug 1554782
            // a call to .UID will generate a UID but will also send an update notification for the the card
            // we use addrbook-contact-created to make sure to only do this once (next time we are here, it is a mod, not an add)
            if (aTopic == "addrbook-contact-created" && aSubject.getProperty("UID","") == "") {
              aSubject.UID;
              return;
            }

            // new cards must get a NEW(!) primaryKey first
            if (delayedCreation ==  "added_by_user" && abDirectory.primaryKeyField && delayedCreationOriginalPrimaryKey == abItem.getProperty(abDirectory.primaryKeyField)) {
              console.log("New primary Key generated!");
              abItem.setProperty(abDirectory.primaryKeyField, folderData.targetData.generatePrimaryKey());
              // special case: do not add "modified_by_server"
              abDirectory.modifyItem(abItem, /*pretagChangelogWithByServerEntry */ false);
              return;
            }
            
            
            // if we reach this point and we have a delayed creation:
            // - if it was "by_user", we can remove the delayedCreation marker and can 
            //   continue to process this event as an addrbook-contact-created
            //
            // - if it was "by_server", we want to ignore any MOD for a freeze time, because
            //   gContactSync modifies our(!) contacts (GoogleID) after we added them, so they get
            //   turned into "modified_by_user" and will be send back to the server.
            let bTopic = aTopic;
            switch (delayedCreation) {
              case "added_by_user":
                bTopic = "addrbook-contact-created";
              case "added_by_server":
                //if delayedCreation is "added_by_server", then itemStatus is "added_by_server" as well, 
                // we can remove it here
                TbSync.db.removeItemFromChangeLog(bookUID, aSubject.uuid + "#DelayedCreation");
                TbSync.db.removeItemFromChangeLog(bookUID, aSubject.uuid + "#DelayedCreationOriginalPrimaryKey");
              default:
                break;
            }

            // if this card was created by us, it will be in the log
            if (itemStatus && itemStatus.endsWith("_by_server")) {
              let age = Date.now() - abItem.changelogData.timestamp;
              if (age < 1500) {
                // during freeze, local modifications are not possible
                return;
              } else {
                // remove blocking entry from changelog after freeze time is over (1.5s),
                // and continue evaluating this event
                abItem.changelogStatus = "";
              }
            }            
            
            // update changelog based on old status
            switch (bTopic) {
              case "addrbook-contact-created":
              {
                switch (itemStatus) {
                  case "added_by_user": 
                    // late create notification
                    break;

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

            if (abDirectory.logUserChanges) TbSync.core.setTargetModified(folderData);
            folderData.targetData.cardObserver(bTopic, abItem);
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

          let folderData = TbSync.addressbook.getFolderFromDirectoryUID(bookUID);
          if (folderData 
            && folderData.targetData 
            && folderData.targetData.isAdvancedAddressbookTargetData) {

            let directory = TbSync.addressbook.getDirectoryFromDirectoryUID(bookUID);
            let abDirectory = new TbSync.addressbook.AbDirectory(directory, folderData);
            let abItem = new TbSync.addressbook.AbItem(abDirectory, aSubject);
          
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
                // To simplify mail list management, we shadow its core properties, need to update them now
                abItem.setProperty("ListName", aSubject.displayName);
                abItem.setProperty("ListNickName", aSubject.getProperty("NickName", ""));
                abItem.setProperty("ListDescription", aSubject.getProperty("Notes", ""));
                
                if (abDirectory.primaryKeyField) {
                  // Since we do not need to update a list, to make custom properties persistent, we do not need to use delayedCreation as with contacts.
                  abItem.setProperty(abDirectory.primaryKeyField, folderData.targetData.generatePrimaryKey());
                }
                
                switch (itemStatus) {
                  case "added_by_user": 
                    // double notification, which is probably impossible, keep status
                    break;

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
                //remove properties of this ML stored in changelog
                TbSync.db.clearChangeLog(abDirectory.UID + "#" + abItem.UID);                
              }
              break;
            }

            if (abDirectory.logUserChanges) TbSync.core.setTargetModified(folderData);
            folderData.targetData.listObserver(aTopic, abItem, null);
          }
        }
        break;

        case "addrbook-list-updated": 
        {
          // aSubject: nsIAbDirectory
          aSubject.QueryInterface(Components.interfaces.nsIAbDirectory);
          // get the card representation of this list, including its parent directory
          let listInfo = TbSync.addressbook.getListInfoFromListUID(aSubject.UID);
          let bookUID = listInfo.directory.UID;

          let folderData = TbSync.addressbook.getFolderFromDirectoryUID(bookUID);
          if (folderData 
            && folderData.targetData 
            && folderData.targetData.isAdvancedAddressbookTargetData) {

            let abDirectory = new TbSync.addressbook.AbDirectory(listInfo.directory, folderData);
            let abItem = new TbSync.addressbook.AbItem(abDirectory, listInfo.listCard);

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
                // To simplify mail list management, we shadow its core properties, need to update them now
                abItem.setProperty("ListName", aSubject.dirName);
                abItem.setProperty("ListNickName", aSubject.listNickName);
                abItem.setProperty("ListDescription", aSubject.description);

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
            
            if (abDirectory.logUserChanges) TbSync.core.setTargetModified(folderData);
            folderData.targetData.listObserver(aTopic, abItem, null);
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
          let listInfo = TbSync.addressbook.getListInfoFromListUID(aData);
          let bookUID = listInfo.directory.UID;

          let folderData = TbSync.addressbook.getFolderFromDirectoryUID(bookUID);
          if (folderData 
            && folderData.targetData 
            && folderData.targetData.isAdvancedAddressbookTargetData) {
            
            let abDirectory = new TbSync.addressbook.AbDirectory(listInfo.directory, folderData);
            let abItem = new TbSync.addressbook.AbItem(abDirectory, listInfo.listCard);
            let abMember = new TbSync.addressbook.AbItem(abDirectory, aSubject);

            if (abDirectory.logUserChanges) TbSync.core.setTargetModified(folderData);
            folderData.targetData.listObserver(aTopic, abItem, abMember);

            // removed, added members cause the list to be changed
            let mailListDirectory = MailServices.ab.getDirectory(listInfo.listCard.mailListURI);
            TbSync.addressbook.addressbookObserver.observe(mailListDirectory, "addrbook-list-updated", null);
            return;
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
        TbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-updated", null);
      }
    },

    onItemRemoved: function addressbookListener_onItemRemoved (aParentDir, aItem) {
      // redirect to addrbook-list-member-removed observers 
      // unsafe and buggy - see bug 1555294 - can be removed after that landed
      if (aItem instanceof Components.interfaces.nsIAbCard
          && aParentDir instanceof Components.interfaces.nsIAbDirectory 
          && !aItem.isMailList
          && aParentDir.isMailList) {
        TbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-list-member-removed", aParentDir.UID)
      }

      //redirect to addrbook-contact-removed observers
      if (aItem instanceof Components.interfaces.nsIAbCard 
          && aParentDir instanceof Components.interfaces.nsIAbDirectory 
          && !aItem.isMailList
          && !aParentDir.isMailList) {
        TbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-contact-removed", aParentDir.UID)
      }

      //redirect to addrbook-list-removed observers
      if (aItem instanceof Components.interfaces.nsIAbCard 
          && aParentDir instanceof Components.interfaces.nsIAbDirectory 
          && aItem.isMailList
          && !aParentDir.isMailList) {
        TbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-list-removed", aParentDir.UID)
      }

      //redirect to addrbook-removed observers
      if (aItem instanceof Components.interfaces.nsIAbDirectory
          && !aItem.isMailList) {
        TbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-removed", null)
      }
    },

    onItemAdded: function addressbookListener_onItemAdded (aParentDir, aItem) {          
      //redirect to addrbook-list-created observers
      if (aItem instanceof Components.interfaces.nsIAbCard 
          && aParentDir instanceof Components.interfaces.nsIAbDirectory 
          && aItem.isMailList
          && !aParentDir.isMailList) {
        TbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-list-created", aParentDir.UID)
      } 
      
      //redirect to addrbook-contact-created observers
      if (aItem instanceof Components.interfaces.nsIAbCard 
          && aParentDir instanceof Components.interfaces.nsIAbDirectory 
          //&& aItem.getProperty("UID","") == "" //detect the only case where the original addrbook-contact-created observer fails to notify
          && !aItem.isMailList
          && !aParentDir.isMailList) {
        TbSync.addressbook.addressbookObserver.observe(aItem, "addrbook-contact-created", aParentDir.UID)
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
