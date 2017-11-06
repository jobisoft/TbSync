"use strict";

var calendarsync = {

    // CALENDAR SYNC
    offsets : null,
    defaultUtcOffset : 0,

    //https://dxr.mozilla.org/comm-central/source/calendar/base/modules/calAsyncUtils.jsm


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




    //insert data from wbxml object into a TB event item
    setEvent: function (item, data, id, asversion) {
        item.id = id;

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
            this.defaultUtcOffset = dateTime.timezoneOffset/-60
            this.offsets[this.defaultUtcOffset] = dateTime.timezone.tzid;
        }
        
        //timezone
        let utcOffset = this.defaultUtcOffset;
        if (data.TimeZone) {
            //load timezone struct into EAS TimeZone object
            this.EASTZ.base64 = data.TimeZone;
            utcOffset = this.EASTZ.utcOffset;
            tbSync.dump("Recieve TZ","Extracted UTC Offset: " + utcOffset + ", Guessed TimeZone: " + this.offsets[utcOffset] + ", Full Received TZ: " + this.EASTZ.toString());
        }

        let utc = cal.createDateTime(data.StartTime); //format "19800101T000000Z" - UTC
        item.startDate = utc.getInTimezone(tzService.getTimezone(this.offsets[utcOffset]));

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


        /* Missing : MeetingStatus, Attachements (needs EAS 16.0 !), Repeated Events

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





    getTimezoneData: function (origitem) {
        let item = origitem.clone();
        //floating timezone cannot be converted to UTC (cause they float) - we have to overwrite it with the local timezone
        if (item.startDate.timezone.tzid == "floating") item.startDate.timezone = cal.calendarDefaultTimezone();
        if (item.endDate.timezone.tzid == "floating") item.endDate.timezone = cal.calendarDefaultTimezone();
        if (item.stampTime.timezone.tzid == "floating") item.stampTime.timezone = cal.calendarDefaultTimezone();

        //to get the UTC string we could use icalString (which does not work on allDayEvents, or calculate it from nativeTime)
        item.startDate.isDate=0;
        item.endDate.isDate=0;
        let tz = {};
        tz.startDateUTC = item.startDate.getInTimezone(cal.UTC()).icalString;
        tz.endDateUTC = item.endDate.getInTimezone(cal.UTC()).icalString;
        tz.stampTimeUTC = item.stampTime.getInTimezone(cal.UTC()).icalString;

        //tbSync.quickdump("startDate", tz.startDateUTC);
        //tbSync.quickdump("endDate", tz.endDateUTC);
        //tbSync.quickdump("stampTime", tz.stampTimeUTC);
            
/*
            item.timezoneOffset();
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

        //Clear TZ object and manually load fields from TB
        this.EASTZ.base64 = "";
        this.EASTZ.utcOffset = item.startDate.timezoneOffset/-60;
        this.EASTZ.standardBias = 0;
        this.EASTZ.daylightBias = 0;
        this.EASTZ.standardName = item.startDate.timezone.tzid;
        this.EASTZ.daylightName = item.startDate.timezone.tzid;
        //this.EASTZ.standardDate
        //this.EASTZ.daylightDate
        
        //tbSync.quickdump("Send EASTZ", this.EASTZ.toString());

        //TimeZone
        tz.timezone = this.EASTZ.base64;
        return tz;
    },

    //read TB event and return its data as WBXML
    getEventApplicationDataAsWBXML: function (item, asversion) {
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
        let tz = this.getTimezoneData(item);
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
    },










    start: function () {
        // skip if lightning is not installed
        if ("calICalendar" in Components.interfaces == false) {
            eas.finishSync("nolightning");
            return;
        }

        // check SyncTarget
        if (!tbSync.checkCalender(eas.syncdata.account, eas.syncdata.folderID)) {
            eas.finishSync("notargets");
            return;
        }
        
        //get sync target of this calendar
        eas.syncdata.targetObj = cal.getCalendarManager().getCalendarById(tbSync.db.getFolderSetting(eas.syncdata.account, eas.syncdata.folderID, "target"));
        eas.syncdata.targetId = eas.syncdata.targetObj.id;

        this.requestRemoteChanges ();
    },










    requestRemoteChanges: function () {

        tbSync.setSyncState("requestingchanges", eas.syncdata.account, eas.syncdata.folderID);

        // request changes
        let wbxml = tbSync.wbxmltools.createWBXML();
        wbxml.otag("Sync");
            wbxml.otag("Collections");
                wbxml.otag("Collection");
                    if (tbSync.db.getAccountSetting(eas.syncdata.account, "asversion") == "2.5") wbxml.atag("Class", eas.syncdata.type);
                    wbxml.atag("SyncKey", eas.syncdata.synckey);
                    wbxml.atag("CollectionId", eas.syncdata.folderID);
                    wbxml.atag("DeletesAsMoves", "1");
                    //wbxml.atag("GetChanges", ""); //Not needed, as it is default
                    wbxml.atag("WindowSize", "100");

                    if (tbSync.db.getAccountSetting(eas.syncdata.account, "asversion") != "2.5") {
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

        eas.Send(wbxml.getBytes(), this.processRemoteChanges.bind(this), "Sync");
    },










    processRemoteChanges: function (wbxml) {
        tbSync.setSyncState("recievingchanges", eas.syncdata.account, eas.syncdata.folderID);

        // get data from wbxml response, some servers send empty response if there are no changes, which is not an error
        let wbxmlData = eas.getDataFromResponse(wbxml);
        if (wbxmlData === null) {
            calendarsync.sendLocalChanges();
            return;
        }
    
        //check status
        if (eas.statusIsBad(wbxmlData,"Sync.Collections.Collection.Status")) return;
        
        //update synckey
        if (eas.updateSynckey(wbxmlData) === false) return;

        //A task is "serializing" async jobs
        Task.spawn(function* () {

            //any commands for us to work on? If we reach this point, Sync.Collections.Collection is valid, 
            //no need to use the save getWbxmlDataField function
            if (wbxmlData.Sync.Collections.Collection.Commands) {

                //promisify calender, so it can be used together with yield
                let pcal = cal.async.promisifyCalendar(eas.syncdata.targetObj.wrappedJSObject);
            
                //looking for additions
                let add = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Add);
                for (let count = 0; count < add.length; count++) {

                    let ServerId = add[count].ServerId;
                    let data = add[count].ApplicationData;

                    let foundItems = yield pcal.getItem(ServerId);
                    if (foundItems.length == 0) { //do NOT add, if an item with that ServerId was found
                        let newItem = cal.createEvent();
                        calendarsync.setEvent(newItem, data, ServerId, tbSync.db.getAccountSetting(eas.syncdata.account, "asversion"));
                        db.addItemToChangeLog(eas.syncdata.targetObj.id, ServerId, "added_by_server");
                        try {
                            yield pcal.addItem(newItem);
                        } catch (e) {tbSync.dump("Error during Add", e);}
                    }
                }

                //looking for changes
                let upd = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Change);
                for (let count = 0; count < upd.length; count++) {

                    let ServerId = upd[count].ServerId;
                    let data = upd[count].ApplicationData;

                    let foundItems = yield pcal.getItem(ServerId);
                    if (foundItems.length > 0) { //only update, if an item with that ServerId was found
                        let newItem = foundItems[0].clone();
                        calendarsync.setEvent(newItem, data, ServerId, tbSync.db.getAccountSetting(eas.syncdata.account, "asversion"));
                        db.addItemToChangeLog(eas.syncdata.targetObj.id, ServerId, "modified_by_server");
                        yield pcal.modifyItem(newItem, foundItems[0]);
                    }
                }
                
                //looking for deletes
                let del = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Delete);
                for (let count = 0; count < del.length; count++) {

                    let ServerId = del[count].ServerId;

                    let foundItems = yield pcal.getItem(ServerId);
                    if (foundItems.length > 0) { //delete item with that ServerId
                        db.addItemToChangeLog(eas.syncdata.targetObj.id, ServerId, "deleted_by_server");
                        yield pcal.deleteItem(foundItems[0]);
                    }
                }
            
            }

            //If we reach this point, Sync.Collections.Collection is valid,  no need to use the save getWbxmlDataField function
            if (wbxmlData.Sync.Collections.Collection.MoreAvailable) {
                calendarsync.requestRemoteChanges();
            } else { 
                calendarsync.sendLocalChanges();
            }
            
        }).then(null, function (exception) {tbSync.dump("exception", exception); eas.finishSync("js-error-in-calendarsync.processRemoteChanges")});

    },










    sendLocalChanges: function () {
        tbSync.setSyncState("sendingchanges", eas.syncdata.account, eas.syncdata.folderID);

        //A task is "serializing" async jobs
        Task.spawn(function* () {

            //promisify calender, so it can be used together with yield
            let pcal = cal.async.promisifyCalendar(eas.syncdata.targetObj.wrappedJSObject);

            let c = 0;
            let maxnumbertosend = tbSync.prefSettings.getIntPref("maxnumbertosend");
            
            //get changed items from ChangeLog
            let changes = db.getItemsFromChangeLog(eas.syncdata.targetObj.id, maxnumbertosend, "_by_user");

            let wbxml = tbSync.wbxmltools.createWBXML();
            wbxml.otag("Sync");
                wbxml.otag("Collections");
                    wbxml.otag("Collection");
                        if (tbSync.db.getAccountSetting(eas.syncdata.account, "asversion") == "2.5") wbxml.atag("Class", eas.syncdata.type);
                        wbxml.atag("SyncKey", eas.syncdata.synckey);
                        wbxml.atag("CollectionId", eas.syncdata.folderID);
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
                                                wbxml.append(calendarsync.getEventApplicationDataAsWBXML(items[0], tbSync.db.getAccountSetting(eas.syncdata.account, "asversion")));
                                            wbxml.ctag();
                                        wbxml.ctag();
                                        db.removeItemFromChangeLog(eas.syncdata.targetObj.id, changes[i].id);
                                        c++;
                                        break;
                                    
                                    case "modified_by_user":
                                        items = yield pcal.getItem(changes[i].id);
                                        wbxml.otag("Change");
                                        wbxml.atag("ServerId", changes[i].id);
                                            wbxml.otag("ApplicationData");
                                                wbxml.append(calendarsync.getEventApplicationDataAsWBXML(items[0], tbSync.db.getAccountSetting(eas.syncdata.account, "asversion")));
                                            wbxml.ctag();
                                        wbxml.ctag();
                                        db.removeItemFromChangeLog(eas.syncdata.targetObj.id, changes[i].id);
                                        c++;
                                        break;
                                    
                                    case "deleted_by_user":
                                        wbxml.otag("Delete");
                                            wbxml.atag("ServerId", changes[i].id);
                                        wbxml.ctag();
                                        db.removeItemFromChangeLog(eas.syncdata.targetObj.id, changes[i].id);
                                        c++;
                                        break;
                                }
                            }

                        wbxml.ctag(); //Commands
                    wbxml.ctag(); //Collection
                wbxml.ctag(); //Collections
            wbxml.ctag(); //Sync

            if (c == 0) {
                eas.finishSync();
            } else {
                eas.Send(wbxml.getBytes(), calendarsync.processLocalChangesResponse.bind(calendarsync), "Sync"); 
            }

        }).then(null, function (exception) {tbSync.dump("exception", exception); eas.finishSync("js-error-in-calendarsync.sendLocalChanges")});

    },










    processLocalChangesResponse: function (wbxml) {
        tbSync.setSyncState("serverid", eas.syncdata.account, eas.syncdata.folderID);

        //get data from wbxml response, check for empty response, which is not an error
        let wbxmlData = eas.getDataFromResponse(wbxml);
        if (wbxmlData === null) {
            calendarsync.sendLocalChanges(); //again, until we no longer get here
            return;
        }
    
        //check status
        if (eas.statusIsBad(wbxmlData,"Sync.Collections.Collection.Status")) return;
        
        //update synckey
        if (eas.updateSynckey(wbxmlData) === false) return;
        
        //any responses for us to work on?  If we reach this point, Sync.Collections.Collection is valid, 
        //no need to use the save getWbxmlDataField function
        if (wbxmlData.Sync.Collections.Collection.Responses) {
                
            //A task is "serializing" async jobs
            Task.spawn(function* () {

                //promisify calender, so it can be used together with yield
                let pcal = cal.async.promisifyCalendar(eas.syncdata.targetObj.wrappedJSObject);

                //looking for additions (Add node contains, status, old ClientId and new ServerId)
                let add = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Add);
                for (let count = 0; count < add.length; count++) {
                    
                    //Check Status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                    if (eas.statusIsBad(add[count],"Status","Sync.Collections.Collection.Responses.Add["+count+"].Status")) return;

                    //look for an item identfied by ClientId and update its id to the new id received from the server
                    let foundItems = yield pcal.getItem(add[count].ClientId);
                    
                    if (foundItems.length > 0) {
                        let newItem = foundItems[0].clone();
                        newItem.id = add[count].ServerId;
                        db.addItemToChangeLog(eas.syncdata.targetObj.id, newItem.id, "modified_by_server");
                        yield pcal.modifyItem(newItem, foundItems[0]);
                    }
                }

                //looking for modifications 
                let upd = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Change);
                for (let count = 0; count < upd.length; count++) {
                    //Check Status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                    if (eas.statusIsBad(upd[count],"Status","Sync.Collections.Collection.Responses.Change["+count+"].Status")) return;
                }

                //looking for deletions 
                let del = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Delete);
                for (let count = 0; count < del.length; count++) {
                    //Check Status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                    if (eas.statusIsBad(del[count],"Status","Sync.Collections.Collection.Responses.Delete["+count+"].Status")) return;
                }
                
            }).then(calendarsync.sendLocalChanges(), function (exception) {tbSync.dump("exception", exception); eas.finishSync("js-error-in-calendarsync.processLocalChangesResponse")});
            
        } else {
            calendarsync.sendLocalChanges(); //again, until we no longer get here
        }
    }

};
