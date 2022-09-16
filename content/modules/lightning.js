/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

 var { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
 
 XPCOMUtils.defineLazyModuleGetters(this, {
  CalAlarm: "resource:///modules/CalAlarm.jsm",
  CalAttachment: "resource:///modules/CalAttachment.jsm",
  CalAttendee: "resource:///modules/CalAttendee.jsm",
  CalEvent: "resource:///modules/CalEvent.jsm",
  CalTodo: "resource:///modules/CalTodo.jsm",
}); 
  
var lightning = {

  cal: null,
  ICAL: null,
   
  load: async function () {
    try {
      TbSync.lightning.cal = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm").cal;
      TbSync.lightning.ICAL = ChromeUtils.import("resource:///modules/calendar/Ical.jsm").ICAL;
      let manager = TbSync.lightning.cal.manager ? TbSync.lightning.cal.manager : TbSync.lightning.cal.getCalendarManager();
      manager.addCalendarObserver(this.calendarObserver);
      manager.addObserver(this.calendarManagerObserver);
    } catch (e) {
      TbSync.dump("Check4Lightning","Error during lightning module import: " + e.toString() + "\n" + e.stack);
      Components.utils.reportError(e);
    }
  },

  unload: async function () {
    //removing global observer
    let manager = TbSync.lightning.cal.manager ? TbSync.lightning.cal.manager : TbSync.lightning.cal.getCalendarManager();
    manager.removeCalendarObserver(this.calendarObserver);
    manager.removeObserver(this.calendarManagerObserver);

    //remove listeners on global sync buttons
    if (TbSync.window.document.getElementById("calendar-synchronize-button")) {
      TbSync.window.document.getElementById("calendar-synchronize-button").removeEventListener("click", function(event){Services.obs.notifyObservers(null, 'tbsync.observer.sync', null);}, false);
    }
    if (TbSync.window.document.getElementById("task-synchronize-button")) {
      TbSync.window.document.getElementById("task-synchronize-button").removeEventListener("click", function(event){Services.obs.notifyObservers(null, 'tbsync.observer.sync', null);}, false);
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
      let calManager = TbSync.lightning.cal.manager ? TbSync.lightning.cal.manager : TbSync.lightning.cal.getCalendarManager();
      let target = this._folderData.getFolderProperty("target");
      let calendar = calManager.getCalendarById(target);
      
      return calendar ? true : false;
    }

    // Returns the target obj, which TbSync should return as the target. It can
    // be whatever you want and is returned by FolderData.targetData.getTarget().
    // If the target does not exist, it should be created. Throw a simple Error, if that
    // failed.
    async getTarget() {
      let calManager = TbSync.lightning.cal.manager ? TbSync.lightning.cal.manager : TbSync.lightning.cal.getCalendarManager();
      let target = this._folderData.getFolderProperty("target");
      let calendar = calManager.getCalendarById(target);
      
      if (!calendar) {
        calendar = await TbSync.lightning.prepareAndCreateCalendar(this._folderData);
        if (!calendar)
          throw new Error("notargets");
      }

      if (!this._targetObj || this._targetObj.id != calendar.id)
        this._targetObj = new TbSync.lightning.TbCalendar(calendar, this._folderData);

      return this._targetObj;
    }
    
    /**
     * Removes the target from the local storage. If it does not exist, return
     * silently. A call to ``hasTarget()`` should return false, after this has
     * been executed.
     *
     */
    removeTarget() {
      let calManager = TbSync.lightning.cal.manager ? TbSync.lightning.cal.manager : TbSync.lightning.cal.getCalendarManager();
      let target = this._folderData.getFolderProperty("target");
      let calendar = calManager.getCalendarById(target);

      try {
        if (calendar) {
          calManager.removeCalendar(calendar);
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
      let calManager = TbSync.lightning.cal.manager ? TbSync.lightning.cal.manager : TbSync.lightning.cal.getCalendarManager();
      let target = this._folderData.getFolderProperty("target");
      let calendar = calManager.getCalendarById(target);

      if (calendar) {
        let changes = TbSync.db.getItemsFromChangeLog(target, 0, "_by_user");        
        if (changes.length > 0) {
          this.targetName = this.targetName + " (*)";
        }
        calendar.setProperty("disabled", true);
        calendar.setProperty("tbSyncProvider", "orphaned");
        calendar.setProperty("tbSyncAccountID", "");
      }
      TbSync.db.clearChangeLog(target);
      this._folderData.resetFolderProperty("target");        
    } 
    
    set targetName(newName) {
      let calManager = TbSync.lightning.cal.manager ? TbSync.lightning.cal.manager : TbSync.lightning.cal.getCalendarManager();
      let target = this._folderData.getFolderProperty("target");
      let calendar = calManager.getCalendarById(target);

      if (calendar) {
        calendar.name = newName;
      } else {
        throw new Error("notargets");
      }
    }
  
    get targetName() {
      let calManager = TbSync.lightning.cal.manager ? TbSync.lightning.cal.manager : TbSync.lightning.cal.getCalendarManager();
      let target = this._folderData.getFolderProperty("target");
      let calendar = calManager.getCalendarById(target);

      if (calendar) {
        return calendar.name;
      } else {
        throw new Error("notargets");
      }
    }

    setReadOnly(value) {
      // hasTarget() can throw an error, ignore that here
      try {
        if (this.hasTarget()) {
          this.getTarget().then(target => target.calendar.setProperty("readOnly", value));
        }
      } catch (e) {
        Components.utils.reportError(e);
      }
    }

    
    // * * * * * * * * * * * * * * * * *
    // * AdvancedTargetData extension  * 
    // * * * * * * * * * * * * * * * * *
    
    get isAdvancedCalendarTargetData() {
      return true;
    }
    
    get folderData() {
      return this._folderData;
    }
    
    // The calendar target does not support a custom primaryKeyField, because
    // the lightning implementation only allows to search for items via UID.
    // Like the addressbook target, the calendar target item element has a
    // primaryKey getter/setter which - however - only works on the UID.
    
    // enable or disable changelog
    get logUserChanges(){
      return true;
    }

    calendarObserver(aTopic, tbCalendar, aPropertyName, aPropertyValue, aOldPropertyValue) {
      switch (aTopic) {
        case "onCalendarPropertyChanged":
          //Services.console.logStringMessage("["+ aTopic + "] " + tbCalendar.calendar.name + " : " + aPropertyName);
          break;

        case "onCalendarDeleted":
        case "onCalendarPropertyDeleted":
          //Services.console.logStringMessage("["+ aTopic + "] " +tbCalendar.calendar.name);
          break;
      }
    }

    itemObserver(aTopic, tbItem, tbOldItem) {
      switch (aTopic) {
        case "onAddItem":
        case "onModifyItem":
        case "onDeleteItem":
          //Services.console.logStringMessage("["+ aTopic + "] " + tbItem.nativeItem.title);
          break;
      }
    }

    // replace this with your own implementation to create the actual addressbook,
    // when this class is extended
    async createCalendar(newname) {
      let calManager = TbSync.lightning.cal.manager ? TbSync.lightning.cal.manager : TbSync.lightning.cal.getCalendarManager();
      let newCalendar = calManager.createCalendar("storage", Services.io.newURI("moz-storage-calendar://"));
      newCalendar.id = TbSync.lightning.cal.getUUID();
      newCalendar.name = newname;
      return newCalendar
    }      
    
  },




  
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  // * TbItem and TbCalendar Classes
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  
  TbItem : class {
    constructor(TbCalendar, item) {
      if (!TbCalendar)
        throw new Error("TbItem::constructor is missing its first parameter!");

      if (!item)
        throw new Error("TbItem::constructor is missing its second parameter!");

      this._tbCalendar = TbCalendar;
      this._item = item;
      
      this._isTodo = (item instanceof Ci.calITodo);
      this._isEvent = (item instanceof Ci.calIEvent);
    }
    
    get tbCalendar() {
      return this._tbCalendar;
    }

    get isTodo() {
      return this._isTodo;
    }
    
    get isEvent() {
      return this._isEvent;
    }




    
    get nativeItem() {
      return this._item;
    }

    get UID() {
      return this._item.id;
    }
    
    get primaryKey() {
      // no custom key possible with lightning, must use the UID
      return this._item.id;
    }

    set primaryKey(value) {
      // no custom key possible with lightning, must use the UID
      this._item.id = value;   
    }

    clone() {
      return new TbSync.lightning.TbItem(this._tbCalendar, this._item.clone());
    }

    toString() {
      return this._item.icalString;
    }

    getProperty(property, fallback = "") {
      return this._item.hasProperty(property) ? this._item.getProperty(property) : fallback;
    }

    setProperty(property, value) {
      this._item.setProperty(property, value);
    }
    
    deleteProperty(property) {
      this._item.deleteProperty(property);
    }
        
    get changelogData() {         
      return TbSync.db.getItemDataFromChangeLog(this._tbCalendar.UID, this.primaryKey);
    }

    get changelogStatus() {
      return TbSync.db.getItemStatusFromChangeLog(this._tbCalendar.UID, this.primaryKey);
    }

    set changelogStatus(status) {
      let value = this.primaryKey;
      
      if (value) {
        if (!status) {
          TbSync.db.removeItemFromChangeLog(this._tbCalendar.UID, value);
          return;
        }

        if (this._tbCalendar.logUserChanges || status.endsWith("_by_server")) {
          TbSync.db.addItemToChangeLog(this._tbCalendar.UID, value, status);
        }
      }
    }
  },


  TbCalendar : class {
    constructor(calendar, folderData) {
      this._calendar = calendar;
      // Since Thunderbird 96, many calendar functions return promises
      if (parseInt(Services.appinfo.version.split(".")[0]) >= 96) {
        this._promisifyCalendar = calendar;
      } else {
        this._promisifyCalendar = TbSync.lightning.cal.async.promisifyCalendar(this._calendar.wrappedJSObject);
      }
      this._folderData = folderData;
     }

    get calendar() {
      return this._calendar;
    }
    
    get promisifyCalendar() {
      return this._promisifyCalendar;
    }

    get logUserChanges() {
      return this._folderData.targetData.logUserChanges;
    }
    
    get primaryKeyField() {
      // Not supported by lightning. We let the implementation sit here, it may get changed in the future.
      // In order to support this, lightning needs to implement a proper getItemfromProperty() method.
      return null;
    }
    
    get UID() {
      return this._calendar.id;
    }

    createNewEvent() {
      let event = new CalEvent();
      return new TbSync.lightning.TbItem(this, event);
    }
    
    createNewTodo() {
      let todo = new CalTodo();
      return new TbSync.lightning.TbItem(this, todo);
    }

    
    
    
    async addItem(tbItem, pretagChangelogWithByServerEntry = true) {
      if (this.primaryKeyField && !tbItem.getProperty(this.primaryKeyField)) {
        tbItem.setProperty(this.primaryKeyField, this._folderData.targetData.generatePrimaryKey());
        //Services.console.logStringMessage("[TbCalendar::addItem] Generated primary key!");
      }
      
      if (pretagChangelogWithByServerEntry) {
        tbItem.changelogStatus = "added_by_server";
      }
      return await this._promisifyCalendar.adoptItem(tbItem._item);
    }
    
    async modifyItem(tbNewItem, tbOldItem, pretagChangelogWithByServerEntry = true) {
      // only add entry if the current entry does not start with _by_user
      let status = tbNewItem.changelogStatus ? tbNewItem.changelogStatus : "";
      if (pretagChangelogWithByServerEntry && !status.endsWith("_by_user")) {
        tbNewItem.changelogStatus = "modified_by_server";
      }
      
      return await this._promisifyCalendar.modifyItem(tbNewItem._item, tbOldItem._item); 
    }        
    
    async deleteItem(tbItem, pretagChangelogWithByServerEntry = true) {
      if (pretagChangelogWithByServerEntry) {
        tbItem.changelogStatus = "deleted_by_server";
      }
      return await this._promisifyCalendar.deleteItem(tbItem._item); 
    }
    
    // searchId is interpreted as the primaryKeyField, which is the UID for this target
    async getItem (searchId) {
      let item = await this._promisifyCalendar.getItem(searchId); 
      if (item.length == null) return new TbSync.lightning.TbItem(this, item);
      if (item.length == 1) return new TbSync.lightning.TbItem(this, item[0]);
      if (item.length > 1) throw "Oops: getItem returned <"+item.length+"> elements!";
      return null;
    }

    async getItemFromProperty(property, value) {
      if (property == "UID") return await this.getItem(value);
      else throw ("TbSync.lightning.getItemFromProperty: Currently onle the UID property can be used to search for items.");
    }

    async getAllItems () {
      return await this._promisifyCalendar.getAllItems(); 
    }
      
  
  
  
  
    getAddedItemsFromChangeLog(maxitems = 0) {             
      return TbSync.db.getItemsFromChangeLog(this.calendar.id, maxitems, "added_by_user").map(item => item.itemId);
    }

    getModifiedItemsFromChangeLog(maxitems = 0) {             
      return TbSync.db.getItemsFromChangeLog(this.calendar.id, maxitems, "modified_by_user").map(item => item.itemId);
    }
    
    getDeletedItemsFromChangeLog(maxitems = 0) {             
      return TbSync.db.getItemsFromChangeLog(this.calendar.id, maxitems, "deleted_by_user").map(item => item.itemId);
    }
    
    getItemsFromChangeLog(maxitems = 0) {             
      return TbSync.db.getItemsFromChangeLog(this.calendar.id, maxitems, "_by_user");
    }

    removeItemFromChangeLog(id, moveToEndInsteadOfDelete = false) {             
      TbSync.db.removeItemFromChangeLog(this.calendar.id, id, moveToEndInsteadOfDelete);
    }
    
    clearChangelog() {
      TbSync.db.clearChangeLog(this.calendar.id);
    }
  },
  



  
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  // * Internal Functions
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  
  getFolderFromCalendarUID: function(calUID) {
    let folders = TbSync.db.findFolders({"target": calUID});
    if (folders.length == 1) {
      let accountData = new TbSync.AccountData(folders[0].accountID);
      return new TbSync.FolderData(accountData, folders[0].folderID);
    }
    return null;
  },
  
  getFolderFromCalendarURL: function(calURL) {
    let folders = TbSync.db.findFolders({"url": calURL});
    if (folders.length == 1) {
      let accountData = new TbSync.AccountData(folders[0].accountID);
      return new TbSync.FolderData(accountData, folders[0].folderID);
    }
    return null;
  },  
  
  calendarObserver : { 
    onStartBatch : function () {},
    onEndBatch : function () {},
    onLoad : function (aCalendar) {},
    onError : function (aCalendar, aErrNo, aMessage) {},

    onAddItem : function (aAddedItem) { 
      if (!(aAddedItem && aAddedItem.calendar))
        return;

      let folderData = TbSync.lightning.getFolderFromCalendarUID(aAddedItem.calendar.id);                    
      if (folderData 
        && folderData.targetData 
        && folderData.targetData.isAdvancedCalendarTargetData) {

        let tbCalendar = new TbSync.lightning.TbCalendar(aAddedItem.calendar, folderData);
        let tbItem = new TbSync.lightning.TbItem(tbCalendar, aAddedItem);          
        let itemStatus = tbItem.changelogStatus;

        // if this card was created by us, it will be in the log
        if (itemStatus && itemStatus.endsWith("_by_server")) {
          let age = Date.now() - tbItem.changelogData.timestamp;
          if (age < 1500) {
            // during freeze, local modifications are not possible
            return;
          } else {
            // remove blocking entry from changelog after freeze time is over (1.5s),
            // and continue evaluating this event
            abItem.changelogStatus = "";
          }
        } 

        if (itemStatus == "deleted_by_user")  {
          // deleted ?  user moved item out and back in -> modified
          tbItem.changelogStatus = "modified_by_user";
        } else {
          tbItem.changelogStatus = "added_by_user";
        }
        
        if (tbCalendar.logUserChanges) TbSync.core.setTargetModified(folderData);
        folderData.targetData.itemObserver("onAddItem", tbItem, null);                                        
      }
    },

    onModifyItem : function (aNewItem, aOldItem) {
      //check, if it is a pure modification within the same calendar
      if (!(aNewItem && aNewItem.calendar && aOldItem && aOldItem.calendar && aNewItem.calendar.id == aOldItem.calendar.id))
        return;

      let folderData = TbSync.lightning.getFolderFromCalendarUID(aNewItem.calendar.id);                    
      if (folderData 
        && folderData.targetData 
        && folderData.targetData.isAdvancedCalendarTargetData) {

        let tbCalendar = new TbSync.lightning.TbCalendar(aNewItem.calendar, folderData);
        let tbNewItem = new TbSync.lightning.TbItem(tbCalendar, aNewItem);          
        let tbOldItem = new TbSync.lightning.TbItem(tbCalendar, aOldItem);          
        let itemStatus = tbNewItem.changelogStatus;
          
        // if this card was created by us, it will be in the log
        if (itemStatus && itemStatus.endsWith("_by_server")) {
          let age = Date.now() - tbNewItem.changelogData.timestamp;
          if (age < 1500) {
            // during freeze, local modifications are not possible
            return;
          } else {
            // remove blocking entry from changelog after freeze time is over (1.5s),
            // and continue evaluating this event
            tbNewItem.changelogStatus = "";
          }
        } 

        if (itemStatus != "added_by_user") {
          //added_by_user -> it is a local unprocessed add do not re-add it to changelog
          tbNewItem.changelogStatus = "modified_by_user";
        }

        if (tbCalendar.logUserChanges) TbSync.core.setTargetModified(folderData);
        folderData.targetData.itemObserver("onModifyItem", tbNewItem, tbOldItem);                                        
      }
    },

    onDeleteItem : function (aDeletedItem) {
      if (!(aDeletedItem && aDeletedItem.calendar))
        return;

      let folderData = TbSync.lightning.getFolderFromCalendarUID(aDeletedItem.calendar.id);                    
      if (folderData 
        && folderData.targetData 
        && folderData.targetData.isAdvancedCalendarTargetData) {

        let tbCalendar = new TbSync.lightning.TbCalendar(aDeletedItem.calendar, folderData);
        let tbItem = new TbSync.lightning.TbItem(tbCalendar, aDeletedItem);
        let itemStatus = tbItem.changelogStatus;

        // if this card was created by us, it will be in the log
        if (itemStatus && itemStatus.endsWith("_by_server")) {
          let age = Date.now() - tbItem.changelogData.timestamp;
          if (age < 1500) {
            // during freeze, local modifications are not possible
            return;
          } else {
            // remove blocking entry from changelog after freeze time is over (1.5s),
            // and continue evaluating this event
            tbItem.changelogStatus = "";
          }
        } 

        if (itemStatus == "added_by_user") {
          //a local add, which has not yet been processed (synced) is deleted -> remove all traces
          tbItem.changelogStatus = "";
        } else {
          tbItem.changelogStatus = "deleted_by_user";
        }

        if (tbCalendar.logUserChanges) TbSync.core.setTargetModified(folderData);
        folderData.targetData.itemObserver("onDeleteItem", tbItem, null);
      }
    },

    //Changed properties of the calendar itself (name, color etc.)
    onPropertyChanged : function (aCalendar, aName, aValue, aOldValue) {
      let folderData = TbSync.lightning.getFolderFromCalendarUID(aCalendar.id);                    
      if (folderData 
        && folderData.targetData 
        && folderData.targetData.isAdvancedCalendarTargetData) {

        let tbCalendar = new TbSync.lightning.TbCalendar(aCalendar, folderData);
          
        switch (aName) {
          case "color":
            // update stored color to recover after disable
            folderData.setFolderProperty("targetColor", aValue); 
            break;
          case "name":
            // update stored name to recover after disable
            folderData.setFolderProperty("targetName", aValue);                         
            // update settings window, if open
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);                    
            break;
        }
        
        folderData.targetData.calendarObserver("onCalendarPropertyChanged", tbCalendar, aName, aValue, aOldValue);                
      }
    },

    //Deleted properties of the calendar itself (name, color etc.)
    onPropertyDeleting : function (aCalendar, aName) {
      let folderData = TbSync.lightning.getFolderFromCalendarUID(aCalendar.id);                    
      if (folderData 
        && folderData.targetData 
        && folderData.targetData.isAdvancedCalendarTargetData) {

        let tbCalendar = new TbSync.lightning.TbCalendar(aCalendar, folderData);
          
        switch (aName) {
          case "color":
          case "name":
            //update settings window, if open
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);                    
          break;
        }

        folderData.targetData.calendarObserver("onCalendarPropertyDeleted", tbCalendar, aName);                
      }
    }
  },

  calendarManagerObserver : {
    onCalendarRegistered : function (aCalendar) {              
    },
    
    onCalendarUnregistering : function (aCalendar) {
      /*let folderData = TbSync.lightning.getFolderFromCalendarUID(aCalendar.id);                    
      if (folderData 
        && folderData.targetData 
        && folderData.targetData.isAdvancedCalendarTargetData) {

        folderData.targetData.calendarObserver("onCalendarUnregistered", aCalendar);                
      }*/
    },
      
    onCalendarDeleting : async function (aCalendar) {
      let folderData = TbSync.lightning.getFolderFromCalendarUID(aCalendar.id);                    
      if (folderData 
        && folderData.targetData 
        && folderData.targetData.isAdvancedCalendarTargetData) {

        // If the user switches "offline support", the calendar is deleted and recreated. Thus,
        // we wait a bit and check, if the calendar is back again and ignore the delete event.
        if (aCalendar.type == "caldav") {
          await TbSync.tools.sleep(1500);
          let calManager = TbSync.lightning.cal.manager ? TbSync.lightning.cal.manager : TbSync.lightning.cal.getCalendarManager();
          for (let calendar of calManager.getCalendars({})) {
            if (calendar.uri.spec == aCalendar.uri.spec) {
              // update the target
              folderData.setFolderProperty("target", calendar.id)
              return;
            }
          }
        }
        
        //delete any pending changelog of the deleted calendar
        TbSync.db.clearChangeLog(aCalendar.id);			

        let tbCalendar = new TbSync.lightning.TbCalendar(aCalendar, folderData);
          
        //unselect calendar if deleted by user and update settings window, if open
        if (folderData.getFolderProperty("selected")) {
          folderData.setFolderProperty("selected", false);
          //update settings window, if open
          Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);
        }
        
        folderData.resetFolderProperty("target");
        folderData.targetData.calendarObserver("onCalendarDeleted", tbCalendar);                

      }
    },
  },

  
  
  //this function actually creates a calendar if missing
  prepareAndCreateCalendar: async function (folderData) {       
    let calManager = TbSync.lightning.cal.manager ? TbSync.lightning.cal.manager : TbSync.lightning.cal.getCalendarManager();
    let provider = folderData.accountData.getAccountProperty("provider");

    //check if  there is a known/cached name, and use that as starting point to generate unique name for new calendar 
    let cachedName = folderData.getFolderProperty("targetName");                         
    let newname = cachedName == "" ? folderData.accountData.getAccountProperty("accountname") + " (" + folderData.getFolderProperty("foldername") + ")" : cachedName;

    //check if there is a cached or preloaded color - if not, chose one
    if (!folderData.getFolderProperty("targetColor")) {
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
      folderData.setFolderProperty("targetColor", freeColors[0].color);        
    }
    
    //create and register new calendar
    let newCalendar = await folderData.targetData.createCalendar(newname);
    newCalendar.setProperty("tbSyncProvider", provider);
    newCalendar.setProperty("tbSyncAccountID", folderData.accountData.accountID);

    //store id of calendar as target in DB
    folderData.setFolderProperty("target", newCalendar.id); 
    folderData.setFolderProperty("targetName", newCalendar.name);
    folderData.setFolderProperty("targetColor",  newCalendar.getProperty("color"));
    return newCalendar;        
  }
}
