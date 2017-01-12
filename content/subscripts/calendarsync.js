"use strict";

var calendarsync = {

    // CALENDAR SYNC
    // Link sync to lightning-sync-button using providerId
    
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
        
        // get data from wbxml response
        let wbxmlData = tzPush.wbxmltools.createWBXML(wbxml).getData();

        if (wbxml.length === 0 || wbxmlData === null) {
            this.tozpush(syncdata);
            return;
        }

        //debug
        wbxmltools.printWbxmlData(wbxmlData);

        //update synckey
        syncdata.synckey = wbxmlData.Sync.Collections.Collection.SyncKey;
        db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", syncdata.synckey);

        //care about status and truncation
        // ...
        
        //get sync target of this calendar
        let calendar = cal.getCalendarManager().getCalendarById(tzPush.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));
        
        //any commands for us to work on?
        if (wbxmlData.Sync.Collections.Collection.Commands) {

            //looking for additions
            let add = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Add);
            for (let count = 0; count < add.length; count++) {
                //check if we already have an item with that id ???
                let event = cal.createEvent();
                tzPush.setEvent(event, add[count].ApplicationData);
                calendar.addItem(event, tzPush.calendarOperationObserver);
            }
            
            //looking for changes
            // ...
            
            //loking for deletes
            // ...
            
        }

        if (wbxmlData.Sync.Collections.Collection.MoreAvailable) {
            this.fromzpush(syncdata);
        } else { 
            this.tozpush(syncdata);
        }
    },





    tozpush: function(syncdata) {
        sync.finishSync(syncdata);
    }

};
