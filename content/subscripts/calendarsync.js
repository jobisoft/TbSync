"use strict";

var calendarsync = {

    // CALENDAR SYNC

    fromzpush: function(syncdata) {
        if ("calICalendar" in Components.interfaces == false) {
            sync.finishSync(syncdata, "nolightning");
            return
        }

        //Check SyncTarget
        if (!tzPush.checkCalender(syncdata.account, syncdata.folderID)) {
            sync.finishSync(syncdata, "notargets");
            return;
        }

        //get sync target of this calendar
        let calendar = cal.getCalendarManager().getCalendarById(tzPush.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));

        // add item
        let item = cal.createEvent();
        item.title = "Syncronization attempt";
        item.setProperty("location","here");
        item.setProperty("description","there");
        item.setProperty("categories","juhu,haha");
        //item.setProperty("syncId","");

        let now = cal.now();   
        item.startDate = now.clone();
        item.endDate = now.clone();
        item.endDate.minute++;
        item.startDate.isDate = false;
        item.startDate.timezone = cal.floating();
        item.endDate.isDate = false;
        item.endDate.timezone = cal.floating();

        //    aItem.entryDate = start;
        //    aItem.dueDate = aEndDate.clone();
        //    due.addDuration(dueOffset);

        calendar.addItem(item, tzPush.calendarOperationObserver);
        
        tzPush.dump("calendarsync", "CalenderSync has not yet been implemented.");
        sync.finishSync(syncdata);
    }
};
