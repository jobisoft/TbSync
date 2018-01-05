"use strict";

eas.calendarsync = {

    //https://dxr.mozilla.org/comm-central/source/calendar/base/modules/calAsyncUtils.jsm

    start: Task.async (function* (syncdata)  {
        // skip if lightning is not installed
        if ("calICalendar" in Components.interfaces == false) {
            throw eas.finishSync("nolightning", eas.flags.abortWithError);
        }
        
        // check SyncTarget
        if (!tbSync.checkCalender(syncdata.account, syncdata.folderID)) {
            throw eas.finishSync("notargets", eas.flags.abortWithError);
        }
        
        //get sync target of this calendar
        syncdata.targetObj = cal.getCalendarManager().getCalendarById(tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));
        syncdata.targetId = syncdata.targetObj.id;

        //sync
        yield eas.calendarsync.requestRemoteChanges (syncdata); 
        yield eas.calendarsync.sendLocalChanges (syncdata);
        
        //if everything was OK, we still throw, to get into catch
        throw eas.finishSync();
    }),



    
    requestRemoteChanges: Task.async (function* (syncdata)  {
        do {
            tbSync.setSyncState("requestingchanges", syncdata.account, syncdata.folderID);

            // BUILD WBXML
            let wbxml = tbSync.wbxmltools.createWBXML();
            wbxml.otag("Sync");
                wbxml.otag("Collections");
                    wbxml.otag("Collection");
                        if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") wbxml.atag("Class", syncdata.type);
                        wbxml.atag("SyncKey", syncdata.synckey);
                        wbxml.atag("CollectionId", syncdata.folderID);
                        wbxml.atag("DeletesAsMoves", "1");
                        //wbxml.atag("GetChanges", ""); //Not needed, as it is default
                        wbxml.atag("WindowSize", "100");

                        if (tbSync.db.getAccountSetting(syncdata.account, "asversion") != "2.5") {
                            wbxml.otag("Options");
                                wbxml.switchpage("AirSyncBase");
                                wbxml.otag("BodyPreference");
                                    wbxml.atag("Type", "1");
                                wbxml.ctag();
                                wbxml.switchpage("AirSync");
                            wbxml.ctag();
                        }

                    wbxml.ctag();
                wbxml.ctag();
            wbxml.ctag();



            //SEND REQUEST
            let response = yield eas.sendRequest(wbxml.getBytes(), "Sync", syncdata);



            //VALIDATE RESPONSE
            tbSync.setSyncState("recievingchanges", syncdata.account, syncdata.folderID);

            // get data from wbxml response, some servers send empty response if there are no changes, which is not an error
            let wbxmlData = eas.getDataFromResponse(response, eas.flags.allowEmptyResponse);
            if (wbxmlData === null) return;
        
            //check status, throw on error
            eas.checkStatus(syncdata, wbxmlData,"Sync.Collections.Collection.Status");
            
            //update synckey, throw on error
            eas.updateSynckey(syncdata, wbxmlData);



            //PROCESS RESPONSE        
            //any commands for us to work on? If we reach this point, Sync.Collections.Collection is valid, 
            //no need to use the save getWbxmlDataField function
            if (wbxmlData.Sync.Collections.Collection.Commands) {

                //promisify calender, so it can be used together with yield
                let pcal = cal.async.promisifyCalendar(syncdata.targetObj.wrappedJSObject);
            
                //looking for additions
                let add = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Add);
                for (let count = 0; count < add.length; count++) {

                    let ServerId = add[count].ServerId;
                    let data = add[count].ApplicationData;

                    let foundItems = yield pcal.getItem(ServerId);
                    if (foundItems.length == 0) { //do NOT add, if an item with that ServerId was found
                        //if this is a resync and this item exists in delete_log, do not add it, the follow-up delete request will remove it from the server as well
                        if (db.getItemStatusFromChangeLog(syncdata.targetObj.id, ServerId) == "deleted_by_user") {
                            tbSync.dump("Add request, but element is in delete_log, asuming resync, local state wins, not adding.", ServerId);
                        } else {
                            let newItem = cal.createEvent();
                            eas.calendarsync.setCalendarItemFromWbxml(newItem, data, ServerId, tbSync.db.getAccountSetting(syncdata.account, "asversion"));
                            db.addItemToChangeLog(syncdata.targetObj.id, ServerId, "added_by_server");
                            try {
                                yield pcal.addItem(newItem);
                            } catch (e) {tbSync.dump("Error during Add", e);}
                        }
                    } else {
                        //item exists, asuming resync
                        tbSync.dump("Add request, but element exists already, asuming resync, local version wins.", ServerId);
                        //we MUST make sure, that our local version is send to the server
                        db.addItemToChangeLog(syncdata.targetObj.id, ServerId, "modified_by_user");
                    }
                }

                //looking for changes
                let upd = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Change);
                //inject custom change object for debug
                //upd = JSON.parse('[{"ServerId":"2tjoanTeS0CJ3QTsq5vdNQAAAAABDdrY6Gp03ktAid0E7Kub3TUAAAoZy4A1","ApplicationData":{"DtStamp":"20171109T142149Z"}}]');
                for (let count = 0; count < upd.length; count++) {

                    let ServerId = upd[count].ServerId;
                    let data = upd[count].ApplicationData;

                    let foundItems = yield pcal.getItem(ServerId);
                    if (foundItems.length > 0) { //only update, if an item with that ServerId was found
                        let newItem = foundItems[0].clone();
                        eas.calendarsync.setCalendarItemFromWbxml(newItem, data, ServerId, tbSync.db.getAccountSetting(syncdata.account, "asversion"));
                        db.addItemToChangeLog(syncdata.targetObj.id, ServerId, "modified_by_server");
                        yield pcal.modifyItem(newItem, foundItems[0]);
                    } else {
                        tbSync.dump("Update request, but element not found", ServerId);
                        //resync to avoid out-of-sync problems, "add" can take care of local merges
                        throw eas.finishSync("ChangeElementNotFound", eas.flags.resyncFolder);
                    }
                }
                
                //looking for deletes
                let del = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Delete);
                for (let count = 0; count < del.length; count++) {

                    let ServerId = del[count].ServerId;

                    let foundItems = yield pcal.getItem(ServerId);
                    if (foundItems.length > 0) { //delete item with that ServerId
                        db.addItemToChangeLog(syncdata.targetObj.id, ServerId, "deleted_by_server");
                        yield pcal.deleteItem(foundItems[0]);
                    } else {
                        tbSync.dump("Delete request, but element not found", ServerId);
                        //resync to avoid out-of-sync problems
                        throw eas.finishSync("DeleteElementNotFound", eas.flags.resyncFolder);
                    }
                }
            
            }
            
            if (!wbxmlData.Sync.Collections.Collection.MoreAvailable) return;
        } while (true);
                
    }),




    sendLocalChanges: Task.async (function* (syncdata)  {

        //promisify calender, so it can be used together with yield
        let pcal = cal.async.promisifyCalendar(syncdata.targetObj.wrappedJSObject);
        let maxnumbertosend = tbSync.prefSettings.getIntPref("maxnumbertosend");
        
        //get changed items from ChangeLog
        do {
            tbSync.setSyncState("sendingchanges", syncdata.account, syncdata.folderID);
            let changes = db.getItemsFromChangeLog(syncdata.targetObj.id, maxnumbertosend, "_by_user");
            let c=0;
            
            // BUILD WBXML
            let wbxml = tbSync.wbxmltools.createWBXML();
            wbxml.otag("Sync");
                wbxml.otag("Collections");
                    wbxml.otag("Collection");
                        if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") wbxml.atag("Class", syncdata.type);
                        wbxml.atag("SyncKey", syncdata.synckey);
                        wbxml.atag("CollectionId", syncdata.folderID);
                        wbxml.otag("Commands");

                            for (let i=0; i<changes.length; i++) {
                                //tbSync.dump("CHANGES",(i+1) + "/" + changes.length + " ("+changes[i].status+"," + changes[i].id + ")");
                                let items = null;
                                switch (changes[i].status) {

                                    case "added_by_user":
                                        items = yield pcal.getItem(changes[i].id);
                                        wbxml.otag("Add");
                                        wbxml.atag("ClientId", changes[i].id); //ClientId is an id generated by Thunderbird, which will get replaced by an id generated by the server
                                            wbxml.otag("ApplicationData");
                                                wbxml.append(eas.calendarsync.getWbxmlFromCalendarItem(items[0], tbSync.db.getAccountSetting(syncdata.account, "asversion")));
                                            wbxml.ctag();
                                        wbxml.ctag();
                                        db.removeItemFromChangeLog(syncdata.targetObj.id, changes[i].id);
                                        c++;
                                        break;
                                    
                                    case "modified_by_user":
                                        items = yield pcal.getItem(changes[i].id);
                                        wbxml.otag("Change");
                                        wbxml.atag("ServerId", changes[i].id);
                                            wbxml.otag("ApplicationData");
                                                wbxml.append(eas.calendarsync.getWbxmlFromCalendarItem(items[0], tbSync.db.getAccountSetting(syncdata.account, "asversion")));
                                            wbxml.ctag();
                                        wbxml.ctag();
                                        db.removeItemFromChangeLog(syncdata.targetObj.id, changes[i].id);
                                        c++;
                                        break;
                                    
                                    case "deleted_by_user":
                                        wbxml.otag("Delete");
                                            wbxml.atag("ServerId", changes[i].id);
                                        wbxml.ctag();
                                        db.removeItemFromChangeLog(syncdata.targetObj.id, changes[i].id);
                                        c++;
                                        break;
                                }
                            }

                        wbxml.ctag(); //Commands
                    wbxml.ctag(); //Collection
                wbxml.ctag(); //Collections
            wbxml.ctag(); //Sync

            //if there was not a single local change, exit
            if (c == 0) {
                if (changes !=0 ) tbSync.dump("noMoreChanges, but unproceccessed changes left:", changes);
                return;
            }



            //SEND REQUEST & VALIDATE RESPONSE
            let response = yield eas.sendRequest(wbxml.getBytes(), "Sync", syncdata);

            tbSync.setSyncState("serverid", syncdata.account, syncdata.folderID);

            //get data from wbxml response
            let wbxmlData = eas.getDataFromResponse(response);
        
            //check status
            eas.checkStatus(syncdata, wbxmlData,"Sync.Collections.Collection.Status");
            
            //update synckey
            eas.updateSynckey(syncdata, wbxmlData);



            //PROCESS RESPONSE        
            //any responses for us to work on?  If we reach this point, Sync.Collections.Collection is valid, 
            //no need to use the save getWbxmlDataField function
            if (wbxmlData.Sync.Collections.Collection.Responses) {                

                //looking for additions (Add node contains, status, old ClientId and new ServerId)
                let add = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Add);
                for (let count = 0; count < add.length; count++) {
                    
                    //Check status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                    eas.checkStatus(syncdata, add[count],"Status","Sync.Collections.Collection.Responses.Add["+count+"].Status");

                    //look for an item identfied by ClientId and update its id to the new id received from the server
                    let foundItems = yield pcal.getItem(add[count].ClientId);
                    
                    if (foundItems.length > 0) {
                        let newItem = foundItems[0].clone();
                        newItem.id = add[count].ServerId;
                        db.addItemToChangeLog(syncdata.targetObj.id, newItem.id, "modified_by_server");
                        yield pcal.modifyItem(newItem, foundItems[0]);
                    }
                }

                //looking for modifications 
                let upd = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Change);
                for (let count = 0; count < upd.length; count++) {
                    //Check status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                    eas.checkStatus(syncdata, upd[count],"Status","Sync.Collections.Collection.Responses.Change["+count+"].Status");
                }

                //looking for deletions 
                let del = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Delete);
                for (let count = 0; count < del.length; count++) {
                    //Check status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                    eas.checkStatus(syncdata, del[count],"Status","Sync.Collections.Collection.Responses.Delete["+count+"].Status");
                }
                
            }
        } while (true);
        
    }),






    //FUNCTIONS TO ACTUALLY READ FROM AND WRITE TO CALENDAR ITEMS
    //insert data from wbxml object into a TB event item
    setCalendarItemFromWbxml: function (item, data, id, asversion) {
        
        item.id = id;
        let easTZ = new eas.TimeZoneDataStructure();

        if (data.Subject) item.title = xmltools.checkString(data.Subject);
        if (data.Location) item.setProperty("location", xmltools.checkString(data.Location));
        if (data.Categories && data.Categories.Category) {
            let cats = [];
            if (Array.isArray(data.Categories.Category)) cats = data.Categories.Category;
            else cats.push(data.Categories.Category);
            item.setCategories(cats.length, cats);
        }

        if (asversion == "2.5") {
            if (data.Body) item.setProperty("description", xmltools.checkString(data.Body));
        } else {
            if (data.Body && data.Body.EstimatedDataSize > 0 && data.Body.Data) item.setProperty("description", xmltools.checkString(data.Body.Data)); //CLEAR??? DataSize>0 ??
        }
        
        //timezone
        let utcOffset =eas.defaultUtcOffset;
        if (data.TimeZone) {
            //load timezone struct into EAS TimeZone object
            easTZ.base64 = data.TimeZone;
            utcOffset = easTZ.utcOffset;
            tbSync.dump("Recieve TZ","Extracted UTC Offset: " + utcOffset + ", Guessed TimeZone: " + eas.offsets[utcOffset] + ", Full Received TZ: " + easTZ.toString());
        }

        let tzService = cal.getTimezoneService();
        if (data.StartTime) {
            let utc = cal.createDateTime(data.StartTime); //format "19800101T000000Z" - UTC
            item.startDate = utc.getInTimezone(tzService.getTimezone(eas.offsets[utcOffset]));
        }

        if (data.EndTime) {
            let utc = cal.createDateTime(data.EndTime);
            item.endDate = utc.getInTimezone(tzService.getTimezone(eas.offsets[utcOffset]));
        }

        //stamp time cannot be set and it is not needed, an updated version is only send to the server, if there was a change, so stamp will be updated


        //check if alldate and fix values
        if (data.AllDayEvent && data.AllDayEvent == "1") {
            item.startDate.isDate = true;
            item.endDate.isDate = true;
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


        //Attendees - remove all Attendees and re-add the ones from XML
        item.removeAllAttendees();
        if (data.Attendees && data.Attendees.Attendee) {
            let att = [];
            if (Array.isArray(data.Attendees.Attendee)) att = data.Attendees.Attendee;
            else att.push(data.Attendees.Attendee);
            for (let i = 0; i < att.length; i++) {

                let attendee = cal.createAttendee();

                attendee["id"] = cal.prependMailTo(att[i].Email);
                attendee["commonName"] = att[i].Name;
                attendee["rsvp"] = "TRUE";

                //not supported in 2.5
                switch (att[i].AttendeeType) {
                    case "1": //required
                        attendee["role"] = "REQ-PARTICIPANT";
                        attendee["userType"] = "INDIVIDUAL";
                        break;
                    case "2": //optional
                        attendee["role"] = "OPT-PARTICIPANT";
                        attendee["userType"] = "INDIVIDUAL";
                        break;
                    default : //resource or unknown
                        attendee["role"] = "NON-PARTICIPANT";
                        attendee["userType"] = "RESOURCE";
                        break;
                }

                //not supported in 2.5
                switch (att[i].AttendeeStatus) {
                    case "2": //Tentative
                        attendee["participationStatus"] = "TENTATIVE";
                        break;
                    case "3": //Accept
                        attendee["participationStatus"] = "ACCEPTED";
                        break;
                    case "4": //Decline
                        attendee["participationStatus"] = "DECLINED";
                        break;
                    case "5": //Not responded
                        attendee["participationStatus"] = "NEEDS-ACTION";
                        break;
                    default : //Unknown
                        attendee["participationStatus"] = "NEEDS-ACTION";
                        break;
                }

                /*
                 * status  : [NEEDS-ACTION, ACCEPTED, DECLINED, TENTATIVE, DELEGATED, COMPLETED, IN-PROCESS]
                 * rolemap : [REQ-PARTICIPANT, OPT-PARTICIPANT, NON-PARTICIPANT, CHAIR]
                 * typemap : [INDIVIDUAL, GROUP, RESOURCE, ROOM]
                 */

                // Add attendee to event
                item.addAttendee(attendee);
            }
        }
        
        if (data.OrganizerName && data.OrganizerEmail) {
            //Organizer
            let organizer = cal.createAttendee();
            organizer.id = cal.prependMailTo(data.OrganizerEmail);
            organizer.commonName = data.OrganizerName;
            organizer.rsvp = "TRUE";
            organizer.role = "CHAIR";
            organizer.userType = null;
            organizer.participationStatus = "ACCEPTED";
            organizer.isOrganizer = true;
            item.organizer = organizer;
        }

        if (data.Recurrence) {
            item.recurrenceInfo = cal.createRecurrenceInfo();
            item.recurrenceInfo.item = item;
            let recRule = cal.createRecurrenceRule();
            switch (data.Recurrence.Type) {
            case "0":
                recRule.type = "DAILY";
                break;
            case "1":
                recRule.type = "WEEKLY";
                break;
            case "2":
            case "3":
                recRule.type = "MONTHLY";
                break;
            case "5":
            case "6":
                recRule.type = "YEARLY";
                break;
            }
            if (data.Recurrence.CalendarType) {
                // TODO
            }
            if (data.Recurrence.DayOfMonth) {
                recRule.setComponent("BYMONTHDAY", 1, [data.Recurrence.DayOfMonth]);
            }
            if (data.Recurrence.DayOfWeek) {
                let DOW = data.Recurrence.DayOfWeek;
                if (DOW == 127) {
                    recRule.setComponent("BYMONTHDAY", 1, [-1]);
                }
                else {
                    let days = [];
                    for (let i = 0; i < 7; ++i) {
                        if (DOW & 1 << i) days.push(i + 1);
                    }
                    recRule.setComponent("BYDAY", days.length, days);
                }
            }
            if (data.Recurrence.FirstDayOfWeek) {
                recRule.setComponent("WKST", 1, [data.Recurrence.FirstDayOfWeek]);
            }
            if (data.Recurrence.Interval) {
                recRule.interval = data.Recurrence.Interval;
            }
            if (data.Recurrence.IsLeapMonth) {
                // TODO
            }
            if (data.Recurrence.MonthOfYear) {
                recRule.setComponent("BYMONTH", 1, [data.Recurrence.MonthOfYear]);
            }
            if (data.Recurrence.Occurrences) {
                recRule.count = data.Recurrence.Occurrences;
            }
            if (data.Recurrence.Until) {
                recRule.untilDate = cal.createDateTime(data.Recurrence.Until);
            }
            if (data.Recurrence.WeekOfMonth) {
                recRule.setComponent("BYWEEKNO", 1, [data.Recurrence.WeekOfMonth]);
            }
            item.recurrenceInfo.insertRecurrenceItemAt(recRule, 0);
        }

        /* Missing : MeetingStatus, Attachements (needs EAS 16.0 !)

            <MeetingStatus xmlns='Calendar'>0</MeetingStatus>
            */

        //TASK STUFF
        //aItem.entryDate = start;
        //aItem.dueDate = aEndDate.clone();
        //due.addDuration(dueOffset);
    },






    //read TB event and return its data as WBXML
    getWbxmlFromCalendarItem: function (item, asversion) {
        let wbxml = tbSync.wbxmltools.createWBXML(""); //init wbxml with "" and not with precodes
        
        /*
         *  We do not use ghosting, that means, if we do not include a value in CHANGE, it is removed from the server. 
         *  However, this does not seem to work on all fields. Furthermore, we need to include any (empty) container to blank its childs.
         */

        wbxml.switchpage("Calendar");
        
        //each TB event has an ID, which is used as EAS serverId - however there is a second UID in the ApplicationData
        //since we do not have two different IDs to use, we use the same ID
        wbxml.atag("UID", item.id);
        //IMPORTANT in EAS v16 it is no longer allowed to send a UID

        // REQUIRED FIELDS
        let tz = eas.getEasTimezoneData(item);
        wbxml.atag("TimeZone", tz.timezone);

        //StartTime & EndTime in UTC
        wbxml.atag("StartTime", tz.startDateUTC);
        wbxml.atag("EndTime", tz.endDateUTC);

        //DtStamp
        wbxml.atag("DtStamp", tz.stampTimeUTC);

        //EAS BusyStatus (TB TRANSP : free = TRANSPARENT, busy = OPAQUE or unset)
        //0 = Free // 1 = Tentative // 2 = Busy // 3 = Work // 4 = Elsewhere (v16)
        // we map TB unset to Tentative , Work and Elsewhere are not used
        if (item.hasProperty("TRANSP")) wbxml.atag("BusyStatus", (item.getProperty("TRANSP") == "TRANSPARENT") ? "0" : "2");
        else wbxml.atag("BusyStatus", "1");

        //EAS Sensitivity (TB CLASS: PUBLIC, PRIVATE, CONFIDENTIAL or unset)
        // 0 = Normal // 1 = Personal // 2 = Private // 3 = Confidential
        let CLASS = { "PUBLIC":"0", "PRIVATE":"2", "CONFIDENTIAL":"3"}
        if (item.hasProperty("CLASS")) wbxml.atag("Sensitivity", CLASS[item.getProperty("CLASS")]);
        else wbxml.atag("Sensitivity", "1");
        


        // OPTIONAL FIELDS
        //for simplicity, we always send a value for AllDayEvent
        wbxml.atag("AllDayEvent", (item.startDate.isDate && item.endDate.isDate) ? "1" : "0");
        
        //obmitting these, should remove them from the server - that does not work reliably, so we send blanks
        wbxml.atag("Subject", (item.title) ? tbSync.encode_utf8(item.title) : "");
        wbxml.atag("Location", (item.hasProperty("location")) ? tbSync.encode_utf8(item.getProperty("location")) : "");
        
        //categories, to properly "blank" them, we need to always include the container
        let categories = item.getCategories({});
        if (categories.length > 0) {
            wbxml.otag("Categories");
                for (let i=0; i<categories.length; i++) wbxml.atag("Category", tbSync.encode_utf8(categories[i]));
            wbxml.ctag();
        } else {
            wbxml.atag("Categories");
        }

        //TP PRIORIRY (9=LOW, 5=NORMAL, 1=HIGH) not mapable to EAS
        
        //EAS Reminder (TB getAlarms) - at least with zarafa blanking by omitting works
        let alarms = item.getAlarms({});
        if (alarms.length>0) wbxml.atag("Reminder", (0 - alarms[0].offset.inSeconds/60).toString());
        //https://dxr.mozilla.org/comm-central/source/calendar/base/public/calIAlarm.idl
        //tbSync.dump("ALARM ("+i+")", [, alarms[i].related, alarms[i].repeat, alarms[i].repeatOffset, alarms[i].repeatDate, alarms[i].action].join("|"));

        
        //EAS MeetingStatus (TB STATUS: CANCELLED,CONFIRMED,TENTATIVE
        // 0  The event is an appointment, which has no attendees.
        // 1  The event is a meeting and the user is the meeting organizer.
        // 3  This event is a meeting, and the user is not the meeting organizer; the meeting was received from someone else.
        // 5  The meeting has been canceled and the user was the meeting organizer.
        // 7  The meeting has been canceled. The user was not the meeting organizer; the meeting was received from someone else


        //Organizer
        if (item.organizer && item.organizer.commonName) wbxml.atag("OrganizerName", item.organizer.commonName);
        if (item.organizer && item.organizer.id) wbxml.atag("OrganizerEmail",  cal.removeMailTo(item.organizer.id));


        //Attendees - remove all Attendees and re-add the ones from XML
        let countObj = {};
        let attendees = item.getAttendees(countObj);
        if (countObj.value > 0) {
            wbxml.otag("Attendees");
                for (let attendee of attendees) {
                    wbxml.otag("Attendee");
                        wbxml.atag("Email", cal.removeMailTo(attendee.id));
                        wbxml.atag("Name", attendee.commonName);
                        if (asversion != "2.5") {
                            switch (attendee.participationStatus) {
                                case "TENTATIVE": wbxml.atag("AttendeeStatus","2");break;
                                case "ACCEPTED" : wbxml.atag("AttendeeStatus","3");break;
                                case "DECLINED" : wbxml.atag("AttendeeStatus","4");break;
                                default         : wbxml.atag("AttendeeStatus","0");break;
                            }

                            /*
                            * status  : [NEEDS-ACTION, ACCEPTED, DECLINED, TENTATIVE, DELEGATED, COMPLETED, IN-PROCESS]
                            * rolemap : [REQ-PARTICIPANT, OPT-PARTICIPANT, NON-PARTICIPANT, CHAIR]
                            * typemap : [INDIVIDUAL, GROUP, RESOURCE, ROOM]
                            */

                            if (attendee.userType == "RESOURCE" || attendee.userType == "ROOM" || attendee.role == "NON-PARTICIPANT") wbxml.atag("AttendeeType","3");
                            else if (attendee.role == "REQ-PARTICIPANT" || attendee.role == "CHAIR") wbxml.atag("AttendeeType","1");
                            else wbxml.atag("AttendeeType","2"); //leftovers are optional
                        }
                    wbxml.ctag();
                }
            wbxml.ctag();
        } else {
            wbxml.atag("Attendees");
        }

        //attachements (needs EAS 16.0!)
        //repeat
        if (item.recurrenceInfo) {
            for (let recRule of item.recurrenceInfo.getRecurrenceItems({})) {
                wbxml.otag("Recurrence");
                let type = 0;
                let monthDays = recRule.getComponent("BYMONTHDAY", {});
                let weekDays  = recRule.getComponent("BYDAY", {});
                let months    = recRule.getComponent("BYMONTH", {});
                let weeks     = recRule.getComponent("BYWEEKNO", {});
                // Unpack 1MO style days
                for (let i = 0; i < weekDays.length; ++i) {
                    if (weekDays[i] > 8) {
                        weeks[i] = Math.floor(weekDays[i] / 8);
                        weekDays[i] = weekDays[i] % 8;
                    }
                }
                // TODO: negative week days eg -1MO
                if (monthDays[0] && monthDays[0] == -1) {
                    weeks = [5];
                    weekDays = [1, 2, 3, 4, 5, 6, 7]; // 127
                    monthDays[0] = null;
                }
                // Type
                if (recRule.type == "WEEKLY") {
                    type = 1;
                    if (!weekDays.length) {
                        weekDays = [item.startDate.weekday + 1];
                    }
                }
                else if (recRule.type == "MONTHLY" && weeks.length) {
                    type = 3;
                }
                else if (recRule.type == "MONTHLY") {
                    type = 2;
                    if (!monthDays.length) {
                        monthDays = [item.startDate.day];
                    }
                }
                else if (recRule.type == "YEARLY" && weeks.length) {
                    type = 6;
                }
                else if (recRule.type == "YEARLY") {
                    type = 5;
                    if (!monthDays.length) {
                        monthDays = [item.startDate.day];
                    }
                    if (!months.length) {
                        months = [item.startDate.month + 1];
                    }
                }
                wbxml.atag("Type", type.toString());
                // TODO: CalendarType: 14.0 and up
                // DayOfMonth
                if (monthDays[0]) {
                    // TODO: Multiple days of month - multiple Recurrence tags?
                    wbxml.atag("DayOfMonth", monthDays[0].toString());
                }
                // DayOfWeek
                if (weekDays.length) {
                    let bitfield = 0;
                    for (let day of weekDays) {
                        bitfield |= 1 << (day - 1);
                    }
                    wbxml.atag("DayOfWeek", bitfield.toString());
                }
                // FirstDayOfWeek: 14.1 and up
                //wbxml.atag("FirstDayOfWeek", recRule.weekStart);
                // Interval
                wbxml.atag("Interval", recRule.interval.toString());
                // TODO: IsLeapMonth: 14.0 and up
                // MonthOfYear
                if (months.length) {
                    wbxml.atag("MonthOfYear", months[0].toString());
                }
                // Occurrences
                if (recRule.isByCount) {
                    wbxml.atag("Occurrences", recRule.count.toString());
                }
                // Until
                else if (recRule.untilDate != null) {
                    wbxml.atag("Until", recRule.untilDate.getInTimezone(cal.UTC()).icalString);
                }
                // WeekOfMonth
                if (weeks.length) {
                    wbxml.atag("WeekOfMonth", weeks[0].toString());
                }
                wbxml.ctag();
            }
        }

        
        /*
        //loop over all properties
        let propEnum = item.propertyEnumerator;
        while (propEnum.hasMoreElements()) {
            let prop = propEnum.getNext().QueryInterface(Components.interfaces.nsIProperty);
            let pname = prop.name;
            tbSync.dump("PROP", pname + " = " + prop.value);
        }
        */

        //Description, should be done at the very end (page switch)
        let description = (item.hasProperty("description")) ? tbSync.encode_utf8(item.getProperty("description")) : "";
        if (asversion == "2.5") {
            wbxml.atag("Body", description);
        } else {
            wbxml.switchpage("AirSyncBase");
            wbxml.otag("Body");
                wbxml.atag("Type", "1");
                wbxml.atag("EstimatedDataSize", "" + description.length);
                wbxml.atag("Data", description);
            wbxml.ctag();
            wbxml.atag("NativeBodyType", "1");

            //return to Calendar code page
            wbxml.switchpage("Calendar");
        }

        //return to AirSync code page
        wbxml.switchpage("AirSync");
        return wbxml.getBytes();
    }
}
