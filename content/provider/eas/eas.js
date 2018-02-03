"use strict";

tbSync.includeJS("chrome://tbsync/content/provider/eas/wbxmltools.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/xmltools.js");

var eas = {
    bundle: Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tbsync/locale/eas.strings"),
    //use flags instead of strings to avoid errors due to spelling errors
    flags : Object.freeze({
        allowEmptyResponse: true, 
        syncNextFolder: "syncNextFolder",
        resyncFolder: "resyncFolder",
        resyncAccount: "resyncAccount", 
        abortWithError: "abortWithError"
    }),
    
    init: Task.async (function* ()  {
        if ("calICalendar" in Components.interfaces) {
            //get a list of all zones
            //alternativly use cal.fromRFC3339 - but this is only doing this
            //https://dxr.mozilla.org/comm-central/source/calendar/base/modules/calProviderUtils.jsm
            eas.offsets = {};
            let tzService = cal.getTimezoneService();
            let dateTime = cal.createDateTime("20160101T000000Z"); //UTC

            //find timezone based on utcOffset
            let enumerator = tzService.timezoneIds;
            while (enumerator.hasMore()) {
                let id = enumerator.getNext();
                dateTime.timezone = tzService.getTimezone(id);
                eas.offsets[dateTime.timezoneOffset/-60] = id; //in minutes
            }

            //also try default timezone
            dateTime.timezone=cal.calendarDefaultTimezone();
            eas.defaultUtcOffset = dateTime.timezoneOffset/-60
            eas.offsets[eas.defaultUtcOffset] = dateTime.timezone.tzid;

            
            //If an EAS calendar is currently NOT associated with an email identity, try to associate, 
            //but do not change any explicitly set association
            // - A) find email identity and accociate (which sets organizer to that user identity)
            // - B) overwrite default organizer with current best guess
            //TODO: Do this after email accounts changed, not only on restart? 
            let folders = tbSync.db.findFoldersWithSetting(["selected","type"], ["1","8,13"], "provider", "eas");
            for (let f=0; f<folders.length; f++) {
                let calendar = cal.getCalendarManager().getCalendarById(folders[f].target);
                if (calendar && calendar.getProperty("imip.identity.key") == "") {
                    //is there an email identity for this eas account?
                    let key = tbSync.getIdentityKey(tbSync.db.getAccountSetting(folders[f].account, "user"));
                    if (key === "") { //TODO: Do this even after manually switching to NONE, not only on restart?
                        //set transient calendar organizer settings based on current best guess and 
                        calendar.setProperty("organizerId", cal.prependMailTo(tbSync.db.getAccountSetting(folders[f].account, "user")));
                        calendar.setProperty("organizerCN",  calendar.getProperty("fallbackOrganizerName"));
                    } else {                      
                        //force switch to found identity
                        calendar.setProperty("imip.identity.key", key);
                    }
                }
            }
                    
        }        
    }),

    start: Task.async (function* (syncdata, job, folderID = "")  {
        //set syncdata for this sync process (reference from outer object)
        syncdata.state = "";
        syncdata.folderID = folderID;
        let accountReSyncs = 0;
        
        do {
            try {
                accountReSyncs++;
                syncdata.todo = 0;
                syncdata.done = 0;

                // set status to syncing (so settingswindow will display syncstates instead of status) and set initial syncstate
                tbSync.db.setAccountSetting(syncdata.account, "status", "syncing");
                tbSync.setSyncState("syncing", syncdata.account);

                if (accountReSyncs > 3) {
                    throw eas.finishSync("resync-loop", eas.flags.abortWithError);
                }

                // check if connected
                if (tbSync.db.getAccountSetting(syncdata.account, "state") == "disconnected") {
                    throw eas.finishSync("notconnected", eas.flags.abortWithError);
                }

                // check if connection has data
                let connection = tbSync.eas.getConnection(syncdata.account);
                if (connection.server == "" || connection.user == "") {
                    throw eas.finishSync("nouserhost", eas.flags.abortWithError);
                }

                //Is this a standard sync or an account resync ?
                if (tbSync.db.getAccountSetting(syncdata.account, "foldersynckey") == "") {
                    //accountReSyncs == 1 is not a save method to identify initial sync, because a resync due to policy/provision 
                    //could still be an initial sync
                    syncdata.accountResync = (accountReSyncs > 1);
                } else {
                    syncdata.accountResync = false;
                }

                //do we need to get a new policy key?
                if (tbSync.db.getAccountSetting(syncdata.account, "provision") == "1" && tbSync.db.getAccountSetting(syncdata.account, "policykey") == 0) {
                    yield eas.getPolicykey(syncdata);
                } 
                
                switch (job) {
                    case "sync":
                        //get all folders, which need to be synced
                        //yield eas.getUserInfo(syncdata);
                        yield eas.getPendingFolders(syncdata);
                        //sync all pending folders
                        yield eas.syncPendingFolders(syncdata); //inside here we throw and catch FinischFolderSync
                        throw eas.finishSync();
                        break;
                        
                    case "deletefolder":
                        //TODO: foldersync first ???
                        yield eas.deleteFolder(syncdata);
                        throw eas.finishSync();
                        break;
                        
                    default:
                        throw eas.finishSync("unknown", eas.flags.abortWithError);

                }

            } catch (report) { 
                    
                switch (report.type) {
                    case eas.flags.resyncAccount:
                        tbSync.dump("Account Resync", "Account: " + tbSync.db.getAccountSetting(syncdata.account, "accountname") + ", Reason: " + report.message);                        
                        tbSync.db.setAccountSetting(syncdata.account, "foldersynckey", "");
                        tbSync.db.setFolderSetting(syncdata.account, "", "synckey", "");
                        continue;

                    case eas.flags.abortWithError: //fatal error, finish account sync
                    case eas.flags.syncNextFolder: //no more folders left, finish account sync
                    case eas.flags.resyncFolder: //should not happen here, just in case
                        eas.finishAccountSync(syncdata, report.message);
                        return;

                    default:
                        //there was some other error
                        Components.utils.reportError(report);
                        eas.finishAccountSync(syncdata, "javascriptError");
                        return;
                }

            }

        } while (true);

    }),

    //Process all folders with PENDING status
    syncPendingFolders: Task.async (function* (syncdata)  {
        let folderReSyncs = 1;
        
        do {            
            //reset syncdata statecounts
            syncdata.statecounts = {};
            syncdata.todo = 0;
            syncdata.done = 0;
                
            //any pending folders left?
            let folders = tbSync.db.findFoldersWithSetting("status", "pending", syncdata.account);
            if (folders.length == 0) {
                //all folders of this account have been synced
                return;
            };

            //The individual folder sync is placed inside a try ... catch block. If a folder sync has finished, a throwFinishSync error is thrown
            //and catched here. If that error has a message attached, it ist re-thrown to the main account sync loop, which will abort sync completely
            try {
                
                //resync loop control
                if (folders[0].folderID == syncdata.folderID) folderReSyncs++;
                else folderReSyncs = 1;

                if (folderReSyncs > 3) {
                    throw eas.finishSync("resync-loop", eas.flags.abortWithError);
                }

                syncdata.synckey = folders[0].synckey;
                syncdata.folderID = folders[0].folderID;
                //get syncdata type, which is also used in WBXML for the CLASS element
                switch (folders[0].type) {
                    case "9": 
                    case "14": 
                        syncdata.type = "Contacts";
                        break;
                    case "8":
                    case "13":
                        syncdata.type = "Calendar";
                        break;
                    case "7":
                    case "15":
                        syncdata.type = "Tasks";
                        break;
                    default:
                        throw eas.finishSync("skipped");
                };
                
                tbSync.setSyncState("preparing", syncdata.account, syncdata.folderID);
                
                //get synckey if needed (this probably means initial sync or resync)
                if (syncdata.synckey == "") {
                    yield eas.getSynckey(syncdata);
                    //folderReSyncs == 1 is not a save method to identify initial sync, because a resync due to policy/provision 
                    //could still be an initial sync
                    syncdata.folderResync = (folderReSyncs > 1);
                } else {
                    syncdata.folderResync = false;
                }
                
                //sync folder
                syncdata.timeOfLastSync = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "lastsynctime") / 1000;
                syncdata.timeOfThisSync = (Date.now() / 1000) - 1;
                switch (syncdata.type) {
                    case "Contacts": 
                        yield eas.contactsync.start(syncdata);
                        break;
                    case "Calendar":
                    case "Tasks": 
                        yield eas.sync.start(syncdata);
                        break;
                }

            } catch (report) { 

                switch (report.type) {
                    case eas.flags.abortWithError:  //if there was a fatal error during folder sync, re-throw error to finish account sync (with error)
                    case eas.flags.resyncAccount:   //if the entire account needs to be resynced, finish this folder and re-throw account (re)sync request                                                    
                        eas.finishFolderSync(syncdata, report.message);
                        throw eas.finishSync(report.message, report.type);
                        break;

                    case eas.flags.syncNextFolder:
                        eas.finishFolderSync(syncdata, report.message);
                        break;
                                            
                    case eas.flags.resyncFolder:
                        //reset synckey to indicate "resync" and sync this folder again
                        tbSync.dump("Folder Resync", "Account: " + tbSync.db.getAccountSetting(syncdata.account, "accountname") + ", Folder: "+ tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name") + ", Reason: " + report.message);
                        tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", "");
                        continue;
                    
                    default:
                        Components.utils.reportError(report);
                        let msg = "javascriptError";
                        eas.finishFolderSync(syncdata, msg);
                        //this is a fatal error, re-throw error to finish account sync
                        throw eas.finishSync(msg, eas.flags.abortWithError);
                }

            }

        }
        while (true);
    }),

    getPolicykey: Task.async (function* (syncdata)  {
        //build WBXML to request provision
        tbSync.setSyncState("prepare.request.provision", syncdata.account);
        let wbxml = wbxmltools.createWBXML();
        wbxml.switchpage("Provision");
        wbxml.otag("Provision");
            wbxml.otag("Policies");
                wbxml.otag("Policy");
                    wbxml.atag("PolicyType",(tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") ? "MS-WAP-Provisioning-XML" : "MS-EAS-Provisioning-WBXML" );
                wbxml.ctag();
            wbxml.ctag();
        wbxml.ctag();

        for (let loop=0; loop < 2; loop++) {
            tbSync.setSyncState("send.request.provision", syncdata.account);
            let response = yield eas.sendRequest(wbxml.getBytes(), "Provision", syncdata);

            tbSync.setSyncState("eval.response.provision", syncdata.account);
            let wbxmlData = eas.getDataFromResponse(response);
            let policyStatus = xmltools.getWbxmlDataField(wbxmlData,"Provision.Policies.Policy.Status");
            let provisionStatus = xmltools.getWbxmlDataField(wbxmlData,"Provision.Status");
            if (provisionStatus === false) {
                throw eas.finishSync("wbxmlmissingfield::Provision.Status", eas.flags.abortWithError);
            } else if (provisionStatus != "1") {
                //dump policy status as well
                if (policyStatus) tbSync.dump("PolicyKey","Received policy status: " + policyStatus);
                throw eas.finishSync("provision::" + provisionStatus, eas.flags.abortWithError);
            }

            //reaching this point: provision status was ok
            let policykey = xmltools.getWbxmlDataField(wbxmlData,"Provision.Policies.Policy.PolicyKey");
            switch (policyStatus) {
                case false:
                    throw eas.finishSync("wbxmlmissingfield::Provision.Policies.Policy.Status", eas.flags.abortWithError);

                case "2":
                    //server does not have a policy for this device: disable provisioning
                    tbSync.db.setAccountSetting(syncdata.account, "provision","0")
                    throw eas.finishSync("NoPolicyForThisDevice", eas.flags.resyncAccount);

                case "1":
                    if (policykey === false) {
                        throw eas.finishSync("wbxmlmissingfield::Provision.Policies.Policy.PolicyKey", eas.flags.abortWithError);
                    } 
                    tbSync.dump("PolicyKey","Received policykey (" + loop + "): " + policykey);
                    tbSync.db.setAccountSetting(syncdata.account, "policykey", policykey);
                    break;

                default:
                    throw eas.finishSync("policy." + policyStatus, eas.flags.abortWithError);
            }

            //build WBXML to acknowledge provision
            tbSync.setSyncState("prepare.request.provision", syncdata.account);
            wbxml = wbxmltools.createWBXML();
            wbxml.switchpage("Provision");
            wbxml.otag("Provision");
                wbxml.otag("Policies");
                    wbxml.otag("Policy");
                        wbxml.atag("PolicyType",(tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") ? "MS-WAP-Provisioning-XML" : "MS-EAS-Provisioning-WBXML" );
                        wbxml.atag("PolicyKey", policykey);
                        wbxml.atag("Status", "1");
                    wbxml.ctag();
                wbxml.ctag();
            wbxml.ctag();
            
            //this wbxml will be used by Send at the top of this loop
        }
    }),

    getPendingFolders: Task.async (function* (syncdata)  {
        //this function sets all folders which ougth to be synced to pending, either a specific one (if folderID is set) or all avail
        if (syncdata.folderID != "") {
            //just set the specified folder to pending
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "status", "pending");
        } else {
            //scan all folders ans set the enabled ones to pending
            tbSync.setSyncState("prepare.request.folders", syncdata.account); 
            let foldersynckey = tbSync.db.getAccountSetting(syncdata.account, "foldersynckey");
            //legacy fallback
            if (foldersynckey == "") foldersynckey = "0";

            //build WBXML to request foldersync
            let wbxml = wbxmltools.createWBXML();
            wbxml.switchpage("FolderHierarchy");
            wbxml.otag("FolderSync");
                wbxml.atag("SyncKey",foldersynckey);
            wbxml.ctag();

            tbSync.setSyncState("send.request.folders", syncdata.account); 
            let response = yield eas.sendRequest(wbxml.getBytes(), "FolderSync", syncdata);

            tbSync.setSyncState("eval.response.folders", syncdata.account); 
            let wbxmlData = eas.getDataFromResponse(response);

            eas.checkStatus(syncdata, wbxmlData,"FolderSync.Status");

            let synckey = xmltools.getWbxmlDataField(wbxmlData,"FolderSync.SyncKey");
            if (synckey) {
                tbSync.db.setAccountSetting(syncdata.account, "foldersynckey", synckey);
            } else {
                throw eas.finishSync("wbxmlmissingfield::FolderSync.SyncKey", eas.flags.abortWithError);
            }
            
            //if we reach this point, wbxmlData contains FolderSync node, so the next if will not fail with an javascript error, 
            //no need to use save getWbxmlDataField function
            
            //are there any changes in folder hierarchy
            let addedFolders = [];
            if (wbxmlData.FolderSync.Changes) {
                //looking for additions
                let add = xmltools.nodeAsArray(wbxmlData.FolderSync.Changes.Add);
                for (let count = 0; count < add.length; count++) {
                    //special action needed during resync: keep track off all added folders
                    addedFolders.push(add[count].ServerId);
                    
                    //check if we have a folder with that folderID (=data[ServerId])
                    let folder = tbSync.db.getFolder(syncdata.account, add[count].ServerId);
                    if (folder === null) {
                        //add folder
                        let newData =tbSync.eas.getNewFolderEntry();
                        newData.account = syncdata.account;
                        newData.folderID = add[count].ServerId;
                        newData.name = add[count].DisplayName;
                        newData.type = add[count].Type;
                        newData.parentID = add[count].ParentId;
                        newData.synckey = "";
                        newData.target = "";
                        newData.selected = (newData.type == "9" || newData.type == "8" || newData.type == "7" ) ? "1" : "0";
                        newData.status = "";
                        newData.lastsynctime = "";
                        tbSync.db.addFolder(newData);
                    } else if (syncdata.accountResync) {
                        //trying to add an existing folder during resync, overwrite local settings with those from server
                        let target = folder.target;

                        folder.name = add[count].DisplayName;
                        folder.parentID = add[count].ParentId;

                        //check if type changed
                        if ((folder.type != add[count].Type) && (folder.selected == "1" || target != "")) {
                            //deselect folder
                            folder.selected = "0";
                            folder.target = "";
                            //if target exists, take it offline
                            if (target != "") tbSync.eas.takeTargetOffline(target, folder.type);
                        }    
                        folder.type = add[count].Type;
                        folder.status = "";

                        //always clear
                        folder.synckey = "";
                        folder.lastsynctime = "";

                        tbSync.db.saveFolders();
                    }
                }
                
                //looking for updates
                let update = xmltools.nodeAsArray(wbxmlData.FolderSync.Changes.Update);
                for (let count = 0; count < update.length; count++) {
                    //geta a reference
                    let folder = tbSync.db.getFolder(syncdata.account, update[count].ServerId);
                    if (folder !== null) {
                        let target = folder.target;

                        //update folder
                        folder.name = update[count].DisplayName;
                        folder.parentID = update[count].ParentId;
                        
                        //check if type changed or folder got deleted
                        if ((folder.type != update[count].Type) && (folder.selected == "1" || target != "")) {
                            //deselect folder
                            folder.selected = "0";                    
                            folder.target = "";                    
                            //if target exists, take it offline
                            if (target != "") tbSync.eas.takeTargetOffline(target, folder.type);

                            //clear on deselect
                            folder.synckey = "";
                            folder.lastsynctime = "";
                        }
                        folder.type = update[count].Type;
                        folder.status = "";

                        tbSync.db.saveFolders();

                    } else {
                        //this might be a problem: cannot update an non-existing folder - simply add the folder as not selected
                        let newData =tbSync.eas.getNewFolderEntry();
                        newData.account = syncdata.account;
                        newData.folderID = update[count].ServerId;
                        newData.name = update[count].DisplayName;
                        newData.type = update[count].Type;
                        newData.parentID = update[count].ParentId;
                        newData.synckey = "";
                        newData.target = "";
                        newData.selected = "";
                        newData.status = "";
                        newData.lastsynctime = "";
                        tbSync.db.addFolder(newData);
                    }
                }

                //looking for deletes
                let del = xmltools.nodeAsArray(wbxmlData.FolderSync.Changes.Delete);
                for (let count = 0; count < del.length; count++) {

                    //get a copy of the folder, so we can del it
                    let folder = tbSync.db.getFolder(syncdata.account, del[count].ServerId);
                    if (folder !== null) {
                        let target = folder.target;
                        //deselect folder
                        folder.selected = "0";                    
                        folder.target = "";                    
                        //if target exists, take it offline
                        if (target != "") tbSync.eas.takeTargetOffline(target, folder.type);
                        //delete folder in account manager
                        tbSync.db.deleteFolder(syncdata.account, del[count].ServerId);
                    } else {
                        //cannot del an non-existing folder - do nothing
                    }
                }
            }

            
            //set selected folders to pending, so they get synced
            //also clean up leftover folder entries in DB during resync
            let folders = tbSync.db.getFolders(syncdata.account);
            for (let f in folders) {
                //special action dring resync: remove all folders from db, which have not been added by server (thus are no longer there)
                if (syncdata.accountResync && !addedFolders.includes(folders[f].folderID)) {
                    //if target exists, take it offline
                    if (folders[f].target != "") tbSync.eas.takeTargetOffline(folders[f].target, folders[f].type);
                    //delete folder in account manager
                    tbSync.db.deleteFolder(syncdata.account, folders[f].folderID);
                    continue;
                }
                            
                if (folders[f].selected == "1") {
                    tbSync.db.setFolderSetting(folders[f].account, folders[f].folderID, "status", "pending");
                }
            }            
        }
    }),

    getSynckey: Task.async (function* (syncdata) {
        tbSync.setSyncState("prepare.request.synckey", syncdata.account);
        //build WBXML to request a new syncKey
        let wbxml = tbSync.wbxmltools.createWBXML();
        wbxml.otag("Sync");
            wbxml.otag("Collections");
                wbxml.otag("Collection");
                    if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") wbxml.atag("Class", syncdata.type);
                    wbxml.atag("SyncKey","0");
                    wbxml.atag("CollectionId",syncdata.folderID);
                wbxml.ctag();
            wbxml.ctag();
        wbxml.ctag();
        
        tbSync.setSyncState("send.request.synckey", syncdata.account);
        let response = yield eas.sendRequest(wbxml.getBytes(), "Sync", syncdata);

        tbSync.setSyncState("eval.response.synckey", syncdata.account);
        // get data from wbxml response
        let wbxmlData = eas.getDataFromResponse(response);
        //check status
        eas.checkStatus(syncdata, wbxmlData,"Sync.Collections.Collection.Status");
        //update synckey
        eas.updateSynckey(syncdata, wbxmlData);
    }),

    finishSync: function (msg = "", type = eas.flags.syncNextFolder) {
        let e = new Error(); 
        e.type = type;
        e.message = msg;
        return e; 
    },

    finishFolderSync: function (syncdata, error) {
        //a folder has been finished, update status
        let time = Date.now();
        let status = "OK";
        
        let info = tbSync.db.getAccountSetting(syncdata.account, "accountname");
        if (syncdata.folderID != "") {
            info += "." + tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name");
        }
        
        if (error !== "") {
            status = error;
            time = "";
        }
        tbSync.dump("finishFolderSync(" + info + ")", tbSync.getLocalizedMessage("status." + status));
        
        if (syncdata.folderID != "") {
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "status", status);
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "lastsynctime", time);
        } 

        tbSync.setSyncState("done", syncdata.account);
    },

    finishAccountSync: function (syncdata, error) {
        let status = "OK";

        // set each folder with PENDING status to ABORTED
        let folders = tbSync.db.findFoldersWithSetting("status", "pending", syncdata.account);
        for (let i=0; i < folders.length; i++) {
            tbSync.db.setFolderSetting(syncdata.account, folders[i].folderID, "status", "aborted");
        }

        //update account status
        if (error !== "") {
            status = error;
            let info = tbSync.db.getAccountSetting(syncdata.account, "accountname");
            tbSync.dump("finishAccountSync(" + info + ")", tbSync.getLocalizedMessage("status." + status));
        }
        tbSync.db.setAccountSetting(syncdata.account, "lastsynctime", Date.now());
        tbSync.db.setAccountSetting(syncdata.account, "status", status);

        //done
        tbSync.setSyncState("accountdone", syncdata.account); 
    },
    
    updateSynckey: function (syncdata, wbxmlData) {
        let synckey = xmltools.getWbxmlDataField(wbxmlData,"Sync.Collections.Collection.SyncKey");

        if (synckey) {
            syncdata.synckey = synckey;
            db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", synckey);
        } else {
            throw eas.finishSync("wbxmlmissingfield::Sync.Collections.Collection.SyncKey", eas.flags.abortWithError);
        }
    },


    deleteFolder: Task.async (function* (syncdata)  {
        if (syncdata.folderID == "") {
            throw eas.finishSync();
        } 
        
        tbSync.setSyncState("prepare.request.deletefolder", syncdata.account);
        let foldersynckey = tbSync.db.getAccountSetting(syncdata.account, "foldersynckey");
        if (foldersynckey == "") foldersynckey = "0";

        //request foldersync
        let wbxml = wbxmltools.createWBXML();
        wbxml.switchpage("FolderHierarchy");
        wbxml.otag("FolderDelete");
            wbxml.atag("SyncKey", foldersynckey);
            wbxml.atag("ServerId", syncdata.folderID);
        wbxml.ctag();

        tbSync.setSyncState("send.request.deletefolder", syncdata.account);
        let response = yield eas.sendRequest(wbxml.getBytes(), "FolderDelete", syncdata);


        tbSync.setSyncState("eval.response.deletefolder", syncdata.account);
        let wbxmlData = eas.getDataFromResponse(response);

        eas.checkStatus(syncdata, wbxmlData,"FolderDelete.Status");

        let synckey = xmltools.getWbxmlDataField(wbxmlData,"FolderDelete.SyncKey");
        if (synckey) {
            tbSync.db.setAccountSetting(syncdata.account, "foldersynckey", synckey);
            //this folder is not synced, no target to take care of, just remove the folder
            tbSync.db.deleteFolder(syncdata.account, syncdata.folderID);
            syncdata.folderID = "";
            //update manager gui / folder list
            let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
            observerService.notifyObservers(null, "tbsync.updateAccountSettingsGui", syncdata.account);
            throw eas.finishSync();
        } else {
            throw eas.finishSync("wbxmlmissingfield::FolderDelete.SyncKey", eas.flags.abortWithError);
        }
    }),


    getUserInfo: Task.async (function* (syncdata)  {
        tbSync.setSyncState("prepare.request.getuserinfo", syncdata.account);

        //request foldersync
        let wbxml = wbxmltools.createWBXML();
        wbxml.switchpage("Settings");
        wbxml.otag("Settings");
            wbxml.otag("UserInformation");
                wbxml.atag("Get");
            wbxml.ctag();
        wbxml.ctag();

        tbSync.setSyncState("send.request.getuserinfo", syncdata.account);
        let response = yield eas.sendRequest(wbxml.getBytes(), "Settings", syncdata);


        tbSync.setSyncState("eval.response.getuserinfo", syncdata.account);
        let wbxmlData = eas.getDataFromResponse(response);

        eas.checkStatus(syncdata, wbxmlData,"Settings.Status");

/*        let synckey = xmltools.getWbxmlDataField(wbxmlData,"FolderDelete.SyncKey");
        if (synckey) {
            tbSync.db.setAccountSetting(syncdata.account, "foldersynckey", synckey);
            //this folder is not synced, no target to take care of, just remove the folder
            tbSync.db.deleteFolder(syncdata.account, syncdata.folderID);
            syncdata.folderID = "";
            //update manager gui / folder list
            let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
            observerService.notifyObservers(null, "tbsync.updateAccountSettingsGui", syncdata.account);
            throw eas.finishSync();
        } else {
            throw eas.finishSync("wbxmlmissingfield::FolderDelete.SyncKey", eas.flags.abortWithError);
        }*/
    }),








    getNewDeviceId: function () {
        //taken from https://jsfiddle.net/briguy37/2MVFd/
        let d = new Date().getTime();
        let uuid = 'xxxxxxxxxxxxxxxxyxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            let r = (d + Math.random()*16)%16 | 0;
            d = Math.floor(d/16);
            return (c=='x' ? r : (r&0x3|0x8)).toString(16);
        });
        return "mztb" + uuid;
    },
    
    getNewAccountEntry: function () {
        let row = {
            "account" : "",
            "accountname": "",
            "provider": "eas",
            "policykey" : 0, 
            "foldersynckey" : "0",
            "lastsynctime" : "0", 
            "state" : "disconnected",
            "status" : "notconnected",
            "deviceId" : tbSync.eas.getNewDeviceId(),
            "asversion" : "14.0",
            "host" : "",
            "user" : "",
            "servertype" : "",
            "seperator" : "10",
            "https" : "0",
            "provision" : "1",
            "birthday" : "0",
            "displayoverride" : "0", 
            "downloadonly" : "0",
            "autosync" : "0",
            "horde" : "0"};
        return row;
    },

    getAccountStorageFields: function () {
        return Object.keys(this.getNewAccountEntry()).sort();
    },
    
    logxml : function (wbxml, what) {
        if (tbSync.prefSettings.getBoolPref("log.toconsole") || tbSync.prefSettings.getBoolPref("log.tofile")) {

            //log wbxml
            let charcodes = [];
            for (let i=0; i< wbxml.length; i++) charcodes.push(wbxml.charCodeAt(i).toString(16));
            let bytestring = charcodes.join(" ");
            tbSync.dump(what + " (WBXML)", "\n" + bytestring);

            let rawxml = tbSync.wbxmltools.convert2xml(wbxml);
            if (rawxml === false) {
                tbSync.dump(what +" (XML)", "\nFailed to convert WBXML to XML!\n");
                return;
            }
            
            //raw xml is save xml with all special chars in user data encoded by encodeURIComponent
            let xml = decodeURIComponent(rawxml.split('><').join('>\n<'));
            tbSync.dump(what +" (XML)", "\n" + xml);
        }
    },
 
    getConnection: function(account) {
        let connection = {
            protocol: (tbSync.db.getAccountSetting(account, "https") == "1") ? "https://" : "http://",
            set host(newHost) { tbSync.db.setAccountSetting(account, "host", newHost); },
            get server() { return tbSync.db.getAccountSetting(account, "host"); },
            get host() { return this.protocol + tbSync.db.getAccountSetting(account, "host"); },
            user: tbSync.db.getAccountSetting(account, "user"),
        };
        return connection;
    },

    getHost4PasswordManager: function (accountdata) {
        let parts = accountdata.user.split("@");
        if (parts.length > 1) {
            return "eas://" + parts[1];
        } else {
            return "eas://" + accountdata.accountname;
        }
    },
    
    getPassword: function (accountdata) {
        let host4PasswordManager = tbSync.eas.getHost4PasswordManager(accountdata);
        let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
        let logins = myLoginManager.findLogins({}, host4PasswordManager, null, "TbSync");
        for (let i = 0; i < logins.length; i++) {
            if (logins[i].username == accountdata.user) {
                return logins[i].password;
            }
        }
        //No password found - we should ask for one - this will be triggered by the 401 response, which also catches wrong passwords
        return null;
    },

    setPassword: function (accountdata, newPassword) {
        let host4PasswordManager = tbSync.eas.getHost4PasswordManager(accountdata);
        let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
        let curPassword = tbSync.eas.getPassword(accountdata);
        
        //Is there a loginInfo for this accountdata?
        if (curPassword !== null) {
            //remove current login info
            let currentLoginInfo = new nsLoginInfo(host4PasswordManager, null, "TbSync", accountdata.user, curPassword, "", "");
            try {
                myLoginManager.removeLogin(currentLoginInfo);
            } catch (e) {
                tbSync.dump("Error removing loginInfo", e);
            }
        }
        
        //create loginInfo with new password
        if (newPassword != "") {
            let newLoginInfo = new nsLoginInfo(host4PasswordManager, null, "TbSync", accountdata.user, newPassword, "", "");
            try {
                myLoginManager.addLogin(newLoginInfo);
            } catch (e) {
                tbSync.dump("Error adding loginInfo", e);
            }
        }
    } ,

    parentIsTrash: function (account, parentID) {
        if (parentID == "0") return false;
        if (tbSync.db.getFolder(account, parentID) && tbSync.db.getFolder(account, parentID).type == "4") return true;
        return false;
    },

    getNewFolderEntry: function () {
        let folder = {
            "account" : "",
            "folderID" : "",
            "name" : "",
            "type" : "",
            "synckey" : "",
            "target" : "",
            "selected" : "",
            "lastsynctime" : "",
            "status" : "",
            "parentID" : ""};
        return folder;
    },

    getFixedServerSettings: function(servertype) {
        let settings = {};

        switch (servertype) {
            case "auto":
                settings["host"] = null;
                settings["https"] = null;
                settings["provision"] = null;
                settings["asversion"] = null;
                break;

            //just here for reference, if this method is going to be used again
            case "outlook.com":
                settings["host"] = "eas.outlook.com";
                settings["https"] = "1";
                settings["provision"] = "0";
                settings["asversion"] = "2.5";
                settings["seperator"] = "44";
                break;
        }
        
        return settings;
    },

    removeTarget: function(target, type) {
        switch (type) {
            case "8": //calendar
            case "13":
            case "7": //tasks
            case "15":
                tbSync.removeCalendar(target);
                break;
            case "9":
            case "14":
                tbSync.removeBook(target);
                break;
            default:
                tbSync.dump("eas.removeTarget","Unknown type <"+type+">");
        }
    },

    takeTargetOffline: function(target, type) {
        let d = new Date();
        let suffix = " [lost contact on " + d.getDate().toString().padStart(2,"0") + "." + (d.getMonth()+1).toString().padStart(2,"0") + "." + d.getFullYear() +"]"

        //if there are local changes, append an  (*) to the name of the target
        let c = 0;
        let a = tbSync.db.getItemsFromChangeLog(target, 0, "_by_user");
        for (let i=0; i<a.length; i++) c++;
        if (c>0) suffix += " (*)";

        //TODO/IDEA : We could also try to add each modified item to a  xxx_by_user category, so the user can quickly identify, which data was not synced

        //this is the only place, where we manually have to call clearChangelog, because the target is not deleted (on delete, changelog is cleared automatically)
        tbSync.db.clearChangeLog(target);
        
        switch (type) {
            case "8":
            case "13":
                tbSync.appendSuffixToNameOfCalendar(target, suffix);
                break;
            case "9":
            case "14":
                tbSync.appendSuffixToNameOfBook(target, suffix);
                break;
            default:
                tbSync.dump("eas.takeTargetOffline","Unknown type <"+type+">");
        }
    },

    connectAccount: function (account) {
        db.setAccountSetting(account, "state", "connected");
        db.setAccountSetting(account, "policykey", 0);
        db.setAccountSetting(account, "foldersynckey", "");
    },

    disconnectAccount: function (account) {
        db.setAccountSetting(account, "state", "disconnected"); //connected or disconnected
        db.setAccountSetting(account, "policykey", 0);
        db.setAccountSetting(account, "foldersynckey", "");

        //Delete all targets / folders
        let folders = db.getFolders(account);
        for (let i in folders) {
            if (folders[i].target != "") {
                //the adressbook / calendar listener will delete the folder, if the account is disconnected
                tbSync.eas.removeTarget(folders[i].target, folders[i].type);
            } else {
                db.deleteFolder(account, folders[i].folderID); 
            }
        }

        db.setAccountSetting(account, "status", "notconnected");
    },

    createTCPErrorFromFailedXHR: function (xhr) {
        //adapted from :
        //https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/How_to_check_the_secruity_state_of_an_XMLHTTPRequest_over_SSL		
        let status = xhr.channel.QueryInterface(Components.interfaces.nsIRequest).status;

        if ((status & 0xff0000) === 0x5a0000) { // Security module
            const nsINSSErrorsService = Components.interfaces.nsINSSErrorsService;
            let nssErrorsService = Components.classes['@mozilla.org/nss_errors_service;1'].getService(nsINSSErrorsService);
            
            // NSS_SEC errors (happen below the base value because of negative vals)
            if ((status & 0xffff) < Math.abs(nsINSSErrorsService.NSS_SEC_ERROR_BASE)) {

                // The bases are actually negative, so in our positive numeric space, we
                // need to subtract the base off our value.
                let nssErr = Math.abs(nsINSSErrorsService.NSS_SEC_ERROR_BASE) - (status & 0xffff);
                switch (nssErr) {
                    case 11: return 'security::SEC_ERROR_EXPIRED_CERTIFICATE';
                    case 12: return 'security::SEC_ERROR_REVOKED_CERTIFICATE';
                    case 13: return 'security::SEC_ERROR_UNKNOWN_ISSUER';
                    case 20: return 'security::SEC_ERROR_UNTRUSTED_ISSUER';
                    case 21: return 'security::SEC_ERROR_UNTRUSTED_CERT';
                    case 36: return 'security::SEC_ERROR_CA_CERT_INVALID';
                    case 90: return 'security::SEC_ERROR_INADEQUATE_KEY_USAGE';
                    case 176: return 'security::SEC_ERROR_CERT_SIGNATURE_ALGORITHM_DISABLED';
                }
                return 'security::UNKNOWN_SECURITY_ERROR';
                
            } else {

                // Calculating the difference 		  
                let sslErr = Math.abs(nsINSSErrorsService.NSS_SSL_ERROR_BASE) - (status & 0xffff);		
                switch (sslErr) {
                    case 3: return 'security::SSL_ERROR_NO_CERTIFICATE';
                    case 4: return 'security::SSL_ERROR_BAD_CERTIFICATE';
                    case 8: return 'security::SSL_ERROR_UNSUPPORTED_CERTIFICATE_TYPE';
                    case 9: return 'security::SSL_ERROR_UNSUPPORTED_VERSION';
                    case 12: return 'security::SSL_ERROR_BAD_CERT_DOMAIN';
                }
                return 'security::UNKOWN_SSL_ERROR';
              
            }

        } else { //not the security module
            
            switch (status) {
                case 0x804B000C: return 'network::NS_ERROR_CONNECTION_REFUSED';
                case 0x804B000E: return 'network::NS_ERROR_NET_TIMEOUT';
                case 0x804B001E: return 'network::NS_ERROR_UNKNOWN_HOST';
                case 0x804B0047: return 'network::NS_ERROR_NET_INTERRUPT';
            }
            return 'network::UNKNOWN_NETWORK_ERROR';

        }
        return null;	 
    },

    TimeZoneDataStructure : class {
        constructor() {
            this.buf = new DataView(new ArrayBuffer(172));
        }
        
        /* Buffer structure:
         @000    utcOffset (4x8bit as 1xLONG)
        
        @004     standardName (64x8bit as 32xWCHAR)
        @068     standardDate (16x8 as 1xSYSTEMTIME)
        @084     standardBias (4x8bit as 1xLONG)
        
        @088     daylightName (64x8bit as 32xWCHAR)
        @152    daylightDate (16x8 as 1xSTRUCT)
        @168    daylightBias (4x8bit as 1xLONG)
        */
        
        set easTimeZone64 (b64) {
            //clear buffer
            for (let i=0; i<172; i++) this.buf.setUint8(i, 0);
            //load content into buffer
            let content = (b64 == "") ? "" : atob(b64);
            for (let i=0; i<content.length; i++) this.buf.setUint8(i, content.charCodeAt(i));
        }
        
        get easTimeZone64 () {
            let content = "";
            for (let i=0; i<172; i++) content += String.fromCharCode(this.buf.getUint8(i));
            return (btoa(content));
        }
        
        getstr (byteoffset) {
            let str = "";
            //walk thru the buffer in 32 steps of 16bit (wchars)
            for (let i=0;i<32;i++) {
                let cc = this.buf.getUint16(byteoffset+i*2, true);
                if (cc == 0) break;
                str += String.fromCharCode(cc);
            }
            return str;
        }

        setstr (byteoffset, str) {
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
        }
        
        getsystemtime (buf, offset) {
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
        }
        
        get standardDate () {return this.getsystemtime (this.buf, 68); }
        get daylightDate () {return this.getsystemtime (this.buf, 152); }
            
        get utcOffset () { return this.buf.getInt32(0, true); }
        set utcOffset (v) { this.buf.setInt32(0, v, true); }

        get standardBias () { return this.buf.getInt32(84, true); }
        set standardBias (v) { this.buf.setInt32(84, v, true); }
        get daylightBias () { return this.buf.getInt32(168, true); }
        set daylightBias (v) { this.buf.setInt32(168, v, true); }
        
        get standardName () {return this.getstr(4); }
        set standardName (v) {return this.setstr(4, v); }
        get daylightName () {return this.getstr(88); }
        set daylightName (v) {return this.setstr(88, v); }
        
        toString () { return "[" + [this.standardName, this.daylightName, this.utcOffset, this.standardBias, this.daylightBias].join("|") + "]"; }
    },






    sendRequest: function (wbxml, command, syncdata) {
        let platformVer = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo).platformVersion;                  
        let msg = "Sending data <" + syncdata.state.split("||")[0] + "> for " + tbSync.db.getAccountSetting(syncdata.account, "accountname");
        if (syncdata.folderID !== "") msg += " (" + tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name") + ")";
        tbSync.eas.logxml(wbxml, msg);

        let connection = tbSync.eas.getConnection(syncdata.account);
        let password = tbSync.eas.getPassword(tbSync.db.getAccount(syncdata.account));

        let deviceType = tbSync.prefSettings.getCharPref("clientID.type");
        let userAgent = tbSync.prefSettings.getCharPref("clientID.useragent"); //plus calendar.useragent.extra = Lightning/5.4.5.2
        if (deviceType == "") deviceType = "Thunderbird";
        if (userAgent == "") userAgent = "Thunderbird ActiveSync";

        let deviceId = tbSync.db.getAccountSetting(syncdata.account, "deviceId");

        tbSync.dump("Sending (EAS v"+tbSync.db.getAccountSetting(syncdata.account, "asversion") +")", "POST " + connection.host + '/Microsoft-Server-ActiveSync?Cmd=' + command + '&User=' + encodeURIComponent(connection.user) + '&DeviceType=' +deviceType + '&DeviceId=' + deviceId, true);
        
        return new Promise(function(resolve,reject) {
            // Create request handler
            syncdata.req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
            syncdata.req.mozBackgroundRequest = true;
            syncdata.req.open("POST", connection.host + '/Microsoft-Server-ActiveSync?Cmd=' + command + '&User=' + encodeURIComponent(connection.user) + '&DeviceType=' +encodeURIComponent(deviceType) + '&DeviceId=' + deviceId, true);
            syncdata.req.overrideMimeType("text/plain");
            syncdata.req.setRequestHeader("User-Agent", userAgent);
            syncdata.req.setRequestHeader("Content-Type", "application/vnd.ms-sync.wbxml");
            syncdata.req.setRequestHeader("Authorization", 'Basic ' + btoa(connection.user + ':' + password));
            if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") {
                syncdata.req.setRequestHeader("MS-ASProtocolVersion", "2.5");
            } else {
                syncdata.req.setRequestHeader("MS-ASProtocolVersion", "14.0");
            }
            syncdata.req.setRequestHeader("Content-Length", wbxml.length);
            if (tbSync.db.getAccountSetting(syncdata.account, "provision") == "1") {
                syncdata.req.setRequestHeader("X-MS-PolicyKey", tbSync.db.getAccountSetting(syncdata.account, "policykey"));
                tbSync.dump("PolicyKey used",tbSync.db.getAccountSetting(syncdata.account, "policykey"));
            }

            syncdata.req.timeout = tbSync.prefSettings.getIntPref("eas.timeout");

            syncdata.req.ontimeout = function () {
                reject(eas.finishSync("timeout", eas.flags.abortWithError));
            };

            syncdata.req.onerror = function () {
                let error = tbSync.eas.createTCPErrorFromFailedXHR(syncdata.req);
                if (!error) {
                    reject(eas.finishSync("networkerror", eas.flags.abortWithError));
                } else {
                    reject(eas.finishSync(error, eas.flags.abortWithError));
                }
            };

            syncdata.req.onload = function() {
                let response = syncdata.req.responseText;
                switch(syncdata.req.status) {

                    case 200: //OK
                        let msg = "Receiving data <" + syncdata.state.split("||")[0] + "> for " + tbSync.db.getAccountSetting(syncdata.account, "accountname");
                        if (syncdata.folderID !== "") msg += " (" + tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name") + ")";
                        tbSync.eas.logxml(response, msg);

                        //What to do on error? IS this an error? Yes!
                        if (response.length !== 0 && response.substr(0, 4) !== String.fromCharCode(0x03, 0x01, 0x6A, 0x00)) {
                            tbSync.dump("Recieved Data", "Expecting WBXML but got - " + response + ", request status = " + syncdata.req.status + ", ready state = " + syncdata.req.readyState);
                            //Freenet.de hack - if we got back junk, the password is probably wrong. we need to stop anyhow, due to this error
                            tbSync.dump("Recieved Data", "We got back junk, which *could* mean, the password is wrong. Prompting.");
                            reject(eas.finishSync(401, eas.flags.abortWithError));
                        } else {
                            resolve(response);
                        }
                        break;

                    case 401: // AuthError
                        reject(eas.finishSync(syncdata.req.status, eas.flags.abortWithError));
                        break;

                    case 449: // Request for new provision (enable it if needed)
                        //enable provision
                        tbSync.db.setAccountSetting(syncdata.account, "provision","1");
                        //reset policykey
                        tbSync.db.setAccountSetting(syncdata.account, "policykey", 0);
                        reject(eas.finishSync(syncdata.req.status, eas.flags.resyncAccount));
                        break;

                    case 451: // Redirect - update host and login manager 
                        let header = syncdata.req.getResponseHeader("X-MS-Location");
                        let newHost = header.slice(header.indexOf("://") + 3, header.indexOf("/M"));
                        let connection = tbSync.eas.getConnection(syncdata.account);

                        tbSync.dump("redirect (451)", "header: " + header + ", oldHost: " + connection.host + ", newHost: " + newHost);

                        //Since we do not use the actual host in the LoginManager (but the FQDN part of the user name), a changing host
                        //does not affect the loginmanager - no further action needed
                        connection.host = newHost;

                        reject(eas.finishSync(syncdata.req.status, eas.flags.resyncAccount));
                        break;
                        
                    default:
                        reject(eas.finishSync("httperror::" + syncdata.req.status, eas.flags.abortWithError));
                }
            };

            if (platformVer >= 50) {
                syncdata.req.send(wbxml);
            } else {
                //from each char in the string, only use the lowest 8bit - why?
                let nBytes = wbxml.length;
                let ui8Data = new Uint8Array(nBytes);
                for (let nIdx = 0; nIdx < nBytes; nIdx++) {
                    ui8Data[nIdx] = wbxml.charCodeAt(nIdx) & 0xff;
                }
                syncdata.req.send(ui8Data);
            }
            
        });
    },

    //returns false on parse error and null on empty response (if allowed)
    getDataFromResponse: function (wbxml, allowEmptyResponse = !eas.flags.allowEmptyResponse) {        
        //check for empty wbxml
        if (wbxml.length === 0) {
            if (allowEmptyResponse) return null;
            else throw eas.finishSync("empty-response", eas.flags.abortWithError);
        }

        //convert to save xml (all special chars in user data encoded by encodeURIComponent) and check for parse errors
        let xml = wbxmltools.convert2xml(wbxml);
        if (xml === false) {
            throw eas.finishSync("wbxml-parse-error", eas.flags.abortWithError);
        }
        
        //retrieve data and check for empty data (all returned data fields are already decoded by decodeURIComponent)
        let wbxmlData = xmltools.getDataFromXMLString(xml);
        if (wbxmlData === null) {
            if (allowEmptyResponse) return null;
            else throw eas.finishSync("response-contains-no-data", eas.flags.abortWithError);
        }
        
        //debug
        xmltools.printXmlData(wbxmlData);
        return wbxmlData;
    },
    
    checkStatus : function (syncdata, wbxmlData, path, rootpath="", allowSoftFail = true) {
        //path is relative to wbxmlData
        //rootpath is the absolute path and must be specified, if wbxml is not the root node and thus path is not the rootpath	    
        let status = xmltools.getWbxmlDataField(wbxmlData,path);
        let fullpath = (rootpath=="") ? path : rootpath;
        let elements = fullpath.split(".");
        let type = elements[0];

        //check if fallback to main class status: the answer could just be a "Sync.Status" instead of a "Sync.Collections.Collections.Status"
        if (status === false) {
            let mainStatus = xmltools.getWbxmlDataField(wbxmlData, type + "." + elements[elements.length-1]);
            if (mainStatus === false) {
                //both possible status fields are missing, report and abort
                tbSync.dump("wbxml status", "Server response does not contain mandatory <"+fullpath+"> field . Error? Aborting Sync.");
                throw eas.finishSync("wbxmlmissingfield::" + fullpath, eas.flags.abortWithError);
            } else {
                //the alternative status could be extracted
                status = mainStatus;
                fullpath = type + "." + elements[elements.length-1];
            }
        }

        //check if all is fine (not bad)
        if (status == "1") {
            return true;
        }

        tbSync.dump("wbxml status check", type + ": " + fullpath + " = " + status);

        //handle errrors based on type
        switch (type+":"+status) {
            case "Sync:3": /*
                        MUST return to SyncKey element value of 0 for the collection. The client SHOULD either delete any items that were added 
                        since the last successful Sync or the client MUST add those items back to the server after completing the full resynchronization
                        */
                tbSync.dump("wbxml status", "Server reports <invalid synchronization key> (" + fullpath + " = " + status + "), resyncing.");
                throw eas.finishSync(type+":"+status, eas.flags.resyncFolder);
            
            case "Sync:6":
                //Server does not accept one of our items, we want to continue syncing, move the element to the end of the changelog
                //and if we hit it again (everything else synced fine), abort (must be handled by caller)
                if (allowSoftFail) return false;
                break;
		
            case "Sync:8": // Object not found - takeTargetOffline and remove folder
                tbSync.dump("wbxml status", "Server reports <object not found> (" +  tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name") + "), keeping local copy and removing folder.");
                let folder = tbSync.db.getFolder(syncdata.account, syncdata.folderID);
                if (folder !== null) {
                    let target = folder.target;
                    //deselect folder
                    folder.selected = "0";
                    folder.target = "";
                    //if target exists, take it offline
                    if (target != "") tbSync.eas.takeTargetOffline(target, folder.type);
                    tbSync.db.deleteFolder(syncdata.account, syncdata.folderID);
                    //folder is no longer there, unset current folder
                    syncdata.folderID = "";
                }
                throw eas.finishSync();

            case "Sync:12": /*
                        Perform a FolderSync command and then retry the Sync command. (is "resync" here)
                        */
                tbSync.dump("wbxml status", "Server reports <folder hierarchy changed> (" + fullpath + " = " + status + "), resyncing");
                throw eas.finishSync(type+":"+status, eas.flags.resyncAccount);

            
            case "FolderDelete:3": // special system folder - fatal error
                throw eas.finishSync("folderDelete.3");

            case "FolderDelete:6": // error on server
                throw eas.finishSync("folderDelete.6");

            case "FolderDelete:4": // folder does not exist - resync ( we allow delete only if folder is not subscribed )
            case "FolderDelete:9": // invalid synchronization key - resync
            case "FolderSync:9": // invalid synchronization key - resync
                throw eas.finishSync(type+":"+status, eas.flags.resyncAccount);
        }
        
        //handle global error (https://msdn.microsoft.com/en-us/library/ee218647(v=exchg.80).aspx)
        switch(status) {
            case "101": //invalid content
            case "102": //invalid wbxml
            case "103": //invalid xml
                throw eas.finishSync("global." + status, eas.flags.abortWithError);

            case "110": //server error - resync
                throw eas.finishSync(type+":"+status, eas.flags.resyncAccount);

            case "142": // DeviceNotProvisioned
            case "143": // PolicyRefresh
            case "144": // InvalidPolicyKey
                //enable provision
                tbSync.db.setAccountSetting(syncdata.account, "provision","1");
                //reset policykey
                tbSync.db.setAccountSetting(syncdata.account, "policykey", 0);
                throw eas.finishSync(type+":"+status, eas.flags.resyncAccount);
            
            default:
                tbSync.dump("wbxml status", "Server reports unhandled status <" + fullpath + " = " + status + ">. Aborting Sync.");
                throw eas.finishSync("wbxmlerror::" + fullpath + " = " + status, eas.flags.abortWithError);

        }		
    },
    
};
    

tbSync.includeJS("chrome://tbsync/content/provider/eas/sync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/tasksync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/calendarsync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/contactsync.js");
