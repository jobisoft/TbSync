/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");
if ("calICalendar" in Components.interfaces && typeof cal == 'undefined') {
    Components.utils.import("resource://calendar/modules/calUtils.jsm");
    Components.utils.import("resource://calendar/modules/ical.js");    
}

var tbSyncAccounts = {

    selectedAccount: null,

    onload: function () {
        //scan accounts, update list and select first entry (because no id is passed to updateAccountList)
        //the onSelect event of the List will load the selected account
        //also update/init add menu
        this.updateAvailableProvider(); 
        
        Services.obs.addObserver(tbSyncAccounts.updateProviderListObserver, "tbsync.observer.manager.updateProviderList", false);
        Services.obs.addObserver(tbSyncAccounts.updateAccountsListObserver, "tbsync.observer.manager.updateAccountsList", false);
        Services.obs.addObserver(tbSyncAccounts.updateAccountSyncStateObserver, "tbsync.observer.manager.updateSyncstate", false);
        Services.obs.addObserver(tbSyncAccounts.updateAccountNameObserver, "tbsync.observer.manager.updateAccountName", false);
        Services.obs.addObserver(tbSyncAccounts.toggleEnableStateObserver, "tbsync.observer.manager.toggleEnableState", false);
    },

    onunload: function () {
        Services.obs.removeObserver(tbSyncAccounts.updateProviderListObserver, "tbsync.observer.manager.updateProviderList");
        Services.obs.removeObserver(tbSyncAccounts.updateAccountsListObserver, "tbsync.observer.manager.updateAccountsList");
        Services.obs.removeObserver(tbSyncAccounts.updateAccountSyncStateObserver, "tbsync.observer.manager.updateSyncstate");
        Services.obs.removeObserver(tbSyncAccounts.updateAccountNameObserver, "tbsync.observer.manager.updateAccountName");
        Services.obs.removeObserver(tbSyncAccounts.toggleEnableStateObserver, "tbsync.observer.manager.toggleEnableState");
    },

    debugToggleAll: function () {
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i < accounts.IDs.length; i++) {
            tbSyncAccounts.toggleAccountEnableState(accounts.IDs[i]);
        }
    },
    
    debugMod: async function () { 
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i < accounts.IDs.length; i++) {
            if (tbSync.core.isEnabled(accounts.IDs[i])) {
                let folders = tbSync.db.getFolders(accounts.IDs[i]);
                for (let f in folders) {
                    if (folders[f].selected == "1") {
                        let tbType = tbSync.providers[accounts.data[accounts.IDs[i]].provider].api.getThunderbirdFolderType(folders[f].type);
                        switch (tbType) {
                            case "tb-contact": 
                                {
                                    let targetId = tbSync.db.getFolderSetting(accounts.IDs[i], folders[f].folderID, "target");
                                    let addressbook = tbSync.addressbook.getAddressBookObject(targetId);
                                    let oldresults = addressbook.getCardsFromProperty("PrimaryEmail", "debugcontact@inter.net", true);
                                    while (oldresults.hasMoreElements()) {
                                        let card = oldresults.getNext();
                                        if (card instanceof Components.interfaces.nsIAbCard && !card.isMailList) {
                                            card.setProperty("DisplayName", "Debug Contact " + Date.now());
                                            card.setProperty("LastName", "Contact " + Date.now());
                                            addressbook.modifyCard(card);
                                        }
                                    }
                                }
                                break;
                            case "tb-event":
                            case "tb-todo":
                                {
                                    let targetId = tbSync.db.getFolderSetting(accounts.IDs[i], folders[f].folderID, "target");
                                    let calendarObj = cal.getCalendarManager().getCalendarById(targetId);
                                    
                                    //promisify calender, so it can be used async
                                    let targetObj = cal.async.promisifyCalendar(calendarObj.wrappedJSObject);
                                    let results = await targetObj.getAllItems();
                                        
                                    for (let r=0; r < results.length; r++) {
                                        let newItem = results[r].clone();
                                        newItem.title = tbType + " " + Date.now();
                                        await targetObj.modifyItem(newItem, results[r]);                                        
                                    }
                                }
                                break;
                        }
                    }
                }
            }
        }
    },

    debugDel: async function () { 
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i < accounts.IDs.length; i++) {
            if (tbSync.core.isEnabled(accounts.IDs[i])) {
                let folders = tbSync.db.getFolders(accounts.IDs[i]);
                for (let f in folders) {
                    if (folders[f].selected == "1") {
                        switch (tbSync.providers[accounts.data[accounts.IDs[i]].provider].api.getThunderbirdFolderType(folders[f].type)) {
                            case "tb-contact": 
                                {                            
                                    let targetId = tbSync.db.getFolderSetting(accounts.IDs[i], folders[f].folderID, "target");
                                    let addressbook = tbSync.addressbook.getAddressBookObject(targetId);
                                    let oldresults = addressbook.getCardsFromProperty("PrimaryEmail", "debugcontact@inter.net", true);
                                    let cardsToDelete = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
                                    while (oldresults.hasMoreElements()) {
                                        cardsToDelete.appendElement(oldresults.getNext(), false);
                                    }
                                    addressbook.deleteCards(cardsToDelete);
                                }
                                break;

                            case "tb-event":
                            case "tb-todo":
                                {
                                    let targetId = tbSync.db.getFolderSetting(accounts.IDs[i], folders[f].folderID, "target");
                                    let calendarObj = cal.getCalendarManager().getCalendarById(targetId);
                                    
                                    //promisify calender, so it can be used async
                                    let targetObj = cal.async.promisifyCalendar(calendarObj.wrappedJSObject);
                                    let results = await targetObj.getAllItems();
                                    for (let r=0; r < results.length; r++) {
                                        await targetObj.deleteItem(results[r]);
                                    }
                                }
                                break;
                        }
                    }
                }
            }
        }
    },

    debugAdd: function (set) { 
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i < accounts.IDs.length; i++) {
            if (tbSync.core.isEnabled(accounts.IDs[i])) {
                let folders = tbSync.db.getFolders(accounts.IDs[i]);
                for (let f in folders) {
                    if (folders[f].selected == "1") {
                        switch (tbSync.providers[accounts.data[accounts.IDs[i]].provider].api.getThunderbirdFolderType(folders[f].type)) {
                            case "tb-contact": 
                                { 
                                    let targetId = tbSync.db.getFolderSetting(accounts.IDs[i], folders[f].folderID, "target");
                                    let addressbook = tbSync.addressbook.getAddressBookObject(targetId);
                                    //the two sets differ by number of contacts
                                    let max = (set == 1) ? 2 : 10;
                                    for (let m=0; m < max; m++) {
                                        let newItem = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
                                        let properties = {
                                            DisplayName: 'Debug Contact ' + Date.now(),
                                            FirstName: 'Debug',
                                            LastName: 'Contact ' + Date.now(),
                                            PrimaryEmail: 'debugcontact@inter.net',
                                            SecondEmail: 'debugcontact2@inter.net',
                                            Email3Address: 'debugcontact3@inter.net',
                                            WebPage1: 'WebPage',
                                            SpouseName: 'Spouse',
                                            CellularNumber: '0123',
                                            PagerNumber: '4567',
                                            HomeCity: 'HomeAddressCity',
                                            HomeCountry: 'HomeAddressCountry',
                                            HomeZipCode: '12345',
                                            HomeState: 'HomeAddressState',
                                            HomePhone: '6789',
                                            Company: 'CompanyName',
                                            Department: 'Department',
                                            JobTitle: 'JobTitle',
                                            WorkCity: 'BusinessAddressCity',
                                            WorkCountry: 'BusinessAddressCountry',
                                            WorkZipCode: '12345',
                                            WorkState: 'BusinessAddressState',
                                            WorkPhone: '6789',
                                            Custom1: 'OfficeLocation',
                                            FaxNumber: '3535',
                                            AssistantName: 'AssistantName',
                                            AssistantPhoneNumber: '4353453',
                                            BusinessFaxNumber: '574563',
                                            Business2PhoneNumber: '43564657',
                                            Home2PhoneNumber: '767564',
                                            CarPhoneNumber: '3543646',
                                            MiddleName: 'MiddleName',
                                            RadioPhoneNumber: '343546',
                                            OtherAddressCity: 'OtherAddressCity',
                                            OtherAddressCountry: 'OtherAddressCountry',
                                            OtherAddressPostalCode: '12345',
                                            OtherAddressState: 'OtherAddressState',
                                            NickName: 'NickName',
                                            Custom2: 'CustomerId',
                                            Custom3: 'GovernmentId',
                                            Custom4: 'AccountName',
                                            IMAddress: 'IMAddress',
                                            IMAddress2: 'IMAddress2',
                                            IMAddress3: 'IMAddress3',
                                            ManagerName: 'ManagerName',
                                            CompanyMainPhone: 'CompanyMainPhone',
                                            MMS: 'MMS',
                                            HomeAddress: "Address",
                                            HomeAddress2: "Address2",
                                            WorkAddress: "Address",
                                            WorkAddress2: "Address2",
                                            OtherAddress: "Address",
                                            OtherAddress2: "Address2",
                                            Notes: "Notes",
                                            Categories: tbSync.eas.sync.Contacts.categoriesToString(["Cat1","Cat2"]),
                                            Cildren: tbSync.eas.sync.Contacts.categoriesToString(["Child1","Child2"]),
                                            BirthDay: "15",
                                            BirthMonth: "05",
                                            BirthYear: "1980",
                                            AnniversaryDay: "27",
                                            AnniversaryMonth: "6",
                                            AnniversaryYear: "2009"                                    
                                        };
                                        for (let p in properties) {
                                            newItem.setProperty(p, properties[p]);
                                        }
                                        addressbook.addCard(newItem);
                                    }
                                }
                                break;

                            case "tb-event":
                                {
                                    let targetId = tbSync.db.getFolderSetting(accounts.IDs[i], folders[f].folderID, "target");
                                    let calendarObj = cal.getCalendarManager().getCalendarById(targetId);
                                    
                                    //promisify calender, so it can be used async
                                    let targetObj = cal.async.promisifyCalendar(calendarObj.wrappedJSObject);
                                    let item = cal.createEvent();
                                    if (set == 1) item.icalString = [
                                                                "BEGIN:VCALENDAR",
                                                                "PRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN",
                                                                "VERSION:2.0",
                                                                "BEGIN:VEVENT",
                                                                "CREATED:20180609T203704Z",
                                                                "LAST-MODIFIED:20180609T203759Z",
                                                                "DTSTAMP:20180609T203759Z",
                                                                "SUMMARY:Debug Event",
                                                                "ORGANIZER;RSVP=FALSE;CN=support;PARTSTAT=ACCEPTED;ROLE=CHAIR:mailto:user@inter.net",
                                                                "DTSTART;VALUE=DATE:20180114",
                                                                "DTEND;VALUE=DATE:20180115",
                                                                "DESCRIPTION:Test",
                                                                "X-EAS-BUSYSTATUS:0",
                                                                "TRANSP:TRANSPARENT",
                                                                "X-EAS-SENSITIVITY:1",
                                                                "X-EAS-RESPONSETYPE:1",
                                                                "X-EAS-MEETINGSTATUS:0",
                                                                "END:VEVENT",
                                                                "END:VCALENDAR"].join("\n");
                                    if (set == 2) item.icalString = ["BEGIN:VCALENDAR",
                                                                "PRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN",
                                                                "VERSION:2.0",
                                                                "BEGIN:VTIMEZONE",
                                                                "TZID:Europe/Berlin",
                                                                "BEGIN:DAYLIGHT",
                                                                "TZOFFSETFROM:+0100",
                                                                "TZOFFSETTO:+0200",
                                                                "TZNAME:CEST",
                                                                "DTSTART:19700329T020000",
                                                                "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
                                                                "END:DAYLIGHT",
                                                                "BEGIN:STANDARD",
                                                                "TZOFFSETFROM:+0200",
                                                                "TZOFFSETTO:+0100",
                                                                "TZNAME:CET",
                                                                "DTSTART:19701025T030000",
                                                                "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
                                                                "END:STANDARD",
                                                                "END:VTIMEZONE",
                                                                "BEGIN:VEVENT",
                                                                "CREATED:20180610T083243Z",
                                                                "LAST-MODIFIED:20180610T083353Z",
                                                                "DTSTAMP:20180610T083353Z",
                                                                "SUMMARY:Debug Event (Reccurring)",
                                                                "ORGANIZER;RSVP=FALSE;CN=support;PARTSTAT=ACCEPTED;ROLE=CHAIR:mailto:user@inter.net",
                                                                "RRULE:FREQ=WEEKLY;UNTIL=20181030T220000Z;BYDAY=FR",
                                                                "DTSTART;TZID=Europe/Berlin:20180518T230000",
                                                                "DTEND;TZID=Europe/Berlin:20180519T000000",
                                                                "DESCRIPTION:Test",
                                                                "X-EAS-BUSYSTATUS:2",
                                                                "TRANSP:OPAQUE",
                                                                "X-EAS-SENSITIVITY:1",
                                                                "X-EAS-RESPONSETYPE:1",
                                                                "X-EAS-MEETINGSTATUS:0",
                                                                "END:VEVENT",
                                                                "END:VCALENDAR"].join("\n");

                                    targetObj.adoptItem(item)
                                }
                                break;

                            case "tb-todo":
                                {
                                    let targetId = tbSync.db.getFolderSetting(accounts.IDs[i], folders[f].folderID, "target");
                                    let calendarObj = cal.getCalendarManager().getCalendarById(targetId);
                                    
                                    //promisify calender, so it can be used async
                                    let targetObj = cal.async.promisifyCalendar(calendarObj.wrappedJSObject);
                                    let item = cal.createTodo();
                                    if (set == 1) item.icalString = [
                                                                "BEGIN:VCALENDAR",
                                                                "PRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN",
                                                                "VERSION:2.0",
                                                                "BEGIN:VTIMEZONE",
                                                                "TZID:Europe/Berlin",
                                                                "BEGIN:DAYLIGHT",
                                                                "TZOFFSETFROM:+0100",
                                                                "TZOFFSETTO:+0200",
                                                                "TZNAME:CEST",
                                                                "DTSTART:19700329T020000",
                                                                "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
                                                                "END:DAYLIGHT",
                                                                "BEGIN:STANDARD",
                                                                "TZOFFSETFROM:+0200",
                                                                "TZOFFSETTO:+0100",
                                                                "TZNAME:CET",
                                                                "DTSTART:19701025T030000",
                                                                "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
                                                                "END:STANDARD",
                                                                "END:VTIMEZONE",
                                                                "BEGIN:VTODO",
                                                                "CREATED:20180609T225952Z",
                                                                "LAST-MODIFIED:20180609T230558Z",
                                                                "DTSTAMP:20180609T230558Z",
                                                                "SUMMARY:Testaufgabe",
                                                                "PRIORITY:5",
                                                                "DTSTART;TZID=Europe/Berlin:20180204T010000",
                                                                "DUE;TZID=Europe/Berlin:20180204T010000",
                                                                "DESCRIPTION:Ja mei\n",
                                                                "X-EAS-SENSITIVITY:0",
                                                                "CLASS:PUBLIC",
                                                                "X-EAS-IMPORTANCE:1",
                                                                "END:VTODO",
                                                                "END:VCALENDAR"].join("\n");

                                    if (set == 2) item.icalString = [
                                                                "BEGIN:VCALENDAR",
                                                                "PRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN",
                                                                "VERSION:2.0",
                                                                "BEGIN:VTIMEZONE",
                                                                "TZID:Europe/Berlin",
                                                                "BEGIN:DAYLIGHT",
                                                                "TZOFFSETFROM:+0100",
                                                                "TZOFFSETTO:+0200",
                                                                "TZNAME:CEST",
                                                                "DTSTART:19700329T020000",
                                                                "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
                                                                "END:DAYLIGHT",
                                                                "BEGIN:STANDARD",
                                                                "TZOFFSETFROM:+0200",
                                                                "TZOFFSETTO:+0100",
                                                                "TZNAME:CET",
                                                                "DTSTART:19701025T030000",
                                                                "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
                                                                "END:STANDARD",
                                                                "END:VTIMEZONE",
                                                                "BEGIN:VTODO",
                                                                "CREATED:20180610T083240Z",
                                                                "LAST-MODIFIED:20180610T084151Z",
                                                                "DTSTAMP:20180610T084151Z",
                                                                "SUMMARY:Debug Todo (Reccurring)",
                                                                "PRIORITY:5",
                                                                "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR",
                                                                "DTSTART;TZID=Europe/Berlin:20180204T010000",
                                                                "DUE;TZID=Europe/Berlin:20180204T010000",
                                                                "DESCRIPTION:Test",
                                                                "X-EAS-SENSITIVITY:0",
                                                                "CLASS:PUBLIC",
                                                                "X-EAS-IMPORTANCE:1",
                                                                "SEQUENCE:1",
                                                                "END:VTODO",
                                                                "END:VCALENDAR"].join("\n");

                                    targetObj.adoptItem(item)
                                }
                                break;
                        }
                    }
                }
            }
        }
    },
        
    
    hasInstalledProvider: function (accountID) {
        let provider = tbSync.db.getAccountSetting(accountID, "provider");
        return tbSync.providers.loadedProviders.hasOwnProperty(provider);
    },

    updateDropdown: function (selector) {
        let accountsList = document.getElementById("tbSyncAccounts.accounts");
        let selectedAccount = null;
        let selectedAccountName = "";
        let isActionsDropdown = (selector == "accountActions");

        let isSyncing = false;
        let isConnected = false;
        let isEnabled = false;
        let isInstalled = false;
        
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)) {
            //some item is selected
            let selectedItem = accountsList.selectedItem;
            selectedAccount = selectedItem.value;
            selectedAccountName = selectedItem.getAttribute("label");
            isSyncing = tbSync.core.isSyncing(selectedAccount);
            isConnected = tbSync.core.isConnected(selectedAccount);
            isEnabled = tbSync.core.isEnabled(selectedAccount);
            isInstalled = tbSyncAccounts.hasInstalledProvider(selectedAccount);
        }
        
        //hide if no accounts are avail (which is identical to no account selected)
        if (isActionsDropdown) document.getElementById(selector + "SyncAllAccounts").hidden = (selectedAccount === null);
        
        //hide if no account is selected
        if (isActionsDropdown) document.getElementById(selector + "Separator").hidden = (selectedAccount === null);
        document.getElementById(selector + "DeleteAccount").hidden = (selectedAccount === null);
        document.getElementById(selector + "DisableAccount").hidden = (selectedAccount === null) || !isEnabled || !isInstalled;
        document.getElementById(selector + "EnableAccount").hidden = (selectedAccount === null) || isEnabled || !isInstalled;
        document.getElementById(selector + "SyncAccount").hidden = (selectedAccount === null) || !isConnected || !isInstalled;
        document.getElementById(selector + "RetryConnectAccount").hidden = (selectedAccount === null) || isConnected || !isEnabled || !isInstalled;

        //Not yet implemented
        if (document.getElementById(selector + "ShowErrorLog")) {
            document.getElementById(selector + "ShowErrorLog").hidden = false;
            document.getElementById(selector + "ShowErrorLog").disabled = false;
        }
        
        if (selectedAccount !== null) {
            //disable if currently syncing (and displayed)
            document.getElementById(selector + "DeleteAccount").disabled = isSyncing;
            document.getElementById(selector + "DisableAccount").disabled = isSyncing;
            document.getElementById(selector + "EnableAccount").disabled = isSyncing;
            document.getElementById(selector + "SyncAccount").disabled = isSyncing;
            //adjust labels - only in global actions dropdown
            if (isActionsDropdown) document.getElementById(selector + "DeleteAccount").label = tbSync.getString("accountacctions.delete").replace("##accountname##", selectedAccountName);
            if (isActionsDropdown) document.getElementById(selector + "SyncAccount").label = tbSync.getString("accountacctions.sync").replace("##accountname##", selectedAccountName);
            if (isActionsDropdown) document.getElementById(selector + "EnableAccount").label = tbSync.getString("accountacctions.enable").replace("##accountname##", selectedAccountName);
            if (isActionsDropdown) document.getElementById(selector + "DisableAccount").label = tbSync.getString("accountacctions.disable").replace("##accountname##", selectedAccountName);
        }
    
        //Debug Options
        if (isActionsDropdown) {
            document.getElementById("accountActionsDebugToggleAll").hidden = !tbSync.prefs.getBoolPref("debug.testoptions");
            document.getElementById("accountActionsDebugAdd1").hidden = !tbSync.prefs.getBoolPref("debug.testoptions");
            document.getElementById("accountActionsDebugAdd2").hidden = !tbSync.prefs.getBoolPref("debug.testoptions");
            document.getElementById("accountActionsDebugMod").hidden = !tbSync.prefs.getBoolPref("debug.testoptions");
            document.getElementById("accountActionsDebugDel").hidden = !tbSync.prefs.getBoolPref("debug.testoptions");
            document.getElementById("accountActionsSeparatorDebug").hidden = !tbSync.prefs.getBoolPref("debug.testoptions");
        }
    },
    
    synchronizeAccount: function () {
        let accountsList = document.getElementById("tbSyncAccounts.accounts");
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)  && !tbSync.core.isSyncing(accountsList.selectedItem.value)) {            
            if (tbSyncAccounts.hasInstalledProvider(accountsList.selectedItem.value)) {
                tbSync.core.syncAccount('sync', accountsList.selectedItem.value);
            }
        }
    },

    deleteAccount: function () {
        let accountsList = document.getElementById("tbSyncAccounts.accounts");
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)  && !tbSync.core.isSyncing(accountsList.selectedItem.value)) {
            let nextAccount =  -1;
            if (accountsList.selectedIndex > 0) {
                //first try to select the item after this one, otherwise take the one before
                if (accountsList.selectedIndex + 1 < accountsList.getRowCount()) nextAccount = accountsList.getItemAtIndex(accountsList.selectedIndex + 1).value;
                else nextAccount = accountsList.getItemAtIndex(accountsList.selectedIndex - 1).value;
            }
            
            if (!tbSyncAccounts.hasInstalledProvider(accountsList.selectedItem.value)) {
                if (confirm(tbSync.getString("prompt.EraseAccount").replace("##accountName##", accountsList.selectedItem.getAttribute("label")))) {
                    //delete account and all folders from db
                    tbSync.db.removeAccount(accountsList.selectedItem.value);
                    //update list
                    this.updateAccountsList(nextAccount);
                } 
            } else if (confirm(tbSync.getString("prompt.DeleteAccount").replace("##accountName##", accountsList.selectedItem.getAttribute("label")))) {
                //cache all folders and remove associated targets 
                tbSync.core.disableAccount(accountsList.selectedItem.value);
                //delete account and all folders from db
                tbSync.db.removeAccount(accountsList.selectedItem.value);
                //update list
                this.updateAccountsList(nextAccount);
            }
        }
    },



    /* * *
    * Observer to catch update list request (upon provider load/unload)
    */
    updateAccountsListObserver: {
        observe: function (aSubject, aTopic, aData) {
            //aData is the accountID to be selected
            //if missing, it will try to not change selection
            tbSyncAccounts.updateAccountsList(aData); 
        }
    },
    
    updateProviderListObserver: {
        observe: function (aSubject, aTopic, aData) {
            //aData is a provider
            tbSyncAccounts.updateAvailableProvider(aData); 
        }
    },    

    toggleEnableState: function () {
        let accountsList = document.getElementById("tbSyncAccounts.accounts");
        
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value) && !tbSync.core.isSyncing(accountsList.selectedItem.value)) {            
            let isConnected = tbSync.core.isConnected(accountsList.selectedItem.value);
            if (!isConnected || window.confirm(tbSync.getString("prompt.Disable"))) {           
                tbSyncAccounts.toggleAccountEnableState(accountsList.selectedItem.value);
            }
        }
    },

    /* * *
    * Observer to catch enable state toggle
    */
    toggleEnableStateObserver: {
        observe: function (aSubject, aTopic, aData) {
            tbSyncAccounts.toggleAccountEnableState(aData);
        }
    },
    
    //is not prompting, this is doing the actual toggle
    toggleAccountEnableState: function (account) {
        if (tbSyncAccounts.hasInstalledProvider(account)) {
            let isEnabled = tbSync.core.isEnabled(account);
            
            if (isEnabled) {
                //we are enabled and want to disable (do not ask, if not connected)
                tbSync.core.disableAccount(account);
                Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountSettingsGui", account);
                tbSyncAccounts.updateAccountStatus(account);
            } else {
                //we are disabled and want to enabled
                tbSync.core.enableAccount(account);
                Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountSettingsGui", account);
                tbSync.core.syncAccount("sync", account);
            }
        }
    },

    /* * *
    * Observer to catch synstate changes and to update account icons
    */
    updateAccountSyncStateObserver: {
        observe: function (aSubject, aTopic, aData) {
            if (aData) {
                //since we want rotating arrows on each syncstate change, we need to run this on each syncstate
                tbSyncAccounts.updateAccountStatus(aData);
            }
        }
    },

    setStatusImage: function (account, obj) {
        let statusImage = this.getStatusImage(account, obj.src);
        if (statusImage != obj.src) {
            obj.src = statusImage;
        }
    },
    
    getStatusImage: function (account, current = "") {
        let src = "";   

        if (!tbSyncAccounts.hasInstalledProvider(account)) {
            src = "error16.png";
        } else {
            switch (tbSync.db.getAccountSetting(account, "status").split(".")[0]) {
                case "OK":
                    src = "tick16.png";
                    break;
                
                case "disabled":
                    src = "disabled16.png";
                    break;
                
                case "info":
                case "nolightning":
                case "notsyncronized":
                case "modified":
                    src = "info16.png";
                    break;

                case "warning":
                    src = "warning16.png";
                    break;

                case "syncing":
                    switch (current.replace("chrome://tbsync/skin/","")) {
                        case "sync16_1.png": 
                            src = "sync16_2.png"; 
                            break;
                        case "sync16_2.png": 
                            src = "sync16_3.png"; 
                            break;
                        case "sync16_3.png": 
                            src = "sync16_4.png"; 
                            break;
                        case "sync16_4.png": 
                            src = "sync16_1.png"; 
                            break;
                        default: 
                            src = "sync16_1.png";
                            tbSync.core.getSyncDataObject(account).accountManagerLastUpdated = 0;
                            break;
                    }                
                    if ((Date.now() - tbSync.core.getSyncDataObject(account).accountManagerLastUpdated) < 300) {
                        return current;
                    }
                    tbSync.core.getSyncDataObject(account).accountManagerLastUpdated = Date.now();
                    break;

                default:
                    src = "error16.png";
            }
        }
        
        return "chrome://tbsync/skin/" + src;
    },

    updateAccountLogo: function (id) {
        let accountData = new tbSync.AccountData(id);
        let listItem = document.getElementById("tbSyncAccounts.accounts." + id);
        if (listItem) {
            let obj = listItem.childNodes[0].firstChild
            obj.src = tbSyncAccounts.hasInstalledProvider(id) ? tbSync.providers[accountData.getAccountSetting("provider")].api.getProviderIcon(16, accountData) : "chrome://tbsync/skin/provider16.png";
        }
    },

    updateAccountStatus: function (id) {
        let listItem = document.getElementById("tbSyncAccounts.accounts." + id);
        if (listItem) {
            let obj = listItem.childNodes[2].firstChild
            this.setStatusImage(id, obj);
        }
    },

    updateAccountNameObserver: {
        observe: function (aSubject, aTopic, aData) {
            let pos = aData.indexOf(":");
            let id = aData.substring(0, pos);
            let name = aData.substring(pos+1);
            tbSyncAccounts.updateAccountName (id, name);
        }
    },

    updateAccountName: function (id, name) {
        let listItem = document.getElementById("tbSyncAccounts.accounts." + id);
        if (listItem.childNodes[1].getAttribute("label") != name) {
            listItem.childNodes[1].setAttribute("label", name);
            listItem.setAttribute("label", name);
        }
    },
    
    updateAvailableProvider: function (provider = null) {        
        //either add/remove a specific provider, or rebuild the list from scratch
        if (provider) {
            //update single provider entry
            tbSyncAccounts.updateAddMenuEntry(provider);
        } else {
            //add default providers
            for (let provider in tbSync.providers.defaultProviders) {
                tbSyncAccounts.updateAddMenuEntry(provider);
            }
            //update/add all remaining installed providers
            for (let provider in tbSync.providers.loadedProviders) {
                tbSyncAccounts.updateAddMenuEntry(provider);
            }
        }
        
        this.updateAccountsList();
        
        let selectedAccount = this.getSelectedAccount();
        if (selectedAccount !== null && tbSync.db.getAccountSetting(selectedAccount, "provider") == provider) {
            tbSyncAccounts.loadSelectedAccount();
        }
    },
    
    updateAccountsList: function (accountToSelect = null) {
        let accountsList = document.getElementById("tbSyncAccounts.accounts");
        let accounts = tbSync.db.getAccounts();

        // try to keep the currently selected account, if accountToSelect is not given
        if (accountToSelect === null) {
            let s = accountsList.getItemAtIndex(accountsList.selectedIndex);
            if (s) {
                // there is an entry selected, do not change it
                accountToSelect = s.value;
            }
        }
        
        if (accounts.allIDs.length > null) {

            //get current accounts in list and remove entries of accounts no longer there
            let listedAccounts = [];
            for (let i=accountsList.getRowCount()-1; i>=0; i--) {
                listedAccounts.push(accountsList.getItemAtIndex (i).value);
                if (accounts.allIDs.indexOf(accountsList.getItemAtIndex(i).value) == -1) {
                    accountsList.removeItemAt(i);
                }
            }

            //accounts array is without order, extract keys (ids) and loop over keys
            for (let i = 0; i < accounts.allIDs.length; i++) {

                if (listedAccounts.indexOf(accounts.allIDs[i]) == -1) {
                    //add all missing accounts (always to the end of the list)
                    let newListItem = document.createElement("richlistitem");
                    newListItem.setAttribute("id", "tbSyncAccounts.accounts." + accounts.allIDs[i]);
                    newListItem.setAttribute("value", accounts.allIDs[i]);
                    newListItem.setAttribute("label", accounts.data[accounts.allIDs[i]].accountname);
                    newListItem.setAttribute("ondblclick", "tbSyncAccounts.toggleEnableState();");
                    
                    //add icon (use "install provider" icon, if provider not installed)
                    let itemTypeCell = document.createElement("listcell");
                    itemTypeCell.setAttribute("class", "img");
                    itemTypeCell.setAttribute("width", "24");
                    itemTypeCell.setAttribute("height", "24");
                        let itemType = document.createElement("image");
                        itemType.setAttribute("style", "margin: 4px;");
                    itemTypeCell.appendChild(itemType);
                    newListItem.appendChild(itemTypeCell);

                    //add account name
                    let itemLabelCell = document.createElement("listcell");
                    itemLabelCell.setAttribute("class", "label");
                    itemLabelCell.setAttribute("flex", "1");
                    newListItem.appendChild(itemLabelCell);

                    //add account status
                    let itemStatusCell = document.createElement("listcell");
                    itemStatusCell.setAttribute("class", "img");
                    itemStatusCell.setAttribute("width", "30");
                    itemStatusCell.setAttribute("height", "30");
                    let itemStatus = document.createElement("image");
                    itemStatus.setAttribute("style", "margin:2px;");
                    itemStatusCell.appendChild(itemStatus);

                    newListItem.appendChild(itemStatusCell);
                    accountsList.appendChild(newListItem);
                } 
                
                //update/set actual values
                this.updateAccountName(accounts.allIDs[i], accounts.data[accounts.allIDs[i]].accountname);
                this.updateAccountStatus(accounts.allIDs[i]);
                this.updateAccountLogo(accounts.allIDs[i]);
            }
            
            //find selected item
            for (let i=0; i<accountsList.getRowCount(); i++) {
                if (accountToSelect === null || accountToSelect == accountsList.getItemAtIndex(i).value) {
                    accountsList.selectedIndex = i;
                    accountsList.ensureIndexIsVisible(i);
                    break;
                }
            }

        } else {
            //No defined accounts, empty accounts list and load dummy
            for (let i=accountsList.getRowCount()-1; i>=0; i--) {
                accountsList.removeItemAt(i);
            }
            document.getElementById("tbSyncAccounts.contentFrame").setAttribute("src", "chrome://tbsync/content/manager/noaccounts.xul");
        }
    },

    updateAddMenuEntry: function (provider) {
        let isDefault = tbSync.providers.defaultProviders.hasOwnProperty(provider);
        let isInstalled = tbSync.providers.loadedProviders.hasOwnProperty(provider);
        
        let entry = document.getElementById("addMenuEntry_" + provider);
        if (entry === null) {
            //add basic menu entry
            let newItem = window.document.createElement("menuitem");
            newItem.setAttribute("id", "addMenuEntry_" + provider);
            newItem.setAttribute("value",  provider);
            newItem.setAttribute("class", "menuitem-iconic");
            newItem.addEventListener("click", function () {tbSyncAccounts.addAccountAction(provider)}, false);
            newItem.setAttribute("hidden", true);
            entry = window.document.getElementById("accountActionsAddAccount").appendChild(newItem);
        }
        
        //Update label, icon and hidden according to isDefault and isInstalled
        if (isInstalled) {
            entry.setAttribute("label",  tbSync.providers[provider].api.getNiceProviderName());
            entry.setAttribute("src", tbSync.providers[provider].api.getProviderIcon(16));
            entry.setAttribute("hidden", false);
        } else if (isDefault) {
            entry.setAttribute("label", tbSync.providers.defaultProviders[provider].name);
            entry.setAttribute("src", "chrome://tbsync/skin/provider16.png");                    
            entry.setAttribute("hidden", false);
        } else {
            entry.setAttribute("hidden", true);
        }
    },

    getSelectedAccount: function () {
        let accountsList = document.getElementById("tbSyncAccounts.accounts");
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)) {
            //get id of selected account from value of selectedItem
            return accountsList.selectedItem.value;
        }
        return null;
    },
    
    //load the pref page for the currently selected account (triggered by onSelect)
    loadSelectedAccount: function () {
        let selectedAccount = this.getSelectedAccount();
        
        if (selectedAccount !== null) { //account id could be 0, so need to check for null explicitly
            let provider = tbSync.db.getAccountSetting(selectedAccount, "provider");            
            if (tbSyncAccounts.hasInstalledProvider(selectedAccount)) {
                document.getElementById("tbSyncAccounts.contentFrame").setAttribute("src", "chrome://tbsync/content/manager/editAccount.xul?provider="+provider+"&id=" + selectedAccount);
            } else {
                document.getElementById("tbSyncAccounts.contentFrame").setAttribute("src", "chrome://tbsync/content/manager/missingProvider.xul?provider="+provider);
            }
        }
    },
    



    addAccountAction: function (provider) {
        let isDefault = tbSync.providers.defaultProviders.hasOwnProperty(provider);
        let isInstalled = tbSync.providers.loadedProviders.hasOwnProperty(provider);
        
        if (isInstalled) {
            tbSyncAccounts.addAccount(provider);
        } else if (isDefault) {
            tbSyncAccounts.installProvider(provider);
        }
    },
    
    addAccount: function (provider) {
        let providerData = new tbSync.ProviderData(provider);
        
        document.getElementById("tbSyncAccounts.accounts").disabled=true;
        document.getElementById("tbSyncAccounts.btnAccountActions").disabled=true;
        window.openDialog(tbSync.providers[provider].api.getCreateAccountXulUrl(), "newaccount", "centerscreen,modal,resizable=no", providerData);
        document.getElementById("tbSyncAccounts.accounts").disabled=false;
        document.getElementById("tbSyncAccounts.btnAccountActions").disabled=false;
    },

    installProvider: function (provider) {
        for (let i=0; i<tbSync.AccountManagerTabs.length; i++) {            
             tbSync.manager.prefWindowObj.document.getElementById("tbSyncAccountManager.t" + i).setAttribute("active","false");
        }
        tbSync.manager.prefWindowObj.document.getElementById("tbSyncAccountManager.installProvider").hidden=false;
        tbSync.manager.prefWindowObj.document.getElementById("tbSyncAccountManager.installProvider").setAttribute("active","true");
        tbSync.manager.prefWindowObj.document.getElementById("tbSyncAccountManager.contentWindow").setAttribute("src", "chrome://tbsync/content/manager/installProvider.xul?provider="+provider);        
    },
            
};
