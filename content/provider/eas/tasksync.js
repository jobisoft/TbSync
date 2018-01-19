"use strict";

eas.sync.Tasks = {

    setThunderbirdItemFromWbxml: function (item, data, id, syncdata) {
    let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");
    item.id = id;

    eas.sync.Calendar.setItemBody(item, syncdata, data);
    eas.sync.Calendar.setItemSubject(item, syncdata, data);
    eas.sync.Calendar.setItemCategories(item, syncdata, data);
    eas.sync.Calendar.setItemRecurrence(item, syncdata, data);

        /*

    tasks is using extended ISO 8601 (2019-01-18T00:00:00.000Z)  instead of basic (20190118T000000Z)

    Importance = [1]
    UtcStartDate = [2017-12-31T23:00:00.000Z]
    StartDate = [2018-01-01T00:00:00.000Z]
    UtcDueDate = [2018-01-30T23:00:00.000Z]
    DueDate = [2018-01-31T00:00:00.000Z]
    Complete = [0]
    Sensitivity = [0]

    var date = Components.classes["@mozilla.org/calendar/datetime;1"].createInstance(Components.interfaces.calIDateTime);
    date.icalString = "20080907T120000Z";

    todo.title = "Crazy new todo";
    todo.dueDate = date;

    //TASK STUFF
    //aItem.entryDate = start;
    //aItem.dueDate = aEndDate.clone();
    //due.addDuration(dueOffset);
        
        */        
        
    },
    
    getWbxmlFromThunderbirdItem: function (item, syncdata) {
        let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");
        let wbxml = tbSync.wbxmltools.createWBXML(""); //init wbxml with "" and not with precodes
        
        wbxml.switchpage("Tasks");
        
        wbxml.atag("Subject", (item.title) ? tbSync.encode_utf8(item.title) : "");
        
        //return to AirSync code page
        wbxml.switchpage("AirSync");
        return wbxml.getBytes();
    },
}
