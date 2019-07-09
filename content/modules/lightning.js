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

  TargetData : class {
    constructor(folderData) {            
      this._targetType = folderData.getFolderProperty("targetType");
      this._folderData = folderData;
      this._targetObj = null;           
    }
    
    get targetType() { // return the targetType, this was initialized with
      return this._targetType;
    }
    
    checkTarget() {
      return tbSync.lightning.checkCalendar(this._folderData);
    }

    getTarget() {
      let calendar = tbSync.lightning.checkCalendar(this._folderData);
      
      if (!calendar) {
        calendar = tbSync.lightning.createCalender(this._folderData);
        if (!calendar)
          throw new Error("CouldNotGetOrCreateTarget");
      }

      return calendar; //TODO: changelog + async Wrapper
    }
    
    removeTarget() {
      let calendar = tbSync.lightning.checkCalendar(this._folderData);
      try {
        if (calendar) {
          tbSync.lightning.cal.getCalendarManager().removeCalendar(calendar);
        }
      } catch (e) {}
    }
    
    decoupleTarget(suffix, cacheFolder = false) {
      let calendar = tbSync.lightning.checkCalendar(this._folderData);

      if (calendar) {
        // decouple directory from the connected folder
        let target = this._folderData.getFolderProperty("target");
        this._folderData.resetFolderProperty("target");

        //if there are local changes, append an  (*) to the name of the target
        let c = 0;
        let a = tbSync.db.getItemsFromChangeLog(target, 0, "_by_user");
        for (let i=0; i<a.length; i++) c++;
        if (c>0) suffix += " (*)";

        //this is the only place, where we manually have to call clearChangelog, because the target is not deleted
        //(on delete, changelog is cleared automatically)
        tbSync.db.clearChangeLog(target);
        if (suffix) {
          let orig = calendar.name;
          calendar.name = "Local backup of: " + orig + " " + suffix;
        }
        calendar.setProperty("disabled", true);
      }
      
      //should we remove the folder by setting its state to cached?
       if (cacheFolder) {
         this._folderData.setFolderProperty("cached", true);
       }
    }     
  },
    
  
  
  
  
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

        let itemStatus = tbSync.db.getItemStatusFromChangeLog(aAddedItem.calendar.id, aAddedItem.id)
        if (itemStatus && itemStatus.endsWith("_by_server")) {
          //we caused this, ignore
          tbSync.db.removeItemFromChangeLog(aAddedItem.calendar.id, aAddedItem.id);
          return;
        }

        //if (itemStatus === null) {
        //    tbSync.db.addItemToChangeLog(aAddedItem.calendar.id, aAddedItem.id, "added_by_user");
        //}
        
        //tbSync.core.setTargetModified(folderData);
        tbSync.providers[folderData.accountData.getAccountProperty("provider")].calendar.itemObserver("onAddItem", folderData, aAddedItem);                                        
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

        let itemStatus = tbSync.db.getItemStatusFromChangeLog(aNewItem.calendar.id, aNewItem.id)
        if (itemStatus && itemStatus.endsWith("_by_server")) {
          //we caused this, ignore
          tbSync.db.removeItemFromChangeLog(aNewItem.calendar.id, aNewItem.id);
          return;
        }

        //if (itemStatus != "added_by_user" && itemStatus != "added_by_server") {
        //    //added_by_user -> it is a local unprocessed add do not re-add it to changelog
        //    //added_by_server -> it was just added by the server but our onItemAdd has not yet seen it, do not overwrite it - race condition - this local change is probably not caused by the user - ignore it?
        //    tbSync.db.addItemToChangeLog(aNewItem.calendar.id, aNewItem.id, "modified_by_user");
        //}

        //tbSync.core.setTargetModified(folderData);
        tbSync.providers[folderData.accountData.getAccountProperty("provider")].calendar.itemObserver("onModifyItem", folderData, aNewItem, aOldItem);                                        
      }
    },

    onDeleteItem : function (aDeletedItem) {
      if (!(aDeletedItem && aDeletedItem.calendar))
        return;

      let folderData = tbSync.lightning.getFolderFromCalendarUID(aDeletedItem.calendar.id);                    
      if (folderData 
        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountProperty("provider"))
        && folderData.getFolderProperty("targetType") == "calendar") {

        let itemStatus = tbSync.db.getItemStatusFromChangeLog(aDeletedItem.calendar.id, aDeletedItem.id)
        if (itemStatus && itemStatus.endsWith("_by_server")) {
          //we caused this, ignore
          tbSync.db.removeItemFromChangeLog(aDeletedItem.calendar.id, aDeletedItem.id);
          return;
        }

        //if (itemStatus == "deleted_by_server" || itemStatus == "added_by_user") {
        //    //if it is a delete pushed from the server, simply acknowledge (do nothing) 
        //    //a local add, which has not yet been processed (synced) is deleted -> remove all traces
        //    tbSync.db.removeItemFromChangeLog(aDeletedItem.calendar.id, aDeletedItem.id);
        //} else {
        //    tbSync.core.setTargetModified(folders[0]);
        //    tbSync.db.addItemToChangeLog(aDeletedItem.calendar.id, aDeletedItem.id, "deleted_by_user");
        //}

        //tbSync.core.setTargetModified(folderData);
        tbSync.providers[folderData.accountData.getAccountProperty("provider")].calendar.itemObserver("onDeleteItem", folderData, aDeletedItem);
      }
    },

    //Changed properties of the calendar itself (name, color etc.)
    onPropertyChanged : function (aCalendar, aName, aValue, aOldValue) {
      let folderData = tbSync.lightning.getFolderFromCalendarUID(aCalendar.id);                    
      if (folderData 
        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountProperty("provider"))
        && folderData.getFolderProperty("targetType") == "calendar") {

        switch (aName) {
          case "color":
            //update stored color to recover after disable
            folderData.setFolderProperty("targetColor", aValue); 
            break;
          case "name":
            //update stored name to recover after disable
            folderData.setFolderProperty("targetName", aValue);                         
            //update settings window, if open
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);                    
            break;
        }
        
        tbSync.providers[folderData.accountData.getAccountProperty("provider")].calendar.calendarObserver("onCalendarPropertyChanged", folderData, aCalendar, aName, aValue, aOldValue);                
      }
    },

    //Deleted properties of the calendar itself (name, color etc.)
    onPropertyDeleting : function (aCalendar, aName) {
      let folderData = tbSync.lightning.getFolderFromCalendarUID(aCalendar.id);                    
      if (folderData 
        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountProperty("provider"))
        && folderData.getFolderProperty("targetType") == "calendar") {

        switch (aName) {
          case "color":
          case "name":
            //update settings window, if open
            Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);                    
          break;
        }

        tbSync.providers[folderData.accountData.getAccountProperty("provider")].calendar.calendarObserver("onCalendarPropertyDeleted", folderData, aCalendar, aName);                
      }
    }
  },

  calendarManagerObserver : {
    onCalendarRegistered : function (aCalendar) {
      let folders = tbSync.db.findFolders({"targetType": "calendar"});
      for (let folder of folders) {
        let provider = tbSync.db.getAccountProperty(folder.accountID, "provider");
        let calendarUrlField = tbSync.providers[provider].calendar.calendarUrlField;
        if (tbSync.db.getFolderProperty(folder.accountID, folder.folderID, calendarUrlField) == aCalendar.uri.spec) {
          let accountData = new tbSync.AccountData(folder.accountID);
          let folderData = new tbSync.FolderData(accountData, folder.folderID);
          tbSync.providers[provider].calendar.calendarObserver("onCalendarReregistered", folderData, aCalendar);                
        }
      }                
    },
    
    onCalendarUnregistering : function (aCalendar) {
      let folderData = tbSync.lightning.getFolderFromCalendarUID(aCalendar.id);                    
      if (folderData 
        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountProperty("provider"))
        && folderData.getFolderProperty("targetType") == "calendar") {

        tbSync.providers[folderData.accountData.getAccountProperty("provider")].calendar.calendarObserver("onCalendarUnregistered", folderData, aCalendar);                
      }                
    },
      
    onCalendarDeleting : function (aCalendar) {
      let folderData = tbSync.lightning.getFolderFromCalendarUID(aCalendar.id);                    
      if (folderData 
        && tbSync.providers.loadedProviders.hasOwnProperty(folderData.accountData.getAccountProperty("provider"))
        && folderData.getFolderProperty("targetType") == "calendar") {

        //delete any pending changelog of the deleted book
        tbSync.db.clearChangeLog(aCalendar.id);			

        //unselect book if deleted by user and update settings window, if open
        if (folderData.getFolderProperty("selected")) {
          folderData.setFolderProperty("selected", false);
          //update settings window, if open
          Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folderData.accountID);
        }
        
        folderData.resetFolderProperty("target");
        tbSync.providers[folderData.accountData.getAccountProperty("provider")].calendar.calendarObserver("onCalendarDeleted", folderData, aCalendar);                

      }
    },
  },

  
  checkCalendar: function (folderData) {       
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
  createCalender: function (folderData) {       
    let calManager = tbSync.lightning.cal.getCalendarManager();
    let target = folderData.getFolderProperty("target");
    let provider = folderData.accountData.getAccountProperty("provider");

    
    //check if  there is a known/cached name, and use that as starting point to generate unique name for new calendar 
    let cachedName = folderData.getFolderProperty("targetName");                         
    let basename = cachedName == "" ? folderData.accountData.getAccountProperty("accountname") + " (" + folderData.getFolderProperty("name") + ")" : cachedName;

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
    } while (!unique);


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
    let newCalendar = tbSync.providers[provider].calendar.createCalendar(newname, folderData);
    tbSync.providers[provider].api.onResetTarget(folderData);
    
    //store id of calendar as target in DB
    folderData.setFolderProperty("target", newCalendar.id); 
    folderData.setFolderProperty("targetName", basename);
    folderData.setFolderProperty("targetColor",  newCalendar.getProperty("color"));
    return newCalendar;        
  }
}
