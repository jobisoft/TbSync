"use strict";

var calendarsync = {

    // CALENDAR SYNC
    // TODO: Link sync to lightning-sync-button using providerId
    
    // wrapper for standard stuff done on each response
    processResponseAndGetData: function (wbxml, syncdata) {
        // get data from wbxml response
        let wbxmlData = tzPush.wbxmltools.createWBXML(wbxml).getData();

        // check for empty response
        if (wbxml.length === 0 || wbxmlData === null) {
            return "empty";
        }

        //debug
        wbxmltools.printWbxmlData(wbxmlData);

        //check status
        if (sync.statusIsBad(wbxmlData.Sync.Collections.Collection.Status, syncdata)) {
            return "bad_status";
        }

        //update synckey
        syncdata.synckey = wbxmlData.Sync.Collections.Collection.SyncKey;
        db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", syncdata.synckey);
        return wbxmlData;
    },


    // wraper to get items by Id
    getItem: function (calendar, id) {
        let requestedItem = null;
        let opDone = false;

        let itemListener = {
            onGetResult (aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
                if (aCount == 1) requestedItem = aItems[0];
            },
            onOperationComplete : function (aOperationType, aId, aDetail) { 
                opDone = true;
            }
        };
        
        calendar.getItem(id, itemListener);
        while (!opDone) {tzPush.dump("Waiting","onOperationDone() not finished yet");} //TODO wait 1s
        return requestedItem;
    },


    isValid_UTC_DateTimeString: function (str) {
        //validate if str is YYYYMMDDTHHMMSSZ
        if (str && str.length == 16 && str.charAt(8) == "T" && str.charAt(15) =="Z") {
            if ( isNaN(str.substr(0,4)) ) return false; //year
            if ( isNaN(str.substr(4,2)) || parseInt(str.substr(4,2)) == 0 || parseInt(str.substr(4,2)) > 12 ) return false; //month
            if ( isNaN(str.substr(6,2)) || parseInt(str.substr(6,2)) == 0 || parseInt(str.substr(4,2)) > 31 ) return false; //day                    
            if ( isNaN(str.substr(9,2)) || parseInt(str.substr(9,2)) > 23 ) return false; // hour
            if ( isNaN(str.substr(11,2)) || parseInt(str.substr(11,2)) > 59 ) return false; // minute
            if ( isNaN(str.substr(13,2)) || parseInt(str.substr(13,2)) > 59 ) return false; // minute
            return true;
        }
        return false;
    },

    //insert data from wbxml object into a TB event item
    setEvent: function (item, data, id) {
        item.id = id;
        
        if (data.Subject) item.title = data.Subject;
        if (data.Location) item.setProperty("location", data.Location);
        if (data.Body && data.Body.Data) item.setProperty("description", data.Body.Data);
        if (data.Categories && data.Categories.Category) item.setCategories(data.Categories.Category.length, data.Categories.Category);

        //set up datetimes
        if (this.isValid_UTC_DateTimeString(data.StartTime) == false) data.StartTime = "19700101T000000Z";
        if (this.isValid_UTC_DateTimeString(data.EndTime) == false) data.EndTime = "19700101T000000Z";

        item.startDate = Components.classes["@mozilla.org/calendar/datetime;1"].createInstance(Components.interfaces.calIDateTime);
        item.startDate.timezone = cal.floating();
        item.startDate.icalString = data.StartTime;
        item.endDate = Components.classes["@mozilla.org/calendar/datetime;1"].createInstance(Components.interfaces.calIDateTime);
        item.endDate.timezone = cal.floating();
        item.endDate.icalString = data.EndTime;

        //check if alldate and fix values
        if (data.AllDayEvent && data.AllDayEvent == "1") {
            item.startDate.isDate = true;
            item.startDate.hour = 0;
            item.startDate.minute = 0;
            item.startDate.second = 0;
            
            item.endDate.isDate = true;
            item.endDate.hour = 0;
            item.endDate.minute = 0;
            item.endDate.second = 0;

            if (item.startDate.compare(item.endDate) == 0) {
                // For a one day all day event, the end date must be 00:00:00 of
                // the next day.
                item.endDate.day++;
            }
        }

        //EAS Reminder
        item.clearAlarms();
        if (data.Reminder) {
            let alarm = cal.createAlarm();
            alarm.related = Components.interfaces.calIAlarm.ALARM_RELATED_START;
            alarm.offset = cal.createDuration();
            alarm.offset.inSeconds = (0-parseInt(data.Reminder)*60);
            alarm.action = "DISPLAY";
            item.addAlarm(alarm);
        }

        //EAS BusyStatus (TB TRANSP : free = TRANSPARENT, busy = OPAQUE)
        //0 = Free // 1 = Tentative // 2 = Busy // 3 = Work // 4 = Elsewhere
        if (data.BusyStatus) item.setProperty("TRANSP", (data.BusyStatus == 0) ? "TRANSPARENT" : "OPAQUE");

        //EAS Sensitivity (TB CLASS: PUBLIC, PRIVATE, CONFIDENTIAL)
        // 0 = Normal // 1 = Personal // 2 = Private // 3 = Confidential
        let CLASS = { "0":"PUBLIC", "1":"PRIVATE", "2":"PRIVATE", "3":"CONFIDENTIAL"};
        if (data.Sensitivity) item.setProperty("CLASS", CLASS[data.Sensitivity]);
        
        //timezone
        //aItem.entryDate = start;
        //aItem.dueDate = aEndDate.clone();
        //due.addDuration(dueOffset);
        
            /*
            <DtStamp xmlns='Calendar'>20161220T213937Z</DtStamp>
            <OrganizerName xmlns='Calendar'>John Bieling</OrganizerName>
            <OrganizerEmail xmlns='Calendar'>john.bieling@uni-bonn.de</OrganizerEmail>

            <Recurrence xmlns='Calendar'>
            <Type xmlns='Calendar'>5</Type>
            <Interval xmlns='Calendar'>1</Interval>
            <DayOfMonth xmlns='Calendar'>15</DayOfMonth>
            <MonthOfYear xmlns='Calendar'>11</MonthOfYear>
            </Recurrence>
            <MeetingStatus xmlns='Calendar'>0</MeetingStatus>
            */
    },

    getDateTimeString : function (str) {
        let dateStr = str;
        if (this.isValid_UTC_DateTimeString(dateStr) == false) {
            if (this.isValid_UTC_DateTimeString(dateStr + "Z")) {
                //valid but not UTC - TODO 
                dateStr = dateStr + "Z";
            } else {
                dateStr = "19700101T000000Z";
            }
        }
        return dateStr;
    },
    
    //read TB event and return its data as WBXML
    getEventApplicationDataAsWBXML: function (item) {
        let wbxml = tzPush.wbxmltools.createWBXML(""); //init wbxml with "" and not with precodes

        /*
         * IMPORTANT:
         * The TB event item has an item.id which is identical to item.getProperty("UID") (a so called promoted property). This id is used locally
         * to identify a card and is set to the ServerID during download. However, there could be a true UID property stored in the item on
         * the server which we do not need and touch. We MUST NOT send a UID property to the server. We only send ClientID and/or ServerId, 
         * which are not stored inside ApplicationData. */

        wbxml.switchpage("Calendar");
        wbxml.atag("StartTime", this.getDateTimeString(item.startDate.icalString));
        wbxml.atag("EndTime", this.getDateTimeString(item.endDate.icalString));
        wbxml.atag("AllDayEvent", (item.startDate.isDate && item.endDate.isDate) ? "1" : "0");

        if (item.title) wbxml.atag("Subject", item.title);
        if (item.hasProperty("location")) wbxml.atag("Location", item.getProperty("location"));
        
        //categories
        let categories = item.getCategories({});
        if (categories.length > 0) {
            wbxml.otag("Categories");
                for (let i=0; i<categories.length; i++) wbxml.atag("Category", categories[i]);
            wbxml.ctag();
        }
        
        //TP PRIORIRY (9=LOW, 5=NORMAL, 1=HIGH) not mapable to EAS
        
        //EAS Reminder (TB getAlarms)
        let alarms = item.getAlarms({});
        if (alarms.length>0) wbxml.atag("Reminder", (0 - alarms[0].offset.inSeconds/60).toString());
        //https://dxr.mozilla.org/comm-central/source/calendar/base/public/calIAlarm.idl
        //tzPush.dump("ALARM ("+i+")", [, alarms[i].related, alarms[i].repeat, alarms[i].repeatOffset, alarms[i].repeatDate, alarms[i].action].join("|"));

        //EAS BusyStatus (TB TRANSP : free = TRANSPARENT, busy = OPAQUE)
        //0 = Free // 1 = Tentative // 2 = Busy // 3 = Work // 4 = Elsewhere
        if (item.hasProperty("TRANSP")) wbxml.atag("BusyStatus", (item.getProperty("TRANSP") == "TRANSPARENT") ? "0" : "2");

        //EAS Sensitivity (TB CLASS: PUBLIC, PRIVATE, CONFIDENTIAL)
        // 0 = Normal // 1 = Personal // 2 = Private // 3 = Confidential
        let CLASS = { "PUBLIC":"0", "PRIVATE":"2", "CONFIDENTIAL":"3"}
        if (item.hasProperty("CLASS")) wbxml.atag("Sensitivity", CLASS[item.getProperty("CLASS")]);
        
        //EAS MeetingStatus (TB STATUS: CANCELLED,CONFIRMED,TENTATIVE
        // 0  The event is an appointment, which has no attendees.
        // 1  The event is a meeting and the user is the meeting organizer.
        // 3  This event is a meeting, and the user is not the meeting organizer; the meeting was received from someone else.
        // 5  The meeting has been canceled and the user was the meeting organizer.
        // 7  The meeting has been canceled. The user was not the meeting organizer; the meeting was received from someone else

        //attendees
        //timezone
        //attachements
        //repeat

        
        
        /*loop over all properties
        let propEnum = item.propertyEnumerator;
        while (propEnum.hasMoreElements()) {
            let prop = propEnum.getNext().QueryInterface(Components.interfaces.nsIProperty);
            let pname = prop.name;
            tzPush.dump("PROP", pname + " = " + prop.value);
        }*/

        //should be the last addition, due to page switch
        if (item.hasProperty("description")) {
            wbxml.switchpage("AirSyncBase");
            wbxml.otag("Body");
                wbxml.atag("Data", item.getProperty("description"));
                wbxml.atag("EstimatedDataSize", item.getProperty("description").length);
                wbxml.atag("Type", "1");
            wbxml.ctag();
            wbxml.atag("NativeBodyType", "1");
        }

        //return to AirSync
        wbxml.switchpage("AirSync");
        return wbxml.getBytes();
    },










    start: function (syncdata) {
        // skip if lightning is not installed
        if ("calICalendar" in Components.interfaces == false) {
            sync.finishSync(syncdata, "nolightning");
            return;
        }

        // check SyncTarget
        if (!tzPush.checkCalender(syncdata.account, syncdata.folderID)) {
            sync.finishSync(syncdata, "notargets");
            return;
        }
        
        //get sync target of this calendar
        syncdata.targetObj = cal.getCalendarManager().getCalendarById(tzPush.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));
        syncdata.targetId = syncdata.targetObj.id;

        this.requestRemoteChanges (syncdata);
    },










    requestRemoteChanges: function (syncdata) {

        sync.setSyncState("requestingchanges", syncdata);

        // request changes
        let wbxml = tzPush.wbxmltools.createWBXML();
        wbxml.otag("Sync");
            wbxml.otag("Collections");
                wbxml.otag("Collection");
                    wbxml.atag("SyncKey", syncdata.synckey);
                    wbxml.atag("CollectionId", syncdata.folderID);
                    wbxml.atag("DeletesAsMoves", "");
                    wbxml.atag("GetChanges", "");
                    wbxml.atag("WindowSize", "100");
                wbxml.ctag();
            wbxml.ctag();
        wbxml.ctag();

        sync.Send(wbxml.getBytes(), this.processRemoteChanges.bind(this), "Sync", syncdata);
    },










    processRemoteChanges: function (wbxml, syncdata) {
        sync.setSyncState("recievingchanges", syncdata);

        // get data from wbxml response (this is processing status and also updates SyncKey)
        let wbxmlData = this.processResponseAndGetData(wbxml, syncdata);
        switch (wbxmlData) {
                case "empty" : this.sendLocalChanges(syncdata); return;
                case "bad_status" : return;
        }

        //any commands for us to work on?
        if (wbxmlData.Sync.Collections.Collection.Commands) {

            //looking for additions
            let add = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Add);
            for (let count = 0; count < add.length; count++) {

                let ServerId = add[count].ServerId;
                let data = add[count].ApplicationData;

                let oldItem = this.getItem(syncdata.targetObj, ServerId);
                if (oldItem === null) { //do NOT add, if an item with that ServerId was found
                    let newItem = cal.createEvent();
                    this.setEvent(newItem, data, ServerId);
                    syncdata.targetObj.setMetaData(ServerId, "added_by_server");
                    syncdata.targetObj.addItem(newItem, tzPush.calendarOperationObserver);
                }
            }

            //looking for changes
            let upd = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Change);
            for (let count = 0; count < upd.length; count++) {

                let ServerId = upd[count].ServerId;
                let data = upd[count].ApplicationData;

                let oldItem = this.getItem(syncdata.targetObj, ServerId);
                if (oldItem !== null) { //only update, if an item with that ServerId was found
                    let newItem = oldItem.clone();
                    this.setEvent(newItem, data, ServerId);
                    syncdata.targetObj.setMetaData(ServerId, "modified_by_server");
                    syncdata.targetObj.modifyItem(newItem, oldItem, tzPush.calendarOperationObserver);
                }
            }
            
            //looking for deletes
            let del = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Delete);
            for (let count = 0; count < del.length; count++) {

                let ServerId = del[count].ServerId;

                let oldItem = this.getItem(syncdata.targetObj, ServerId);
                if (oldItem !== null) { //delete item with that ServerId
                    syncdata.targetObj.setMetaData(ServerId, "deleted_by_server");
                    syncdata.targetObj.deleteItem(oldItem, tzPush.calendarOperationObserver);
                }
            }
            
        }

        if (wbxmlData.Sync.Collections.Collection.MoreAvailable) {
            this.requestRemoteChanges(syncdata);
        } else { 
            this.sendLocalChanges(syncdata);
        }
    },










    sendLocalChanges: function (syncdata) {
        sync.setSyncState("sendingchanges", syncdata);

        let c = 0;
        let max = tzPush.db.prefSettings.getIntPref("maxnumbertosend");
        
        //get changed items from MetaData
        let ids = {};
        let values = {};
        let counts = {};
        syncdata.targetObj.getAllMetaData(counts, ids, values);

        let wbxml = tzPush.wbxmltools.createWBXML();
        wbxml.otag("Sync");
            wbxml.otag("Collections");
                wbxml.otag("Collection");
                    wbxml.atag("SyncKey", syncdata.synckey);
                    wbxml.atag("CollectionId", syncdata.folderID);
                    wbxml.otag("Commands");

                        for (let i=0; i<counts.value && c < max; i++) {
                            switch (values.value[i]) {

                                case "added_by_user":
                                    wbxml.otag("Add");
                                    wbxml.atag("ClientId", ids.value[i]); //ClientId is an id generated by Thunderbird, which will get replaced by an id generated by the server
                                        wbxml.otag("ApplicationData");
                                            wbxml.append(this.getEventApplicationDataAsWBXML(this.getItem(syncdata.targetObj, ids.value[i])));
                                        wbxml.ctag();
                                    wbxml.ctag();
                                    syncdata.targetObj.deleteMetaData(ids.value[i]);
                                    c++;
                                    break;
                                
                                case "modified_by_user":
                                    wbxml.otag("Change");
                                    wbxml.atag("ServerId", ids.value[i]);
                                        wbxml.otag("ApplicationData");
                                            wbxml.append(this.getEventApplicationDataAsWBXML(this.getItem(syncdata.targetObj, ids.value[i])));
                                        wbxml.ctag();
                                    wbxml.ctag();
                                    syncdata.targetObj.deleteMetaData(ids.value[i]);
                                    c++;
                                    break;
                                
                                case "deleted_by_user":
                                    wbxml.otag("Delete");
                                        wbxml.atag("ServerId", ids.value[i]);
                                    wbxml.ctag();
                                    syncdata.targetObj.deleteMetaData(ids.value[i]);
                                    c++;
                                    break;
                            }
                        }

                    wbxml.ctag(); //Commands
                wbxml.ctag(); //Collection
            wbxml.ctag(); //Collections
        wbxml.ctag(); //Sync

        if (c == 0) {
            sync.finishSync(syncdata);
        } else {
            sync.Send(wbxml.getBytes(), this.processLocalChangesResponse.bind(this), "Sync", syncdata); 
        }
    },










    processLocalChangesResponse: function (wbxml, syncdata) {
        sync.setSyncState("serverid", syncdata);

        // get data from wbxml response (this is processing status and also updates SyncKey)
        let wbxmlData = this.processResponseAndGetData(wbxml, syncdata);
        switch (wbxmlData) {
                case "empty" : sync.finishSync(syncdata); return;
                case "bad_status" : return;
        }
               
        //any responses for us to work on?
        if (wbxmlData.Sync.Collections.Collection.Responses) {

            //looking for additions (Add node contains, status, old ClientId and new ServerId)
            let add = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Add);
            for (let count = 0; count < add.length; count++) {
                
                //Check Status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                if (sync.statusIsBad(add[count].Status, syncdata)) return;

                //look for an item identfied by ClientId and update its id to the new id received from the server
                let oldItem = this.getItem(syncdata.targetObj, add[count].ClientId);
                if (oldItem !== null) {
                    let newItem = oldItem.clone();
                    newItem.id = add[count].ServerId;
                    syncdata.targetObj.setMetaData(newItem.id, "modified_by_server");
                    syncdata.targetObj.modifyItem(newItem, oldItem, tzPush.calendarOperationObserver);
                }
            }

            //looking for modifications 
            let upd = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Change);
            for (let count = 0; count < upd.length; count++) {
                //Check Status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                if (sync.statusIsBad(upd[count].Status, syncdata)) return;
            }

            //looking for deletions 
            let del = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Delete);
            for (let count = 0; count < del.length; count++) {
                //Check Status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                if (sync.statusIsBad(del[count].Status, syncdata)) return;
            }
            
            //we might not be done yet (max number to send)
            this.sendLocalChanges(syncdata); 
            
        } else {
            sync.finishSync(syncdata);
        }
    }

};
