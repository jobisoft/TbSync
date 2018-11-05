/*
 * This file is part of TbSync.
 *
 * TbSync is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * TbSync is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with TbSync. If not, see <https://www.gnu.org/licenses/>.
 */
 
 "use strict";

tbSync.includeJS("chrome://tbsync/content/provider/eas/wbxmltools.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/xmltools.js");

var eas = {
    bundle: Services.strings.createBundle("chrome://tbsync/locale/eas.strings"),
    minTbSyncVersionRequired: "0",

    //use flags instead of strings to avoid errors due to spelling errors
    flags : Object.freeze({
        allowEmptyResponse: true, 
        syncNextFolder: "syncNextFolder",
        resyncFolder: "resyncFolder", //will take down target and do a fresh sync
        resyncAccount: "resyncAccount", //will loop once more, but will not do any special actions
        abortWithError: "abortWithError",
        abortWithServerError: "abortWithServerError",
    }),
    


    /**
     * Called during load of external provider extension to init provider.
     *
     * @param lightningIsAvail       [in] indicate wheter lightning is installed/enabled
     */
    load: Task.async (function* (lightningIsAvail) {
        //dynamically load overlays from xpi
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abEditCardDialog.xul", "chrome://tbsync/content/provider/eas/overlays/abCardWindow.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://tbsync/content/provider/eas/overlays/abCardWindow.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://tbsync/content/provider/eas/overlays/addressbookoverlay.xul");

        //inform users to install EAS provider
        let showMigrationPopup = false;
        let accounts = tbSync.db.getAccounts();
        for (let i = 0; i < accounts.IDs.length; i++) {
            if (accounts.data[accounts.IDs[i]].provider == "eas") {
                showMigrationPopup = true;
            }
        }
        if (showMigrationPopup && !tbSync.eas4tbsync && tbSync.window.confirm(tbSync.getLocalizedMessage("migrate"))) {
		tbSync.openTBtab("https://addons.thunderbird.net/de/thunderbird/addon/eas-4-tbsync/");
	}
        if (lightningIsAvail) {
            //If an EAS calendar is currently NOT associated with an email identity, try to associate, 
            //but do not change any explicitly set association
            // - A) find email identity and accociate (which sets organizer to that user identity)
            // - B) overwrite default organizer with current best guess
            //TODO: Do this after email accounts changed, not only on restart? 
            let folders = tbSync.db.findFoldersWithSetting(["selected","type"], ["1","8,13"], "provider", "eas");
            for (let f=0; f < folders.length; f++) {
                let calendar = cal.getCalendarManager().getCalendarById(folders[f].target);
                if (calendar && calendar.getProperty("imip.identity.key") == "") {
                    //is there an email identity for this eas account?
                    let key = tbSync.getIdentityKey(tbSync.db.getAccountSetting(folders[f].account, "user"));
                    if (key === "") { //TODO: Do this even after manually switching to NONE, not only on restart?
                        //set transient calendar organizer settings based on current best guess and 
                        calendar.setProperty("organizerId", cal.email.prependMailTo(tbSync.db.getAccountSetting(folders[f].account, "user")));
                        calendar.setProperty("organizerCN",  calendar.getProperty("fallbackOrganizerName"));
                    } else {                      
                        //force switch to found identity
                        calendar.setProperty("imip.identity.key", key);
                    }
                }
            }
        }

    }),

    /**
     * Called during unload of external provider extension to unload provider.
     *
     * @param lightningIsAvail       [in] indicate wheter lightning is installed/enabled
     */
    unload: function (lightningIsAvail) {
        tbSync.dump("Unloading", "eas");
    },


    /**
     * Returns location of 16x16 pixel provider icon.
     */
    getProviderIcon: function () {
        return "chrome://tbsync/skin/eas16.png";
    },



    /**
     * Return object which contains all possible fields of a row in the accounts database with the default value if not yet stored in the database.
     */
    getDefaultAccountEntries: function () {
        let row = {
            "account" : "",
            "accountname": "",
            "provider": "eas",
            "policykey" : "0", 
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
            "devicetype": tbSync.prefSettings.getCharPref("eas.clientID.type"),
            }; 
        return row;
    },



    /**
     * Return object which contains all possible fields of a row in the folder database with the default value if not yet stored in the database.
     */
    getDefaultFolderEntries: function (account) {
        let folder = {
            "account" : account,
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
            "useChangeLog" : "1", //log changes into changelog
            "downloadonly" : tbSync.db.getAccountSetting(account, "downloadonly"), //each folder has its own settings, the main setting is just the default,
            };
        return folder;
    },
    


    /**
     * Returns an array of folder settings, that should survive disable and re-enable
     */
    getPersistentFolderSettings: function () {
        return ["targetName", "targetColor", "selected"];
    },



    /**
     * Return the thunderbird type (tb-contact, tb-event, tb-todo) for a given folder type of this provider. A provider could have multiple 
     * type definitions for a single thunderbird type (default calendar, shared address book, etc), this maps all possible provider types to
     * one of the three thunderbird types.
     *
     * @param type       [in] provider folder type
     */
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



    /**
     * Is called everytime an account of this provider is enabled in the manager UI, set/reset database fields as needed.
     *
     * @param account       [in] account which is being enabled
     */
    onEnableAccount: function (account) {
        db.resetAccountSetting(account, "policykey");
        db.resetAccountSetting(account, "foldersynckey");
        db.resetAccountSetting(account, "lastEasOptionsUpdate");
        db.resetAccountSetting(account, "lastsynctime");
    },



    /**
     * Is called everytime an account of this provider is disabled in the manager UI, set/reset database fields as needed and
     * remove/backup all sync targets of this account.
     *
     * @param account       [in] account which is being disabled
     */
    onDisableAccount: function (account) {
    },



    /**
     * Is called everytime an new target is created, intended to set a clean sync status.
     *
     * @param account       [in] account the new target belongs to
     * @param folderID       [in] folder the new target belongs to
     */
    onResetTarget: function (account, folderID) {
        db.resetFolderSetting(account, folderID, "synckey");
        db.resetFolderSetting(account, folderID, "lastsynctime");
    },
    


    /**
     * Is called if TbSync needs to create a new thunderbird address book associated with an account of this provider.
     *
     * @param newname       [in] name of the new address book
     * @param account       [in] id of the account this address book belongs to
     * @param folderID      [in] id of the folder this address book belongs to (sync target)
     *
     * return the id of the newAddressBook 
     */
    createAddressBook: function (newname, account, folderID) {
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        return abManager.newAddressBook(newname, "", 2); /* kPABDirectory - return abManager.newAddressBook(name, "moz-abmdbdirectory://", 2); */
    },



    /**
     * Is called if TbSync needs to create a new UID for an address book card
     *
     * @param aItem       [in] card that needs new ID
     *
     * returns the new id 
     */
    getNewCardID: function (aItem, folder) {
        return aItem.localId;
    },



    /**
     * Is called if TbSync needs to create a new lightning calendar associated with an account of this provider.
     *
     * @param newname       [in] name of the new calendar
     * @param account       [in] id of the account this calendar belongs to
     * @param folderID      [in] id of the folder this calendar belongs to (sync target)
     */
    createCalendar: function(newname, account, folderID) {
        let calManager = cal.getCalendarManager();
        //Alternative calendar, which uses calTbSyncCalendar
        //let newCalendar = calManager.createCalendar("TbSync", Services.io.newURI('tbsync-calendar://'));

        //Create the new standard calendar with a unique name
        let newCalendar = calManager.createCalendar("storage", Services.io.newURI("moz-storage-calendar://"));
        newCalendar.id = cal.getUUID();
        newCalendar.name = newname;

        newCalendar.setProperty("color", tbSync.db.getFolderSetting(account, folderID, "targetColor"));
        newCalendar.setProperty("relaxedMode", true); //sometimes we get "generation too old for modifyItem", check can be disabled with relaxedMode
        newCalendar.setProperty("calendar-main-in-composite",true);

        calManager.registerCalendar(newCalendar);

        //is there an email identity we can associate this calendar to? 
        //getIdentityKey returns "" if none found, which removes any association
        let key = tbSync.getIdentityKey(tbSync.db.getAccountSetting(account, "user"));
        newCalendar.setProperty("fallbackOrganizerName", newCalendar.getProperty("organizerCN"));
        newCalendar.setProperty("imip.identity.key", key);
        if (key === "") {
            //there is no matching email identity - use current default value as best guess and remove association
            //use current best guess 
            newCalendar.setProperty("organizerCN", newCalendar.getProperty("fallbackOrganizerName"));
            newCalendar.setProperty("organizerId", cal.email.prependMailTo(tbSync.db.getAccountSetting(account, "user")));
        }
        
        return newCalendar;
    },



    /**
     * Is called if TbSync needs to find contacts in the global address list (GAL / directory) of an account associated with this provider.
     * It is used for autocompletion while typing something into the address field of the message composer and for the address book search,
     * if something is typed into the search field of the Thunderbird address book.
     *
     * TbSync will execute this only for queries longer than 3 chars.
     *
     * DO NOT IMPLEMENT AT ALL, IF NOT SUPPORTED
     *
     * @param account       [in] id of the account which should be searched
     * @param currentQuery  [in] search query
     */
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
// Not valid for GAL: https://msdn.microsoft.com/en-us/library/gg675461(v=exchg.80).aspx
//                wbxml.otag("Options");
//                    wbxml.atag("DeepTraversal");
//                    wbxml.atag("RebuildResults");
//                wbxml.ctag();
            wbxml.ctag();
        wbxml.ctag();

        let syncdata = {};
        syncdata.account = account;
        syncdata.folderID = "";
        syncdata.syncstate = "SearchingGAL";
        
            
        let response = yield eas.sendRequest(wbxml.getBytes(), "Search", syncdata);
        let wbxmlData = eas.getDataFromResponse(response);
        let galdata = [];

        if (wbxmlData.Search && wbxmlData.Search.Response && wbxmlData.Search.Response.Store && wbxmlData.Search.Response.Store.Result) {
            let results = xmltools.nodeAsArray(wbxmlData.Search.Response.Store.Result);
            let accountname = tbSync.db.getAccountSetting(account, "accountname");
        
            for (let count = 0; count < results.length; count++) {
                if (results[count].Properties) {
                    //tbSync.window.console.log('Found contact:' + results[count].Properties.DisplayName);
                    let resultset = {};

                    resultset.properties = {};                    
                    resultset.properties["FirstName"] = results[count].Properties.FirstName;
                    resultset.properties["LastName"] = results[count].Properties.LastName;
                    resultset.properties["DisplayName"] = results[count].Properties.DisplayName;
                    resultset.properties["PrimaryEmail"] = results[count].Properties.EmailAddress;
                    resultset.properties["CellularNumber"] = results[count].Properties.MobilePhone;
                    resultset.properties["HomePhone"] = results[count].Properties.HomePhone;
                    resultset.properties["WorkPhone"] = results[count].Properties.Phone;
                    resultset.properties["Company"] = accountname; //results[count].Properties.Company;
                    resultset.properties["Department"] = results[count].Properties.Title;
                    resultset.properties["JobTitle"] = results[count].Properties.Office;

                    resultset.autocomplete = {};                    
                    resultset.autocomplete.value = results[count].Properties.DisplayName + " <" + results[count].Properties.EmailAddress + ">";
                    resultset.autocomplete.account = account;
                        
                    galdata.push(resultset);
                }
            }
        }
        
        return galdata;
    }),



    /**
     * Is called if one or more cards have been selected in the addressbook, to update 
     * field information in the card view pane
     * 
     * OPTIONAL, do not implement, if this provider is not adding any fields to the
     * address book
     *
     * @param window       [in] window obj of address book
     * @param card         [in] selected card
     */
    onAbResultsPaneSelectionChanged: function (window, card) {
        let email3Box = window.document.getElementById("cvEmail3Box");
        if (email3Box) {
            let email3Value = card.getProperty("Email3Address","");
            if (email3Value) {
                email3Box.hidden = false;
                let email3Element = window.document.getElementById("cvEmail3");
                window.HandleLink(email3Element, window.zSecondaryEmail, email3Value, email3Box, "mailto:" + email3Value);
            }
        }
    },
    


    /**
     * Is called if a card is loaded in the edit dialog to show/hide elements 
    *  besides those of class type "<provider>Container"
     * 
     * OPTIONAL, do not implement, if this provider is not manipulating 
     * the edit/new dialog beyond toggeling the elements of 
     * class  "<provider>Container"
     *
     * @param document       [in] document obj of edit/new dialog
     * @param isOwnProvider  [in] true if the open card belongs to this provider
     */
    onAbCardLoad: function (document, isOwnProvider) {
    },


    /**
     * Is called if TbSync needs to synchronize an account.
     *
     * @param syncdata      [in] object that contains the account and maybe the folder which needs to worked on
     *                           you are free to add more fields to this object which you need (persistent) during sync
     * @param job           [in] identifier about what is to be done, the standard job is "sync", you are free to add
     *                           custom jobs like "deletefolder" via your own accountSettings.xul
     */
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
                if (connection.host == "" || connection.user == "") {
                    throw eas.finishSync("nouserhost", eas.flags.abortWithError);
                }
                
                //should we recheck options/commands? Always check, if we have no info about asversion!
                if (tbSync.db.getAccountSetting(syncdata.account, "asversion", "") == "" || (Date.now() - tbSync.db.getAccountSetting(syncdata.account, "lastEasOptionsUpdate")) > 86400000 ) {
                    yield eas.getServerOptions(syncdata);
                }
                                
                //only update the actual used asversion, if we are currently not connected or it has not yet been set
                if (tbSync.db.getAccountSetting(syncdata.account, "asversion", "") == "" || !tbSync.isConnected(syncdata.account)) {
                    //eval the currently in the UI selected EAS version
                    let asversionselected = tbSync.db.getAccountSetting(syncdata.account, "asversionselected");
                    let allowedVersionsString = tbSync.db.getAccountSetting(syncdata.account, "allowedEasVersions").trim();
                    let allowedVersionsArray = allowedVersionsString.split(",");

                    if (asversionselected == "auto") {
                        if (allowedVersionsArray.includes("14.0")) tbSync.db.setAccountSetting(syncdata.account, "asversion", "14.0");
                        else if (allowedVersionsArray.includes("2.5")) tbSync.db.setAccountSetting(syncdata.account, "asversion", "2.5");
                        else if (allowedVersionsString == "") {
                            throw eas.finishSync("InvalidServerOptions", eas.flags.abortWithError);
                        } else {
                            throw eas.finishSync("nosupportedeasversion::"+allowedVersionsArray.join(", "), eas.flags.abortWithError);
                        }
                    } else if (allowedVersionsString != "" && !allowedVersionsArray.includes(asversionselected)) {
                        throw eas.finishSync("notsupportedeasversion::"+asversionselected+"::"+allowedVersionsArray.join(", "), eas.flags.abortWithError);
                    } else {
                        //just use the value set by the user
                        tbSync.db.setAccountSetting(syncdata.account, "asversion", asversionselected);
                    }
                }
                
                //do we need to get a new policy key?
                if (tbSync.db.getAccountSetting(syncdata.account, "provision") == "1" && tbSync.db.getAccountSetting(syncdata.account, "policykey") == "0") {
                    yield eas.getPolicykey(syncdata);
                } 
                
                switch (job) {
                    case "sync":
                        //set device info
                        yield eas.setDeviceInformation (syncdata);
                        //get all folders, which need to be synced
                        yield eas.getPendingFolders(syncdata);
                        //update folder list in GUI
                        Services.obs.notifyObservers(null, "tbsync.updateFolderList", syncdata.account);
                        //sync all pending folders
                        yield eas.syncPendingFolders(syncdata); //inside here we throw and catch FinischFolderSync
                        throw eas.finishSync();
                        break;
                        
                    case "deletefolder":
                        //TODO: foldersync first ???
                        yield eas.deleteFolder(syncdata);
                        //update folder list in GUI
                        Services.obs.notifyObservers(null, "tbsync.updateFolderList", syncdata.account);
                        throw eas.finishSync();
                        break;
                        
                    default:
                        throw eas.finishSync("unknown", eas.flags.abortWithError);

                }

            } catch (report) { 
                    
                switch (report.type) {
                    case eas.flags.resyncAccount:
                        tbSync.dump("Account Resync", "Account: " + tbSync.db.getAccountSetting(syncdata.account, "accountname") + ", Reason: " + report.message);                        
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





    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    // * HELPER FUNCTIONS BEYOND THE API
    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    
    getPendingFolders: Task.async (function* (syncdata)  {
        //this function sets all folders which ougth to be synced to pending, either a specific one (if folderID is set) or all avail
        if (syncdata.folderID != "") {
            //just set the specified folder to pending
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "status", "pending");
        } else {
            //scan all folders and set the enabled ones to pending
            tbSync.setSyncState("prepare.request.folders", syncdata.account); 
            let foldersynckey = tbSync.db.getAccountSetting(syncdata.account, "foldersynckey");

            //build WBXML to request foldersync
            let wbxml = wbxmltools.createWBXML();
            wbxml.switchpage("FolderHierarchy");
            wbxml.otag("FolderSync");
                wbxml.atag("SyncKey", foldersynckey);
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
            if (wbxmlData.FolderSync.Changes) {
                //looking for additions
                let add = xmltools.nodeAsArray(wbxmlData.FolderSync.Changes.Add);
                for (let count = 0; count < add.length; count++) {
                    //only add allowed folder types to DB
                    if (!["9","14","8","13","7","15"].includes(add[count].Type)) 
                        continue;
                                        
                    //create folder obj for new  folder settings
                    let newFolderSettings = {};
                    newFolderSettings.folderID = add[count].ServerId;
                    newFolderSettings.name = add[count].DisplayName;
                    newFolderSettings.type = add[count].Type;
                    newFolderSettings.parentID = add[count].ParentId;

                    if (tbSync.prefSettings.getBoolPref("eas.fix4freedriven")) {
                        let target = tbSync.db.getFolderSetting(syncdata.account, add[count].ServerId, "target");                    
                        if (target) newFolderSettings.target = target;
                    }
                        
                    if (tbSync.db.getAccountSetting(syncdata.account, "syncdefaultfolders") == "1") {
                        newFolderSettings.selected = (newFolderSettings.type == "9" || newFolderSettings.type == "8" || newFolderSettings.type == "7" ) ? "1" : "0";
                    } else newFolderSettings.selected = "0";
                                
                    //if there is a cached version of this folderID, addFolder will merge all persistent settings - all other settings not defined here will be set to their defaults
                    tbSync.db.addFolder(syncdata.account, newFolderSettings);
                }
                
                //looking for updates
                let update = xmltools.nodeAsArray(wbxmlData.FolderSync.Changes.Update);
                for (let count = 0; count < update.length; count++) {
                    //get a reference
                    let folder = tbSync.db.getFolder(syncdata.account, update[count].ServerId);
                    if (folder !== null) {
                        //update folder
                        tbSync.db.setFolderSetting(folder.account, folder.folderID, "name", update[count].DisplayName);
                        tbSync.db.setFolderSetting(folder.account, folder.folderID, "type", update[count].Type);
                        tbSync.db.setFolderSetting(folder.account, folder.folderID, "parentID", update[count].ParentId);
                    }
                }

                //looking for deletes
                let del = xmltools.nodeAsArray(wbxmlData.FolderSync.Changes.Delete);
                for (let count = 0; count < del.length; count++) {

                    let folder = tbSync.db.getFolder(syncdata.account, del[count].ServerId);
                    if (folder !== null) {
                        tbSync.takeTargetOffline("eas", folder, "[deleted from server]");
                    }
                }
            }

            tbSync.prepareFoldersForSync(syncdata.account);            
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
                if (syncdata.folderID == folders[0].folderID) folderReSyncs++;
                else folderReSyncs = 1;
                syncdata.folderID = folders[0].folderID;

                if (folderReSyncs > 3) {
                    throw eas.finishSync("resync-loop");
                }

                //get syncdata type, which is also used in WBXML for the CLASS element
                syncdata.type = null;
                switch (eas.getThunderbirdFolderType(folders[0].type)) {
                    case "tb-contact": 
                        syncdata.type = "Contacts";
                        // check SyncTarget
                        if (!tbSync.checkAddressbook(syncdata.account, syncdata.folderID)) {
                            throw eas.finishSync("notargets");
                        }
                        break;
                        
                    case "tb-event":
                        if (syncdata.type === null) syncdata.type = "Calendar";
                    case "tb-todo":
                        if (syncdata.type === null) syncdata.type = "Tasks";

                        // skip if lightning is not installed
                        if (tbSync.lightningIsAvailable() == false) {
                            throw eas.finishSync("nolightning");
                        }
                        
                        // check SyncTarget
                        if (!tbSync.checkCalender(syncdata.account, syncdata.folderID)) {
                            throw eas.finishSync("notargets");
                        }                        
                        break;
                        
                    default:
                        throw eas.finishSync("skipped");
                };





                tbSync.setSyncState("preparing", syncdata.account, syncdata.folderID);
                
                //get synckey if needed
                syncdata.synckey = folders[0].synckey;                
                if (syncdata.synckey == "") {
                    yield eas.getSynckey(syncdata);
                }
                
                //sync folder
                syncdata.timeOfLastSync = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "lastsynctime") / 1000;
                syncdata.timeOfThisSync = (Date.now() / 1000) - 1;
                
                switch (syncdata.type) {
                    case "Contacts": 
                        //get sync target of this addressbook
                        syncdata.targetId = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target");
                        syncdata.addressbookObj = tbSync.getAddressBookObject(syncdata.targetId);

                        //promisify addressbook, so it can be used together with yield
                        syncdata.targetObj = tbSync.promisifyAddressbook(syncdata.addressbookObj);
                        
                        yield eas.sync.start(syncdata);   //using new tbsync contacts sync code
                        break;

                    case "Calendar":
                    case "Tasks": 
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
                        //takeTargetOffline will backup the current folder and on next run, a fresh copy 
                        //of the folder will be synced down - the folder itself is NOT deleted
                        tbSync.dump("Folder Resync", "Account: " + tbSync.db.getAccountSetting(syncdata.account, "accountname") + ", Folder: "+ tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name") + ", Reason: " + report.message);
                        tbSync.takeTargetOffline("eas", tbSync.db.getFolder(syncdata.account, syncdata.folderID), "[forced folder resync]", false);
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
                    tbSync.db.resetAccountSetting(syncdata.account, "policykey");
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

    setDeviceInformation: Task.async (function* (syncdata)  {
        if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5" || !tbSync.db.getAccountSetting(syncdata.account, "allowedEasCommands").split(",").includes("Settings")) {
            return;
        }
            
        tbSync.setSyncState("prepare.request.setdeviceinfo", syncdata.account);

        let wbxml = wbxmltools.createWBXML();
        wbxml.switchpage("Settings");
        wbxml.otag("Settings");
            wbxml.otag("DeviceInformation");
                wbxml.otag("Set");
                    wbxml.atag("Model", "Computer");
                    wbxml.atag("FriendlyName", "TbSync on Device " + tbSync.db.getAccountSetting(syncdata.account, "deviceId").substring(4));
                    wbxml.atag("OS", OS.Constants.Sys.Name);
                    wbxml.atag("UserAgent", tbSync.db.getAccountSetting(syncdata.account, "useragent"));
                wbxml.ctag();
            wbxml.ctag();
        wbxml.ctag();

        tbSync.setSyncState("send.request.setdeviceinfo", syncdata.account);
        let response = yield eas.sendRequest(wbxml.getBytes(), "Settings", syncdata);

        tbSync.setSyncState("eval.response.setdeviceinfo", syncdata.account);
        let wbxmlData = eas.getDataFromResponse(response);

        eas.checkStatus(syncdata, wbxmlData,"Settings.Status");
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
            Services.obs.notifyObservers(null, "tbsync.updateFolderList", syncdata.account);
            throw eas.finishSync();
        } else {
            throw eas.finishSync("wbxmlmissingfield::FolderDelete.SyncKey", eas.flags.abortWithError);
        }
    }),

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
        return "MZTB" + uuid;
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
            get host() { 
                let h = this.protocol + tbSync.db.getAccountSetting(account, "host"); 
                while (h.endsWith("/")) { h = h.slice(0,-1); }

                if (h.endsWith("Microsoft-Server-ActiveSync")) return h;
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
            syncdata.req.setRequestHeader("Authorization", 'Basic ' + tbSync.b64encode(connection.user + ':' + password));
            syncdata.req.timeout = tbSync.prefSettings.getIntPref("timeout");

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
                    case 401: // AuthError
                            reject(eas.finishSync("401", eas.flags.abortWithError));
                        break;

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
                            resolve();
                        break;

                    default:
                            resolve();
                        break;

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
            syncdata.req.setRequestHeader("Authorization", 'Basic ' + tbSync.b64encode(connection.user + ':' + password));
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

            syncdata.req.timeout = tbSync.prefSettings.getIntPref("timeout");

            syncdata.req.ontimeout = function () {
                if (allowSoftFail) resolve("");
                else reject(eas.finishSync("timeout", eas.flags.abortWithError));
            };

            syncdata.req.onerror = function () {
                if (allowSoftFail) resolve("");
                else {
                    let error = tbSync.createTCPErrorFromFailedXHR(syncdata.req);
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
                        tbSync.db.resetAccountSetting(syncdata.account, "policykey");
                        reject(eas.finishSync(syncdata.req.status, eas.flags.resyncAccount));
                        break;

                    case 451: // Redirect - update host and login manager 
                        let header = syncdata.req.getResponseHeader("X-MS-Location");
                        let newHost = header.slice(header.indexOf("://") + 3, header.indexOf("/M"));
                        let connection = tbSync.eas.getConnection(syncdata.account);

                        tbSync.dump("redirect (451)", "header: " + header + ", oldHost: " + connection.host + ", newHost: " + newHost);

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
                if (allowSoftFail) return "Invalid item!";
                throw eas.finishSync("ServerRejectedRequest");                            

            case "Sync:7": //The client has changed an item for which the conflict policy indicates that the server's changes take precedence.
                return "";
        
            case "Sync:8": // Object not found - takeTargetOffline and remove folder
                {
                    tbSync.synclog("Warning", "WBXML: Server reports <object not found> (" +  tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "name") + "), keeping local copy and removing folder.");
                    let folder = tbSync.db.getFolder(syncdata.account, syncdata.folderID);
                    if (folder !== null) {
                        tbSync.takeTargetOffline("eas", folder, "[deleted from server]");
                        //folder is no longer there, unset current folder
                        syncdata.folderID = "";
                    }
                    throw eas.finishSync();
                }

            case "Sync:9": //User account could be out of disk space, also send if no write permission (TODO)
                return "";

            case "FolderDelete:3": // special system folder - fatal error
                throw eas.finishSync("folderDelete.3");

            case "FolderDelete:6": // error on server
                throw eas.finishSync("folderDelete.6");

            case "FolderDelete:4": // folder does not exist - resync ( we allow delete only if folder is not subscribed )
            case "FolderDelete:9": // invalid synchronization key - resync
            case "FolderSync:9": // invalid synchronization key - resync
            case "Sync:12": // folder hierarchy changed
                {
                    let folders = tbSync.db.getFolders(syncdata.account);
                    for (let f in folders) {
                        tbSync.takeTargetOffline("eas", folders[f], "[forced account resync]", false);
                        tbSync.db.setFolderSetting(folders[f].account, folders[f].folderID, "cached", "1");
                    }		    
                    //folder is no longer there, unset current folder
                    syncdata.folderID = "";
                    //reset account
                    tbSync.eas.onEnableAccount(syncdata.account);
                    throw eas.finishSync(type+"("+status+")", eas.flags.resyncAccount);
                }
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
                tbSync.db.resetAccountSetting(syncdata.account, "policykey");
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
                if (secure) req.setRequestHeader("Authorization", "Basic " + tbSync.b64encode(connection.user + ":" + password));                
            }

            req.ontimeout = function () {
                tbSync.dump("EAS autodiscover with timeout", "\n" + connection.url + " => \n" + req.responseURL);
                resolve({"url":req.responseURL, "error":"timeout", "server":"", "user":connection.user});
            };
           
            req.onerror = function () {
                let error = tbSync.createTCPErrorFromFailedXHR(req);
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
    },
    
    
    
    
    /**
     * Implements the TbSync UI interface for external provider extensions, 
     * only needed, if the standard TbSync UI logic is used (chrome://tbsync/content/manager/accountSettings.js).
     */
    ui: {

        /**
         * Returns array of all possible account options (field names of a row in the accounts database).
         */
        getAccountStorageFields: function () {
            return Object.keys(tbSync.eas.getDefaultAccountEntries()).sort();
        },



        /**
         * Returns array of all options, that should not lock while being connected.
         */
        getAlwaysUnlockedSettings: function () {
            return ["autosync"];
        },



        /**
         * Returns object with fixed entries for rows in the accounts database. This is useable for two cases:
         *   1. indicate which entries where retrieved by autodiscover, do not assign a value
         *   2. other special server profiles (like "outlook") which the user can select during account creation with predefined values
         * In either case, these entries are not editable in the UI by default,but the user has to unlock them.
         *
         * @param servertype       [in] return fixed set based on the given servertype
         */
        getFixedServerSettings: function (servertype) {
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



        /**
         * Is called before the context menu of the folderlist is shown, allows to 
         * show/hide custom menu options based on selected folder
         *
         * @param document       [in] document object of the account settings window
         * @param folder         [in] folder databasse object of the selected folder
         */
        onFolderListContextMenuShowing: function (document, folder) {
            let hideContextMenuDelete = true;

            if (folder !== null) {
                //if a folder in trash is selected, also show ContextMenuDelete (but only if FolderDelete is allowed)
                if (tbSync.eas.parentIsTrash(folder.account, folder.parentID) && tbSync.db.getAccountSetting(folder.account, "allowedEasCommands").split(",").includes("FolderDelete")) {// folder in recycle bin
                    hideContextMenuDelete = false;
                    document.getElementById("tbsync.accountsettings.FolderListContextMenuDelete").label = tbSync.getLocalizedMessage("deletefolder.menuentry::" + folder.name, "eas");
                }                
            }

            document.getElementById("tbsync.accountsettings.FolderListContextMenuDelete").hidden = hideContextMenuDelete;
        },



        /**
         * Returns an array of folderRowData objects, containing all information needed 
         * to fill the folderlist. The content of the folderRowData object is free to choose,
         * it will be passed back to addRowToFolderList() and updateRowOfFolderList()
         *
         * @param account        [in] account id for which the folder data should be returned
         */
        getSortedFolderData: function (account) {
            let folderData = [];
            let folders = tbSync.db.getFolders(account);
            let allowedTypesOrder = ["9","14","8","13","7","15"];
            let folderIDs = Object.keys(folders).filter(f => allowedTypesOrder.includes(folders[f].type)).sort((a, b) => (tbSync.eas.ui.getIdChain(allowedTypesOrder, account, a).localeCompare(tbSync.eas.ui.getIdChain(allowedTypesOrder, account, b))));
            
            for (let i=0; i < folderIDs.length; i++) {
                folderData.push(tbSync.eas.ui.getFolderRowData(folders[folderIDs[i]]));
            }
            return folderData;
        },



        /**
         * Returns a folderRowData object, containing all information needed to fill one row
         * in the folderlist. The content of the folderRowData object is free to choose, it
         * will be passed back to addRowToFolderList() and updateRowOfFolderList()
         *
         * Use tbSync.getSyncStatusMsg(folder, syncdata, provider) to get a nice looking 
         * status message, including sync progress (if folder is synced)
         *
         * @param folder         [in] folder databasse object of requested folder
         * @param syncdata       [in] optional syncdata obj send by updateRowOfFolderList(),
         *                            needed to check if the folder is currently synced
         */             getFolderRowData: function (folder, syncdata = null) {
            let rowData = {};
            rowData.folderID = folder.folderID;
            rowData.selected = (folder.selected == "1");
            rowData.type = folder.type;
            rowData.name = folder.name;
            rowData.status = tbSync.getSyncStatusMsg(folder, syncdata, "eas");

            if (tbSync.eas.parentIsTrash(folder.account, folder.parentID)) rowData.name = tbSync.getLocalizedMessage("recyclebin", "eas") + " | " + rowData.name;

            return rowData;
        },
    


        /**
         * Is called to add a row to the folderlist.
         *
         * @param document       [in] document object of the account settings window
         * @param newListItem    [in] the listitem of the row, where row items should be added to
         * @param rowData        [in] rowData object with all information needed to add the row
         */        
        addRowToFolderList: function (document, newListItem, rowData) {
            //add folder type/img
            let itemTypeCell = document.createElement("listcell");
            itemTypeCell.setAttribute("class", "img");
            itemTypeCell.setAttribute("width", "24");
            itemTypeCell.setAttribute("height", "24");
                let itemType = document.createElement("image");
                itemType.setAttribute("src", tbSync.eas.ui.getTypeImage(rowData.type));
                itemType.setAttribute("style", "margin: 4px;");
            itemTypeCell.appendChild(itemType);
            newListItem.appendChild(itemTypeCell);

            //add folder name
            let itemLabelCell = document.createElement("listcell");
            itemLabelCell.setAttribute("class", "label");
            itemLabelCell.setAttribute("width", "145");
            itemLabelCell.setAttribute("crop", "end");
            itemLabelCell.setAttribute("label", rowData.name);
            itemLabelCell.setAttribute("tooltiptext", rowData.name);
            itemLabelCell.setAttribute("disabled", !rowData.selected);
            if (!rowData.selected) itemLabelCell.setAttribute("style", "font-style:italic;");
            newListItem.appendChild(itemLabelCell);

            //add folder status
            let itemStatusCell = document.createElement("listcell");
            itemStatusCell.setAttribute("class", "label");
            itemStatusCell.setAttribute("flex", "1");
            itemStatusCell.setAttribute("crop", "end");
            itemStatusCell.setAttribute("label", rowData.status);
            itemStatusCell.setAttribute("tooltiptext", rowData.status);
            newListItem.appendChild(itemStatusCell);
        },		



        /**
         * Is called to update a row of the folderlist.
         *
         * @param document       [in] document object of the account settings window
         * @param listItem       [in] the listitem of the row, which needs to be updated
         * @param rowData        [in] rowData object with all information needed to add the row
         */        
        updateRowOfFolderList: function (document, item, rowData) {
            tbSync.updateListItemCell(item.childNodes[1], ["label","tooltiptext"], rowData.name);
            tbSync.updateListItemCell(item.childNodes[2], ["label","tooltiptext"], rowData.status);
            if (rowData.selected) {
                tbSync.updateListItemCell(item.childNodes[1], ["style"], "font-style:normal;");
                tbSync.updateListItemCell(item.childNodes[1], ["disabled"], "false");
            } else {
                tbSync.updateListItemCell(item.childNodes[1], ["style"], "font-style:italic;");
                tbSync.updateListItemCell(item.childNodes[1], ["disabled"], "true");
            }
        },



        /**
         * Return the icon used in the folderlist to represent the different folder types
         *
         * @param type       [in] provider folder type
         */
        getTypeImage: function (type) {
            let src = ""; 
            switch (type) {
                case "9": 
                case "14": 
                    src = "contacts16.png";
                    break;
                case "8":
                case "13":
                    src = "calendar16.png";
                    break;
                case "7":
                case "15":
                    src = "todo16.png";
                    break;
            }
            return "chrome://tbsync/skin/" + src;
        },    







        //BEYOND API

        //Custom stuff, outside of interface, invoked by own functions in overlayed accountSettings.xul
        getIdChain: function (allowedTypesOrder, account, _folderID) {
            let folderID = _folderID;
            
            //create sort string so that child folders are directly below their parent folders, different folder types are grouped and trashed folders at the end
            let chain = folderID.toString().padStart(3,"0");
            let folder = tbSync.db.getFolder(account, folderID);
            
            while (folder && folder.parentID && folder.parentID != "0") {
                chain = folder.parentID.toString().padStart(3,"0") + "." + chain;
                folderID = folder.parentID;
                folder = tbSync.db.getFolder(account, folderID);
            }
            
            if (folder && folder.type) {
                let pos = allowedTypesOrder.indexOf(folder.type);
                chain = ((pos == -1) ? "ZZZ" : pos.toString().padStart(3,"0")) + "." + chain;
            }
            
            return chain;
        },    

        stripHost: function (document, account) {
            let host = document.getElementById('tbsync.accountsettings.pref.host').value;
            if (host.indexOf("https://") == 0) {
                host = host.replace("https://","");
                document.getElementById('tbsync.accountsettings.pref.https').checked = true;
                tbSync.db.setAccountSetting(account, "https", "1");
            } else if (host.indexOf("http://") == 0) {
                host = host.replace("http://","");
                document.getElementById('tbsync.accountsettings.pref.https').checked = false;
                tbSync.db.setAccountSetting(account, "https", "0");
            }
            
            while (host.endsWith("/")) { host = host.slice(0,-1); }        
            document.getElementById('tbsync.accountsettings.pref.host').value = host
            tbSync.db.setAccountSetting(account, "host", host);
        },
        
        deleteFolder: function(document, account) {
            let folderList = document.getElementById("tbsync.accountsettings.folderlist");
            if (folderList.selectedItem !== null && !folderList.disabled) {
                let fID =  folderList.selectedItem.value;
                let folder = tbSync.db.getFolder(account, fID, true);

                //only trashed folders can be purged (for example O365 does not show deleted folders but also does not allow to purge them)
                if (!tbSync.eas.parentIsTrash(account, folder.parentID)) return;
                
                if (folder.selected == "1") document.defaultView.alert(tbSync.getLocalizedMessage("deletefolder.notallowed::" + folder.name, "eas"));
                else if (document.defaultView.confirm(tbSync.getLocalizedMessage("deletefolder.confirm::" + folder.name, "eas"))) {
                tbSync.syncAccount("deletefolder", account, fID);
                } 
            }            
        },
    }
    
};
    

tbSync.includeJS("chrome://tbsync/content/provider/eas/sync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/tasksync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/calendarsync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/contactsync.js");
