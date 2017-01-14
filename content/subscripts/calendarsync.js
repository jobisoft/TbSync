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

        //inline listener objects for ADD jobs, DELETE jobs and UPDATE jobs
        let itemData = null;

        let itemListenerAdd = {
            onGetResult (aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
                //we could loop over aItems and check each aItems UID if it matches an entry itemData, but no 
                //we tried to get ONE item, if we are here, we found ONE item, so adding that item (again) is not possible, 
                //clear itemData (which contains this one item) so onOperationComplete has nothing to do
                itemData = null;
            },
            onOperationComplete : function (aOperationType, aId, aDetail) {
                //add item stored in addItemData
                if (itemData === null) return;
                let newItem = cal.createEvent();
                tzPush.setEvent(newItem, itemData);
                calendar.addItem(newItem, tzPush.calendarOperationObserver);
            }
        };

        let itemListenerUpdate = {
            onGetResult (aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
                //if we are here, we found that one item we want to update
                let newItem = cal.createEvent();
                tzPush.setEvent(newItem, itemData);
                calendar.modifyItem(newItem, aItems[0], tzPush.calendarOperationObserver);
            },
            onOperationComplete : function (aOperationType, aId, aDetail) {}
        };

        let itemListenerDelete = { 
            onGetResult (aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
                calendar.deleteItem(aItems[0], tzPush.calendarOperationObserver);
            },
            onOperationComplete : function (aOperationType, aId, aDetail) {}
        };


        
        
        // get data from wbxml response
        let wbxmlData = tzPush.wbxmltools.createWBXML(wbxml).getData();

        // check for empty response
        if (wbxml.length === 0 || wbxmlData === null) {
            this.tozpush(syncdata);
            return;
        }

        //debug
        wbxmltools.printWbxmlData(wbxmlData);

        //check status
        if (sync.statusIsBad(wbxmlData.Sync.Collections.Collection.Status, syncdata)) {
            return;
        }

        //update synckey
        syncdata.synckey = wbxmlData.Sync.Collections.Collection.SyncKey;
        db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", syncdata.synckey);
        
        //get sync target of this calendar
        let calendar = cal.getCalendarManager().getCalendarById(tzPush.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));
        
        //any commands for us to work on?
        if (wbxmlData.Sync.Collections.Collection.Commands) {

            //looking for additions
            let add = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Add);
            for (let count = 0; count < add.length; count++) {
                itemData = add[count].ApplicationData;
                calendar.getItem(itemData.UID, itemListenerAdd); //do NOT add, if an item with that UID was found - handled by listener
            }
            
            //looking for changes
            let upd = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Change);
            for (let count = 0; count < upd.length; count++) {
                itemData = upd[count].ApplicationData;
                calendar.getItem(itemData.UID, itemListenerUpdate); //Only update, if an item with that UID was found - handled by listener
            }
            
            //looking for deletes
            let del = wbxmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Delete);
            for (let count = 0; count < del.length; count++) {
                calendar.getItem(del[count].ServerId, itemListenerDelete); //delete items with that UID (there is no ApplicationData in delete commands, so we need to use ServerId
            }
            
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
