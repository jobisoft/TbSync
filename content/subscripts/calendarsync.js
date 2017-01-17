"use strict";

var calendarsync = {

    // CALENDAR SYNC
    // Link sync to lightning-sync-button using providerId
    
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
        while (!opDone) {tzPush.dump("Waiting","onOperationDone() not finished yet");}
        return requestedItem;
    },


    //insert data from wbxml object into a TB event item
    setEvent: function (item, data) {

        item.title = data.Subject;
        item.setProperty("location", data.Location);
        item.setProperty("description", data.Body.Data);
        //item.setProperty("categories","juhu,haha");
//        item.setProperty("syncId", data.UID);
        item.setProperty("UID", data.UID);
                
        //set up datetimes
        item.startDate = Components.classes["@mozilla.org/calendar/datetime;1"].createInstance(Components.interfaces.calIDateTime);
        item.startDate.timezone = cal.floating();
        item.startDate.icalString = data.StartTime;

        item.endDate = Components.classes["@mozilla.org/calendar/datetime;1"].createInstance(Components.interfaces.calIDateTime);
        item.endDate.timezone = cal.floating();
        item.endDate.icalString = data.EndTime;

        if (data.AllDayEvent == "1") {
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
            <BusyStatus xmlns='Calendar'>0</BusyStatus>
            <Reminder xmlns='Calendar'>1080</Reminder>
            <MeetingStatus xmlns='Calendar'>0</MeetingStatus>
            <NativeBodyType xmlns='AirSyncBase'>1</NativeBodyType>
            */
    },

    //read TB event and store its data in an obj
    getEventAsWBXML: function (item) {
        let wbxml = tzPush.wbxmltools.createWBXML(""); //init wbxml with "" and not with precodes

        wbxml.switchpage("Calendar");
//        wbxml.atag("UID", item.getProperty("UID"));
        wbxml.atag("Subject", item.title);
        wbxml.atag("Location", item.getProperty("location"));
        wbxml.atag("StartTime", item.startDate.icalString + "Z"); //maybe we need to calculate UTC time and append "Z"
        wbxml.atag("EndTime", item.endDate.icalString + "Z"); // here as well
        wbxml.atag("AllDayEvent", (item.startDate.isDate && item.endDate.isDate) ? "1" : "0");

        wbxml.switchpage("AirSyncBase");
        wbxml.otag("Body");
            wbxml.atag("Data", item.getProperty("description"));
            wbxml.atag("EstimatedDataSize", item.getProperty("description").length);
            wbxml.atag("Type", "1");
        wbxml.ctag();

        return wbxml.getBytes();
    },







    fromzpush: function(syncdata) {
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
        
        //get sync target of this calendar
        let calendar = cal.getCalendarManager().getCalendarById(tzPush.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));
        
        //any commands for us to work on?
        if (wbxmlData.Sync.Collections.Collection.Commands) {

            //looking for additions
            let add = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Add);
            for (let count = 0; count < add.length; count++) {
                let data = add[count].ApplicationData;
                
                //we do not care about the UID saved in this event, we always use the ServerId - we also do not send UID to the Server
                data.UID = add[count].ServerId;
                
                let oldItem = this.getItem(calendar, data.UID); 
                if (oldItem === null) { //do NOT add, if an item with that UID was found - really? TODO
                    let newItem = cal.createEvent();
                    this.setEvent(newItem, data);
                    calendar.setMetaData(newItem.id, "added_by_server");
                    calendar.addItem(newItem, tzPush.calendarOperationObserver);
                }
            }
            
            //looking for changes
            let upd = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Change);
            for (let count = 0; count < upd.length; count++) {
                let data = upd[count].ApplicationData;

                //we do not care about the UID saved in this event, we always use the ServerId - we also do not send UID to the Server
                data.UID = upd[count].ServerId;

                let oldItem = this.getItem(calendar, data.UID);
                if (oldItem !== null) { //Only update, if an item with that UID was found
                    let newItem = cal.createEvent();
                    this.setEvent(newItem, data);
                    calendar.setMetaData(newItem.id, "modified_by_server");
                    calendar.modifyItem(newItem, oldItem, tzPush.calendarOperationObserver);
                }
            }
            
            //looking for deletes
            let del = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Delete);
            for (let count = 0; count < del.length; count++) {
                let oldItem = this.getItem(calendar, del[count].ServerId);
                if (oldItem !== null) { //delete items with that UID (there is no ApplicationData in delete commands, so use ServerId directly)
                    calendar.setMetaData(oldItem.id, "deleted_by_server");
                    calendar.deleteItem(oldItem, tzPush.calendarOperationObserver);
                }
            }
            
        }

        if (wbxmlData.Sync.Collections.Collection.MoreAvailable) {
            this.fromzpush(syncdata);
        } else { 
            this.sendLocalChanges(syncdata);
        }
    },










    sendLocalChanges: function(syncdata) {
        sync.setSyncState("sendingchanges", syncdata);

        //get sync target of this calendar
        let calendar = cal.getCalendarManager().getCalendarById(tzPush.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));

        //get changes and deletes from changelog
        let additions = tzPush.db.getItemsFromChangeLog(calendar.id, tzPush.db.prefSettings.getIntPref("maxnumbertosend"), "add");
        let changes = tzPush.db.getItemsFromChangeLog(calendar.id, tzPush.db.prefSettings.getIntPref("maxnumbertosend"), "change");
        let deletes = tzPush.db.getItemsFromChangeLog(calendar.id, tzPush.db.prefSettings.getIntPref("maxnumbertosend"), "delete");
        
        if (additions.length + changes.length + deletes.length == 0) {
            sync.finishSync(syncdata);
        } else {

            let wbxml = tzPush.wbxmltools.createWBXML();
            wbxml.otag("Sync");
                wbxml.otag("Collections");
                    wbxml.otag("Collection");
                        wbxml.atag("SyncKey", syncdata.synckey);
                        wbxml.atag("CollectionId", syncdata.folderID);
                        wbxml.otag("Commands");

                            for (let i = 0; i < additions.length; i++) {
                                wbxml.otag("Add");
                                wbxml.atag("ClientId", additions[i]);
                                    wbxml.otag("ApplicationData");
                                        wbxml.append(this.getEventAsWBXML(this.getItem(calendar, additions[i])));
                                    wbxml.ctag();
                                wbxml.ctag();
                                tzPush.db.removeItemFromChangeLog(calendar.id, additions[i]);
                            }

                            for (let i = 0; i < changes.length; i++) {
                                wbxml.otag("Change");
                                wbxml.atag("ServerId", changes[i]);
                                    wbxml.otag("ApplicationData");
                                        wbxml.append(this.getEventAsWBXML(this.getItem(calendar, changes[i])));
                                    wbxml.ctag();
                                wbxml.ctag();
                                tzPush.db.removeItemFromChangeLog(calendar.id, changes[i]);
                            }

                            for (let i = 0; i < deletes.length; i++) {
                                wbxml.otag("Delete");
                                    wbxml.atag("ServerId", deletes[i]);
                                wbxml.ctag();
                                tzPush.db.removeItemFromChangeLog(calendar.id, deletes[i]);
                            } 

                        wbxml.ctag(); //Commands
                    wbxml.ctag(); //Collection
                wbxml.ctag(); //Collections
            wbxml.ctag(); //Sync

            sync.Send(wbxml.getBytes(), this.processLocalChangesResponse.bind(this), "Sync", syncdata); 
        }
    },



    processLocalChangesResponse: function(wbxml, syncdata) {
        sync.setSyncState("serverid", syncdata);

        // get data from wbxml response (this is processing status and also updates SyncKey)
        let wbxmlData = this.processResponseAndGetData(wbxml, syncdata);
        switch (wbxmlData) {
                case "empty" : this.sendLocalDeletes(syncdata); return;
                case "bad_status" : return;
        }
        
        //get sync target of this calendar
        let calendar = cal.getCalendarManager().getCalendarById(tzPush.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));
        
        //any responses for us to work on?
        if (wbxmlData.Sync.Collections.Collection.Responses) {

            //looking for additions (Add node contains, status, old ClientId and new ServerId)
            let add = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Add);
            for (let count = 0; count < add.length; count++) {
                let oldItem = this.getItem(calendar, add[count].ClientId);  //also process status 7 TODO!
                if (oldItem !== null) {
                    let newItem = oldItem.clone();
                    newItem.setProperty("UID", add[count].ServerId);
                    calendar.setMetaData(newItem.id, "modified_by_server");

                    // IMPORTANT: We do not set this card to modified_by_server, because this changes of the UID inside the application data MUST be 
                    // send to the server as well (At the moment the server still has the old clientId as UID inside application data)! Another option would
                    // be to never download the actual UID but overwrite it localy with serverId, but that is not save if other sync tools are used elsewhere,
                    // which do download the true UID. A third option would be to not depend on UID and to add a custom ID and setup a UID-CustomId MAP 

                    //TODO: either MAP or ADJUST UID - I do not like that we have to send a THIRD message for an add job...
                    //OR do not upload UID at all
                    calendar.modifyItem(newItem, oldItem, tzPush.calendarOperationObserver);
                }
            }
            //we might not be done yet (max number to send)
            this.sendLocalChanges(syncdata); 
            
        } else {
            sync.finishSync(syncdata);
        }
    }

};
