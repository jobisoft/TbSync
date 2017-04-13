"use strict";

tbSync.includeJS("chrome://tbsync/content/provider/eas/wbxmltools.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/xmltools.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/contactsync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/calendarsync.js");

var eas = {

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
            "policykey" : "", 
            "foldersynckey" : "0",
            "lastsynctime" : "0", 
            "state" : "disconnected",
            "status" : "notconnected",
            "deviceId" : this.getNewDeviceId(),
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
        db.setAccountSetting(account, "state", "connecting");
        db.setAccountSetting(account, "policykey", "");
        db.setAccountSetting(account, "foldersynckey", "");
    },

    disconnectAccount: function (account) {
        db.setAccountSetting(account, "state", "disconnected"); //connected, connecting or disconnected
        db.setAccountSetting(account, "policykey", "");
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

        //set syncdata for this sync process
        let syncdata = {};
        syncdata.account = account;
        syncdata.folderID = folderID;
        syncdata.fResync = false;
        syncdata.status = "OK";

        // set status to syncing (so settingswindow will display syncstates instead of status) and set initial syncstate
        tbSync.db.setAccountSetting(syncdata.account, "status", "syncing");
        tbSync.setSyncState("syncing", syncdata);

        // check if connected
        if (tbSync.db.getAccountSetting(account, "state") == "disconnected") { //allow connected and connecting
            this.finishSync(syncdata, "notconnected");
            return;
        }

        // check if connection has data
        let connection = tbSync.getConnection(account);
        if (connection.server == "" || connection.user == "") {
            this.finishSync(syncdata, "nouserhost");
            return;
        }

        switch (job) {
            case "resync":
                syncdata.fResync = true;
                tbSync.db.setAccountSetting(account, "policykey", "");

                //if folderID present, resync only that one folder, otherwise all folders
                if (folderID !== "") {
                    tbSync.db.setFolderSetting(account, folderID, "synckey", "");
                } else {
                    tbSync.db.setAccountSetting(account, "foldersynckey", "");
                    tbSync.db.setFolderSetting(account, "", "synckey", "");
                }
                
            case "sync":
                if (tbSync.db.getAccountSetting(account, "provision") == "1" && tbSync.db.getAccountSetting(account, "policykey") == "") {
                    this.getPolicykey(syncdata);
                } else {
                    this.getFolderIds(syncdata);
                }
                break;
        }
    },

    getPolicykey: function(syncdata) {
        tbSync.setSyncState("requestingprovision", syncdata); 

        //request provision
        let wbxml = wbxmltools.createWBXML();
        wbxml.switchpage("Provision");
        wbxml.otag("Provision");
            wbxml.otag("Policies");
                wbxml.otag("Policy");
                    wbxml.atag("PolicyType",(tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") ? "MS-WAP-Provisioning-XML" : "MS-EAS-Provisioning-WBXML" );
                wbxml.ctag();
            wbxml.ctag();
        wbxml.ctag();

        syncdata.next = 1;
        wbxml = this.Send(wbxml.getBytes(), this.getPolicykeyCallback.bind(this), "Provision", syncdata);
    },
    
    getPolicykeyCallback: function (responseWbxml, syncdata) {
        let policykey = wbxmltools.FindPolicykey(responseWbxml);
        tbSync.dump("policykeyCallback("+syncdata.next+")", policykey);
        tbSync.db.setAccountSetting(syncdata.account, "policykey", policykey);

        //next == 1 and 2 = resend - next ==3 = GetFolderIds() - 
        // - the protocol requests us to first send zero as policykey and get a temp policykey in return,
        // - the we need to resend this tempkey and get the final one 
        // - then we need to resend the final one and check, if we get that one back - THIS CHECK IS MISSING (TODO)
        if (syncdata.next < 3) {

            //re-request provision
            let wbxml = wbxmltools.createWBXML();
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

            syncdata.next++;
            this.Send(wbxml.getBytes(), this.getPolicykeyCallback.bind(this), "Provision", syncdata);
        } else {
            let policykey = wbxmltools.FindPolicykey(responseWbxml);
            tbSync.dump("final returned policykey", policykey);
            this.getFolderIds(syncdata);
        }
    },

    getFolderIds: function(syncdata) {
        //if syncdata already contains a folderID, it is a specific folder sync - otherwise we scan all folders and sync all folders
        if (syncdata.folderID != "") {
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "status", "pending");
            this.syncNextFolder(syncdata);
        } else {
            tbSync.setSyncState("requestingfolders", syncdata); 
            let foldersynckey = tbSync.db.getAccountSetting(syncdata.account, "foldersynckey");
            if (foldersynckey == "") foldersynckey = "0";

            //request foldersync
            let wbxml = wbxmltools.createWBXML();
            wbxml.switchpage("FolderHierarchy");
            wbxml.otag("FolderSync");
                wbxml.atag("SyncKey",foldersynckey);
            wbxml.ctag();

            this.Send(wbxml.getBytes(), this.getFolderIdsCallback.bind(this), "FolderSync", syncdata);
        }
    },

    getFolderIdsCallback: function (wbxml, syncdata) {

        let wbxmlData = tbSync.wbxmltools.createWBXML(wbxml).getData();
        if (this.statusIsBad(wbxmlData.FolderSync.Status, syncdata)) {
            return;
        }

        if (wbxmlData.FolderSync.SyncKey) tbSync.db.setAccountSetting(syncdata.account, "foldersynckey", wbxmlData.FolderSync.SyncKey);
        else this.finishSync(syncdata, "missingfoldersynckey");

        if (wbxmlData.FolderSync.Changes) {
            //looking for additions
            let add = xmltools.nodeAsArray(wbxmlData.FolderSync.Changes.Add);
            for (let count = 0; count < add.length; count++) {
                //check if we have a folder with that folderID (=data[ServerId])
                if (tbSync.db.getFolder(syncdata.account, add[count].ServerId) === null) {
                    //add folder
                    let newData =tbSync.eas.getNewFolderEntry();
                    newData.account = syncdata.account;
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
                let folder = tbSync.db.getFolder(syncdata.account, update[count]["ServerId"]);
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
                let folder = tbSync.db.getFolder(syncdata.account, del[count]["ServerId"]);
                if (folder !== null) {
                    //del folder - we do not touch target (?)
                    tbSync.db.deleteFolder(syncdata.account, del[count]["ServerId"]);
                } else {
                    //TODO? - cannot del an non-existing folder - resync!
                }
            }
        }
        
        //set selected folders to pending, so they get synced
        let folders = tbSync.db.getFolders(syncdata.account);
        for (let f in folders) {
            if (folders[f].selected == "1") {
                tbSync.db.setFolderSetting(folders[f].account, folders[f].folderID, "status", "pending");
            }
        }

        this.syncNextFolder(syncdata);
    },


    //Process all folders with PENDING status
    syncNextFolder: function (syncdata) {
        let folders = tbSync.db.findFoldersWithSetting("status", "pending", syncdata.account);
        if (folders.length == 0 || syncdata.status != "OK") {
            //all folders of this account have been synced
            tbSync.finishAccountSync(syncdata);
        } else {
            syncdata.synckey = folders[0].synckey;
            syncdata.folderID = folders[0].folderID;
            switch (folders[0].type) {
                case "9": 
                case "14": 
                    syncdata.type = "Contacts";
                    break;
                case "8":
                case "13":
                    syncdata.type = "Calendar";
                    break;
                default:
                    eas.finishSync(syncdata, "skipped");
                    return;
            };

            if (syncdata.synckey == "") {
                //request a new syncKey
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
                this.Send(wbxml.getBytes(), this.getSynckey.bind(this), "Sync", syncdata);
            } else {
                this.startSync(syncdata); 
            }
        }
    },

    getSynckey: function (responseWbxml, syncdata) {
        syncdata.synckey = wbxmltools.FindKey(responseWbxml);
        tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", syncdata.synckey);
        this.startSync(syncdata); 
    },

    startSync: function (syncdata) {
        switch (syncdata.type) {
            case "Contacts": 
                contactsync.fromzpush(syncdata);
                break;
            case "Calendar":
                calendarsync.start(syncdata);
                break;
        }
    },

    finishSync: function (syncdata, error = "") {
        //a folder has been finished, process next one
        let time = Date.now();
        let status = "OK";
        if (error !== "") {
            tbSync.dump("finishSync(): Error @ Account #" + syncdata.account, tbSync.getLocalizedMessage("status." + error));
            syncdata.status = error; //store latest error
            status = error;
            time = "";
        }

        if (syncdata.folderID) {
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "status", status);
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "lastsynctime", time);
        }

        tbSync.setSyncState("done", syncdata);
        this.syncNextFolder(syncdata);
    },






    statusIsBad : function (status, syncdata) {
        switch (status) {
            case "1":
                //all fine, not bad
                return false;
            case "3": 
                tbSync.dump("wbxml status", "Server reports <invalid synchronization key> (" + status + "), resyncing.");
                eas.initSync("resync", syncdata.account, syncdata.folderID);
                break;
            case "12": 
                tbSync.dump("wbxml status", "Server reports <folder hierarchy changed> (" + status + "), resyncing");
                eas.initSync("resync", syncdata.account, syncdata.folderID);
                break;
            default:
                tbSync.dump("wbxml status", "Server reports status <"+status+">. Error? Aborting Sync.");
                eas.finishSync(syncdata, "wbxmlerror::" + status);
                break;
        }        
        return true;
    },

    Send: function (wbxml, callback, command, syncdata) {
        let platformVer = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo).platformVersion;   
        
        if (tbSync.prefSettings.getBoolPref("debugwbxml")) tbSync.debuglog(wbxml, "["+tbSync.currentProzess.state+"] sending:");

        let connection = tbSync.getConnection(syncdata.account);
        let password = tbSync.getPassword(connection);

        let deviceType = 'Thunderbird';
        let deviceId = tbSync.db.getAccountSetting(syncdata.account, "deviceId");
        
        // Create request handler
        let req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
        req.mozBackgroundRequest = true;
        if (tbSync.prefSettings.getBoolPref("debugwbxml")) {
            tbSync.dump("sending", "POST " + connection.host + '/Microsoft-Server-ActiveSync?Cmd=' + command + '&User=' + connection.user + '&DeviceType=' +deviceType + '&DeviceId=' + deviceId, true);
        }
        req.open("POST", connection.host + '/Microsoft-Server-ActiveSync?Cmd=' + command + '&User=' + connection.user + '&DeviceType=' +deviceType + '&DeviceId=' + deviceId, true);
        req.overrideMimeType("text/plain");
        req.setRequestHeader("User-Agent", deviceType + ' ActiveSync');
        req.setRequestHeader("Content-Type", "application/vnd.ms-sync.wbxml");
        req.setRequestHeader("Authorization", 'Basic ' + btoa(connection.user + ':' + password));
        if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") {
            req.setRequestHeader("MS-ASProtocolVersion", "2.5");
        } else {
            req.setRequestHeader("MS-ASProtocolVersion", "14.0");
        }
        req.setRequestHeader("Content-Length", wbxml.length);
        if (tbSync.db.getAccountSetting(syncdata.account, "provision") == "1") {
            req.setRequestHeader("X-MS-PolicyKey", tbSync.db.getAccountSetting(syncdata.account, "policykey"));
        }

        req.timeout = 30000;

        req.ontimeout = function () {
            this.finishSync(syncdata, "timeout");
        }.bind(this);
        
        req.onerror = function () {
            this.finishSync(syncdata, "networkerror");
        }.bind(this);

        // Define response handler for our request
        req.onload = function() { 
            switch(req.status) {

                case 200: //OK
                    wbxml = req.responseText;
                    if (tbSync.prefSettings.getBoolPref("debugwbxml")) tbSync.debuglog(wbxml,"receiving");

                    //What to do on error? IS this an error? TODO
                    if (wbxml.substr(0, 4) !== String.fromCharCode(0x03, 0x01, 0x6A, 0x00)) {
                        if (wbxml.length !== 0) {
                            tbSync.dump("recieved", "expecting wbxml but got - " + req.responseText + ", request status = " + req.status + ", ready state = " + req.readyState);
                        }
                    }
                    callback(req.responseText, syncdata);
                    break;

                case 401: // AuthError
                    this.finishSync(syncdata, req.status);
                    break;

                case 449: // Request for new provision
                    if (tbSync.db.getAccountSetting(syncdata.account, "provision") == "1") {
                        eas.initSync("resync", syncdata.account, syncdata.folderID);
                    } else {
                        this.finishSync(syncdata, req.status);
                    }
                    break;

                case 451: // Redirect - update host and login manager 
                    let header = req.getResponseHeader("X-MS-Location");
                    let newHost = header.slice(header.indexOf("://") + 3, header.indexOf("/M"));
                    let connection = tbSync.getConnection(syncdata.account);
                    let password = tbSync.getPassword(connection);

                    tbSync.dump("redirect (451)", "header: " + header + ", oldHost: " + connection.host + ", newHost: " + newHost);

                    //If the current connection has a LoginInfo (password stored !== null), try to update it
                    if (password !== null) {
                        tbSync.dump("redirect (451)", "updating loginInfo");
                        let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
                        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
                        
                        //remove current login info
                        let currentLoginInfo = new nsLoginInfo(connection.host, connection.host, null, connection.user, password, "USER", "PASSWORD");
                        myLoginManager.removeLogin(currentLoginInfo);

                        //update host and add new login info
                        connection.host = newHost;
                        let newLoginInfo = new nsLoginInfo(connection.host, connection.host, null, connection.user, password, "USER", "PASSWORD");
                        try {
                            myLoginManager.addLogin(newLoginInfo);
                        } catch (e) {
                            this.finishSync(syncdata, "httperror::" + req.status);
                        }
                    } else {
                        //just update host
                        connection.host = newHost;
                    }

                    //TODO: We could end up in a redirect loop - stop here and ask user to manually resync?
                    eas.initSync("resync", syncdata.account); //resync everything
                    break;
                    
                default:
                    this.finishSync(syncdata, "httperror::" + req.status);
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
