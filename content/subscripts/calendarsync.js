"use strict";

var calendarsync = {

    // CALENDAR SYNC

    fromzpush: function(syncdata) {
        // skip if lightning is not installed
        if ("calICalendar" in Components.interfaces == false) {
            sync.finishSync(syncdata, "nolightning");
            return
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
                wbxml.ctag();
            wbxml.ctag();
        wbxml.ctag();

        sync.Send(wbxml.getBytes(), this.processRemoteChanges.bind(this), "Sync", syncdata);
    },

    processRemoteChanges: function (wbxml, syncdata) {
        //care about status and truncation

        //update synckey
        let synckey = wbxmltools.FindKey(wbxml);
        db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", synckey);

        // convert wbxml answer to xml and parse as DOM
        var oParser = Components.classes["@mozilla.org/xmlextras/domparser;1"].createInstance(Components.interfaces.nsIDOMParser);
        var oDOM = oParser.parseFromString(wbxmltools.convert2xml(wbxml), "text/xml");

        //get sync target of this calendar
        let calendar = cal.getCalendarManager().getCalendarById(tzPush.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));

        //looking for additions (Add node contains only ServerId, everything else is inside ApplicationData, inside ApplicationData is Body)
        var add = oDOM.getElementsByTagName("Add");
        for (let count = 0; count < add.length; count++) {
            let data = tzPush.getDataFromXML(add[count]);
            //check if returned data.ServerId == folderId ???
            //check if we already have an item with that id ???
            this.additem(calendar, data);
        }

        sync.finishSync(syncdata);
    },

    
    additem: function (calendar, data) {
        // create item
        let item = cal.createEvent();
        item.title = data.ApplicationData.Subject;
        item.setProperty("location", data.ApplicationData.Location);
        item.setProperty("description", data.ApplicationData.Body.Data);
        //item.setProperty("categories","juhu,haha");
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
    }
};
