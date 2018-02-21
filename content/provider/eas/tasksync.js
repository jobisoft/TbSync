"use strict";

eas.sync.Tasks = {

    setThunderbirdItemFromWbxml: function (item, data, id, syncdata) {
        let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");
        item.id = id;

        eas.sync.setItemBody(item, syncdata, data);
        eas.sync.setItemSubject(item, syncdata, data);
        eas.sync.setItemCategories(item, syncdata, data);
        eas.sync.setItemRecurrence(item, syncdata, data);

        let tzService = cal.getTimezoneService();
        if (data.DueDate && data.UtcDueDate) {
            //extract offset from EAS data
            let DueDate = new Date(data.DueDate);
            let UtcDueDate = new Date(data.UtcDueDate);
            let offset = (UtcDueDate.getTime() - DueDate.getTime())/60000;

            //timezone is identified by its offset
            let utc = cal.createDateTime(UtcDueDate.toBasicISOString()); //format "19800101T000000Z" - UTC
            item.dueDate = utc.getInTimezone(tzService.getTimezone(eas.offsets[offset]));
        }

        if (data.StartDate && data.UtcStartDate) {
            //extract offset from EAS data
            let StartDate = new Date(data.StartDate);
            let UtcStartDate = new Date(data.UtcStartDate);
            let offset = (UtcStartDate.getTime() - StartDate.getTime())/60000;

            //timezone is identified by its offset
            let utc = cal.createDateTime(UtcStartDate.toBasicISOString()); //format "19800101T000000Z" - UTC
            item.entryDate = utc.getInTimezone(tzService.getTimezone(eas.offsets[offset]));
        }

        eas.sync.mapEasPropertyToThunderbird ("Sensitivity", "CLASS", data, item);
        eas.sync.mapEasPropertyToThunderbird ("Importance", "PRIORITY", data, item);

        item.clearAlarms();
        if (data.ReminderSet && data.ReminderTime && data.UtcStartDate) {        
            let UtcDate = tbSync.createDateTime(data.UtcStartDate);
            let UtcAlarmDate = tbSync.createDateTime(data.ReminderTime);
            let alarm = cal.createAlarm();
            alarm.related = Components.interfaces.calIAlarm.ALARM_RELATED_START; //TB saves new alarms as offsets, so we add them as such as well
            alarm.offset = UtcAlarmDate.subtractDate(UtcDate);
            alarm.action = "DISPLAY";
            item.addAlarm(alarm);
        }
        
        //status/percentage cannot be mapped
        if (data.Complete) {
          if (data.Complete == "0") {
            item.isCompleted = false;
          } else {
            item.isCompleted = true;
            if (data.DateCompleted) item.completedDate = tbSync.createDateTime(data.DateCompleted);
          }
        }            
    },
    


    getWbxmlFromThunderbirdItem: function (item, syncdata) {
        let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");
        let wbxml = tbSync.wbxmltools.createWBXML("", syncdata.type); //init wbxml with "" and not with precodes, and set initial codepage

        //Order of tags taken from: https://msdn.microsoft.com/en-us/library/dn338924(v=exchg.80).aspx
        
        //Subject
        wbxml.atag("Subject", (item.title) ? tbSync.encode_utf8(item.title) : "");
        
        //Body
        wbxml.append(eas.sync.getItemBody(item, syncdata));

        //Importance
        wbxml.atag("Importance", eas.sync.mapThunderbirdPropertyToEas("PRIORITY", "Importance", item));

        //tasks is using extended ISO 8601 (2019-01-18T00:00:00.000Z)  instead of basic (20190118T000000Z), 
        //getIsoUtcString returns extended if true as second parameter is present
        if (item.entryDate || item.dueDate) {
            wbxml.atag("UtcStartDate", tbSync.getIsoUtcString(item.entryDate ? item.entryDate : item.dueDate, true));
            //to fake the local time as UTC, getIsoUtcString needs the third parameter to be true
            wbxml.atag("StartDate", tbSync.getIsoUtcString(item.entryDate ? item.entryDate : item.dueDate, true, true));

            wbxml.atag("UtcDueDate", tbSync.getIsoUtcString(item.dueDate ? item.dueDate : item.entryDate, true));
            //to fake the local time as UTC, getIsoUtcString needs the third parameter to be true
            wbxml.atag("DueDate", tbSync.getIsoUtcString(item.dueDate ? item.dueDate : item.entryDate, true, true));
        }
        
        //Categories
        wbxml.append(eas.sync.getItemCategories(item, syncdata));

        //Recurrence
        wbxml.append(eas.sync.getItemRecurrence(item, syncdata));
        
        //Complete
        if (item.isCompleted) {
                wbxml.atag("Complete", "1");
                wbxml.atag("DateCompleted", tbSync.getIsoUtcString(item.completedDate, true));		
        } else {
                wbxml.atag("Complete", "0");
        }

	    //Sensitivity
        wbxml.atag("Sensitivity", eas.sync.mapThunderbirdPropertyToEas("CLASS", "Sensitivity", item));

        //ReminderTime and ReminderSet
        let alarms = item.getAlarms({});
        if (alarms.length>0 && (item.entryDate || item.dueDate)) {
            //create Date obj from entryDate by converting item.entryDate to an extended UTC ISO string, which can be parsed by Date
            //if entryDate is missing, the startDate of this object is set to its dueDate
            let UtcDate = new Date(tbSync.getIsoUtcString(item.entryDate ? item.entryDate : item.dueDate, true));
            //add offset
            UtcDate.setSeconds(UtcDate.getSeconds() + alarms[0].offset.inSeconds);		
            wbxml.atag("ReminderTime", UtcDate.toISOString());
            wbxml.atag("ReminderSet", "1");
        } else {
            wbxml.atag("ReminderSet", "0");
        }
        
        return wbxml.getBytes();
    },
}
