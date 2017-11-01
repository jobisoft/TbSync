"use strict";

tbSync.includeJS("chrome://tbsync/content/provider/eas/wbxmltools.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/xmltools.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/contactsync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/calendarsync.js");

var eas = {

    //syncdata is used to communicate inside the eas provider
    //communication between core - gui- and eas provider use currentProzess
    syncdata: {},

    bundle: Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tbsync/locale/eas.strings"),
    init: function () {
        
        //DB Concept:
        //-- on application start, data is read async from json file into object
        //-- AddOn only works on object
        //-- each time data is changed, an async write job is initiated 2s in the future and is resceduled, if another request arrives within that time

        //A task is "serializing" async jobs
        Task.spawn(function* () {

            //load changelog from file
            try {
                let data = yield OS.File.read(tbSync.getAbsolutePath(db.changelogFile));
                db.changelog = JSON.parse(tbSync.decoder.decode(data));
            } catch (ex) {
                //if there is no file, there is no file...
            }

            //load accounts from file
            try {
                let data = yield OS.File.read(tbSync.getAbsolutePath(db.accountsFile));
                db.accounts = JSON.parse(tbSync.decoder.decode(data));
            } catch (ex) {
                //if there is no file, there is no file...
            }

            //load folders from file
            try {
                let data = yield OS.File.read(tbSync.getAbsolutePath(db.foldersFile));
                db.folders = JSON.parse(tbSync.decoder.decode(data));
            } catch (ex) {
                //if there is no file, there is no file...
            }

            //finish async init by calling main init()
            tbSync.init();
            
        }).then(null, Components.utils.reportError);

    },
    
    unload: function () {
        //i thought that I might need to manually write pending/scheduled write jobs before closing, 
        //but it looks like I do not have to

        //db.changelogTimer.cancel();
        //db.accountsTimer.cancel();
        //db.foldersTimer.cancel();
        //tbSync.writeAsyncJSON(tbSync.db.accounts, tbSync.db.accountsFile);
        //tbSync.writeAsyncJSON(tbSync.db.folders, tbSync.db.foldersFile);
        //tbSync.writeAsyncJSON(tbSync.db.changelog, tbSync.db.changelogFile);

        //test
        //tbSync.db.addItemToChangeLog("WriteRequest", "JustBefore", "ClosingThunderbird");
        //tbSync.db.saveChangelog();
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
            "state" : "disconnected",
            "status" : "notconnected",
            "deviceId" : eas.getNewDeviceId(),
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
            "autosync" : "0" };
        return row;
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
            
            //let xml = decodeURIComponent(escape(rawxml.split('><').join('>\n<')));
            let xml = tbSync.decode_utf8(rawxml.split('><').join('>\n<'));
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
        let host4PasswordManager = eas.getHost4PasswordManager(accountdata);
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
        let host4PasswordManager = eas.getHost4PasswordManager(accountdata);
        let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
        let curPassword = eas.getPassword(accountdata);
        
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
            "status" : ""};
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
            case "8":
            case "13":
                tbSync.removeCalendar(target);
                break;
            case "9":
            case "14":
                tbSync.removeBook(target);
                break;
            default:
                tbSync.dump("tbSync.eas.removeTarget","Unknown type <"+type+">");
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

        //Delete all targets
        let folders = db.findFoldersWithSetting("selected", "1", account);
        for (let i = 0; i<folders.length; i++) {
            tbSync.eas.removeTarget(folders[i].target, folders[i].type);
        }
        db.deleteAllFolders(account);

        db.setAccountSetting(account, "status", "notconnected");
    },





    // EAS SYNC FUNCTIONS

    initSync: function (job, account,  folderID = "") {

        //store  current value of numberOfResync
        let numberOfResync = eas.syncdata.numberOfResync;
        
        //set syncdata for this sync process
        eas.syncdata = {};
        eas.syncdata.account = account;
        eas.syncdata.folderID = folderID;
        eas.syncdata.fResync = false;

        // set status to syncing (so settingswindow will display syncstates instead of status) and set initial syncstate
        tbSync.db.setAccountSetting(account, "status", "syncing");
        tbSync.setSyncState("syncing", account);

        // check if connected
        if (tbSync.db.getAccountSetting(account, "state") == "disconnected") { //allow connected
            eas.finishSync("notconnected");
            return;
        }

        // check if connection has data
        let connection = tbSync.eas.getConnection(account);
        if (connection.server == "" || connection.user == "") {
            eas.finishSync("nouserhost");
            return;
        }

        if (job == "resync") eas.syncdata.numberOfResync = numberOfResync + 1;
        else eas.syncdata.numberOfResync = 0;

        if (eas.syncdata.numberOfResync > 5) {
            eas.finishSync("resync-loop");
            return;
        }
        
        switch (job) {
            case "resync":
                eas.syncdata.fResync = true;
                tbSync.db.setAccountSetting(account, "policykey", 0);

                //if folderID present, resync only that one folder, otherwise all folders
                if (folderID !== "") {
                    tbSync.db.setFolderSetting(account, folderID, "synckey", "");
                } else {
                    tbSync.db.setAccountSetting(account, "foldersynckey", "");
                    tbSync.db.setFolderSetting(account, "", "synckey", "");
                }
                
            case "sync":
                if (tbSync.db.getAccountSetting(account, "provision") == "1" && tbSync.db.getAccountSetting(account, "policykey") == 0) {
                    eas.getPolicykey();
                } else {
                    eas.getFolderIds();
                }
                break;
        }
    },

    getPolicykey: function() {
        tbSync.setSyncState("requestingprovision", eas.syncdata.account); 
        //reset policykey
        tbSync.db.setAccountSetting(eas.syncdata.account, "policykey", 0);

        //request provision
        let wbxml = wbxmltools.createWBXML();
        wbxml.switchpage("Provision");
        wbxml.otag("Provision");
            wbxml.otag("Policies");
                wbxml.otag("Policy");
                    wbxml.atag("PolicyType",(tbSync.db.getAccountSetting(eas.syncdata.account, "asversion") == "2.5") ? "MS-WAP-Provisioning-XML" : "MS-EAS-Provisioning-WBXML" );
                wbxml.ctag();
            wbxml.ctag();
        wbxml.ctag();

        eas.syncdata.next = 1;
        wbxml = eas.Send(wbxml.getBytes(), eas.getPolicykeyCallback.bind(this), "Provision");
    },
    
    getPolicykeyCallback: function (responseWbxml) {
        let wbxmlData = eas.getDataFromResponse(responseWbxml);

        let policykey = xmltools.getWbxmlDataField(wbxmlData,"Provision.Policies.Policy.PolicyKey");
        if (policykey === false) {
            let status = xmltools.getWbxmlDataField(wbxmlData,"Provision.Policies.Policy.Status");
            if (status) {
                eas.finishSync("policy." + status);
            } else {
                eas.finishSync("wbxmlmissingfield::Provision.Policies.Policy.Status");
            }
            return;
        }
        
        tbSync.dump("policykeyCallback("+eas.syncdata.next+")", policykey);
        tbSync.db.setAccountSetting(eas.syncdata.account, "policykey", policykey);

        //next == 1  => resend - next ==2 => GetFolderIds() - 
        // - the protocol requests us to request a policykey and get a temp policykey in return,
        // - than we need to resend this tempkey and acknowledge all policies and get the final key
        if (eas.syncdata.next < 2) {

            //acknowledge provision
            let wbxml = wbxmltools.createWBXML();
            wbxml.switchpage("Provision");
            wbxml.otag("Provision");
                wbxml.otag("Policies");
                    wbxml.otag("Policy");
                        wbxml.atag("PolicyType",(tbSync.db.getAccountSetting(eas.syncdata.account, "asversion") == "2.5") ? "MS-WAP-Provisioning-XML" : "MS-EAS-Provisioning-WBXML" );
                        wbxml.atag("PolicyKey", policykey);
                        wbxml.atag("Status", "1");
                    wbxml.ctag();
                wbxml.ctag();
            wbxml.ctag();

            eas.syncdata.next++;
            eas.Send(wbxml.getBytes(), eas.getPolicykeyCallback.bind(this), "Provision");
        } else {
            tbSync.dump("final returned policykey", policykey);
            eas.getFolderIds();
        }
    },

    getFolderIds: function() {
        //if syncdata already contains a folderID, it is a specific folder sync - otherwise we scan all folders and sync all folders
        if (eas.syncdata.folderID != "") {
            tbSync.db.setFolderSetting(eas.syncdata.account, eas.syncdata.folderID, "status", "pending");
            eas.syncNextFolder();
        } else {
            tbSync.setSyncState("requestingfolders", eas.syncdata.account); 
            let foldersynckey = tbSync.db.getAccountSetting(eas.syncdata.account, "foldersynckey");
            if (foldersynckey == "") foldersynckey = "0";

            //request foldersync
            let wbxml = wbxmltools.createWBXML();
            wbxml.switchpage("FolderHierarchy");
            wbxml.otag("FolderSync");
                wbxml.atag("SyncKey",foldersynckey);
            wbxml.ctag();

            eas.Send(wbxml.getBytes(), eas.getFolderIdsCallback.bind(this), "FolderSync");
        }
    },

    getFolderIdsCallback: function (wbxml) {
        let wbxmlData = eas.getDataFromResponse(wbxml);

        if (eas.statusIsBad(wbxmlData,"FolderSync.Status")) return;

        let synckey = xmltools.getWbxmlDataField(wbxmlData,"FolderSync.SyncKey");
        if (synckey) {
            tbSync.db.setAccountSetting(eas.syncdata.account, "foldersynckey", synckey);
        } else {
            eas.finishSync("wbxmlmissingfield::FolderSync.SyncKey");
            return;
        }
        
        //if we reach this point, wbxmlData contains FolderSync node, so the next if will not fail with an javascript error, 
        //no need to use save getWbxmlDataField function
        if (wbxmlData.FolderSync.Changes) {
            //looking for additions
            let add = xmltools.nodeAsArray(wbxmlData.FolderSync.Changes.Add);
            for (let count = 0; count < add.length; count++) {
                //check if we have a folder with that folderID (=data[ServerId])
                if (tbSync.db.getFolder(eas.syncdata.account, add[count].ServerId) === null) {
                    //add folder
                    let newData =tbSync.eas.getNewFolderEntry();
                    newData.account = eas.syncdata.account;
                    newData.folderID = add[count].ServerId;
                    newData.name = add[count].DisplayName;
                    newData.type = add[count].Type;
                    newData.synckey = "";
                    newData.target = "";
                    newData.selected = (newData.type == "9" || newData.type == "8" ) ? "1" : "0";
                    newData.status = "";
                    newData.lastsynctime = "";
                    tbSync.db.addFolder(newData);
                } else {
                    //TODO? - cannot add an existing folder - resync!
                }
            }
            
            //looking for updates if a folder gets moved to trash, its parentId is no longer zero! TODO
            // -> this means, deleted folders still show up here, because we do not check, if folder is in root
            let update = xmltools.nodeAsArray(wbxmlData.FolderSync.Changes.Update);
            for (let count = 0; count < update.length; count++) {
                //geta a reference
                let folder = tbSync.db.getFolder(eas.syncdata.account, update[count]["ServerId"]);
                if (folder !== null) {
                    //update folder
                    folder.name = update[count]["DisplayName"];
                    folder.type = update[count]["Type"];
                    tbSync.db.saveFolders();
                } else {
                    //TODO? - cannot update an non-existing folder - resync!
                }
            }

            //looking for deletes
            let del = xmltools.nodeAsArray(wbxmlData.FolderSync.Changes.Delete);
            for (let count = 0; count < del.length; count++) {

                //get a copy of the folder, so we can del it
                let folder = tbSync.db.getFolder(eas.syncdata.account, del[count]["ServerId"]);
                if (folder !== null) {
                    //del folder - we do not touch target (?)
                    tbSync.db.deleteFolder(eas.syncdata.account, del[count]["ServerId"]);
                } else {
                    //TODO? - cannot del an non-existing folder - resync!
                }
            }
        }
        
        //set selected folders to pending, so they get synced
        let folders = tbSync.db.getFolders(eas.syncdata.account);
        for (let f in folders) {
            if (folders[f].selected == "1") {
                tbSync.db.setFolderSetting(folders[f].account, folders[f].folderID, "status", "pending");
            }
        }

        eas.syncNextFolder();
    },


    //Process all folders with PENDING status
    syncNextFolder: function () {
        let folders = tbSync.db.findFoldersWithSetting("status", "pending", eas.syncdata.account);
        if (folders.length == 0 || tbSync.db.getAccountSetting(eas.syncdata.account, "status") != "syncing") {
            //all folders of this account have been synced, or there was an error
            tbSync.finishAccountSync(eas.syncdata.account);
        } else {
            eas.syncdata.synckey = folders[0].synckey;
            eas.syncdata.folderID = folders[0].folderID;
            switch (folders[0].type) {
                case "9": 
                case "14": 
                    eas.syncdata.type = "Contacts";
                    break;
                case "8":
                case "13":
                    eas.syncdata.type = "Calendar";
                    break;
                default:
                    eas.finishSync("skipped");
                    return;
            };
            
            tbSync.setSyncState("preparing", eas.syncdata.account, eas.syncdata.folderID);
            if (eas.syncdata.synckey == "") {
                //request a new syncKey
                let wbxml = tbSync.wbxmltools.createWBXML();
                wbxml.otag("Sync");
                    wbxml.otag("Collections");
                        wbxml.otag("Collection");
                            if (tbSync.db.getAccountSetting(eas.syncdata.account, "asversion") == "2.5") wbxml.atag("Class", eas.syncdata.type);
                            wbxml.atag("SyncKey","0");
                            wbxml.atag("CollectionId",eas.syncdata.folderID);
                        wbxml.ctag();
                    wbxml.ctag();
                wbxml.ctag();
                eas.Send(wbxml.getBytes(), eas.getSynckey.bind(this), "Sync");
            } else {
                eas.startSync(); 
            }
        }
    },

    getSynckey: function (responseWbxml) {
        eas.syncdata.synckey = wbxmltools.FindKey(responseWbxml);
        tbSync.db.setFolderSetting(eas.syncdata.account, eas.syncdata.folderID, "synckey", eas.syncdata.synckey);
        eas.startSync(); 
    },

    startSync: function () {
        eas.syncdata.timeOfLastSync = tbSync.db.getFolderSetting(eas.syncdata.account, eas.syncdata.folderID, "lastsynctime") / 1000;
        eas.syncdata.timeOfThisSync = (Date.now() / 1000) - 1;
        switch (eas.syncdata.type) {
            case "Contacts": 
                contactsync.fromzpush();
                break;
            case "Calendar":
                calendarsync.start();
                break;
        }
    },

    finishSync: function (error = "") {
        //a folder has been finished, process next one
        let time = Date.now();
        let status = "OK";
        if (error !== "") {
            status = error;
            time = "";
            tbSync.dump("finishSync(): Error @ Account " + tbSync.db.getAccountSetting(eas.syncdata.account, "accountname"), tbSync.getLocalizedMessage("status." + status));
            //setting a status on the account will overwrite syncing status, which will abort syncing on nextFolder
            tbSync.db.setAccountSetting(eas.syncdata.account, "status", status);
        } else {
            tbSync.dump("finishSync(): OK @ Account " + tbSync.db.getAccountSetting(eas.syncdata.account, "accountname"), tbSync.getLocalizedMessage("status." + status));
        }

        if (eas.syncdata.folderID != "") {
            tbSync.db.setFolderSetting(eas.syncdata.account, eas.syncdata.folderID, "status", status);
            tbSync.db.setFolderSetting(eas.syncdata.account, eas.syncdata.folderID, "lastsynctime", time);
        } 

        tbSync.setSyncState("done", eas.syncdata.account);
        eas.syncNextFolder();
    },





    // RESPONSE PROCESS FUNCTIONS
    statusIsBad : function (wbxmlData,path) {
        let status = xmltools.getWbxmlDataField(wbxmlData,path);
        
        switch (status) {
            case false:
                tbSync.dump("wbxml status", "Server response does not contain mandatory <"+path+"> field . Error? Aborting Sync.");
                eas.finishSync("wbxmlmissingfield::" + path);
                return true;
            
            case "1":
                //all fine, not bad
                return false;

            case "3": 
                tbSync.dump("wbxml status", "Server reports <invalid synchronization key> (" + status + "), resyncing.");
                eas.initSync("resync", eas.syncdata.account, eas.syncdata.folderID);
                return true;
            case "12": 
                tbSync.dump("wbxml status", "Server reports <folder hierarchy changed> (" + status + "), resyncing");
                eas.initSync("resync", eas.syncdata.account, eas.syncdata.folderID);
                return true;
            default:
                tbSync.dump("wbxml status", "Server reports unknown status <"+status+">. Error? Aborting Sync.");
                eas.finishSync("wbxmlerror::" + status);
                return true;
        }		
    },

    //returns false on parse error and null on empty response
    getDataFromResponse: function (wbxml) {        
        //check for empty wbxml
        if (wbxml.length === 0) {
            return null;
        }

        //convert to xml and check for parse errors
        let xml = wbxmltools.convert2xml(wbxml);
        if (xml === false) {
            eas.finishSync("wbxml-parse-error");
            return false;
        }
        
        //retrieve data and check for empty data
        let wbxmlData = xmltools.getDataFromXMLString(xml);
        if (wbxmlData === null) {
            return null;
        }
        
        //debug
        xmltools.printXmlData(wbxmlData);
        return wbxmlData;
    },

    updateSynckey: function (wbxmlData) {
        let synckey = xmltools.getWbxmlDataField(wbxmlData,"Sync.Collections.Collection.SyncKey");

        if (synckey) {
            eas.syncdata.synckey = synckey;
            db.setFolderSetting(eas.syncdata.account, eas.syncdata.folderID, "synckey", synckey);
            return true;
        } else {
            eas.finishSync("wbxmlmissingfield::Sync.Collections.Collection.SyncKey");
            return false;
        }
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


    Send: function (wbxml, callback, command) {
        let platformVer = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo).platformVersion;   
        
        if (tbSync.currentProzess.forceAbort) return;
        
        tbSync.eas.logxml(wbxml, "Sending data "+tbSync.currentProzess.state);
        if (tbSync.currentProzess.state == tbSync.currentProzess.laststate) tbSync.currentProzess.chunks++;
        else tbSync.currentProzess.chunks = 0;

        let connection = tbSync.eas.getConnection(eas.syncdata.account);
        let password = tbSync.eas.getPassword(tbSync.db.getAccount(eas.syncdata.account));

        let deviceType = 'Thunderbird';
        let deviceId = tbSync.db.getAccountSetting(eas.syncdata.account, "deviceId");
        
        // Create request handler
        let req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
        req.mozBackgroundRequest = true;
        tbSync.dump("sending", "POST " + connection.host + '/Microsoft-Server-ActiveSync?Cmd=' + command + '&User=' + connection.user + '&DeviceType=' +deviceType + '&DeviceId=' + deviceId, true);

        req.open("POST", connection.host + '/Microsoft-Server-ActiveSync?Cmd=' + command + '&User=' + connection.user + '&DeviceType=' +deviceType + '&DeviceId=' + deviceId, true);
        req.overrideMimeType("text/plain");
        req.setRequestHeader("User-Agent", deviceType + ' ActiveSync');
        req.setRequestHeader("Content-Type", "application/vnd.ms-sync.wbxml");
        req.setRequestHeader("Authorization", 'Basic ' + btoa(connection.user + ':' + password));
        if (tbSync.db.getAccountSetting(eas.syncdata.account, "asversion") == "2.5") {
            req.setRequestHeader("MS-ASProtocolVersion", "2.5");
        } else {
            req.setRequestHeader("MS-ASProtocolVersion", "14.0");
        }
        req.setRequestHeader("Content-Length", wbxml.length);
        if (tbSync.db.getAccountSetting(eas.syncdata.account, "provision") == "1") {
            req.setRequestHeader("X-MS-PolicyKey", tbSync.db.getAccountSetting(eas.syncdata.account, "policykey"));
            tbSync.dump("PolicyKey used",tbSync.db.getAccountSetting(eas.syncdata.account, "policykey"));
        }

        req.timeout = 30000;

        req.ontimeout = function () {
            eas.finishSync("timeout");
        }.bind(this);
        
        req.onerror = function () {
            let error = this.createTCPErrorFromFailedXHR(req);
            if (!error) {
                eas.finishSync("networkerror");
            } else {
                eas.finishSync(error);
            }
        }.bind(this);

        // Define response handler for our request
        req.onload = function() {
            if (tbSync.currentProzess.forceAbort) return;

            switch(req.status) {

                case 200: //OK
                    wbxml = req.responseText;
                    tbSync.eas.logxml(wbxml, "Receiving Data");

                    //What to do on error? IS this an error? Yes!
                    if (wbxml.length !== 0 && wbxml.substr(0, 4) !== String.fromCharCode(0x03, 0x01, 0x6A, 0x00)) {
                        tbSync.dump("Recieved Data", "Expecting WBXML but got - " + req.responseText + ", request status = " + req.status + ", ready state = " + req.readyState);
                        //Freenet.de hack - if we got back junk, the password is probably wrong. we need to stop anyhow, due to this error
                        tbSync.dump("Recieved Data", "We got back junk, which *could* mean, the password is wrong. Prompting.");
                        eas.finishSync(401);
                    } else {
                         callback(req.responseText);
                    }
                    break;

                case 401: // AuthError
                    eas.finishSync(req.status);
                    break;

                case 449: // Request for new provision
                    if (tbSync.db.getAccountSetting(eas.syncdata.account, "provision") == "1") {
                        eas.initSync("resync", eas.syncdata.account, eas.syncdata.folderID);
                    } else {
                        eas.finishSync(req.status);
                    }
                    break;

                case 451: // Redirect - update host and login manager 
                    let header = req.getResponseHeader("X-MS-Location");
                    let newHost = header.slice(header.indexOf("://") + 3, header.indexOf("/M"));
                    let connection = tbSync.eas.getConnection(eas.syncdata.account);

                    tbSync.dump("redirect (451)", "header: " + header + ", oldHost: " + connection.host + ", newHost: " + newHost);

                    //Since we do not use the actual host in the LoginManager (but the FQDN part of the user name), a changing host
                    //does not affect the loginmanager - no further action needed
                    connection.host = newHost;

                    eas.initSync("resync", eas.syncdata.account); //resync everything
                    break;
                    
                default:
                    eas.finishSync("httperror::" + req.status);
            }
        }.bind(this);

        try {
            if (platformVer >= 50) {
                /*nBytes = wbxml.length;
                ui8Data = new Uint8Array(nBytes);
                for (let nIdx = 0; nIdx < nBytes; nIdx++) {
                ui8Data[nIdx] = wbxml.charCodeAt(nIdx) & 0xff;
                }*/

                req.send(wbxml);
            } else {
                let nBytes = wbxml.length;
                let ui8Data = new Uint8Array(nBytes);
                for (let nIdx = 0; nIdx < nBytes; nIdx++) {
                    ui8Data[nIdx] = wbxml.charCodeAt(nIdx) & 0xff;
                }
                //tbSync.dump("ui8Data",wbxmltools.convert2xml(wbxml))
                req.send(ui8Data);
            }
        } catch (e) {
            tbSync.dump("unknown error", e);
        }

        return true;
    }
};

eas.init();
