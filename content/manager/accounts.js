"use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccounts = {

    selectedAccount: null,

    onload: function () {
        //scan accounts, update list and select first entry (because no id is passed to updateAccountList)
        //the onSelect event of the List will load the selected account
        this.updateAccountsList(); 
        Services.obs.addObserver(tbSyncAccounts.updateAccountSyncStateObserver, "tbsync.changedSyncstate", false);
        Services.obs.addObserver(tbSyncAccounts.updateAccountNameObserver, "tbsync.changedAccountName", false);
        Services.obs.addObserver(tbSyncAccounts.toggleEnableStateObserver, "tbsync.toggleEnableState", false);
    },

    onunload: function () {
        Services.obs.removeObserver(tbSyncAccounts.updateAccountSyncStateObserver, "tbsync.changedSyncstate");
        Services.obs.removeObserver(tbSyncAccounts.updateAccountNameObserver, "tbsync.changedAccountName");
        Services.obs.removeObserver(tbSyncAccounts.toggleEnableStateObserver, "tbsync.toggleEnableState");
    },

    debugToggleAll: function () {
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i < accounts.IDs.length; i++) {
            tbSyncAccounts.toggleEnableStateObserver.observe(null, "tbsync.toggleEnableState", accounts.IDs[i], true);
        }
    },
    
    debugMod: function () { 
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i < accounts.IDs.length; i++) {
            if (tbSync.isEnabled(accounts.IDs[i])) {
                let folders = tbSync.db.getFolders(accounts.IDs[i]);
                for (let f in folders) {
                    if (folders[f].selected == "1") {
                        switch (folders[f].type) {
                            case "9": 
                            case "14": 
                                //"Contacts";
                                let targetId = tbSync.db.getFolderSetting(accounts.IDs[i], folders[f].folderID, "target");
                                let addressbook = tbSync.getAddressBookObject(targetId);
                                let oldresults = addressbook.getCardsFromProperty("PrimaryEmail", "debugcontact@inter.net", true);
                                while (oldresults.hasMoreElements()) {
                                    let card = oldresults.getNext();
                                    card.setProperty("DisplayName", "Debug Contact " + Date.now());
                                    card.setProperty("LastName", "Contact " + Date.now());
                                    addressbook.modifyCard(newitem.card);
                                }
                                
                                break;
                            case "8":
                            case "13":
                                //"Calendar";
                                break;
                            case "7":
                            case "15":
                                //"Tasks";
                                break;
                        }
                    }
                }
            }
        }
    },

    debugDel: function () { 
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i < accounts.IDs.length; i++) {
            if (tbSync.isEnabled(accounts.IDs[i])) {
                let folders = tbSync.db.getFolders(accounts.IDs[i]);
                for (let f in folders) {
                    if (folders[f].selected == "1") {
                        switch (folders[f].type) {
                            case "9": 
                            case "14": 
                                //"Contacts";
                                let targetId = tbSync.db.getFolderSetting(accounts.IDs[i], folders[f].folderID, "target");
                                let addressbook = tbSync.getAddressBookObject(targetId);
                                let oldresults = addressbook.getCardsFromProperty("PrimaryEmail", "debugcontact@inter.net", true);
                                let cardsToDelete = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
                                while (oldresults.hasMoreElements()) {
                                    cardsToDelete.appendElement(oldresults.getNext(), "");
                                }
                                addressbook.deleteCards(cardsToDelete);
                                
                                break;
                            case "8":
                            case "13":
                                //"Calendar";
                                break;
                            case "7":
                            case "15":
                                //"Tasks";
                                break;
                        }
                    }
                }
            }
        }
    },

    debugAdd: function (max) { 
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i < accounts.IDs.length; i++) {
            if (tbSync.isEnabled(accounts.IDs[i])) {
                let folders = tbSync.db.getFolders(accounts.IDs[i]);
                for (let f in folders) {
                    if (folders[f].selected == "1") {
                        switch (folders[f].type) {
                            case "9": 
                            case "14": 
                                //"Contacts";
                                let targetId = tbSync.db.getFolderSetting(accounts.IDs[i], folders[f].folderID, "target");
                                let addressbook = tbSync.getAddressBookObject(targetId);
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
                            break;
                            case "8":
                            case "13":
                                //"Calendar";
                                break;
                            case "7":
                            case "15":
                                //"Tasks";
                                break;
                        }
                    }
                }
            }
        }
    },
        
    addAccount: function () {
        //EAS hardcoded, will be made dynamic as soon as different providers are usable
        document.getElementById("tbSyncAccounts.accounts").disabled=true;
        document.getElementById("tbSyncAccounts.btnAccountActions").disabled=true;
        window.openDialog("chrome://tbsync/content/provider/eas/newaccount.xul", "easnewaccount", "centerscreen,modal,resizable=no");
        document.getElementById("tbSyncAccounts.accounts").disabled=false;
        document.getElementById("tbSyncAccounts.btnAccountActions").disabled=false;
    },

    updateDropdown: function (selector) {
        let accountsList = document.getElementById("tbSyncAccounts.accounts");
        let selectedAccount = null;
        let selectedAccountName = "";
        let isActionsDropdown = (selector == "accountActions");

        let isSyncing = false;
        let isConnected = false;
        let isEnabled = false;
        
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)) {
            //some item is selected
            let selectedItem = accountsList.selectedItem;
            selectedAccount = selectedItem.value;
            selectedAccountName = selectedItem.getAttribute("label");
            isSyncing = tbSync.isSyncing(selectedAccount);
            isConnected = tbSync.isConnected(selectedAccount);
            isEnabled = tbSync.isEnabled(selectedAccount);
        }
        
        //hide if no accounts are avail (which is identical to no account selected)
        if (isActionsDropdown) document.getElementById(selector + "SyncAllAccounts").hidden = (selectedAccount === null);
        
        //hide if no account is selected
        if (isActionsDropdown) document.getElementById(selector + "Separator").hidden = (selectedAccount === null);
        document.getElementById(selector + "DeleteAccount").hidden = (selectedAccount === null);
        document.getElementById(selector + "DisableAccount").hidden = (selectedAccount === null) || !isEnabled;
        document.getElementById(selector + "EnableAccount").hidden = (selectedAccount === null) || isEnabled;
        document.getElementById(selector + "SyncAccount").hidden = (selectedAccount === null) || !isConnected;
        document.getElementById(selector + "RetryConnectAccount").hidden = (selectedAccount === null) || isConnected || !isEnabled;

        //Not yet implemented
        document.getElementById(selector + "ShowSyncLog").hidden = true;//(selectedAccount === null) || !isEnabled;
        document.getElementById(selector + "ShowSyncLog").disabled = true;
        
        if (selectedAccount !== null) {
            //disable if currently syncing (and displayed)
            document.getElementById(selector + "DeleteAccount").disabled = isSyncing;
            document.getElementById(selector + "DisableAccount").disabled = isSyncing;
            document.getElementById(selector + "EnableAccount").disabled = isSyncing;
            document.getElementById(selector + "SyncAccount").disabled = isSyncing;
            //adjust labels - only in global actions dropdown
            if (isActionsDropdown) document.getElementById(selector + "DeleteAccount").label = tbSync.getLocalizedMessage("accountacctions.delete").replace("##accountname##", selectedAccountName);
            if (isActionsDropdown) document.getElementById(selector + "SyncAccount").label = tbSync.getLocalizedMessage("accountacctions.sync").replace("##accountname##", selectedAccountName);
            if (isActionsDropdown) document.getElementById(selector + "EnableAccount").label = tbSync.getLocalizedMessage("accountacctions.enable").replace("##accountname##", selectedAccountName);
            if (isActionsDropdown) document.getElementById(selector + "DisableAccount").label = tbSync.getLocalizedMessage("accountacctions.disable").replace("##accountname##", selectedAccountName);
        }
	
        //Debug Options
        if (isActionsDropdown) {
            document.getElementById("accountActionsDebugToggleAll").hidden = !tbSync.prefSettings.getBoolPref("debug.testoptions");
            document.getElementById("accountActionsDebugAdd1").hidden = !tbSync.prefSettings.getBoolPref("debug.testoptions");
            document.getElementById("accountActionsDebugAdd10").hidden = !tbSync.prefSettings.getBoolPref("debug.testoptions");
            document.getElementById("accountActionsDebugMod").hidden = !tbSync.prefSettings.getBoolPref("debug.testoptions");
            document.getElementById("accountActionsDebugDel").hidden = !tbSync.prefSettings.getBoolPref("debug.testoptions");
            document.getElementById("accountActionsSeparatorDebug").hidden = !tbSync.prefSettings.getBoolPref("debug.testoptions");
        }
    },
    
    toggleEnableState: function () {
        let accountsList = document.getElementById("tbSyncAccounts.accounts");
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value) && !tbSync.isSyncing(accountsList.selectedItem.value)) {            
            Services.obs.notifyObservers(null, "tbsync.toggleEnableState", accountsList.selectedItem.value);
        }
    },

    synchronizeAccount: function () {
        let accountsList = document.getElementById("tbSyncAccounts.accounts");
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)  && !tbSync.isSyncing(accountsList.selectedItem.value)) {            
            tbSync.syncAccount('sync', accountsList.selectedItem.value);
        }
    },

    deleteAccount: function () {
        let accountsList = document.getElementById("tbSyncAccounts.accounts");
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)  && !tbSync.isSyncing(accountsList.selectedItem.value)) {
            let nextAccount =  -1;
            if (accountsList.selectedIndex > 0) {
                //first try to select the item after this one, otherwise take the one before
                if (accountsList.selectedIndex + 1 < accountsList.getRowCount()) nextAccount = accountsList.getItemAtIndex(accountsList.selectedIndex + 1).value;
                else nextAccount = accountsList.getItemAtIndex(accountsList.selectedIndex - 1).value;
            }
            
            if (confirm(tbSync.getLocalizedMessage("prompt.DeleteAccount").replace("##accountName##", accountsList.selectedItem.getAttribute("label")))) {
                //disable (removes ab, triggers changelog cleanup) 
                tbSync[tbSync.db.getAccountSetting(accountsList.selectedItem.value, "provider")].disableAccount(accountsList.selectedItem.value);
                //delete account and all folders from db
                tbSync.db.removeAccount(accountsList.selectedItem.value);

                this.updateAccountsList(nextAccount);
            }
        }
    },


    /* * *
    * Observer to catch enable state toggle
    */
    toggleEnableStateObserver: {
        observe: function (aSubject, aTopic, aData, doNotAsk = false) {
            let account = aData;                        
            let isConnected = tbSync.isConnected(account);
            let isEnabled = tbSync.isEnabled(account);

            if (isEnabled) {
                //we are enabled and want to disable (do not ask, if not connected)
                if (doNotAsk || !isConnected || window.confirm(tbSync.getLocalizedMessage("prompt.Disable"))) {
                    tbSync[tbSync.db.getAccountSetting(account, "provider")].disableAccount(account);
                    Services.obs.notifyObservers(null, "tbsync.updateAccountSettingsGui", account);
                }
            } else {
                //we are disabled and want to enabled
                tbSync[tbSync.db.getAccountSetting(account, "provider")].enableAccount(account);
                Services.obs.notifyObservers(null, "tbsync.updateAccountSettingsGui", account);
                tbSync.syncAccount("sync", account);
            }
        }
    },


    /* * *
    * Observer to catch synstate changes and to update account icons
    */
    updateAccountSyncStateObserver: {
        observe: function (aSubject, aTopic, aData) {
            if (aData != "") {
                //since we want rotating arrows on each syncstate change, we need to run this on each syncstate
                let syncstate = tbSync.getSyncData(aData,"syncstate");
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
        switch (tbSync.db.getAccountSetting(account, "status")) {
            case "OK":
                if (tbSync.isEnabled(account)) src = "tick16.png";
                else src = "disabled.png";
                break;
            
            case "disabled":
                src = "disabled.png";
                break;
            
            case "needtorevert":
            case "notsyncronized":
            case "nolightning":
            case "modified":
                src = "warning16.png";
                break;

            case "syncing":
                if (current.indexOf("sync16") == -1) {
                    //current img is something else, show sync img directly
                    src = "sync16.png";
                    tbSync.setSyncData(account, "accountManagerLastUpdated", Date.now());
                } else if ((Date.now() - tbSync.getSyncData(account, "accountManagerLastUpdated")) > 400) {
                    //current img is one of the sync images, flip at lower speed see them rotate
                    if (current.indexOf("sync16.png") == -1) src = "sync16.png"; else src = "sync16_r.png";
                    tbSync.setSyncData(account, "accountManagerLastUpdated", Date.now());
                } else {
                    return current;
                }
                break;

            default:
                src = "error16.png";
        }

        return "chrome://tbsync/skin/" + src;
    },

    updateAccountStatus: function (id) {
        let listItem = document.getElementById("tbSyncAccounts.accounts." + id);
        if (listItem) this.setStatusImage(id, listItem.childNodes[1].firstChild);
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
        if (listItem.firstChild.getAttribute("label") != name) listItem.firstChild.setAttribute("label", name);
    },
    
    updateAccountsList: function (accountToSelect = -1) {
        let accountsList = document.getElementById("tbSyncAccounts.accounts");
        let accounts = tbSync.db.getAccounts();

        if (accounts.IDs.length > null) {

            //get current accounts in list and remove entries of accounts no longer there
            let listedAccounts = [];
            for (let i=accountsList.getRowCount()-1; i>=0; i--) {
                listedAccounts.push(accountsList.getItemAtIndex (i).value);
                if (accounts.IDs.indexOf(accountsList.getItemAtIndex(i).value) == -1) {
                    accountsList.removeItemAt(i);
                }
            }

            //accounts array is without order, extract keys (ids) and loop over keys
            for (let i = 0; i < accounts.IDs.length; i++) {

                if (listedAccounts.indexOf(accounts.IDs[i]) == -1) {
                    //add all missing accounts (always to the end of the list)
                    let newListItem = document.createElement("richlistitem");
                    newListItem.setAttribute("id", "tbSyncAccounts.accounts." + accounts.IDs[i]);
                    newListItem.setAttribute("value", accounts.IDs[i]);
                    newListItem.setAttribute("label", accounts.data[accounts.IDs[i]].accountname);
                    newListItem.setAttribute("ondblclick", "tbSyncAccounts.toggleEnableState();");
                    
                    //add account name
                    let itemLabelCell = document.createElement("listcell");
                    itemLabelCell.setAttribute("class", "label");
                    itemLabelCell.setAttribute("flex", "1");
                    itemLabelCell.setAttribute("label", accounts.data[accounts.IDs[i]].accountname);
                    newListItem.appendChild(itemLabelCell);

                    //add account status
                    let itemStatusCell = document.createElement("listcell");
                    itemStatusCell.setAttribute("class", "img");
                    itemStatusCell.setAttribute("width", "30");
                    itemStatusCell.setAttribute("height", "30");
                    let itemStatus = document.createElement("image");
                    itemStatus.setAttribute("src", this.getStatusImage(accounts.IDs[i]));
                    itemStatus.setAttribute("style", "margin:2px;");
                    itemStatusCell.appendChild(itemStatus);

                    newListItem.appendChild(itemStatusCell);
                    accountsList.appendChild(newListItem);
                } else {
                    //update existing entries in list
                    this.updateAccountName(accounts.IDs[i], accounts.data[accounts.IDs[i]].accountname);
                    this.updateAccountStatus(accounts.IDs[i]);
                }
            }
            
            //find selected item
            for (let i=0; i<accountsList.getRowCount(); i++) {
                if (accountToSelect == accountsList.getItemAtIndex(i).value || accountToSelect == -1) {
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
            
            const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;
            document.getElementById("tbSyncAccounts.contentFrame").webNavigation.loadURI("chrome://tbsync/content/manager/noaccounts.xul", LOAD_FLAGS_NONE, null, null, null);
        }
    },


    //load the pref page for the currently selected account (triggered by onSelect)
    loadSelectedAccount: function () {
        let accountsList = document.getElementById("tbSyncAccounts.accounts");
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)) {
            //get id of selected account from value of selectedItem
            this.selectedAccount = accountsList.selectedItem.value;
            const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;
            document.getElementById("tbSyncAccounts.contentFrame").webNavigation.loadURI("chrome://tbsync/content/provider/"+tbSync.db.getAccountSetting(this.selectedAccount, "provider")+"/accountSettings.xul?id=" + this.selectedAccount, LOAD_FLAGS_NONE, null, null, null);
        }
    }
    
};
