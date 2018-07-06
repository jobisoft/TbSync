"use strict";

tbSync.includeJS("chrome://tbsync/content/provider/eas/wbxmltools.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/xmltools.js");

var eas = {
    bundle: Services.strings.createBundle("chrome://tbsync/locale/eas.strings"),
    //use flags instead of strings to avoid errors due to spelling errors
    flags : Object.freeze({
        allowEmptyResponse: true, 
        syncNextFolder: "syncNextFolder",
        resyncFolder: "resyncFolder",
        resyncAccount: "resyncAccount", 
        abortWithError: "abortWithError",
        abortWithServerError: "abortWithServerError",
    }),
    

    init: Task.async (function* ()  {
        //dynamically load overlays from xpi
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abEditCardDialog.xul", "chrome://tbsync/content/provider/eas/overlays/abCardWindow.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://tbsync/content/provider/eas/overlays/abCardWindow.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://tbsync/content/provider/eas/overlays/addressbookoverlay.xul");

        //fix criticalBug introduced by changing DeviceType, deviceType now is part of the account data
        let showMigrationPopup = false;
        let accounts = tbSync.db.getAccounts();
        for (let i = 0; i < accounts.IDs.length; i++) {
            if (accounts.data[accounts.IDs[i]].provider == "eas" && !accounts.data[accounts.IDs[i]].hasOwnProperty("devicetype")) {
                showMigrationPopup = true;

                //remove all folders, disable account, set to fixed, create new deviceID
                tbSync.db.setAccountSetting(accounts.IDs[i], "deviceId", tbSync.eas.getNewDeviceId());
                tbSync.db.setAccountSetting(accounts.IDs[i], "useragent", tbSync.prefSettings.getCharPref("eas.clientID.useragent"));
                tbSync.db.setAccountSetting(accounts.IDs[i], "devicetype", tbSync.prefSettings.getCharPref("eas.clientID.type"));                 
                tbSync.db.setAccountSetting(accounts.IDs[i], "status", "disabled");
                tbSync.db.setAccountSetting(accounts.IDs[i], "policykey", 0);
                tbSync.db.setAccountSetting(accounts.IDs[i], "foldersynckey", "");
                    
                let folders = tbSync.db.getFolders(accounts.IDs[i]);
                for (let f in folders) {
                    //rename target if it exists
                    tbSync.takeTargetOffline("eas", folders[f].target, folders[f].type, " [emergency backup by TbSync]");
                    //remove folder
                    tbSync.db.deleteFolder(accounts.IDs[i], folders[f].folderID);
                }		    
            }
        }
        if (showMigrationPopup) tbSync.window.alert(tbSync.getLocalizedMessage("migrate"));        
    }),


    //this is  called, after lighning has become available - it is called by tbSync.onLightningLoad
    init4lightning: Task.async (function* () {
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
    }),

    createCalendar: function(account, folderID, color, newname) {
        //Alternative calendar, which uses calTbSyncCalendar
        //let newCalendar = calManager.createCalendar("TbSync", Services.io.newURI('tbsync-calendar://'));

        //Create the new standard calendar with a unique name
        let calManager = cal.getCalendarManager();
        let newCalendar = calManager.createCalendar("storage", Services.io.newURI("moz-storage-calendar://"));
        newCalendar.id = cal.getUUID();
        newCalendar.name = newname;

        newCalendar.setProperty("color", color); //any chance to get the color from the provider? pass via folderSetting
        newCalendar.setProperty("relaxedMode", true); //sometimes we get "generation too old for modifyItem", check can be disabled with relaxedMode
        newCalendar.setProperty("calendar-main-in-composite",true);

        return newCalendar;
    },

    createCalendarPostAction: function(account, folderID, newCalendar) {
        //is there an email identity we can associate this calendar to? 
        //getIdentityKey returns "" if none found, which removes any association
        let key = tbSync.getIdentityKey(tbSync.db.getAccountSetting(account, "user"));
        newCalendar.setProperty("fallbackOrganizerName", newCalendar.getProperty("organizerCN"));
        newCalendar.setProperty("imip.identity.key", key);
        if (key === "") {
            //there is no matching email identity - use current default value as best guess and remove association
            //use current best guess 
            newCalendar.setProperty("organizerCN", newCalendar.getProperty("fallbackOrganizerName"));
            newCalendar.setProperty("organizerId", cal.prependMailTo(tbSync.db.getAccountSetting(account, "user")));
        }
    },

    getThunderbirdFolderType: function(type) {
        switch (type) {
            case "9": 
            case "14": 
                return "tb-contact";
            case "8":
            case "13":
                return "tb-event";
            case "7":
            case "15":
                return "tb-todo";
            default:
                return "unknown ("+type + ")";
        };
    },




    //CORE SYNC LOOP FUNCTION
    start: Task.async (function* (syncdata, job)  {
        let accountReSyncs = 0;
        
        do {
            try {
                accountReSyncs++;
                syncdata.todo = 0;
                syncdata.done = 0;

                if (accountReSyncs > 3) {
                    throw eas.finishSync("resync-loop", eas.flags.abortWithError);
                }

                // check if enabled
                if (!tbSync.isEnabled(syncdata.account)) {
                    throw eas.finishSync("disabled", eas.flags.abortWithError);
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
                
                //should we recheck options/commands?
                if ((Date.now() - tbSync.db.getAccountSetting(syncdata.account, "lastEasOptionsUpdate")) > 86400000 ) {
                    yield eas.getServerOptions(syncdata);
                }
                
                //update "live" setting from UI
                if (!tbSync.isConnected(syncdata.account)) {
                    db.setAccountSetting(syncdata.account, "asversion", db.getAccountSetting(syncdata.account, "asversionselected"));
                }
                
                //check EAS version - "auto" means we just enabled and have to find the best option avail, any other value needs to be checked agains options avail
                let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");
                let allowed = tbSync.db.getAccountSetting(syncdata.account, "allowedEasVersions").split(",");
                if (asversion == "auto") {
                    if (allowed.includes("14.0")) tbSync.db.setAccountSetting(syncdata.account, "asversion","14.0");
                    else if (allowed.includes("2.5")) tbSync.db.setAccountSetting(syncdata.account, "asversion","2.5");
                    else if (allowed == "") {
                        throw eas.finishSync("InvalidServerOptions", eas.flags.abortWithError);
                    } else {
                        throw eas.finishSync("nosupportedeasversion::"+allowed.join(","), eas.flags.abortWithError);
                    }
                } else if (allowed != "" && !allowed.includes(asversion)) {
                    throw eas.finishSync("notsupportedeasversion::"+asversion+"::"+allowed.join(","), eas.flags.abortWithError);
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

                    case eas.flags.abortWithServerError: 
                        //Could not connect to server. Can we rerun autodiscover? If not, fall through to abortWithError              
                        if (tbSync.db.getAccountSetting(syncdata.account, "servertype") == "auto") {
                            let errorcode = yield eas.updateServerConnectionViaAutodiscover(syncdata);
                            switch (errorcode) {
                                case 401:
                                case 403: //failed to authenticate
                                    tbSync.finishAccountSync(syncdata, "401");
                                    return;                            
                                case 200: //server and/or user was updated, retry
                                    Services.obs.notifyObservers(null, "tbsync.updateAccountSettingsGui", syncdata.account);
                                    continue;
                                default: //autodiscover failed, fall through to abortWithError
                            }                        
                        }

                    case eas.flags.abortWithError: //fatal error, finish account sync
                    case eas.flags.syncNextFolder: //no more folders left, finish account sync
                    case eas.flags.resyncFolder: //should not happen here, just in case
                        tbSync.finishAccountSync(syncdata, report.message);
                        return;

                    default:
                        //there was some other error
                        Components.utils.reportError(report);
                        tbSync.finishAccountSync(syncdata, "javascriptError");
                        return;
                }

            }

        } while (true);

    }),

    getPendingFolders: Task.async (function* (syncdata)  {
        //this function sets all folders which ougth to be synced to pending, either a specific one (if folderID is set) or all avail
        if (syncdata.folderID != "") {
            //just set the specified folder to pending
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "status", "pending");
        } else {
            //scan all folders and set the enabled ones to pending
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
                        newData.downloadonly = tbSync.db.getAccountSetting(syncdata.account, "downloadonly"); //each folder has its own settings, the main setting is just the default

                        //if there is a cached version of this folder, take selection state from there
                        if (tbSync.db.getAccountSetting(syncdata.account, "syncdefaultfolders") == "1") {
                            let cachedFolders = tbSync.db.findFoldersWithSetting(["cached","name","account","type"], ["1", newData.name,  newData.account, newData.type], "provider", "eas");
                            if (cachedFolders && cachedFolders.length == 1) {
                                newData.selected = cachedFolders[0].selected;
                                newData.targetName = cachedFolders[0].targetName ? cachedFolders[0].targetName : "";
                                newData.targetColor = cachedFolders[0].targetColor ? cachedFolders[0].targetColor : "";
                            }
                            else newData.selected = (newData.type == "9" || newData.type == "8" || newData.type == "7" ) ? "1" : "0";
                        } else newData.selected = "0";
                        
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
                            tbSync.takeTargetOffline("eas", target, folder.type);
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
                            tbSync.takeTargetOffline("eas", target, folder.type);

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
                        tbSync.takeTargetOffline("eas", target, folder.type);
                        //delete folder in account manager
                        tbSync.db.deleteFolder(syncdata.account, del[count].ServerId);
                    } else {
                        //cannot del an non-existing folder - do nothing
                    }
                }
            }

            
            //special action during resync: remove all folders from db, which have not been added by server (thus are no longer there)
            if (syncdata.accountResync) {
                let folders = tbSync.db.getFolders(syncdata.account);
                for (let f in folders) {
                    if (!addedFolders.includes(folders[f].folderID)) {
                        //if target exists, take it offline
                        tbSync.takeTargetOffline("eas", folders[f].target, folders[f].type);
                        //delete folder in account manager
                        tbSync.db.deleteFolder(syncdata.account, folders[f].folderID);
                    }
                }
            }
            
            tbSync.setSelectedFoldersToPending(syncdata.account);            
        }
    }),

    //Process all folders with PENDING status
    syncPendingFolders: Task.async (function* (syncdata)  {
        let folderReSyncs = 1;
        
        do {                
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
                    throw eas.finishSync("resync-loop");
                }

                syncdata.synckey = folders[0].synckey;
                syncdata.folderID = folders[0].folderID;
                //get syncdata type, which is also used in WBXML for the CLASS element
                switch (eas.getThunderbirdFolderType(folders[0].type)) {
                    case "tb-contact": 
                        syncdata.type = "Contacts";
                        break;
                    case "tb-event":
                        syncdata.type = "Calendar";
                        break;
                    case "tb-todo":
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
                        // check SyncTarget
                        if (!tbSync.checkAddressbook(syncdata.account, syncdata.folderID)) {
                            throw eas.finishSync("notargets");
                        }

                        //get sync target of this addressbook
                        syncdata.targetId = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target");
                        syncdata.addressbookObj = tbSync.getAddressBookObject(syncdata.targetId);

                        //promisify addressbook, so it can be used together with yield
                        syncdata.targetObj = tbSync.promisifyAddressbook(syncdata.addressbookObj);
                        
                        yield eas.sync.start(syncdata);   //using new tbsync contacts sync code
                        break;

                    case "Calendar":
                    case "Tasks": 
                        // skip if lightning is not installed
                        if (tbSync.lightningIsAvailable() == false) {
                            throw eas.finishSync("nolightning");
                        }
                        
                        // check SyncTarget
                        if (!tbSync.checkCalender(syncdata.account, syncdata.folderID)) {
                            throw eas.finishSync("notargets");
                        }

                        syncdata.targetId = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target");
                        syncdata.calendarObj = cal.getCalendarManager().getCalendarById(syncdata.targetId);
                        
                        //promisify calender, so it can be used together with yield
                        syncdata.targetObj = cal.async.promisifyCalendar(syncdata.calendarObj.wrappedJSObject);

                        syncdata.calendarObj.startBatch();
                        yield eas.sync.start(syncdata);
                        syncdata.calendarObj.endBatch();

                        break;
                }

            } catch (report) { 

                switch (report.type) {
                    case eas.flags.abortWithError:  //if there was a fatal error during folder sync, re-throw error to finish account sync (with error)
                    case eas.flags.abortWithServerError:
                    case eas.flags.resyncAccount:   //if the entire account needs to be resynced, finish this folder and re-throw account (re)sync request                                                    
                        tbSync.finishFolderSync(syncdata, report.message);
                        throw eas.finishSync(report.message, report.type);
                        break;

                    case eas.flags.syncNextFolder:
                        tbSync.finishFolderSync(syncdata, report.message);
                        break;
                                            
                    case eas.flags.resyncFolder:
                        //reset synckey to indicate "resync" and sync this folder again
                        tbSync.dump("Folder Resync", "Account: " + tbSync.db.getAccountSetting(syncdata.account, "accountname") + ", Folder: "+ tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name") + ", Reason: " + report.message);
                        tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", "");
                        continue;
                    
                    default:
                        Components.utils.reportError(report);
                        let msg = "javascriptError";
                        tbSync.finishFolderSync(syncdata, msg);
                        //this is a fatal error, re-throw error to finish account sync
                        throw eas.finishSync(msg, eas.flags.abortWithError);
                }

            }

        }
        while (true);
    }),










    //WBXML FUNCTIONS
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

    getItemEstimate: Task.async (function* (syncdata)  {
        syncdata.todo = -1;
        
        if (!tbSync.db.getAccountSetting(syncdata.account, "allowedEasCommands").split(",").includes("GetItemEstimate")) {
            return; //do not throw, this is optional
        }
        
        tbSync.setSyncState("prepare.request.estimate", syncdata.account, syncdata.folderID);
        
        // BUILD WBXML
        let wbxml = tbSync.wbxmltools.createWBXML();
        wbxml.switchpage("GetItemEstimate");
        wbxml.otag("GetItemEstimate");
            wbxml.otag("Collections");
                wbxml.otag("Collection");
                    if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") { //got order for 2.5 directly from Microsoft support
                        wbxml.atag("Class", syncdata.type); //only 2.5
                        wbxml.atag("CollectionId", syncdata.folderID);
                        wbxml.switchpage("AirSync");
                        wbxml.atag("FilterType", tbSync.prefSettings.getIntPref("eas.synclimit").toString());
                        wbxml.atag("SyncKey", syncdata.synckey);
                        wbxml.switchpage("GetItemEstimate");
                    } else { //14.0
                        wbxml.switchpage("AirSync");
                        wbxml.atag("SyncKey", syncdata.synckey);
                        wbxml.switchpage("GetItemEstimate");
                        wbxml.atag("CollectionId", syncdata.folderID);
                        wbxml.switchpage("AirSync");
                        wbxml.otag("Options");
                            if (syncdata.type == "Calendar") wbxml.atag("FilterType", tbSync.prefSettings.getIntPref("eas.synclimit").toString()); //0, 4,5,6,7
                            wbxml.atag("Class", syncdata.type);
                        wbxml.ctag();
                        wbxml.switchpage("GetItemEstimate");
                    }
                wbxml.ctag();
            wbxml.ctag();
        wbxml.ctag();

        //SEND REQUEST
        tbSync.setSyncState("send.request.estimate", syncdata.account, syncdata.folderID);
        let response = yield eas.sendRequest(wbxml.getBytes(), "GetItemEstimate", syncdata, /* allowSoftFail */ true);

        //VALIDATE RESPONSE
        tbSync.setSyncState("eval.response.estimate", syncdata.account, syncdata.folderID);

        // get data from wbxml response, some servers send empty response if there are no changes, which is not an error
        let wbxmlData = eas.getDataFromResponse(response, eas.flags.allowEmptyResponse);
        if (wbxmlData === null) return;

        let status = xmltools.getWbxmlDataField(wbxmlData, "GetItemEstimate.Response.Status");
        let estimate = xmltools.getWbxmlDataField(wbxmlData, "GetItemEstimate.Response.Collection.Estimate");

        if (status && status == "1") { //do not throw on error, with EAS v2.5 I get error 2 for tasks and calendars ???
            syncdata.todo = estimate;
        }
    }),

    getUserInfo: Task.async (function* (syncdata)  {
        if (!tbSync.db.getAccountSetting(syncdata.account, "allowedEasCommands").split(",").includes("Settings")) {
            return;
        }

        tbSync.setSyncState("prepare.request.getuserinfo", syncdata.account);

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
    }),

    abServerSearch: Task.async (function* (account, currentQuery)  {
        if (!tbSync.db.getAccountSetting(account, "allowedEasCommands").split(",").includes("Search")) {
            return null;
        }

        let wbxml = wbxmltools.createWBXML();
        wbxml.switchpage("Search");
        wbxml.otag("Search");
            wbxml.otag("Store");
                wbxml.atag("Name", "GAL");
                wbxml.atag("Query", currentQuery);
                wbxml.otag("Options");
                    wbxml.atag("DeepTraversal");
                    wbxml.atag("RebuildResults");
                wbxml.ctag();
            wbxml.ctag();
        wbxml.ctag();

        let syncdata = {};
        syncdata.account = account;
        syncdata.folderID = "";
        syncdata.syncstate = "SearchingGAL";
        
            
        let response = yield eas.sendRequest(wbxml.getBytes(), "Search", syncdata);
        let wbxmlData = eas.getDataFromResponse(response);

        return xmltools.nodeAsArray(wbxmlData.Search.Response.Store.Result);
    }),

    deleteFolder: Task.async (function* (syncdata)  {
        if (syncdata.folderID == "") {
            throw eas.finishSync();
        } 
        
        if (!tbSync.db.getAccountSetting(syncdata.account, "allowedEasCommands").split(",").includes("FolderDelete")) {
            throw eas.finishSync("notsupported::FolderDelete", eas.flags.abortWithError);
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
            Services.obs.notifyObservers(null, "tbsync.updateAccountSettingsGui", syncdata.account);
            throw eas.finishSync();
        } else {
            throw eas.finishSync("wbxmlmissingfield::FolderDelete.SyncKey", eas.flags.abortWithError);
        }
    }),










    // SYNC GLUE FUNCTIONS
    finishSync: function (msg = "", type = eas.flags.syncNextFolder) {
        let e = new Error(); 
        e.type = type;
        e.message = msg;
        return e; 
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
            "status" : "disabled",
            "deviceId" : tbSync.eas.getNewDeviceId(),
            "asversionselected" : "auto",
            "asversion" : "",
            "host" : "",
            "user" : "",
            "servertype" : "",
            "seperator" : "10",
            "https" : "1",
            "syncdefaultfolders" : "1",
            "provision" : "0",
            "birthday" : "0",
            "displayoverride" : "0", 
            "downloadonly" : "0",
            "autosync" : "0",
            "horde" : "0",
            "lastEasOptionsUpdate":"0",
            "allowedEasVersions": "",
            "allowedEasCommands": "",
            "useragent": tbSync.prefSettings.getCharPref("eas.clientID.useragent"),
            "devicetype": tbSync.prefSettings.getCharPref("eas.clientID.type")}; 
        return row;
    },

    getAccountStorageFields: function () {
        return Object.keys(this.getNewAccountEntry()).sort();
    },
    
    logxml : function (wbxml, what) {
        //include xml in log, if userdatalevel 2 or greater
        if ((tbSync.prefSettings.getBoolPref("log.toconsole") || tbSync.prefSettings.getBoolPref("log.tofile")) && tbSync.prefSettings.getIntPref("log.userdatalevel")>1) {

            //log aw wbxml if userdatalevel is 3 or greater
            if (tbSync.prefSettings.getIntPref("log.userdatalevel")>2) {
                let charcodes = [];
                for (let i=0; i< wbxml.length; i++) charcodes.push(wbxml.charCodeAt(i).toString(16));
                let bytestring = charcodes.join(" ");
                tbSync.dump("WBXML: " + what, "\n" + bytestring);
            }

            let rawxml = tbSync.wbxmltools.convert2xml(wbxml);
            if (rawxml === false) {
                tbSync.dump(what +" (XML)", "\nFailed to convert WBXML to XML!\n");
                return;
            }
            
            //raw xml is save xml with all special chars in user data encoded by encodeURIComponent - KEEP that in order to be able to analyze logged XML 
            //let xml = decodeURIComponent(rawxml.split('><').join('>\n<'));
            let xml = rawxml.split('><').join('>\n<');
            tbSync.dump("XML: " + what, "\n" + xml);
        }
    },
 
    getConnection: function(account) {
        let connection = {
            protocol: (tbSync.db.getAccountSetting(account, "https") == "1") ? "https://" : "http://",
            set host(newHost) { tbSync.db.setAccountSetting(account, "host", newHost); },
            get server() { return tbSync.db.getAccountSetting(account, "host"); },
            get host() { 
                let h = this.protocol + tbSync.db.getAccountSetting(account, "host"); 
                if (h.endsWith("Microsoft-Server-ActiveSync")) return h;
                
                while (h.endsWith("/")) { h = h.slice(0,-1); }
                return h + "/Microsoft-Server-ActiveSync"; 
            },
            user: tbSync.db.getAccountSetting(account, "user"),
        };
        return connection;
    },    

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
            "targetName" : "",
            "targetColor" : "",
            "selected" : "",
            "lastsynctime" : "",
            "status" : "",
            "parentID" : "",
            "downloadonly" : "0",
            "cached" : "0"};
        return folder;
    },

    getFixedServerSettings: function(servertype) {
        let settings = {};

        switch (servertype) {
            case "auto":
                settings["host"] = null;
                settings["https"] = null;
                settings["asversionselected"] = null;
                break;

            //just here for reference, if this method is going to be used again
            case "outlook.com":
                settings["host"] = "eas.outlook.com";
                settings["https"] = "1";
                settings["asversionselected"] = "2.5";
                settings["seperator"] = "44";
                break;
        }
        
        return settings;
    },

    enableAccount: function (account) {
        db.setAccountSetting(account, "status", "notsyncronized");
        db.setAccountSetting(account, "policykey", 0);
        db.setAccountSetting(account, "foldersynckey", "");
        db.setAccountSetting(account, "lastEasOptionsUpdate", "0");
        db.setAccountSetting(account, "lastsynctime", "0");
    },

    disableAccount: function (account) {
        db.setAccountSetting(account, "status", "disabled");
        db.setAccountSetting(account, "policykey", 0);
        db.setAccountSetting(account, "foldersynckey", "");

        //remove all folders from DB and remove associated targets (cache folders, if syncdefaultfolders set) 
        tbSync.removeAllFolders(account);
    },

    TimeZoneDataStructure : class {
        constructor() {
            this.buf = new DataView(new ArrayBuffer(172));
        }
        
/*		
        Buffer structure:
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
                toString() { return [this.wYear, this.wMonth, this.wDay].join("-") + ", " + this.wDayOfWeek + ", " + [this.wHour,this.wMinute,this.wSecond].join(":") + "." + this.wMilliseconds},

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
        
        toString () { return ["", 
            "utcOffset: "+ this.utcOffset,
            "standardName: "+ this.standardName,
            "standardDate: "+ this.standardDate.toString(),
            "standardBias: "+ this.standardBias,
            "daylightName: "+ this.daylightName,
            "daylightDate: "+ this.daylightDate.toString(),
            "daylightBias: "+ this.daylightBias].join("\n"); }
    },










    //XHR FUNCTIONS
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

    getServerOptions: function (syncdata) {        
        tbSync.setSyncState("prepare.request.options", syncdata.account);
        let connection = tbSync.eas.getConnection(syncdata.account);
        let password = tbSync.getPassword(tbSync.db.getAccount(syncdata.account));

        let userAgent = tbSync.db.getAccountSetting(syncdata.account, "useragent"); //plus calendar.useragent.extra = Lightning/5.4.5.2
        tbSync.dump("Sending", "OPTIONS " + connection.host);
        
        return new Promise(function(resolve,reject) {
            // Create request handler - API changed with TB60 to new XMKHttpRequest()
            syncdata.req = new XMLHttpRequest();
            syncdata.req.mozBackgroundRequest = true;
            syncdata.req.open("OPTIONS", connection.host, true);
            syncdata.req.overrideMimeType("text/plain");
            syncdata.req.setRequestHeader("User-Agent", userAgent);
            syncdata.req.setRequestHeader("Authorization", 'Basic ' + btoa(connection.user + ':' + password));
            syncdata.req.timeout = tbSync.prefSettings.getIntPref("eas.timeout");

            syncdata.req.ontimeout = function () {
                resolve();
            };

            syncdata.req.onerror = function () {
                resolve();
            };

            syncdata.req.onload = function() {
                tbSync.setSyncState("eval.request.options", syncdata.account);
                let responseData = {};

                switch(syncdata.req.status) {
                    case 200:
                        responseData["MS-ASProtocolVersions"] =  syncdata.req.getResponseHeader("MS-ASProtocolVersions");
                        responseData["MS-ASProtocolCommands"] =  syncdata.req.getResponseHeader("MS-ASProtocolCommands");                        

                        tbSync.dump("EAS OPTIONS with response (status: 200)", "\n" +
                        "responseText: " + syncdata.req.responseText + "\n" +
                        "responseHeader(MS-ASProtocolVersions): " + responseData["MS-ASProtocolVersions"]+"\n" +
                        "responseHeader(MS-ASProtocolCommands): " + responseData["MS-ASProtocolCommands"]);

                        if (responseData && responseData["MS-ASProtocolCommands"] && responseData["MS-ASProtocolVersions"]) {
                            tbSync.db.setAccountSetting(syncdata.account, "allowedEasCommands", responseData["MS-ASProtocolCommands"]);
                            tbSync.db.setAccountSetting(syncdata.account, "allowedEasVersions", responseData["MS-ASProtocolVersions"]);
                            tbSync.db.setAccountSetting(syncdata.account, "lastEasOptionsUpdate", Date.now());
                        }

                    default:
                            resolve();

                }
            };
            
            tbSync.setSyncState("send.request.options", syncdata.account);
            syncdata.req.send();
            
        });
    },

    sendRequest: function (wbxml, command, syncdata, allowSoftFail = false) {
        let msg = "Sending data <" + syncdata.syncstate.split("||")[0] + "> for " + tbSync.db.getAccountSetting(syncdata.account, "accountname");
        if (syncdata.folderID !== "") msg += " (" + tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name") + ")";
        tbSync.eas.logxml(wbxml, msg);

        let connection = tbSync.eas.getConnection(syncdata.account);
        let password = tbSync.getPassword(tbSync.db.getAccount(syncdata.account));

        let userAgent = tbSync.db.getAccountSetting(syncdata.account, "useragent"); //plus calendar.useragent.extra = Lightning/5.4.5.2
        let deviceType = tbSync.db.getAccountSetting(syncdata.account, "devicetype");
        let deviceId = tbSync.db.getAccountSetting(syncdata.account, "deviceId");

        tbSync.dump("Sending (EAS v"+tbSync.db.getAccountSetting(syncdata.account, "asversion") +")", "POST " + connection.host + '?Cmd=' + command + '&User=' + encodeURIComponent(connection.user) + '&DeviceType=' +deviceType + '&DeviceId=' + deviceId, true);
        
        return new Promise(function(resolve,reject) {
            // Create request handler - API changed with TB60 to new XMKHttpRequest()
            syncdata.req = new XMLHttpRequest();
            syncdata.req.mozBackgroundRequest = true;
            syncdata.req.open("POST", connection.host + '?Cmd=' + command + '&User=' + encodeURIComponent(connection.user) + '&DeviceType=' +encodeURIComponent(deviceType) + '&DeviceId=' + deviceId, true);
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
                if (allowSoftFail) resolve("");
                else reject(eas.finishSync("timeout", eas.flags.abortWithError));
            };

            syncdata.req.onerror = function () {
                if (allowSoftFail) resolve("");
                else {
                    let error = tbSync.eas.createTCPErrorFromFailedXHR(syncdata.req);
                    if (!error) {
                        reject(eas.finishSync("networkerror", eas.flags.abortWithServerError));
                    } else {
                        reject(eas.finishSync(error, eas.flags.abortWithServerError));
                    }
                }
            };

            syncdata.req.onload = function() {
                let response = syncdata.req.responseText;
                switch(syncdata.req.status) {

                    case 200: //OK
                        let msg = "Receiving data <" + syncdata.syncstate.split("||")[0] + "> for " + tbSync.db.getAccountSetting(syncdata.account, "accountname");
                        if (syncdata.folderID !== "") msg += " (" + tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name") + ")";
                        tbSync.eas.logxml(response, msg);

                        //What to do on error? IS this an error? Yes!
                        if (!allowSoftFail && response.length !== 0 && response.substr(0, 4) !== String.fromCharCode(0x03, 0x01, 0x6A, 0x00)) {
                            tbSync.dump("Recieved Data", "Expecting WBXML but got junk (request status = " + syncdata.req.status + ", ready state = " + syncdata.req.readyState + "\n>>>>>>>>>>\n" + response + "\n<<<<<<<<<<\n");
                            reject(eas.finishSync("invalid"));
                        } else {
                            resolve(response);
                        }
                        break;

                    case 401: // AuthError
                    case 403: // Forbiddden (some servers send forbidden on AuthError, like Freenet)
                        reject(eas.finishSync("401", eas.flags.abortWithError));
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
                        if (allowSoftFail) resolve("");
                        else reject(eas.finishSync("httperror::" + syncdata.req.status, eas.flags.abortWithError));
                }
            };

            syncdata.req.send(wbxml);
            
        });
    },

    //returns false on parse error and null on empty response (if allowed)
    getDataFromResponse: function (wbxml, allowEmptyResponse = !eas.flags.allowEmptyResponse) {        
        //check for empty wbxml
        if (wbxml.length === 0) {
            if (allowEmptyResponse) return null;
            else throw eas.finishSync("empty-response");
        }

        //convert to save xml (all special chars in user data encoded by encodeURIComponent) and check for parse errors
        let xml = wbxmltools.convert2xml(wbxml);
        if (xml === false) {
            throw eas.finishSync("wbxml-parse-error");
        }
        
        //retrieve data and check for empty data (all returned data fields are already decoded by decodeURIComponent)
        let wbxmlData = xmltools.getDataFromXMLString(xml);
        if (wbxmlData === null) {
            if (allowEmptyResponse) return null;
            else throw eas.finishSync("response-contains-no-data");
        }
        
        //debug
        xmltools.printXmlData(wbxmlData, false); //do not include ApplicationData in log
        return wbxmlData;
    },
    
    checkStatus : function (syncdata, wbxmlData, path, rootpath="", allowSoftFail = false) {
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
                tbSync.synclog("Warning", "WBXML: Server response does not contain mandatory <"+fullpath+"> field . Error? Aborting Sync.");
                throw eas.finishSync("wbxmlmissingfield::" + fullpath);
            } else {
                //the alternative status could be extracted
                status = mainStatus;
                fullpath = type + "." + elements[elements.length-1];
            }
        }

        //check if all is fine (not bad)
        if (status == "1") {
            return "";
        }

        tbSync.dump("wbxml status check", type + ": " + fullpath + " = " + status);

        //handle errrors based on type
        switch (type+":"+status) {
            case "Sync:3": /*
                        MUST return to SyncKey element value of 0 for the collection. The client SHOULD either delete any items that were added 
                        since the last successful Sync or the client MUST add those items back to the server after completing the full resynchronization
                        */
                tbSync.synclog("Warning", "WBXML: Server reports <invalid synchronization key> (" + fullpath + " = " + status + "), resyncing.");
                throw eas.finishSync(type+"("+status+")", eas.flags.resyncFolder);
            
            case "Sync:4":
                if (allowSoftFail) return "Mailformed request. Bug in TbSync?";
                throw eas.finishSync("ServerRejectedRequest");                            
            
            case "Sync:5":
                if (allowSoftFail) return "Temporary server issues or invalid item";
                throw eas.finishSync("TempServerError");                            

            case "Sync:6":
                //Server does not accept one of our items or the entire request.
                if (allowSoftFail) return "Invalid item! Mandatory fields missing? Dublicate item?";
                throw eas.finishSync("ServerRejectedRequest");                            

            case "Sync:7": //The client has changed an item for which the conflict policy indicates that the server's changes take precedence.
                return "";
        
            case "Sync:8": // Object not found - takeTargetOffline and remove folder
                tbSync.synclog("Warning", "WBXML: Server reports <object not found> (" +  tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name") + "), keeping local copy and removing folder.");
                let folder = tbSync.db.getFolder(syncdata.account, syncdata.folderID);
                if (folder !== null) {
                    let target = folder.target;
                    //deselect folder
                    folder.selected = "0";
                    folder.target = "";
                    //if target exists, take it offline
                    tbSync.takeTargetOffline("eas", target, folder.type);
                    tbSync.db.deleteFolder(syncdata.account, syncdata.folderID);
                    //folder is no longer there, unset current folder
                    syncdata.folderID = "";
                }
                throw eas.finishSync();

            case "Sync:9": //User account could be out of disk space, also send if no write permission (TODO)
                return "";

            case "Sync:12": /*
                        Perform a FolderSync command and then retry the Sync command. (is "resync" here)
                        */
                tbSync.synclog("Warning", "WBXML: Server reports <folder hierarchy changed> (" + fullpath + " = " + status + "), resyncing");
                throw eas.finishSync(type+"("+status+")", eas.flags.resyncAccount);

            
            case "FolderDelete:3": // special system folder - fatal error
                throw eas.finishSync("folderDelete.3");

            case "FolderDelete:6": // error on server
                throw eas.finishSync("folderDelete.6");

            case "FolderDelete:4": // folder does not exist - resync ( we allow delete only if folder is not subscribed )
            case "FolderDelete:9": // invalid synchronization key - resync
            case "FolderSync:9": // invalid synchronization key - resync
                throw eas.finishSync(type+"("+status+")", eas.flags.resyncAccount);
        }
        
        //handle global error (https://msdn.microsoft.com/en-us/library/ee218647(v=exchg.80).aspx)
        let descriptions = {};
        switch(status) {
            case "101": //invalid content
            case "102": //invalid wbxml
            case "103": //invalid xml
                throw eas.finishSync("global." + status, eas.flags.abortWithError);
            
            case "109": descriptions["109"]="DeviceTypeMissingOrInvalid";
            case "112": descriptions["112"]="ActiveDirectoryAccessDenied";
            case "126": descriptions["126"]="UserDisabledForSync";
            case "127": descriptions["127"]="UserOnNewMailboxCannotSync";
            case "128": descriptions["128"]="UserOnLegacyMailboxCannotSync";
            case "129": descriptions["129"]="DeviceIsBlockedForThisUser";
            case "130": descriptions["120"]="AccessDenied";
            case "131": descriptions["131"]="AccountDisabled";
                throw eas.finishSync("global.clientdenied"+ "::" + status + "::" + descriptions[status], eas.flags.abortWithError);

            case "110": //server error - resync
                throw eas.finishSync(type+"("+status+")", eas.flags.resyncAccount);

            case "141": // The device is not provisionable
            case "142": // DeviceNotProvisioned
            case "143": // PolicyRefresh
            case "144": // InvalidPolicyKey
                //enable provision
                tbSync.db.setAccountSetting(syncdata.account, "provision","1");
                //reset policykey
                tbSync.db.setAccountSetting(syncdata.account, "policykey", 0);
                throw eas.finishSync(type+"("+status+")", eas.flags.resyncAccount);
            
            default:
                tbSync.synclog("Warning", "WBXML: Server reports unhandled status <" + fullpath + " = " + status + ">. Aborting Sync.");
                if (allowSoftFail) return "Server reports unhandled status <" + fullpath + " = " + status + ">";
                throw eas.finishSync("wbxmlerror::" + fullpath + " = " + status, eas.flags.abortWithError);

        }		
    },





    // AUTODISCOVER        
    updateServerConnectionViaAutodiscover: Task.async (function* (syncdata) {
        tbSync.setSyncState("prepare.request.autodiscover", syncdata.account);
        let user = tbSync.db.getAccountSetting(syncdata.account, "user");
        let password = tbSync.getPassword(tbSync.db.getAccount(syncdata.account));

        tbSync.setSyncState("send.request.autodiscover", syncdata.account);
        let result = yield tbSync.eas.getServerConnectionViaAutodiscover(user, password, 30*1000);

        tbSync.setSyncState("eval.response.autodiscover", syncdata.account);
        if (result.errorcode == 200) {
            //update account
            tbSync.db.setAccountSetting(syncdata.account, "host", eas.stripAutodiscoverUrl(result.server)); 
            tbSync.db.setAccountSetting(syncdata.account, "user", result.user);
            tbSync.db.setAccountSetting(syncdata.account, "https", (result.server.substring(0,5) == "https") ? "1" : "0");
        }

        return result.errorcode;
    }),
    
    stripAutodiscoverUrl: function(url) {
        let u = url;
        while (u.endsWith("/")) { u = u.slice(0,-1); }
        if (u.endsWith("/Microsoft-Server-ActiveSync")) u=u.slice(0, -28);
        else tbSync.dump("Received non-standard EAS url via autodiscover:", url);

        return u.split("//")[1]; //cut off protocol
    },
    
    getServerConnectionViaAutodiscover : Task.async (function* (user, password, maxtimeout) {
        let urls = [];
        let parts = user.split("@");
        
        urls.push({"url":"http://autodiscover."+parts[1]+"/autodiscover/autodiscover.xml", "user":user});
        urls.push({"url":"http://"+parts[1]+"/autodiscover/autodiscover.xml", "user":user});
        urls.push({"url":"http://autodiscover."+parts[1]+"/Autodiscover/Autodiscover.xml", "user":user});
        urls.push({"url":"http://"+parts[1]+"/Autodiscover/Autodiscover.xml", "user":user});

        urls.push({"url":"https://autodiscover."+parts[1]+"/autodiscover/autodiscover.xml", "user":user});
        urls.push({"url":"https://"+parts[1]+"/autodiscover/autodiscover.xml", "user":user});
        urls.push({"url":"https://autodiscover."+parts[1]+"/Autodiscover/Autodiscover.xml", "user":user});
        urls.push({"url":"https://"+parts[1]+"/Autodiscover/Autodiscover.xml", "user":user});

        let responses = []; //array of objects {url, error, server}
        let initialUrlArraySize = urls.length;

        for (let i=0; i<initialUrlArraySize; i++) {
            tbSync.dump("Querry EAS autodiscover URL ("+i+")", urls[i].url + " @ " + urls[i].user);
            let timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
            let connection = {"url":urls[i].url, "user":urls[i].user};
            timer.initWithCallback({notify : function () {tbSync.eas.getServerConnectionViaAutodiscoverRedirectWrapper(responses, urls, connection, password, maxtimeout)}}, 200*i, 0);
        }

        //monitor responses and url size (can increase due to redirects)
        let startDate = Date.now();
        let result = null;
        
        while ((Date.now()-startDate) < maxtimeout && result === null) {
            yield tbSync.sleep(1000);
            
            let i = 0;
            while (initialUrlArraySize < urls.length) {
                tbSync.dump("Querry EAS autodiscover URL ("+initialUrlArraySize+")", urls[initialUrlArraySize].url + " @ " + urls[initialUrlArraySize].user);
                let timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
                let connection = {"url":urls[initialUrlArraySize].url, "user":urls[initialUrlArraySize].user};
                timer.initWithCallback({notify : function () {tbSync.eas.getServerConnectionViaAutodiscoverRedirectWrapper(responses, urls, connection, password, maxtimeout)}}, 200*i, 0);                
                initialUrlArraySize++;
                i++;
            }
            
            //also check, if one of our request succeded or failed hard, no need to wait for the others, return
            for (let r=0; r<responses.length; r++) {
                if (responses[r].server) result = {"server": responses[r].server, "user": responses[r].user, "error": "", "errorcode":200};
                if (responses[r].error == 403 || responses[r].error == 401) result = {"server": "", "user": responses[r].user, "errorcode": responses[r].error, "error": tbSync.getLocalizedMessage("status." + responses[r].error, "eas")};
            }
            
        } 

        //log all responses and extract certerrors
        let certerrors = [];
        let log = [];
        for (let r=0; r<responses.length; r++) {
            log.push(" *  "+responses[r].url+" @ " + responses[r].user +" : " + (responses[r].server ? responses[r].server : responses[r].error));

            //look for certificate errors, which might be usefull to the user in case of a general fail
            if (responses[r].error) {
                let security_error = responses[r].error.toString().split("::");
                if (security_error.length == 2 && security_error[0] == "security") {
                    certerrors.push(responses[r].url + "\n\t => " + security_error[1]);
                }
            }
        }
        tbSync.dump("EAS autodiscover results","\n" + log.join("\n"));
        
        if (result === null) { 
            let error = tbSync.getLocalizedMessage("autodiscover.FailedUnknown","eas");
            //include certerrors
            if (certerrors.length>0) error = error + "\n\n" + tbSync.getLocalizedMessage("autodiscover.FailedSecurity","eas") + "\n\n" + certerrors.join("\n");
            result = {"server":"", "user":user, "error":error, "errorcode":503};
        }

        return result;        
    }),
       
    getServerConnectionViaAutodiscoverRedirectWrapper : Task.async (function* (responses, urls, connection, password, maxtimeout) {        
        //using HEAD to find URL redirects until response URL no longer changes 
        // * XHR should follow redirects transparently, but that does not always work, POST data could get lost, so we
        // * need to find the actual POST candidates (example: outlook.de accounts)
        let result = {};
        let method = "HEAD";
            
        do {            
            yield tbSync.sleep(200);
            result = yield tbSync.eas.getServerConnectionViaAutodiscoverRequest(method, connection, password, maxtimeout);
            method = "";
            
            if (result.error == "redirect found") {
                //add this url to the list, if it is new
                if (!urls.some(u => (u.url == result.url && u.user == result.user))) {
                    urls.push({"url":result.url, "user":result.user});
                    tbSync.dump("EAS autodiscover URL redirect",  "\n" + connection.url + " @ " + connection.user + " => \n" + result.url + " @ " + result.user);
                }
                return;
            } else if (result.error == "POST candidate found") {
                method = "POST";
            }

        } while (method == "POST");

        if (responses && Array.isArray(responses)) responses.push(result);
    }),    
    
    getServerConnectionViaAutodiscoverRequest: function (method, connection, password, maxtimeout) {
        return new Promise(function(resolve,reject) {
            
            let xml = '<?xml version="1.0" encoding="utf-8"?>\r\n';
            xml += '<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/mobilesync/requestschema/2006">\r\n';
            xml += '<Request>\r\n';
            xml += '<EMailAddress>' + connection.user + '</EMailAddress>\r\n';
            xml += '<AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/mobilesync/responseschema/2006</AcceptableResponseSchema>\r\n';
            xml += '</Request>\r\n';
            xml += '</Autodiscover>\r\n';
            
            let userAgent = tbSync.prefSettings.getCharPref("eas.clientID.useragent"); //plus calendar.useragent.extra = Lightning/5.4.5.2

            // Create request handler - API changed with TB60 to new XMKHttpRequest()
            let req = new XMLHttpRequest();
            req.mozBackgroundRequest = true;
            req.open(method, connection.url, true);
            req.timeout = maxtimeout;
            req.setRequestHeader("User-Agent", userAgent);
            
            let secure = (connection.url.substring(0,8).toLowerCase() == "https://");
            
            if (method == "POST") {
                req.setRequestHeader("Content-Length", xml.length);
                req.setRequestHeader("Content-Type", "text/xml");
                if (secure) req.setRequestHeader("Authorization", "Basic " + btoa(connection.user + ":" + password));                
            }

            req.ontimeout = function () {
                tbSync.dump("EAS autodiscover with timeout", "\n" + connection.url + " => \n" + req.responseURL);
                resolve({"url":req.responseURL, "error":"timeout", "server":"", "user":connection.user});
            };
           
            req.onerror = function () {
                let error = tbSync.eas.createTCPErrorFromFailedXHR(req);
                if (!error) error = req.responseText;
                tbSync.dump("EAS autodiscover with error ("+error+")",  "\n" + connection.url + " => \n" + req.responseURL);
                resolve({"url":req.responseURL, "error":error, "server":"", "user":connection.user});
            };

            req.onload = function() { 
                //initiate rerun on redirects
                if (req.responseURL != connection.url) {
                    resolve({"url":req.responseURL, "error":"redirect found", "server":"", "user":connection.user});
                    return;
                }

                //initiate rerun on HEAD request without redirect (rerun and do a POST on this)
                if (method == "HEAD") {
                    resolve({"url":req.responseURL, "error":"POST candidate found", "server":"", "user":connection.user});
                    return;
                }

                //ignore POST without autherization (we just do them to get redirect information)
                if (!secure) {
                    resolve({"url":req.responseURL, "error":"unsecure POST", "server":"", "user":connection.user});
                    return;
                }
                
                //evaluate secure POST requests which have not been redirected
                tbSync.dump("EAS autodiscover POST with status (" + req.status + ")",   "\n" + connection.url + " => \n" + req.responseURL  + "\n[" + req.responseText + "]");
                
                if (req.status === 200) {
                    let data = tbSync.xmltools.getDataFromXMLString(req.responseText);
            
                    if (!(data === null) && data.Autodiscover && data.Autodiscover.Response && data.Autodiscover.Response.Action) {
                        // "Redirect" or "Settings" are possible
                        if (data.Autodiscover.Response.Action.Redirect) {
                            // redirect, start again with new user
                            let newuser = action.Redirect;
                            resolve({"url":req.responseURL, "error":"redirect found", "server":"", "user":newuser});

                        } else if (data.Autodiscover.Response.Action.Settings) {
                            // get server settings
                            let server = tbSync.xmltools.nodeAsArray(data.Autodiscover.Response.Action.Settings.Server);

                            for (let count = 0; count < server.length; count++) {
                                if (server[count].Type == "MobileSync" && server[count].Url) {
                                    resolve({"url":req.responseURL, "error":"", "server":server[count].Url, "user":connection.user});
                                    return;
                                }
                            }
                        }
                    } else {
                        resolve({"url":req.responseURL, "error":"invalid", "server":"", "user":connection.user});
                    }
                } else {
                    resolve({"url":req.responseURL, "error":req.status, "server":"", "user":connection.user});                     
                }
            };
            
            if (method == "HEAD") req.send();
            else  req.send(xml);
            
        });
    }
    
};
    

tbSync.includeJS("chrome://tbsync/content/provider/eas/sync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/tasksync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/calendarsync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/contactsync.js");
