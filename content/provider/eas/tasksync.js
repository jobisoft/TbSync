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
        if (data.ReminderSet && data.ReminderTime && data.UtcDueDate) {        
            let UtcDueDate = tbSync.createDateTime(data.UtcDueDate);
            let UtcAlarmDate = tbSync.createDateTime(data.ReminderTime);
            let alarm = cal.createAlarm();
            alarm.related = Components.interfaces.calIAlarm.ALARM_RELATED_START; //TB saves new alarms as offsets, so we add them as such as well
            alarm.offset = UtcAlarmDate.subtractDate(UtcDueDate);
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

        wbxml.atag("Subject", (item.title) ? tbSync.encode_utf8(item.title) : "");
        wbxml.atag("Sensitivity", eas.sync.mapThunderbirdPropertyToEas("CLASS", "Sensitivity", item));
        wbxml.atag("Importance", eas.sync.mapThunderbirdPropertyToEas("PRIORITY", "Importance", item));

        //tasks is using extended ISO 8601 (2019-01-18T00:00:00.000Z)  instead of basic (20190118T000000Z), 
        //getIsoUtcString returns extended if true as second parameter is present
        if (item.entryDate) {
            wbxml.atag("UtcStartDate", tbSync.getIsoUtcString(item.entryDate, true));
            //to fake the local time as UTC, getIsoUtcString needs the third parameter to be true
            wbxml.atag("StartDate", tbSync.getIsoUtcString(item.entryDate, true, true));
        }

        if (item.dueDate) {
            wbxml.atag("UtcDueDate", tbSync.getIsoUtcString(item.dueDate, true));
            wbxml.atag("DueDate", tbSync.getIsoUtcString(item.dueDate, true, true));
        }
        
        wbxml.append(eas.sync.getItemCategories(item, syncdata));
        wbxml.append(eas.sync.getItemBody(item, syncdata));
        wbxml.append(eas.sync.getItemRecurrence(item, syncdata));

        let alarms = item.getAlarms({});
        if (alarms.length>0) {
            wbxml.atag("ReminderSet", "1");
            //create Date obj from dueDate by converting item.dueDate to an extended UTC ISO string, which can be parsed by Date
            let UtcDate = new Date(tbSync.getIsoUtcString(item.dueDate, true));
            //add offset
            UtcDate.setSeconds(UtcDate.getSeconds() + alarms[0].offset.inSeconds);		
            wbxml.atag("ReminderTime", UtcDate.toISOString());
        } else {
            wbxml.atag("ReminderSet", "0");
        }

        if (item.isCompleted) {
                wbxml.atag("Complete", "1");
                wbxml.atag("DateCompleted", tbSync.getIsoUtcString(item.completedDate, true));		
        } else {
                wbxml.atag("Complete", "0");
        }
        
        return wbxml.getBytes();
    },
}
