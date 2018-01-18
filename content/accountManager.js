"use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");
Components.utils.import("resource://gre/modules/osfile.jsm");
Components.utils.import("resource://gre/modules/Task.jsm");

var tbSyncAccountManager = {

    selectedAccount: null,

    onload: function () {
        //scan accounts, update list and select first entry (because no id is passed to updateAccountList)
        //the onSelect event of the List will load the selected account
        this.updateAccountsList(); 
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.addObserver(tbSyncAccountManager.updateAccountSyncStateObserver, "tbsync.changedSyncstate", false);
        observerService.addObserver(tbSyncAccountManager.updateAccountNameObserver, "tbsync.changedAccountName", false);
    },

    onunload: function () {
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.removeObserver(tbSyncAccountManager.updateAccountSyncStateObserver, "tbsync.changedSyncstate");
        observerService.removeObserver(tbSyncAccountManager.updateAccountNameObserver, "tbsync.changedAccountName");
        tbSync.prefWindowObj = null;
    },


    addAccount: function () {
        //EAS hardcoded, will be made dynamic as soon as different providers are usable
        window.openDialog("chrome://tbsync/content/provider/eas/newaccount.xul", "easnewaccount", "centerscreen,modal,resizable=no");
    },


    deleteAccount: function () {
        let accountsList = document.getElementById("tbSyncAccountManager.accounts");
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)) {
            let nextAccount =  -1;
            if (accountsList.selectedIndex > 0) {
                //first try to select the item after this one, otherwise take the one before
                if (accountsList.selectedIndex + 1 < accountsList.getRowCount()) nextAccount = accountsList.getItemAtIndex(accountsList.selectedIndex + 1).value;
                else nextAccount = accountsList.getItemAtIndex(accountsList.selectedIndex - 1).value;
            }
            
            if (confirm(tbSync.getLocalizedMessage("prompt.DeleteAccount").replace("##accountName##", accountsList.selectedItem.getAttribute("label")))) {
                //disconnect (removes ab, triggers changelog cleanup) 
                tbSync[tbSync.db.getAccountSetting(accountsList.selectedItem.value, "provider")].disconnectAccount(accountsList.selectedItem.value);
                //delete account from db
                tbSync.db.removeAccount(accountsList.selectedItem.value);

                this.updateAccountsList(nextAccount);
            }
        }
    },


    /* * *
    * Observer to catch synstate changes and to update account icons
    */
    updateAccountSyncStateObserver: {
        observe: function (aSubject, aTopic, aData) {
            if (aData != "") {
                //limit execution to a couple of states, not all
                let state = tbSync.getSyncData(aData,"state");
                //if (state == "syncing" || state == "accountdone") 
                tbSyncAccountManager.updateAccountStatus(aData);
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
                src = "tick16.png";
                break;
            
            case "notconnected":
                src = "discon.png";
                break;
            
            case "notsyncronized":
            case "nolightning":
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
        let listItem = document.getElementById("tbSyncAccountManager.accounts." + id);
        this.setStatusImage(id, listItem.childNodes[1].firstChild);
    },

    updateAccountNameObserver: {
        observe: function (aSubject, aTopic, aData) {
            let pos = aData.indexOf(":");
            let id = aData.substring(0, pos);
            let name = aData.substring(pos+1);
            tbSyncAccountManager.updateAccountName (id, name);
        }
    },

    updateAccountName: function (id, name) {
        let listItem = document.getElementById("tbSyncAccountManager.accounts." + id);
        if (listItem.firstChild.getAttribute("label") != name) listItem.firstChild.setAttribute("label", name);
    },
    
    updateAccountsList: function (accountToSelect = -1) {
        let accountsList = document.getElementById("tbSyncAccountManager.accounts");
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
                    newListItem.setAttribute("id", "tbSyncAccountManager.accounts." + accounts.IDs[i]);
                    newListItem.setAttribute("value", accounts.IDs[i]);
                    newListItem.setAttribute("label", accounts.data[accounts.IDs[i]].accountname);

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
            document.getElementById("tbSyncAccountManager.contentFrame").webNavigation.loadURI("chrome://tbsync/content/noaccounts.xul", LOAD_FLAGS_NONE, null, null, null);
        }
    },


    //load the pref page for the currently selected account (triggered by onSelect)
    loadSelectedAccount: function () {
        let accountsList = document.getElementById("tbSyncAccountManager.accounts");
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)) {
            //get id of selected account from value of selectedItem
            this.selectedAccount = accountsList.selectedItem.value;
            const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;
            document.getElementById("tbSyncAccountManager.contentFrame").webNavigation.loadURI("chrome://tbsync/content/provider/"+tbSync.db.getAccountSetting(this.selectedAccount, "provider")+"/accountSettings.xul?id=" + this.selectedAccount, LOAD_FLAGS_NONE, null, null, null);
        }
    },

    openFileTab: function (file) {
        return tbSync.openTBtab(tbSync.getAbsolutePath(file));
    }
    
};
