"use strict";

var calendarsync = {

    // CALENDAR SYNC
    // TODO: Link sync to lightning-sync-button using providerId
    offsets : null,





    //EAS TimeZone data structure
    EASTZ : {
        buf : new DataView(new ArrayBuffer(172)),
        
        /* Buffer structure:
         @000    utcOffset (4x8bit as 1xLONG)
        
        @004     standardName (64x8bit as 32xWCHAR)
        @068     standardDate (16x8 as 1xSYSTEMTIME)
        @084     standardBias (4x8bit as 1xLONG)
        
        @088     daylightName (64x8bit as 32xWCHAR)
        @152    daylightDate (16x8 as 1xSTRUCT)
        @168    daylightBias (4x8bit as 1xLONG)
        */
        
        set base64 (b64) {
            //clear buffer
            for (let i=0; i<172; i++) this.buf.setUint8(i, 0);
            //load content into buffer
            let content = (b64 == "") ? "" : atob(b64);
            for (let i=0; i<content.length; i++) this.buf.setUint8(i, content.charCodeAt(i));
        },
        
        get base64 () {
            let content = "";
            for (let i=0; i<172; i++) content += String.fromCharCode(this.buf.getUint8(i));
            return (btoa(content));
        },
        
        getstr : function (byteoffset) {
            let str = "";
            //walk thru the buffer in 32 steps of 16bit (wchars)
            for (let i=0;i<32;i++) {
                let cc = this.buf.getUint16(byteoffset+i*2, true);
                if (cc == 0) break;
                str += String.fromCharCode(cc);
            }
            return str;
        },

        setstr : function (byteoffset, str) {
            //clear first
            for (let i=0;i<32;i++) this.buf.setUint16(byteoffset+i*2, 0);

            //add GMT Offset to string
            if (str == "UTC") str = "(GMT+00:00) Coordinated Universal Time";
            else {
                //offset is just the other way around
                let GMT = (this.utcOffset<0) ? "GMT+" : "GMT-";
                let offset = Math.abs(this.utcOffset);
                
                let m = offset % 60;
                let h = (offset-m)/60;
                GMT += (h<10 ? "0" :"" ) + h.toString() + ":" + (m<10 ? "0" :"" ) + m.toString();
                str = "(" + GMT + ") " + str;
            }
            
            //walk thru the buffer in steps of 16bit (wchars)
            for (let i=0;i<str.length && i<32; i++) this.buf.setUint16(byteoffset+i*2, str.charCodeAt(i), true);
        },
        
        getsystemtime : function (buf, offset) {
            let systemtime = {
                get wYear () { return buf.getUint16(offset + 0, true); },
                get wMonth () { return buf.getUint16(offset + 2, true); },
                get wDayOfWeek () { return buf.getUint16(offset + 4, true); },
                get wDay () { return buf.getUint16(offset + 6, true); },
                get wHour () { return buf.getUint16(offset + 8, true); },
                get wMinute () { return buf.getUint16(offset + 10, true); },
                get wSecond () { return buf.getUint16(offset + 12, true); },
                get wMilliseconds () { return buf.getUint16(offset + 14, true); },

                set wYear (v) { buf.setUint16(offset + 0, v, true); },
                set wMonth (v) { buf.setUint16(offset + 2, v, true); },
                set wDayOfWeek (v) { buf.setUint16(offset + 4, v, true); },
                set wDay (v) { buf.setUint16(offset + 6, v, true); },
                set wHour (v) { buf.setUint16(offset + 8, v, true); },
                set wMinute (v) { buf.setUint16(offset + 10, v, true); },
                set wSecond (v) { buf.setUint16(offset + 12, v, true); },
                set wMilliseconds (v) { buf.setUint16(offset + 14, v, true); },
                };
            return systemtime;
        },
        
        get standardDate () {return this.getsystemtime (this.buf, 68); },
        get daylightDate () {return this.getsystemtime (this.buf, 152); },
            
        get utcOffset () { return this.buf.getInt32(0, true); },
        set utcOffset (v) { this.buf.setInt32(0, v, true); },

        get standardBias () { return this.buf.getInt32(84, true); },
        set standardBias (v) { this.buf.setInt32(84, v, true); },
        get daylightBias () { return this.buf.getInt32(168, true); },
        set daylightBias (v) { this.buf.setInt32(168, v, true); },
        
        get standardName () {return this.getstr(4); },
        set standardName (v) {return this.setstr(4, v); },
        get daylightName () {return this.getstr(88); },
        set daylightName (v) {return this.setstr(88, v); },
        
        toString : function () { return "[" + [this.standardName, this.daylightName, this.utcOffset, this.standardBias, this.daylightBias].join("|") + "]"; }
        
    },




    // wrapper for standard stuff done on each response
    processResponseAndGetData: function (wbxml, syncdata) {
        // get data from wbxml response
        let wbxmlData = tbSync.wbxmltools.createWBXML(wbxml).getData();

        // check for empty response
        if (wbxml.length === 0 || wbxmlData === null) {
            return "empty";
        }

        //debug
        xmltools.printXmlData(wbxmlData);

        //check status
        if (sync.statusIsBad(wbxmlData.Sync.Collections.Collection.Status, syncdata)) {
            return "bad_status";
        }

        //update synckey
        if (wbxmlData.Sync.Collections.Collection.SyncKey) {
            syncdata.synckey = wbxmlData.Sync.Collections.Collection.SyncKey;
            db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", syncdata.synckey);
            return wbxmlData;
        } else {
            sync.finishSync(syncdata, "nosynckey");
            return "nokey";
        }
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
        // we need to wait for the async job to finish
        // I would realy like to access the getItemById function of the storage provider, but duno how..
        // that function directly returns the id from the private member memory without going thru a listener
        while (!opDone) {
            //sleep 1s and check again
            let date = Date.now();
            let curDate = Date.now();
            do { 
                curDate = Date.now();
            } while (curDate-date < 1000);
        }
        return requestedItem;
    },






    //insert data from wbxml object into a TB event item
    setEvent: function (item, data, id, asversion) {
        item.id = id;

        if (data.Subject) item.title = data.Subject;
        if (data.Location) item.setProperty("location", data.Location);
        if (data.Categories && data.Categories.Category) {
            let cats = [];
            if (Array.isArray(data.Categories.Category)) cats = data.Categories.Category;
            else cats.push(data.Categories.Category);
            item.setCategories(cats.length, cats);
        }

        //store the UID send from the server as EASUID. The field UID is reserved for the ServerId of this item and can be accessed as item.id and as item.getProperty("UID");
        if (data.UID) item.setProperty("EASUID", data.UID);

        if (asversion == "2.5") {
            if (data.Body) item.setProperty("description", data.Body);
        } else {
            if (data.Body && data.Body.EstimatedDataSize > 0 && data.Body.Data) item.setProperty("description", data.Body.Data);
        }

        //get a list of all zones - we only do this once, we do it here to not slow down TB startup time
        //alternativly use cal.fromRFC3339 - but this is only doing this
        //https://dxr.mozilla.org/comm-central/source/calendar/base/modules/calProviderUtils.jsm
        let tzService = cal.getTimezoneService();
        if (this.offsets === null) {
            this.offsets = {};
            let dateTime = cal.createDateTime("20160101T000000Z"); //UTC

            //find timezone based on utcOffset
            let enumerator = tzService.timezoneIds;
            while (enumerator.hasMore()) {
                let id = enumerator.getNext();
                dateTime.timezone = tzService.getTimezone(id);
                this.offsets[dateTime.timezoneOffset/-60] = id; //in minutes
            }

            //also try default timezone
            dateTime.timezone=cal.calendarDefaultTimezone();
            this.offsets[dateTime.timezoneOffset/-60] = dateTime.timezone.tzid;
            //also use a map to map EAS to TB
        }
        
        //timezone
        let utcOffset = 0;
        if (data.TimeZone) {
            //load timezone struct into EAS TimeZone object
            this.EASTZ.base64 = data.TimeZone;
            utcOffset = this.EASTZ.utcOffset;
            tbSync.dump("Recieve TZ","Extracted UTC Offset: " + utcOffset + ", Guessed TimeZone: " + this.offsets[utcOffset] + ", Full Received TZ: " + this.EASTZ.toString());
        }

        let utc = cal.createDateTime(data.StartTime); //format "19800101T000000Z" - UTC
        item.startDate = utc.getInTimezone(tzService.getTimezone(this.offsets[utcOffset]));
        tbSync.dump("TB TZ", item.startDate.timezone);

        utc = cal.createDateTime(data.EndTime); 
        item.endDate = utc.getInTimezone(tzService.getTimezone(this.offsets[utcOffset]));

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
 
 /*
	
	Missing : MeetingStatus, Attendees, Attachements, Repeated Events
	
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

        //TASK STUFF
        //aItem.entryDate = start;
        //aItem.dueDate = aEndDate.clone();
        //due.addDuration(dueOffset);
    },



    //read TB event and return its data as WBXML
    getEventApplicationDataAsWBXML: function (item, asversion) {
        let wbxml = tbSync.wbxmltools.createWBXML(""); //init wbxml with "" and not with precodes

        /*
         *  We do not use ghosting, that means, if we do not include a value in CHANGE, it is removed from the server. 
         *  However, this does not seem to work on all fields. Furthermore, we need to include any (empty) container to blank its childs.
         */

        wbxml.switchpage("Calendar");
        
        //if EASUID is not set, the user just created this item and it has a new UID as id
        //this UID is stored in the item and also on the server as ApplicationData.UID
        //After the server receives this item, he will send back a ServerId, which we need to store as item id (UID),
        //but we also need to keep the ApplicationData.UID, so we backup that into the field EASUID
        if (item.hasProperty("EASUID")) wbxml.atag("UID", item.getProperty("EASUID"));
        else wbxml.atag("UID", item.id);
        
        //IMPORTANT in EAS v16 it is no longer allowed to send a UID
        
        
        
/*        item.timezoneOffset();
         let date_utc = date;
        equal(date_utc.hour, 15);
        equal(date_utc.icalString, "20051113T150000Z");

        let utc = cal.createDateTime();
        equal(utc.timezone.tzid, "UTC");
        equal(utc.clone().timezone.tzid, "UTC");
        equal(utc.timezoneOffset, 0); 
        
        tbSync.dump("Timezone", item.startDate.timezone);
        tbSync.dump("Timezone", item.startDate.timezoneOffset);

        let newDate = item.startDate.getInTimezone(cal.calendarDefaultTimezone());
        tbSync.dump("Timezone", newDate.timezone);
        tbSync.dump("Timezone", newDate.timezoneOffset);
        
        item.timezoneOffset();
         let date_utc = date.getInTimezone(cal.UTC());
        equal(date_utc.hour, 15);
        equal(date_utc.icalString, "20051113T150000Z");

        let utc = cal.createDateTime();
        equal(utc.timezone.tzid, "UTC");
        equal(utc.clone().timezone.tzid, "UTC");
        equal(utc.timezoneOffset, 0);

        equal(cal.createDateTime("20120101T120000").compare(cal.createDateTime("20120101")), 0);

        */

/* 
    Is that really needed? For UTC all is zero, but server still does not accept...

    BEGIN:VTIMEZONE
    TZID:Europe/Berlin
    BEGIN:DAYLIGHT
    TZOFFSETFROM:+0100
    TZOFFSETTO:+0200
    TZNAME:CEST
    DTSTART:19700329T020000
    RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3
    END:DAYLIGHT
    BEGIN:STANDARD
    TZOFFSETFROM:+0200
    TZOFFSETTO:+0100
    TZNAME:CET
    DTSTART:19701025T030000
    RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10
    END:STANDARD
    END:VTIMEZONE
*/        


    // REQUIRED FIELDS

        //Clear TZ object an manually load fields from TB
        this.EASTZ.base64 = "";
        this.EASTZ.utcOffset = item.startDate.timezoneOffset/-60;
        this.EASTZ.standardBias = 0;
        this.EASTZ.daylightBias = 0;
        this.EASTZ.standardName = item.startDate.timezone.tzid;
        this.EASTZ.daylightName = item.startDate.timezone.tzid;
        //this.EASTZ.standardDate
        //this.EASTZ.daylightDate
        tbSync.dump("Send TZ", this.EASTZ.toString());
        tbSync.dump("TB TZ", item.startDate.timezone);

        //TimeZone
        wbxml.atag("TimeZone", this.EASTZ.base64);

        //StartTime & EndTime in UTC
        wbxml.atag("StartTime", item.startDate.getInTimezone(cal.UTC()).icalString);
        wbxml.atag("EndTime", item.endDate.getInTimezone(cal.UTC()).icalString);

        //DtStamp
        wbxml.atag("DtStamp", item.stampTime.getInTimezone(cal.UTC()).icalString);

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
        wbxml.atag("Subject", (item.title) ? item.title : "");
        wbxml.atag("Location", (item.hasProperty("location")) ? item.getProperty("location") : "");
        
        //categories, to properly "blank" them, we need to always include the container
        let categories = item.getCategories({});
        if (categories.length > 0) {
            wbxml.otag("Categories");
                for (let i=0; i<categories.length; i++) wbxml.atag("Category", categories[i]);
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

        //attendees
        //attachements
        //repeat

        
        
        /*loop over all properties
        let propEnum = item.propertyEnumerator;
        while (propEnum.hasMoreElements()) {
            let prop = propEnum.getNext().QueryInterface(Components.interfaces.nsIProperty);
            let pname = prop.name;
            tbSync.dump("PROP", pname + " = " + prop.value);
        }*/


        //Description, should be done at the very end (page switch)
        if (asversion == "2.5") {
            wbxml.atag("Body", (item.hasProperty("description")) ? item.getProperty("description") : "");
        } else {
            wbxml.switchpage("AirSyncBase");
            let description =(item.hasProperty("description")) ? item.getProperty("description") : "";
            wbxml.otag("Body");
                wbxml.atag("Data", description);
                wbxml.atag("EstimatedDataSize", "" + description.length);
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
        if (!tbSync.checkCalender(syncdata.account, syncdata.folderID)) {
            sync.finishSync(syncdata, "notargets");
            return;
        }
        
        //get sync target of this calendar
        syncdata.targetObj = cal.getCalendarManager().getCalendarById(tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));
        syncdata.targetId = syncdata.targetObj.id;

        this.requestRemoteChanges (syncdata);
    },










    requestRemoteChanges: function (syncdata) {

        sync.setSyncState("requestingchanges", syncdata);

        // request changes
        let wbxml = tbSync.wbxmltools.createWBXML();
        wbxml.otag("Sync");
            wbxml.otag("Collections");
                wbxml.otag("Collection");
                    if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") wbxml.atag("Class", syncdata.type);
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
                case "nokey": return;
        }

        //any commands for us to work on?
        if (wbxmlData.Sync.Collections.Collection.Commands) {

            //looking for additions
            let add = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Add);
            for (let count = 0; count < add.length; count++) {

                let ServerId = add[count].ServerId;
                let data = add[count].ApplicationData;

                let oldItem = this.getItem(syncdata.targetObj, ServerId);
                if (oldItem === null) { //do NOT add, if an item with that ServerId was found
                    let newItem = cal.createEvent();
                    this.setEvent(newItem, data, ServerId, tbSync.db.getAccountSetting(syncdata.account, "asversion"));
                    db.addItemToChangeLog(syncdata.targetObj.id, ServerId, "added_by_server");
                    try {
                        syncdata.targetObj.addItem(newItem, tbSync.calendarOperationObserver);
                    } catch (e) {tbSync.dump("Error during Add", e);}
                }
            }

            //looking for changes
            let upd = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Change);
            for (let count = 0; count < upd.length; count++) {

                let ServerId = upd[count].ServerId;
                let data = upd[count].ApplicationData;

                let oldItem = this.getItem(syncdata.targetObj, ServerId);
                if (oldItem !== null) { //only update, if an item with that ServerId was found
                    let newItem = oldItem.clone();
                    this.setEvent(newItem, data, ServerId, tbSync.db.getAccountSetting(syncdata.account, "asversion"));
                    db.addItemToChangeLog(syncdata.targetObj.id, ServerId, "modified_by_server");
                    syncdata.targetObj.modifyItem(newItem, oldItem, tbSync.calendarOperationObserver);
                }
            }
            
            //looking for deletes
            let del = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Delete);
            for (let count = 0; count < del.length; count++) {

                let ServerId = del[count].ServerId;

                let oldItem = this.getItem(syncdata.targetObj, ServerId);
                if (oldItem !== null) { //delete item with that ServerId
                    db.addItemToChangeLog(syncdata.targetObj.id, ServerId, "deleted_by_server");
                    syncdata.targetObj.deleteItem(oldItem, tbSync.calendarOperationObserver);
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
        let maxnumbertosend = tbSync.db.prefSettings.getIntPref("maxnumbertosend");
        
        //get changed items from ChangeLog
        let changes = db.getItemsFromChangeLog(syncdata.targetObj.id, maxnumbertosend, "_by_user");

        let wbxml = tbSync.wbxmltools.createWBXML();
        wbxml.otag("Sync");
            wbxml.otag("Collections");
                wbxml.otag("Collection");
                    if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") wbxml.atag("Class", syncdata.type);
                    wbxml.atag("SyncKey", syncdata.synckey);
                    wbxml.atag("CollectionId", syncdata.folderID);
                    wbxml.otag("Commands");

                        for (let i=0; i<changes.length; i++) {
//                            tbSync.dump("CHANGES",(i+1) + "/" + changes.length + " ("+changes[i].status+"," + changes[i].id + ")");
                            switch (changes[i].status) {

                                case "added_by_user":
                                    wbxml.otag("Add");
                                    wbxml.atag("ClientId", changes[i].id); //ClientId is an id generated by Thunderbird, which will get replaced by an id generated by the server
                                        wbxml.otag("ApplicationData");
                                            wbxml.append(this.getEventApplicationDataAsWBXML(this.getItem(syncdata.targetObj, changes[i].id), tbSync.db.getAccountSetting(syncdata.account, "asversion")));
                                        wbxml.ctag();
                                    wbxml.ctag();
                                    db.removeItemFromChangeLog(syncdata.targetObj.id, changes[i].id);
                                    c++;
                                    break;
                                
                                case "modified_by_user":
                                    wbxml.otag("Change");
                                    wbxml.atag("ServerId", changes[i].id);
                                        wbxml.otag("ApplicationData");
                                            wbxml.append(this.getEventApplicationDataAsWBXML(this.getItem(syncdata.targetObj, changes[i].id), tbSync.db.getAccountSetting(syncdata.account, "asversion")));
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
                case "nokey": return;
        }

        //any responses for us to work on?
        if (wbxmlData.Sync.Collections.Collection.Responses) {

            //looking for additions (Add node contains, status, old ClientId and new ServerId)
            let add = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Add);
            for (let count = 0; count < add.length; count++) {
                
                //Check Status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                if (sync.statusIsBad(add[count].Status, syncdata)) return;

                //look for an item identfied by ClientId and update its id to the new id received from the server
                let oldItem = this.getItem(syncdata.targetObj, add[count].ClientId);
                if (oldItem !== null) {
                    let newItem = oldItem.clone();
                    //server has two identifiers for this item, serverId and UID
                    //on creation, TB created a UID which has been send to the server as UID inside AplicationData
                    //we NEED to use ServerId as TB UID without changing UID on Server -> Backup
                    newItem.setProperty("EASUID", newItem.id);
                    
                    newItem.id = add[count].ServerId;
                    db.addItemToChangeLog(syncdata.targetObj.id, newItem.id, "modified_by_server");
                    syncdata.targetObj.modifyItem(newItem, oldItem, tbSync.calendarOperationObserver);
                }
            }

            //looking for modifications 
            let upd = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Change);
            for (let count = 0; count < upd.length; count++) {
                //Check Status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                if (sync.statusIsBad(upd[count].Status, syncdata)) return;
            }

            //looking for deletions 
            let del = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Delete);
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
