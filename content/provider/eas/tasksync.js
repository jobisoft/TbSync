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

    /*

    ReminderSet = [0]
    ReminderSet = [1]
    ReminderTime = [2018-01-31T07:00:00.000Z]
    
    Complete = [0]
    Complete = [1]
    DateCompleted = [2018-01-31T23:00:00.000Z] //UTC
        
        */        
        
    },
    
    getWbxmlFromThunderbirdItem: function (item, syncdata) {
        let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");
        let wbxml = tbSync.wbxmltools.createWBXML(""); //init wbxml with "" and not with precodes
        
        wbxml.switchpage("Tasks");
        
        wbxml.atag("Subject", (item.title) ? tbSync.encode_utf8(item.title) : "");
        wbxml.atag("Sensitivity", eas.sync.mapThunderbirdPropertyToEas("CLASS", "Sensitivity", item));
        wbxml.atag("Importance", eas.sync.mapThunderbirdPropertyToEas("PRIORITY", "Importance", item));

        //tasks is using extended ISO 8601 (2019-01-18T00:00:00.000Z)  instead of basic (20190118T000000Z), 
        //getEasTimeUTC returns extended if true as second parameter is present
        wbxml.atag("UtcStartDate", tbSync.eas.getEasTimeUTC(item.entryDate, true));
        //to fake the local time as UTC, getEasTimeUTC needs the third parameter to be true
        wbxml.atag("StartDate", tbSync.eas.getEasTimeUTC(item.entryDate, true, true));

        wbxml.atag("UtcDueDate", tbSync.eas.getEasTimeUTC(item.dueDate, true));
        wbxml.atag("DueDate", tbSync.eas.getEasTimeUTC(item.dueDate, true, true));
        
        wbxml.append(eas.sync.getItemCategories(item, syncdata));
        wbxml.append(eas.sync.getItemBody(item, syncdata));
        wbxml.append(eas.sync.getItemRecurrence(item, syncdata));

        //return to AirSync code page
        wbxml.switchpage("AirSync");
        return wbxml.getBytes();
    },
}
