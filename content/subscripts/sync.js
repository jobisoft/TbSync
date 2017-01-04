/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */
"use strict";

var sync = {

    // SYNC QUEUE MANAGEMENT
    
    syncQueue : [],
    syncState : "idle", //replace pref with this var?
    syncingNow : "",

    addAccountToSyncQueue: function (job, account = "") {
        if (account == "") {
            //Add all connected accounts to the queue - at this point we do not know anything about folders, they are handled by the sync process
            let accounts = tzPush.db.getAccounts().IDs;
            for (let i=0; i<accounts.length; i++) {
                sync.syncQueue.push( job + "." + accounts[i] );
            }
        } else {
            //Add specified account to the queue
            sync.syncQueue.push( job + "." + account );
        }

        //after jobs have been aded to the queue, try to start working on the queue
        if (tzPush.db.prefSettings.getCharPref("syncstate") == "idle") sync.workSyncQueue();
    },
    
    workSyncQueue: function () {
        //workSyncQueue assumes, that it is allowed to start a new sync job
        //if no more jobs in queue, do nothing
        if (sync.syncQueue.length == 0) return;

        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);

        let syncrequest = sync.syncQueue.shift().split(".");
        let job = syncrequest[0];
        let account = syncrequest[1];

        switch (job) {
            case "sync":
            case "resync":
                sync.init(job, account);
                break;
            default:
                tzPush.dump("workSyncQueue()", "Unknow job for sync queue ("+ job + ")");
        }
    },

    finishAccountSync: function (syncdata) {
        let state = tzPush.db.getAccountSetting(syncdata.account, "state");
        
        if (state == "connecting") {
            if (syncdata.status == "OK") {
                tzPush.db.setAccountSetting(syncdata.account, "state", "connected");
            } else {
                this.disconnectAccount(syncdata.account);
                tzPush.db.setAccountSetting(syncdata.account, "state", "disconnected");
            }
        }

        //update account
        tzPush.db.setAccountSetting(syncdata.account, "lastsynctime", Date.now());
        tzPush.db.setAccountSetting(syncdata.account, "status", syncdata.status);
        
        //update of settings window
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.notifyObservers(null, "tzpush.accountSyncFinished", syncdata.account + "." + syncdata.status);
        
        //work on the queue
        if (sync.syncQueue.length > 0) sync.workSyncQueue();
        else sync.setSyncState("idle"); 
    },


    resetSync: function () {
        //set state to idle
        sync.setSyncState("idle"); 
        //flush the queue
        sync.syncQueue = [];

        //check each account, if state is "connecting" and disconnect it
        let accounts = db.getAccounts();
        for (let i=0; i<accounts.IDs.length; i++) {
            if (accounts.data[accounts.IDs[i]].state == "connecting") this.disconnectAccount(accounts.IDs[i]);
        }
    },

    init: function (job, account,  folderID = "") {

        //set syncdata for this sync process
        let syncdata = {};
        syncdata.account = account;
        syncdata.folderID = folderID;
        syncdata.fResync = false;
        syncdata.status = "OK";
        sync.setSyncState("syncing", syncdata);

//        //notify settings gui about fresh sync (only for full account syncs)
//        if (folderID == "") {
//            let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
//            observerService.notifyObservers(null, "tzpush.accountSyncStarted", syncdata.account);
//        }

        //Check if connected
        if (tzPush.db.getAccountSetting(account, "state") == "disconnected") { //allow connected and connecting
            this.finishSync(syncdata, "notconnected");
            return;
        }

        //Check if connection has data
        let connection = tzPush.getConnection(account);
        if (connection.server == "" || connection.user == "") {
            this.finishSync(syncdata, "nouserhost");
            return;
        }

        switch (job) {
            case "resync":
                syncdata.fResync = true;
                tzPush.db.setAccountSetting(account, "policykey", "");

                //if folderID present, resync only that one folder, otherwise all folders
                if (folderID !== "") {
                    tzPush.db.setFolderSetting(account, folderID, "synckey", "");
                } else {
                    tzPush.db.setAccountSetting(account, "foldersynckey", "");
                    tzPush.db.setFolderSetting(account, "", "synckey", "");
                }
                
            case "sync":
                if (tzPush.db.getAccountSetting(account, "provision") == "1" && tzPush.db.getAccountSetting(account, "policykey") == "") {
                    this.getPolicykey(syncdata);
                } else {
                    this.getFolderIds(syncdata);
                }
                break;
        }
    },

    connectAccount: function (account) {
        db.setAccountSetting(account, "state", "connecting");
        db.setAccountSetting(account, "policykey", "");
        db.setAccountSetting(account, "foldersynckey", "");
    },

    disconnectAccount: function (account) {
        db.setAccountSetting(account, "state", "disconnected");
        db.setAccountSetting(account, "status", "notconnected");
        db.setAccountSetting(account, "policykey", "");
        db.setAccountSetting(account, "foldersynckey", "");

        //Delete all targets - TODO: based on type
        let folders = db.findFoldersWithSetting("selected", "true", account);
        for (let i = 0; i<folders.length; i++) {
            tzPush.removeBook(folders[i].target);
        }
        db.deleteAllFolders(account);
    },









    // GLOBAL SYNC FUNCTIONS

    getPolicykey: function(syncdata) {
        let wbxml = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x00, 0x0E, 0x45, 0x46, 0x47, 0x48, 0x03, 0x4D, 0x53, 0x2D, 0x57, 0x41, 0x50, 0x2D, 0x50, 0x72, 0x6F, 0x76, 0x69, 0x73, 0x69, 0x6F, 0x6E, 0x69, 0x6E, 0x67, 0x2D, 0x58, 0x4D, 0x4C, 0x00, 0x01, 0x01, 0x01, 0x01);
        if (tzPush.db.getAccountSetting(syncdata.account, "asversion") !== "2.5") {
            wbxml = wbxml.replace("MS-WAP-Provisioning-XML", "MS-EAS-Provisioning-WBXML");
        }
        syncdata.next = 1;
        wbxml = this.Send(wbxml, this.getPolicykeyCallback.bind(this), "Provision", syncdata);
    },
    
    getPolicykeyCallback: function (responseWbxml, syncdata) {
        let policykey = this.FindPolicykey(responseWbxml);
        tzPush.dump("policykeyCallback("+syncdata.next+")", policykey);
        tzPush.db.setAccountSetting(syncdata.account, "policykey", policykey);
        //next == 1 and 2 = resend - next ==3 = GetFolderIds() - 
        // - the protocol requests us to first send zero as policykey and get a temp policykey in return,
        // - the we need to resend this tempkey and get the final one 
        // - then we need to resend the final one and check, if we get that one back - THIS CHECK IS MISSING (TODO)
        if (syncdata.next < 3) {
            let wbxml = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x00, 0x0E, 0x45, 0x46, 0x47, 0x48, 0x03, 0x4D, 0x53, 0x2D, 0x57, 0x41, 0x50, 0x2D, 0x50, 0x72, 0x6F, 0x76, 0x69, 0x73, 0x69, 0x6F, 0x6E, 0x69, 0x6E, 0x67, 0x2D, 0x58, 0x4D, 0x4C, 0x00, 0x01, 0x49, 0x03, 0x50, 0x6F, 0x6C, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x4B, 0x03, 0x31, 0x00, 0x01, 0x01, 0x01, 0x01);
            //Proposed Fix: Also change the WAP string, if asversion !== 2.5 - as done in the main Policykey() function.
            if (tzPush.db.getAccountSetting(syncdata.account, "asversion") !== "2.5") {
                wbxml = wbxml.replace("MS-WAP-Provisioning-XML", "MS-EAS-Provisioning-WBXML");
            }
            wbxml = wbxml.replace('PolKeyReplace', policykey);
            syncdata.next++;
            this.Send(wbxml, this.getPolicykeyCallback.bind(this), "Provision", syncdata);
        } else {
            let policykey = this.FindPolicykey(responseWbxml);
            tzPush.dump("final returned policykey", policykey);
            this.getFolderIds(syncdata);
        }
    },

    FindPolicykey: function (wbxml) {
        let x = String.fromCharCode(0x49, 0x03); //<PolicyKey> Code Page 14
        let start = wbxml.indexOf(x) + 2;
        let end = wbxml.indexOf(String.fromCharCode(0x00), start);
        return wbxml.substring(start, end);
    },


    getFolderIds: function(syncdata) {
        //if syncdata already contains a folderID, it is a specific folder sync - otherwise we scan all folders and sync all folders
        if (syncdata.folderID != "") {
            tzPush.db.setFolderSetting(syncdata.account, syncdata.folderID, "status", "PENDING");
            this.syncNextFolder(syncdata);
        } else {
            let wbxml = String.fromCharCode(0x03, 0x01, 0x6a, 0x00, 0x00, 0x07, 0x56, 0x52, 0x03, 0x30, 0x00, 0x01, 0x01);
            this.Send(wbxml, this.getFolderIdsCallback.bind(this), "FolderSync", syncdata);
        }
    },

    getFolderIdsCallback: function (wbxml, syncdata) { //ActiveSync Commands taken from TzPush 2.5.4
        let foldersynckey = this.FindKey(wbxml);
        tzPush.db.setAccountSetting(syncdata.account, "foldersynckey", foldersynckey); //not used ???

        let start = 0;
        let numst = wbxml.indexOf(String.fromCharCode(0x4E, 0x57));
        let numsp = wbxml.indexOf(String.fromCharCode(0x00), numst);
        let num = parseInt(wbxml.substring(numst + 3, numsp));

        // get currently stored folder data from db and clear db
        // the last parameter must not be false, because we need
        // a COPY of the cache: deleteAllFolders will clear the cache,
        // which would render a reference useless!
        let folders = tzPush.db.getFolders(syncdata.account, true); 
        // clear DB (and cache!)
        tzPush.db.deleteAllFolders(syncdata.account);
                
        for (let x = 0; x < num; x++) {
            start = wbxml.indexOf(String.fromCharCode(0x4F), start);
            let dict = {};
            for (let y = 0; y < 4; y++) {
                start = wbxml.indexOf(String.fromCharCode(0x03), start) + 1;
                let end = wbxml.indexOf(String.fromCharCode(0x00), start);
                dict[y] = wbxml.substring(start, end);
                start = end;
            }
            
            let newData ={};
            newData.account = syncdata.account;
            newData.folderID = dict[0];
            newData.name = dict[2];
            newData.type = dict[3];
            newData.synckey = "";
            newData.target = "";
            newData.selected = "";
            newData.lastsynctime = "";
            newData.status = "";
                
                
            if (folders !== null && folders.hasOwnProperty(newData.folderID)) {
                //this folder is known, if type did not change, use current settings
                let curData = folders[newData.folderID];
                if (curData.type == newData.type) {
                    newData.synckey = curData.synckey;
                    newData.target = curData.target;
                    newData.selected = curData.selected;
                }
            } else {
                //new folder, check if it is a default contact folder and auto select it - TODO: Calendar
                if (newData.type == "9" || newData.type == "14" || newData.type == "8") { 
                    newData.selected = "true"; 
                }
            }

            //Set status of each selected folder to PENDING
            if (newData.selected == "true") newData.status="PENDING";
            tzPush.db.addFolder(newData);
            
        }
        this.syncNextFolder(syncdata);
    },


    //Process all folders with PENDING status
    syncNextFolder: function (syncdata) {
        let folders = tzPush.db.findFoldersWithSetting("status", "PENDING", syncdata.account);
        if (folders.length == 0 || syncdata.status != "OK") {
            //all folders of this account have been synced
            sync.finishAccountSync(syncdata);
        } else {
            syncdata.synckey = folders[0].synckey;
            syncdata.folderID = folders[0].folderID;
            
            if (syncdata.synckey == "") {
                let wbxml = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x4B, 0x03, 0x30, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x01, 0x01, 0x01);
                if (tzPush.db.getAccountSetting(syncdata.account, "asversion") == "2.5") {
                    wbxml = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x50, 0x03, 0x43, 0x6F, 0x6E, 0x74, 0x61, 0x63, 0x74, 0x73, 0x00, 0x01, 0x4B, 0x03, 0x30, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x01, 0x01, 0x01);
                }
                wbxml = wbxml.replace('Id2Replace', syncdata.folderID);
                this.Send(wbxml, this.getSynckey.bind(this), "Sync", syncdata);
            } else {
                this.startSync(syncdata); 
            }
        }
    },


    getSynckey: function (responseWbxml, syncdata) {
        syncdata.synckey = this.FindKey(responseWbxml);
        tzPush.db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", syncdata.synckey);
        this.startSync(syncdata); 
    },


    startSync: function (syncdata) {
        syncdata.type = tzPush.db.getFolderSetting(syncdata.account, syncdata.folderID, "type");
        switch (syncdata.type) {
            case "9": 
            case "14": 
                contactsync.fromzpush(syncdata);
                break;
            case "8":
                calendarsync.fromzpush(syncdata);
                break;
            default:
                tzPush.dump("startSync()", "Skipping unknown folder type <"+syncdata.type+">");
                this.finishSync(syncdata);
        }
    },


    finishSync: function (syncdata, error = "") {
        //a folder has been finished, process next one
        let time = Date.now();
        let status = "OK";
        if (error !== "") {
            tzPush.dump("finishSync(): Error @ Account #" + syncdata.account, tzPush.getLocalizedMessage("status." + error));
            syncdata.status = error; //store latest error
            status = error;
            time = "";
        }

        if (syncdata.folderID) {
            tzPush.db.setFolderSetting(syncdata.account, syncdata.folderID, "status", status);
            tzPush.db.setFolderSetting(syncdata.account, syncdata.folderID, "lastsynctime", time);
        }

        sync.setSyncState("done", syncdata);
        this.syncNextFolder(syncdata);
    },


    setSyncState: function(syncstate, syncdata = null) {
        //set new syncstate
        tzPush.db.prefSettings.setCharPref("syncstate", syncstate);

        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        let msg = tzPush.getLocalizedMessage("syncstate." + syncstate);
        let accountname = "";
        let foldername = "";
        let prefTarget = "";
        let statusTarget = "";

        //generate notifies to update gui with new syncstate
        if (syncdata !== null) {
            //also keep track of the current sync
            sync.syncingNow = syncdata.account;
            
            accountname = "#" + syncdata.account;
            
            let accounts = tzPush.db.getAccounts().data;
            if (accounts.hasOwnProperty(syncdata.account)) {
                accountname = accounts[syncdata.account].accountname;
                if (syncdata.folderID !== "") foldername = tzPush.db.getFolderSetting(syncdata.account, syncdata.folderID, "name");
            }
            
            if (foldername != "") { 
                if (syncstate == "done") { //Done without folder info in pref window and status bar
                    statusTarget = " [" + accountname + "]";
                } else {
                    prefTarget = " [" + foldername + "]"; 
                    statusTarget = " [" + accountname + "/" + foldername + "]";
                }
            }
            observerService.notifyObservers(null, "tzpush.setPrefInfo", syncdata.account + "." + msg + prefTarget);
        } else {
            sync.syncingNow = "";
        }
        
        observerService.notifyObservers(null, "tzpush.setStatusBar", msg + statusTarget);
    },


    checkSyncTarget: function (account, folderID) { //TODO: based on type contact/calendar
        let folder = tzPush.db.getFolder(account, folderID, false); //get read-only-reference
        let targetName = tzPush.getAddressBookName(folder.target);
        let targetObject = tzPush.getAddressBookObject(folder.target);
        
        if (targetName !== null && targetObject !== null && targetObject instanceof Components.interfaces.nsIAbDirectory) return true;
        
        // Get unique Name for new address book
        let testname = tzPush.db.getAccountSetting(account, "accountname") + "." + folder.name;
        let newname = testname;
        let count = 1;
        let unique = false;
        do {
            unique = true;
            let booksIter = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager).directories;
            while (booksIter.hasMoreElements()) {
                let data = booksIter.getNext();
                if (data instanceof Components.interfaces.nsIAbDirectory && data.dirName == newname) {
                    unique = false;
                    break;
                }
            }
            if (!unique) {
                newname = testname + "." + count;
                count = count + 1;
            }
        } while (!unique);
        
        //Create the new book with the unique name
        let dirPrefId = tzPush.addBook(newname);
        
        //find uri of new book and store in DB
        let booksIter = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager).directories;
        while (booksIter.hasMoreElements()) {
            let data = booksIter.getNext();
            if (data instanceof Components.interfaces.nsIAbDirectory && data.dirPrefId == dirPrefId) {
                tzPush.db.setFolderSetting(account, folderID, "target", data.URI); 
                tzPush.dump("checkSyncTarget("+account+", "+folderID+")", "Creating new sync target (" + newname + ", " + data.URI + ")");
                return true;
            }
        }
        
        return false;
    },


    Send: function (wbxml, callback, command, syncdata) {
        let platformVer = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo).platformVersion;   
        
        if (tzPush.db.prefSettings.getBoolPref("debugwbxml")) {
            tzPush.dump("sending", decodeURIComponent(escape(wbxml2xml.convert(wbxml).split('><').join('>\n<'))));
            tzPush.appendToFile("wbxml-debug.log", wbxml);
        }

        let connection = tzPush.getConnection(syncdata.account);
        let password = tzPush.getPassword(connection);

        let deviceType = 'Thunderbird';
        let deviceId = tzPush.db.getAccountSetting(syncdata.account, "deviceId");
        
        // Create request handler
        let req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
        req.mozBackgroundRequest = true;
        if (tzPush.db.prefSettings.getBoolPref("debugwbxml")) {
            tzPush.dump("sending", "POST " + connection.url + '?Cmd=' + command + '&User=' + connection.user + '&DeviceType=' +deviceType + '&DeviceId=' + deviceId, true);
        }
        req.open("POST", connection.url + '?Cmd=' + command + '&User=' + connection.user + '&DeviceType=' +deviceType + '&DeviceId=' + deviceId, true);
        req.overrideMimeType("text/plain");
        req.setRequestHeader("User-Agent", deviceType + ' ActiveSync');
        req.setRequestHeader("Content-Type", "application/vnd.ms-sync.wbxml");
        req.setRequestHeader("Authorization", 'Basic ' + btoa(connection.user + ':' + password));
        if (tzPush.db.getAccountSetting(syncdata.account, "asversion") == "2.5") {
            req.setRequestHeader("MS-ASProtocolVersion", "2.5");
        } else {
            req.setRequestHeader("MS-ASProtocolVersion", "14.0");
        }
        req.setRequestHeader("Content-Length", wbxml.length);
        if (tzPush.db.getAccountSetting(syncdata.account, "provision") == "1") {
            req.setRequestHeader("X-MS-PolicyKey", tzPush.db.getAccountSetting(syncdata.account, "policykey"));
        }

        // Define response handler for our request
        req.onreadystatechange = function() { 
            //tzPush.dump("header",req.getAllResponseHeaders().toLowerCase())
            if (req.readyState === 4 && req.status === 200) {

                wbxml = req.responseText;
                if (tzPush.db.prefSettings.getBoolPref("debugwbxml")) {
                    tzPush.dump("recieved", tzPush.decode_utf8(wbxml2xml.convert(wbxml).split('><').join('>\n<')));
                    tzPush.appendToFile("wbxml-debug.log", wbxml);
                    //tzPush.dump("header",req.getAllResponseHeaders().toLowerCase())
                }
                if (wbxml.substr(0, 4) !== String.fromCharCode(0x03, 0x01, 0x6A, 0x00)) {
                    if (wbxml.length !== 0) {
                        tzPush.dump("recieved", "expecting wbxml but got - " + req.responseText + ", request status = " + req.status + ", ready state = " + req.readyState);
                    }
                }
                callback(req.responseText, syncdata);
            } else if (req.readyState === 4) {

                switch(req.status) {
                    case 0: // ConnectError
                        this.finishSync(syncdata, req.status);
                        break;
                    
                    case 401: // AuthError
                        this.finishSync(syncdata, req.status);
                        break;
                    
                    case 449: // Request for new provision
                        if (tzPush.db.getAccountSetting(syncdata.account, "provision") == "1") {
                            sync.init("resync", syncdata.account, syncdata.folderID);
                        } else {
                            this.finishSync(syncdata, req.status);
                        }
                        break;
                
                    case 451: // Redirect - update host and login manager 
                        let header = req.getResponseHeader("X-MS-Location");
                        let newHost = header.slice(header.indexOf("://") + 3, header.indexOf("/M"));
                        let connection = tzPush.getConnection(syncdata.account);
                        let password = tzPush.getPassword(connection);

                        tzPush.dump("redirect (451)", "header: " + header + ", oldHost: " + connection.host + ", newHost: " + newHost);
                        
                        //If the current connection has a LoginInfo (password stored !== null), try to update it
                        if (password !== null) {
                            tzPush.dump("redirect (451)", "updating loginInfo");
                            let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
                            let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
                            
                            //remove current login info
                            let currentLoginInfo = new nsLoginInfo(connection.host, connection.url, null, connection.user, password, "USER", "PASSWORD");
                            myLoginManager.removeLogin(currentLoginInfo);

                            //update host and add new login info
                            connection.host = newHost;
                            let newLoginInfo = new nsLoginInfo(connection.host, connection.url, null, connection.user, password, "USER", "PASSWORD");
                            try {
                                myLoginManager.addLogin(newLoginInfo);
                            } catch (e) {
                                this.finishSync(syncdata, req.status);
                            }
                        } else {
                            //just update host
                            connection.host = newHost;
                        }

                        //TODO: We could end up in a redirect loop - stop here and ask user to manually resync?
                        sync.init("resync", syncdata.account); //resync everything
                        break;
                        
                    default:
                        tzPush.dump("request status", "reported -- " + req.status);
                        this.finishSync(syncdata, req.status);
                }
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
                //tzPush.dump("ui8Data",wbxml2xml.convert(wbxml))
                req.send(ui8Data);
            }
        } catch (e) {
            tzPush.dump("unknown error", e);
        }

        return true;
    },





    // WBXML TOOLS

    FindKey: function (wbxml) {
        let x = String.fromCharCode(0x4b, 0x03); //<SyncKey> Code Page 0
        if (wbxml.substr(5, 1) === String.fromCharCode(0x07)) {
            x = String.fromCharCode(0x52, 0x03); //<SyncKey> Code Page 7
        }

        let start = wbxml.indexOf(x) + 2;
        let end = wbxml.indexOf(String.fromCharCode(0x00), start);
        return wbxml.substring(start, end);
    }

/*    FindFolder: function (wbxml, type) {
        let start = 0;
        let end;
        let folderID;
        let Scontact = String.fromCharCode(0x4A, 0x03) + type + String.fromCharCode(0x00, 0x01);
        let contact = wbxml.indexOf(Scontact);
        while (wbxml.indexOf(String.fromCharCode(0x48, 0x03), start) < contact) {
            start = wbxml.indexOf(String.fromCharCode(0x48, 0x03), start) + 2;
            end = wbxml.indexOf(String.fromCharCode(0x00), start);
            if (start === 1) {
                break;
            }
            folderID = wbxml.substring(start, end); //we should be able to end the loop with return.
        }
        return folderID;
    }, */

};
