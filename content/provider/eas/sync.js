"use strict";

eas.sync = {

    createItem : function (syncdata) {
        switch (syncdata.type) {
            case "Calendar": return cal.createEvent();
            case "Tasks": return cal.createTodo();
        }
    },


    start: Task.async (function* (syncdata)  {
        // skip if lightning is not installed
        if ("calICalendar" in Components.interfaces == false) {
            throw eas.finishSync("nolightning", eas.flags.abortWithError);
        }
        
        // check SyncTarget
        if (!tbSync.checkCalender(syncdata.account, syncdata.folderID)) {
            throw eas.finishSync("notargets", eas.flags.abortWithError);
        }
        
        //get sync target of this calendar
        syncdata.targetObj = cal.getCalendarManager().getCalendarById(tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));
        syncdata.targetId = syncdata.targetObj.id;

        //sync
        yield eas.sync.requestRemoteChanges (syncdata); 
        yield eas.sync.sendLocalChanges (syncdata);
        
        //if everything was OK, we still throw, to get into catch
        throw eas.finishSync();
    }),



    
    requestRemoteChanges: Task.async (function* (syncdata)  {
        do {
            tbSync.setSyncState("requestingchanges", syncdata.account, syncdata.folderID);

            // BUILD WBXML
            let wbxml = tbSync.wbxmltools.createWBXML();
            wbxml.otag("Sync");
                wbxml.otag("Collections");
                    wbxml.otag("Collection");
                        if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") wbxml.atag("Class", syncdata.type);
                        wbxml.atag("SyncKey", syncdata.synckey);
                        wbxml.atag("CollectionId", syncdata.folderID);
                        wbxml.atag("DeletesAsMoves", "1");
                        //wbxml.atag("GetChanges", ""); //Not needed, as it is default
                        wbxml.atag("WindowSize", "100");

                        if (tbSync.db.getAccountSetting(syncdata.account, "asversion") != "2.5") {
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



            //SEND REQUEST
            let response = yield eas.sendRequest(wbxml.getBytes(), "Sync", syncdata);



            //VALIDATE RESPONSE
            tbSync.setSyncState("recievingchanges", syncdata.account, syncdata.folderID);

            // get data from wbxml response, some servers send empty response if there are no changes, which is not an error
            let wbxmlData = eas.getDataFromResponse(response, eas.flags.allowEmptyResponse);
            if (wbxmlData === null) return;
        
            //check status, throw on error
            eas.checkStatus(syncdata, wbxmlData,"Sync.Collections.Collection.Status");
            
            //update synckey, throw on error
            eas.updateSynckey(syncdata, wbxmlData);



            //PROCESS RESPONSE        
            //any commands for us to work on? If we reach this point, Sync.Collections.Collection is valid, 
            //no need to use the save getWbxmlDataField function
            if (wbxmlData.Sync.Collections.Collection.Commands) {

                //promisify calender, so it can be used together with yield
                let pcal = cal.async.promisifyCalendar(syncdata.targetObj.wrappedJSObject);
            
                //looking for additions
                let add = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Add);
                for (let count = 0; count < add.length; count++) {

                    let ServerId = add[count].ServerId;
                    let data = add[count].ApplicationData;

                    let foundItems = yield pcal.getItem(ServerId);
                    if (foundItems.length == 0) { //do NOT add, if an item with that ServerId was found
                        //if this is a resync and this item exists in delete_log, do not add it, the follow-up delete request will remove it from the server as well
                        if (db.getItemStatusFromChangeLog(syncdata.targetObj.id, ServerId) == "deleted_by_user") {
                            tbSync.dump("Add request, but element is in delete_log, asuming resync, local state wins, not adding.", ServerId);
                        } else {
                            let newItem = eas.sync.createItem(syncdata);
                            eas.sync[syncdata.type].setThunderbirdItemFromWbxml(newItem, data, ServerId, syncdata);
                            db.addItemToChangeLog(syncdata.targetObj.id, ServerId, "added_by_server");
                            try {
                                yield pcal.addItem(newItem);
                            } catch (e) {tbSync.dump("Error during Add", e);}
                        }
                    } else {
                        //item exists, asuming resync
                        tbSync.dump("Add request, but element exists already, asuming resync, local version wins.", ServerId);
                        //we MUST make sure, that our local version is send to the server
                        db.addItemToChangeLog(syncdata.targetObj.id, ServerId, "modified_by_user");
                    }
                }

                //looking for changes
                let upd = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Change);
                //inject custom change object for debug
                //upd = JSON.parse('[{"ServerId":"2tjoanTeS0CJ3QTsq5vdNQAAAAABDdrY6Gp03ktAid0E7Kub3TUAAAoZy4A1","ApplicationData":{"DtStamp":"20171109T142149Z"}}]');
                for (let count = 0; count < upd.length; count++) {

                    let ServerId = upd[count].ServerId;
                    let data = upd[count].ApplicationData;

                    let foundItems = yield pcal.getItem(ServerId);
                    if (foundItems.length > 0) { //only update, if an item with that ServerId was found
                        let newItem = foundItems[0].clone();
                        eas.sync[syncdata.type].setThunderbirdItemFromWbxml(newItem, data, ServerId, syncdata);
                        db.addItemToChangeLog(syncdata.targetObj.id, ServerId, "modified_by_server");
                        yield pcal.modifyItem(newItem, foundItems[0]);
                    } else {
                        tbSync.dump("Update request, but element not found", ServerId);
                        //resync to avoid out-of-sync problems, "add" can take care of local merges
                        throw eas.finishSync("ChangeElementNotFound", eas.flags.resyncFolder);
                    }
                }
                
                //looking for deletes
                let del = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Commands.Delete);
                for (let count = 0; count < del.length; count++) {

                    let ServerId = del[count].ServerId;

                    let foundItems = yield pcal.getItem(ServerId);
                    if (foundItems.length > 0) { //delete item with that ServerId
                        db.addItemToChangeLog(syncdata.targetObj.id, ServerId, "deleted_by_server");
                        yield pcal.deleteItem(foundItems[0]);
                    } else {
                        tbSync.dump("Delete request, but element not found", ServerId);
                        //resync to avoid out-of-sync problems
                        throw eas.finishSync("DeleteElementNotFound", eas.flags.resyncFolder);
                    }
                }
            
            }
            
            if (!wbxmlData.Sync.Collections.Collection.MoreAvailable) return;
        } while (true);
                
    }),




    sendLocalChanges: Task.async (function* (syncdata)  {

        //promisify calender, so it can be used together with yield
        let pcal = cal.async.promisifyCalendar(syncdata.targetObj.wrappedJSObject);
        let maxnumbertosend = tbSync.prefSettings.getIntPref("maxnumbertosend");
        
        //get changed items from ChangeLog
        do {
            tbSync.setSyncState("sendingchanges", syncdata.account, syncdata.folderID);
            let changes = db.getItemsFromChangeLog(syncdata.targetObj.id, maxnumbertosend, "_by_user");
            let c=0;
            
            // BUILD WBXML
            let wbxml = tbSync.wbxmltools.createWBXML();
            wbxml.otag("Sync");
                wbxml.otag("Collections");
                    wbxml.otag("Collection");
                        if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") wbxml.atag("Class", syncdata.type);
                        wbxml.atag("SyncKey", syncdata.synckey);
                        wbxml.atag("CollectionId", syncdata.folderID);
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
                                                wbxml.append(eas.sync[syncdata.type].getWbxmlFromThunderbirdItem(items[0], syncdata));
                                            wbxml.ctag();
                                        wbxml.ctag();
                                        db.removeItemFromChangeLog(syncdata.targetObj.id, changes[i].id);
                                        c++;
                                        break;
                                    
                                    case "modified_by_user":
                                        items = yield pcal.getItem(changes[i].id);
                                        wbxml.otag("Change");
                                        wbxml.atag("ServerId", changes[i].id);
                                            wbxml.otag("ApplicationData");
                                                wbxml.append(eas.sync[syncdata.type].getWbxmlFromThunderbirdItem(items[0], syncdata));
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

            //if there was not a single local change, exit
            if (c == 0) {
                if (changes !=0 ) tbSync.dump("noMoreChanges, but unproceccessed changes left:", changes);
                return;
            }



            //SEND REQUEST & VALIDATE RESPONSE
            let response = yield eas.sendRequest(wbxml.getBytes(), "Sync", syncdata);

            tbSync.setSyncState("serverid", syncdata.account, syncdata.folderID);

            //get data from wbxml response
            let wbxmlData = eas.getDataFromResponse(response);
        
            //check status
            eas.checkStatus(syncdata, wbxmlData,"Sync.Collections.Collection.Status");
            
            //update synckey
            eas.updateSynckey(syncdata, wbxmlData);



            //PROCESS RESPONSE        
            //any responses for us to work on?  If we reach this point, Sync.Collections.Collection is valid, 
            //no need to use the save getWbxmlDataField function
            if (wbxmlData.Sync.Collections.Collection.Responses) {                

                //looking for additions (Add node contains, status, old ClientId and new ServerId)
                let add = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Add);
                for (let count = 0; count < add.length; count++) {
                    
                    //Check status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                    eas.checkStatus(syncdata, add[count],"Status","Sync.Collections.Collection.Responses.Add["+count+"].Status");

                    //look for an item identfied by ClientId and update its id to the new id received from the server
                    let foundItems = yield pcal.getItem(add[count].ClientId);
                    
                    if (foundItems.length > 0) {
                        let newItem = foundItems[0].clone();
                        newItem.id = add[count].ServerId;
                        db.addItemToChangeLog(syncdata.targetObj.id, newItem.id, "modified_by_server");
                        yield pcal.modifyItem(newItem, foundItems[0]);
                    }
                }

                //looking for modifications 
                let upd = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Change);
                for (let count = 0; count < upd.length; count++) {
                    //Check status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                    eas.checkStatus(syncdata, upd[count],"Status","Sync.Collections.Collection.Responses.Change["+count+"].Status");
                }

                //looking for deletions 
                let del = xmltools.nodeAsArray(wbxmlData.Sync.Collections.Collection.Responses.Delete);
                for (let count = 0; count < del.length; count++) {
                    //Check status, stop sync if bad (statusIsBad will initiate a resync or finish the sync properly)
                    eas.checkStatus(syncdata, del[count],"Status","Sync.Collections.Collection.Responses.Delete["+count+"].Status");
                }
                
            }
        } while (true);
        
    })
}
