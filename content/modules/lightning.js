/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
  
var lightning = {

  lightningInitDone : false,
  
  cal: null,
  ICAL: null,
  
  load: async function () {
    //check for lightning
    let lightning = await AddonManager.getAddonByID("{e2fda1a4-762b-4020-b5ad-a41df1933103}");
    if (lightning !== null) {
      tbSync.dump("Check4Lightning","Start");

      //try to import
      if ("calICalendar" in Components.interfaces) {
        var { cal } = ChromeUtils.import("resource://calendar/modules/calUtils.jsm");
        var { ICAL } = ChromeUtils.import("resource://calendar/modules/ical.js");
        tbSync.lightning.cal = cal;
        tbSync.lightning.ICAL = ICAL;
      }

      if (typeof tbSync.lightning.cal !== 'undefined') {
        //adding a global observer
        tbSync.lightning.cal.getCalendarManager().addCalendarObserver(this.calendarObserver);
        tbSync.lightning.cal.getCalendarManager().addObserver(this.calendarManagerObserver);

        //indicate, that we have initialized 
        this.lightningInitDone = true;
        tbSync.dump("Check4Lightning","Done");                            
      } else {
        tbSync.dump("Check4Lightning","Failed!");
      }
    }

  },

  unload: async function () {
    if (this.isAvailable()) {
      //removing global observer
      tbSync.lightning.cal.getCalendarManager().removeCalendarObserver(this.calendarObserver);
      tbSync.lightning.cal.getCalendarManager().removeObserver(this.calendarManagerObserver);

      //remove listeners on global sync buttons
      if (tbSync.window.document.getElementById("calendar-synchronize-button")) {
        tbSync.window.document.getElementById("calendar-synchronize-button").removeEventListener("click", function(event){Services.obs.notifyObservers(null, 'tbsync.observer.sync', null);}, false);
      }
      if (tbSync.window.document.getElementById("task-synchronize-button")) {
        tbSync.window.document.getElementById("task-synchronize-button").removeEventListener("click", function(event){Services.obs.notifyObservers(null, 'tbsync.observer.sync', null);}, false);
      }
    }
  },




  
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  // * TargetData implementation 
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  
   TargetData : class {
    constructor(folderData) {            
      this._targetType = folderData.getFolderProperty("targetType");
      this._folderData = folderData;
      this._targetObj = null;           
    }
    
    // Return the targetType, this was initialized with.
    get targetType() {
      return this._targetType;
    }
    
    // Check, if the target exists and return true/false.
    hasTarget() {
      if (!tbSync.lightning.isAvailable()) {
          throw new Error("nolightning");
      }

      return tbSync.lightning.getCalendar(this._folderData) ? true : false;
    }

    // Returns the target obj, which TbSync should return as the target. It can
    // be whatever you want and is returned by FolderData.targetData.getTarget().
    // If the target does not exist, it should be created. Throw a simple Error, if that
    // failed.
    getTarget() {
      if (!tbSync.lightning.isAvailable()) {
          throw new Error("nolightning");
      }

      let calendar = tbSync.lightning.getCalendar(this._folderData);
      
      if (!calendar) {
        calendar = tbSync.lightning.createCalendar(this._folderData);
        if (!calendar)
          throw new Error("notargets");
      }

      if (!this._targetObj || this._targetObj.id != calendar.id)
        this._targetObj = new tbSync.lightning.TbCalendar(calendar, this._folderData);

      return this._targetObj;
    }
    
    // Remove the target and everything that belongs to it. TbSync will reset the target
    // property after this call has been executed.
    removeTarget() {
      if (!tbSync.lightning.isAvailable()) {
          throw new Error("nolightning");
      }

      let calendar = tbSync.lightning.getCalendar(this._folderData);
      try {
        if (calendar) {
          tbSync.lightning.cal.getCalendarManager().removeCalendar(calendar);
        }
      } catch (e) {}
    }

    /**
     * This is called, when a folder is removed, but its target should be kept
     * as a stale/unconnected item.
     *
     * @param suffix         [in] Suffix, which should be appended to the name
     *                            of the target.
     * @param pendingChanges [in] Array of ChangelogData objects, of unsynced
     *                            local changes
     * 
     */
     appendStaleSuffix(suffix, pendingChanges) {
      if (!tbSync.lightning.isAvailable()) {
          throw new Error("nolightning");
      }

      let calendar = tbSync.lightning.getCalendar(this._folderData);
      if (calendar && suffix) {
        //if there are pending/unsynced changes, append an  (*) to the name of the target
        if (pendingChanges.length > 0) suffix += " (*)";

        let orig = calendar.name;
        calendar.name = tbSync.getString("target.orphaned") + ": " + orig + (suffix ? " " + suffix : "");
        calendar.setProperty("disabled", true);
        calendar.setProperty("tbSyncProvider", "orphaned");
        calendar.setProperty("tbSyncAccountID", "");
      }
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
      return new tbSync.lightning.TbItem(this._tbCalendar, this._item.clone());
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
      return tbSync.db.getItemDataFromChangeLog(this._tbCalendar.UID, this.primaryKey);
    }

    get changelogStatus() {
      return tbSync.db.getItemStatusFromChangeLog(this._tbCalendar.UID, this.primaryKey);
    }

    set changelogStatus(status) {
      let value = this.primaryKey;
      
      if (value) {
        if (!status) {
          tbSync.db.removeItemFromChangeLog(this._tbCalendar.UID, value);
          return;
        }

        if (this._tbCalendar.logUserChanges || status.endsWith("_by_server")) {
          tbSync.db.addItemToChangeLog(this._tbCalendar.UID, value, status);
        }
      }
    }
  },


  TbCalendar : class {
    constructor(calendar, folderData) {
      this._calendar = calendar;
      this._promisifyCalendar = tbSync.lightning.cal.async.promisifyCalendar(this._calendar.wrappedJSObject);
      this._folderData = folderData;
      this._provider = folderData.accountData.getAccountProperty("provider");
     }

    get calendar() {
      return this._calendar;
    }
    
    get promisifyCalendar() {
      return this._promisifyCalendar;
    }

    get logUserChanges() {
      return tbSync.providers[this._provider].StandardCalendarTarget.logUserChanges;
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
      let event = tbSync.lightning.cal.createEvent();
      return new tbSync.lightning.TbItem(this, event);
    }
    
    createNewTodo() {
      let todo = tbSync.lightning.cal.createTodo();
      return new tbSync.lightning.TbItem(this, todo);
    }

    
    
    
    async addItem(tbItem, pretagChangelogWithByServerEntry = true) {
      if (this.primaryKeyField && !tbItem.getProperty(this.primaryKeyField)) {
        tbItem.setProperty(this.primaryKeyField, tbSync.providers[this._provider].StandardCalendarTarget.generatePrimaryKey(this._folderData));
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
      if (item.length == 1) return new tbSync.lightning.TbItem(this, item[0]);
      if (item.length > 1) throw "Oops: getItem returned <"+item.length+"> elements!";
      return null;
    }

    async getItemFromProperty(property, value) {
      if (property == "UID") return await this.getItem(value);
      else throw ("tbSync.lightning.getItemFromProperty: Currently onle the UID property can be used to search for items.");
    }

    async getAllItems () {
      return await this._promisifyCalendar.getAllItems(); 
    }
      
  
  
  
  
    getAddedItemsFromChangeLog(maxitems = 0) {             
      return tbSync.db.getItemsFromChangeLog(this.calendar.id, maxitems, "added_by_user").map(item => item.itemId);
    }

    getModifiedItemsFromChangeLog(maxitems = 0) {             
      return tbSync.db.getItemsFromChangeLog(this.calendar.id, maxitems, "modified_by_user").map(item => item.itemId);
    }
    
    getDeletedItemsFromChangeLog(maxitems = 0) {             
      return tbSync.db.getItemsFromChangeLog(this.calendar.id, maxitems, "deleted_by_user").map(item => item.itemId);
    }
    
    getItemsFromChangeLog(maxitems = 0) {             
      return tbSync.db.getItemsFromChangeLog(this.calendar.id, maxitems, "_by_user");
    }

    removeItemFromChangeLog(id, moveToEndInsteadOfDelete = false) {             
      tbSync.db.removeItemFromChangeLog(this.calendar.id, id, moveToEndInsteadOfDelete);
    }
    
    clearChangelog() {
      tbSync.db.clearChangeLog(this.calendar.id);
    }
  },
  



  
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  // * Internal Functions
  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  
  isAvailable: function () {
    //if it is known - and still valid - return true
    return (this.lightningInitDone && typeof tbSync.lightning.cal !== 'undefined');
  },
  
  getFolderFromCalendarUID: function(calUID) {
    let folders = tbSync.db.findFolders({"target": calUID});
    if (folders.length == 1) {
      let accountData = new tbSync.AccountData(folders[0].accountID);
      return new tbSync.FolderData(accountData, folders[0].folderID);
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

      let folderData = tbSync.lightning.getFolderFromCalendarUID(aAddedItem.calendar.id);                    
      if (folderData 
        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountProperty("provider"))
        && folderData.getFolderProperty("targetType") == "calendar") {

        let tbCalendar = new tbSync.lightning.TbCalendar(aAddedItem.calendar, folderData);
        let tbItem = new tbSync.lightning.TbItem(tbCalendar, aAddedItem);          
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
        
        if (tbCalendar.logUserChanges) tbSync.core.setTargetModified(folderData);
        tbSync.providers[folderData.accountData.getAccountProperty("provider")].StandardCalendarTarget.itemObserver("onAddItem", folderData, tbItem, null);                                        
      }
    },

    onModifyItem : function (aNewItem, aOldItem) {
      //check, if it is a pure modification within the same calendar
      if (!(aNewItem && aNewItem.calendar && aOldItem && aOldItem.calendar && aNewItem.calendar.id == aOldItem.calendar.id))
        return;

      let folderData = tbSync.lightning.getFolderFromCalendarUID(aNewItem.calendar.id);                    
      if (folderData 
        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountProperty("provider"))
        && folderData.getFolderProperty("targetType") == "calendar") {

        let tbCalendar = new tbSync.lightning.TbCalendar(aNewItem.calendar, folderData);
        let tbNewItem = new tbSync.lightning.TbItem(tbCalendar, aNewItem);          
        let tbOldItem = new tbSync.lightning.TbItem(tbCalendar, aOldItem);          
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

        if (tbCalendar.logUserChanges) tbSync.core.setTargetModified(folderData);
        tbSync.providers[folderData.accountData.getAccountProperty("provider")].StandardCalendarTarget.itemObserver("onModifyItem", folderData, tbNewItem, tbOldItem);                                        
      }
    },

    onDeleteItem : function (aDeletedItem) {
      if (!(aDeletedItem && aDeletedItem.calendar))
        return;

      let folderData = tbSync.lightning.getFolderFromCalendarUID(aDeletedItem.calendar.id);                    
      if (folderData 
        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountProperty("provider"))
        && folderData.getFolderProperty("targetType") == "calendar") {

        let tbCalendar = new tbSync.lightning.TbCalendar(aDeletedItem.calendar, folderData);
        let tbItem = new tbSync.lightning.TbItem(tbCalendar, aDeletedItem);
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

        if (tbCalendar.logUserChanges) tbSync.core.setTargetModified(folderData);
        tbSync.providers[folderData.accountData.getAccountProperty("provider")].StandardCalendarTarget.itemObserver("onDeleteItem", folderData, tbItem, null);
      }
    },

    //Changed properties of the calendar itself (name, color etc.)
    onPropertyChanged : function (aCalendar, aName, aValue, aOldValue) {
      let folderData = tbSync.lightning.getFolderFromCalendarUID(aCalendar.id);                    
      if (folderData 
        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountProperty("provider"))
        && folderData.getFolderProperty("targetType") == "calendar") {

        let tbCalendar = new tbSync.lightning.TbCalendar(aCalendar, folderData);
          
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
        
        tbSync.providers[folderData.accountData.getAccountProperty("provider")].StandardCalendarTarget.calendarObserver("onCalendarPropertyChanged", folderData, tbCalendar, aName, aValue, aOldValue);                
      }
    },

    //Deleted properties of the calendar itself (name, color etc.)
    onPropertyDeleting : function (aCalendar, aName) {
      let folderData = tbSync.lightning.getFolderFromCalendarUID(aCalendar.id);                    
      if (folderData 
        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountProperty("provider"))
        && folderData.getFolderProperty("targetType") == "calendar") {

        let tbCalendar = new tbSync.lightning.TbCalendar(aCalendar, folderData);
          
        switch (aName) {
          case "color":
          case "name":
            //update settings window, if open
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);                    
          break;
        }

        tbSync.providers[folderData.accountData.getAccountProperty("provider")].StandardCalendarTarget.calendarObserver("onCalendarPropertyDeleted", folderData, tbCalendar, aName);                
      }
    }
  },

  calendarManagerObserver : {
    onCalendarRegistered : function (aCalendar) {              
    },
    
    onCalendarUnregistering : function (aCalendar) {
      /*let folderData = tbSync.lightning.getFolderFromCalendarUID(aCalendar.id);                    
      if (folderData 
        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountProperty("provider"))
        && folderData.getFolderProperty("targetType") == "calendar") {

        tbSync.providers[folderData.accountData.getAccountProperty("provider")].StandardCalendarTarget.calendarObserver("onCalendarUnregistered", folderData, aCalendar);                
      }*/
    },
      
    onCalendarDeleting : async function (aCalendar) {
      let folderData = tbSync.lightning.getFolderFromCalendarUID(aCalendar.id);                    
      if (folderData 
        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountProperty("provider"))
        && folderData.getFolderProperty("targetType") == "calendar") {

        // If the user switches "offline support", the calendar is deleted and recreated. Thus,
        // we wait a bit and check, if the calendar is back again and ignore the delete event.
        await tbSync.tools.sleep(1500);

        let calManager = tbSync.lightning.cal.getCalendarManager();          
        for (let calendar of calManager.getCalendars({})) {
            if (calendar.uri.spec == aCalendar.uri.spec) {
                // update the target
                folderData.setFolderProperty("target", calendar.id)
                return;
            }
        }

        //delete any pending changelog of the deleted book
        tbSync.db.clearChangeLog(aCalendar.id);			

        let tbCalendar = new tbSync.lightning.TbCalendar(aCalendar, folderData);
          
        //unselect book if deleted by user and update settings window, if open
        if (folderData.getFolderProperty("selected")) {
          folderData.setFolderProperty("selected", false);
          //update settings window, if open
          Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);
        }
        
        folderData.resetFolderProperty("target");
        tbSync.providers[folderData.accountData.getAccountProperty("provider")].StandardCalendarTarget.calendarObserver("onCalendarDeleted", folderData, tbCalendar);                

      }
    },
  },

  
  getCalendar: function (folderData) {       
    if (!folderData.getFolderProperty("cached")) {
      let target = folderData.getFolderProperty("target");
      let calManager = tbSync.lightning.cal.getCalendarManager();
      let targetCal = calManager.getCalendarById(target);
      
      if (targetCal !== null)  {
        //check for double targets - just to make sure
        let folders = tbSync.db.findFolders({"target": target, "cached": false}, {"accountID": folderData.accountID});
        if (folders.length == 1) {
          return targetCal;
        } else {
          throw "Target with multiple source folders found! Forcing hard fail (" + target +" )."; 
        }
      }
    }
    return null;
  },
  
  //this function actually creates a calendar if missing
  createCalendar: function (folderData) {       
    let calManager = tbSync.lightning.cal.getCalendarManager();
    let target = folderData.getFolderProperty("target");
    let provider = folderData.accountData.getAccountProperty("provider");

    
    //check if  there is a known/cached name, and use that as starting point to generate unique name for new calendar 
    let cachedName = folderData.getFolderProperty("targetName");                         
    let newname = cachedName == "" ? folderData.accountData.getAccountProperty("accountname") + " (" + folderData.getFolderProperty("foldername") + ")" : cachedName;

    /* this seems to cause more trouble than it helps
    let count = 1;
    let unique = false;
    let newname = basename;
    do {
      unique = true;
      for (let calendar of calManager.getCalendars({})) {
        if (calendar.name == newname) {
          unique = false;
          break;
        }
      }
      if (!unique) {
        newname = basename + " #" + count;
        count = count + 1;
      }
    } while (!unique);*/


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
    let newCalendar = tbSync.providers[provider].StandardCalendarTarget.createCalendar(newname, folderData);
    newCalendar.setProperty("tbSyncProvider", provider);
    newCalendar.setProperty("tbSyncAccountID", folderData.accountData.accountID);
    tbSync.providers[provider].Base.onResetTarget(folderData);

    //store id of calendar as target in DB
    folderData.setFolderProperty("target", newCalendar.id); 
    folderData.setFolderProperty("targetName", newCalendar.name);
    folderData.setFolderProperty("targetColor",  newCalendar.getProperty("color"));
    return newCalendar;        
  }
}
