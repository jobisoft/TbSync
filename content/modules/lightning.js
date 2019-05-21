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
    
    load: async function () {
        //check for lightning
        let lightning = await tbSync.getAddonByID("{e2fda1a4-762b-4020-b5ad-a41df1933103}");
        if (lightning !== null) {
            tbSync.dump("Check4Lightning","Start");

            //try to import
            if ("calICalendar" in Components.interfaces && typeof cal == 'undefined') {
                Components.utils.import("resource://calendar/modules/calUtils.jsm");
                Components.utils.import("resource://calendar/modules/ical.js");    
            }

            if (typeof cal !== 'undefined') {
                //adding a global observer
                cal.getCalendarManager().addCalendarObserver(this.calendarObserver);
                cal.getCalendarManager().addObserver(this.calendarManagerObserver);

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
            cal.getCalendarManager().removeCalendarObserver(this.calendarObserver);
            cal.getCalendarManager().removeObserver(this.calendarManagerObserver);

            //remove listeners on global sync buttons
            if (tbSync.window.document.getElementById("calendar-synchronize-button")) {
                tbSync.window.document.getElementById("calendar-synchronize-button").removeEventListener("click", function(event){Services.obs.notifyObservers(null, 'tbsync.observer.sync', null);}, false);
            }
            if (tbSync.window.document.getElementById("task-synchronize-button")) {
                tbSync.window.document.getElementById("task-synchronize-button").removeEventListener("click", function(event){Services.obs.notifyObservers(null, 'tbsync.observer.sync', null);}, false);
            }
        }
    },
    
    isAvailable: function () {
        //if it is known - and still valid - just return true
        return (this.lightningInitDone && typeof cal !== 'undefined');
    },
    
    calendarObserver : { 
        onStartBatch : function () {},
        onEndBatch : function () {},
        onLoad : function (aCalendar) { tbSync.dump("calendarObserver::onLoad","<" + aCalendar.name + "> was loaded."); },

        onAddItem : function (aItem) { 
            let itemStatus = tbSync.db.getItemStatusFromChangeLog(aItem.calendar.id, aItem.id)

            //if an event in one of the synced calendars is added, update status of target and account
            let folders = tbSync.db.findFoldersWithSetting(["target","useChangeLog"], [aItem.calendar.id, "1"]);
            if (folders.length == 1) {
                if (itemStatus == "added_by_server") {
                    tbSync.db.removeItemFromChangeLog(aItem.calendar.id, aItem.id);
                } else if (itemStatus === null) {
                    tbSync.core.setTargetModified(folders[0]);
                    tbSync.db.addItemToChangeLog(aItem.calendar.id, aItem.id, "added_by_user");
                }
            }
        },

        onModifyItem : function (aNewItem, aOldItem) {
            //check, if it is a pure modification within the same calendar
            if (aNewItem && aNewItem.calendar && aOldItem && aOldItem.calendar) {
                if (aNewItem.calendar.id == aOldItem.calendar.id) {

                    //check, if it is an event in one of the synced calendars
                    let newFolders = tbSync.db.findFoldersWithSetting(["target","useChangeLog"], [aNewItem.calendar.id, "1"]);
                    if (newFolders.length == 1) {
                        //check if t was modified by the server
                        let itemStatus = tbSync.db.getItemStatusFromChangeLog(aNewItem.calendar.id, aNewItem.id)

                        if (itemStatus == "modified_by_server") {
                            tbSync.db.removeItemFromChangeLog(aNewItem.calendar.id, aNewItem.id);
                        } else  if (itemStatus != "added_by_user" && itemStatus != "added_by_server") {
                            //added_by_user -> it is a local unprocessed add do not re-add it to changelog
                            //added_by_server -> it was just added by the server but our onItemAdd has not yet seen it, do not overwrite it - race condition - this local change is probably not caused by the user - ignore it?
                            tbSync.core.setTargetModified(newFolders[0]);
                            tbSync.db.addItemToChangeLog(aNewItem.calendar.id, aNewItem.id, "modified_by_user");
                        }
                    }
                    
                }
            } else {
                tbSync.dump("Error cal.onModifyItem", aNewItem.id + " has no calendar property");                
            }
        },

        onDeleteItem : function (aDeletedItem) {
            if (aDeletedItem && aDeletedItem.calendar) {
                //if an event in one of the synced calendars is deleted, update status of target and account
                let folders = tbSync.db.findFoldersWithSetting(["target","useChangeLog"], [aDeletedItem.calendar.id,"1"]);
                if (folders.length == 1) {
                    let itemStatus = tbSync.db.getItemStatusFromChangeLog(aDeletedItem.calendar.id, aDeletedItem.id)
                    if (itemStatus == "deleted_by_server" || itemStatus == "added_by_user") {
                        //if it is a delete pushed from the server, simply acknowledge (do nothing) 
                        //a local add, which has not yet been processed (synced) is deleted -> remove all traces
                        tbSync.db.removeItemFromChangeLog(aDeletedItem.calendar.id, aDeletedItem.id);
                    } else {
                        tbSync.core.setTargetModified(folders[0]);
                        tbSync.db.addItemToChangeLog(aDeletedItem.calendar.id, aDeletedItem.id, "deleted_by_user");
                    }
                }
            } else {
                tbSync.dump("Error cal.onDeleteItem", aDeletedItem.id + " has no calendar property");                
            }
        },
            
        onError : function (aCalendar, aErrNo, aMessage) { tbSync.dump("calendarObserver::onError","<" + aCalendar.name + "> had error #"+aErrNo+"("+aMessage+")."); },

        //Changed properties of the calendar itself (name, color etc.) - IF A PROVIDER NEEDS TO DO CUSTOM STUFF HERE, HE NEEDS TO ADD ITS OWN LISTENER
        onPropertyChanged : function (aCalendar, aName, aValue, aOldValue) {
            tbSync.dump("calendarObserver::onPropertyChanged","<" + aName + "> changed from <"+aOldValue+"> to <"+aValue+">");
            let folders = tbSync.db.findFoldersWithSetting(["target"], [aCalendar.id]);
            if (folders.length == 1) {
                switch (aName) {
                    case "color":
                        //update stored color to recover after disable
                        tbSync.db.setFolderSetting(folders[0].account, folders[0].folderID, "targetColor", aValue); 
                        break;
                    case "name":
                        //update stored name to recover after disable
                        tbSync.db.setFolderSetting(folders[0].account, folders[0].folderID, "targetName", aValue);                         
                        //update settings window, if open
                        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folders[0].account);
                        break;
                }
            }
        },

        //Deleted properties of the calendar itself (name, color etc.) - IF A PROVIDER NEEDS TO DO CUSTOM STUFF HERE, HE NEEDS TO ADD ITS OWN LISTENER
        onPropertyDeleting : function (aCalendar, aName) {
            tbSync.dump("calendarObserver::onPropertyDeleting","<" + aName + "> was deleted");
            let folders = tbSync.db.findFoldersWithSetting(["target"], [aCalendar.id]);
            if (folders.length == 1) {
                switch (aName) {
                    case "color":
                    case "name":
                        //update settings window, if open
                        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folders[0].account);
                    break;
                }
            }
        }
    },

    calendarManagerObserver : {
        onCalendarRegistered : function (aCalendar) { tbSync.dump("calendarManagerObserver::onCalendarRegistered","<" + aCalendar.name + "> was registered."); },
        onCalendarUnregistering : function (aCalendar) { tbSync.dump("calendarManagerObserver::onCalendarUnregistering","<" + aCalendar.name + "> was unregisterd."); },
        onCalendarDeleting : function (aCalendar) {
            tbSync.dump("calendarManagerObserver::onCalendarDeleting","<" + aCalendar.name + "> was deleted.");

            //It should not be possible to link a calendar to two different accounts, so we just take the first target found
            let folders =  tbSync.db.findFoldersWithSetting("target", aCalendar.id);
            if (folders.length == 1) {
                //delete any pending changelog of the deleted calendar
                tbSync.db.clearChangeLog(aCalendar.id);

                //unselect calendar if deleted by user (calendar is cached if delete during disable) and update settings window, if open
                if (folders[0].selected == "1" && folders[0].cached != "1") {
                    tbSync.db.setFolderSetting(folders[0].account, folders[0].folderID, "selected", "0");
                    //update settings window, if open
                    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folders[0].account);
                }
                
                tbSync.db.resetFolderSetting(folders[0].account, folders[0].folderID, "target");
            }
        },
    },

    getCalendarName: function (id) {
        if (tbSync.lightning.isAvailable()) {
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

    changeNameOfCalendarAndDisable: function(id, newname) {
        try {
            let targetCal = cal.getCalendarManager().getCalendarById(id);
            if (targetCal !== null) {
                let orig = targetCal.name;
                targetCal.name =  newname.replace("%ORIG%", orig);
                targetCal.setProperty("disabled", true);
            }
        } catch (e) {}
    },

    
    //this function actually creates a calendar if missing
    checkCalender: function (accountData) {       
        let target = accountData.getFolderSetting("target");
        let calManager = cal.getCalendarManager();
        let targetCal = calManager.getCalendarById(target);
        
        if (targetCal !== null)  {
            //check for double targets - just to make sure
            let folders = tbSync.db.findFoldersWithSetting("target", target);
            if (folders.length == 1) {
                return true;
            } else {
                throw "Target with multiple source folders found! Forcing hard fail (" + target +" )."; 
            }
        }

        
        //check if  there is a known/cached name, and use that as starting point to generate unique name for new calendar 
        let cachedName = accountData.getFolderSetting("targetName");                         
        let testname = cachedName == "" ? accountData.getAccountSetting("accountname") + " (" + accountData.getFolderSetting("name") + ")" : cachedName;

        let count = 1;
        let unique = false;
        let newname = testname;
        do {
            unique = true;
            for (let calendar of calManager.getCalendars({})) {
                if (calendar.name == newname) {
                    unique = false;
                    break;
                }
            }
            if (!unique) {
                newname = testname + " #" + count;
                count = count + 1;
            }
        } while (!unique);


        //check if there is a cached or preloaded color - if not, chose one
        if (!accountData.getFolderSetting("targetColor")) {
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
            accountData.setFolderSetting("targetColor", freeColors[0].color);        
        }
        
        //create and register new calendar
        let provider = accountData.getAccountSetting("provider");
        let newCalendar = tbSync.providers[provider].api.createCalendar(newname, accountData);
        tbSync.providers[provider].api.onResetTarget(accountData);
        
        //store id of calendar as target in DB
        accountData.setFolderSetting("target", newCalendar.id); 
        //accountData.setFolderSetting("targetName", newCalendar.name); 
       accountData.setFolderSetting("targetColor",  newCalendar.getProperty("color"));
        return true;        
    }
    
}
