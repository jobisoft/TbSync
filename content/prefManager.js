"use strict";

Components.utils.import("chrome://tzpush/content/tzpush.jsm");

var tzprefManager = {

    selectedAccount: null,

    onload: function () {
        //scan accounts, update list and select first entry (because no id is passed to updateAccountList)
        //the onSelect event of the List will load the selected account
        this.updateAccountsList(); 
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.addObserver(tzprefManager.updateAccountStatusObserver, "tzpush.changedSyncstate", false);
    },

    onunload: function () {
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.removeObserver(tzprefManager.updateAccountStatusObserver, "tzpush.changedSyncstate");
        tzPush.prefWindowObj = null;
    },


    addAccount: function () {
        //create a new account and pass its id to updateAccountsList, which wil select it
        //the onSelect event of the List will load the selected account
        this.updateAccountsList(tzPush.db.addAccount(tzPush.getLocalizedMessage("new_account"), true));
    },


    deleteAccount: function () {
        let accountsList = document.getElementById("tzprefManager.accounts");
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)) {
            let nextAccount =  -1;
            if (accountsList.selectedIndex > 0) {
                //first try to select the item after this one, otherwise take the one before
                if (accountsList.selectedIndex + 1 < accountsList.getRowCount()) nextAccount = accountsList.getItemAtIndex(accountsList.selectedIndex + 1).value;
                else nextAccount = accountsList.getItemAtIndex(accountsList.selectedIndex - 1).value;
            }
            
            if (confirm(tzPush.getLocalizedMessage("promptDeleteAccount").replace("##accountName##", accountsList.selectedItem.label))) {
                //disconnect (removes ab, triggers deletelog cleanup) 
                tzPush.sync.disconnectAccount(accountsList.selectedItem.value);
                //delete account from db
                tzPush.db.removeAccount(accountsList.selectedItem.value);

                this.updateAccountsList(nextAccount);
            }
        }
    },


    /* * *
    * Observer to catch synstate changes and to update account icons
    */
    updateAccountStatusObserver: {
        observe: function (aSubject, aTopic, aData) {
            //limit execution to a couple of states, not all
            let state = tzPush.sync.currentProzess.state;
            
            //react on true syncstate changes send by setSyncState()
            if (aData == "" && (state == "syncing" || state == "accountdone")) tzprefManager.updateAccountStatus(tzPush.sync.currentProzess.account );

            //react on manual notifications send by tzmessenger
            if (aData != "") tzprefManager.updateAccountStatus(aData);
        }
    },

    getStatusImage: function (account) {
        let src = "";   

        switch (tzPush.db.getAccountSetting(account, "status")) {
            case "OK":
                src = "tick16.png";
                break;
            
            case "notconnected":
                src = "discon.png";
                break;
            
            case "notsyncronized":
                src = "warning16.png";
                break;

            case "syncing":
                src = "sync16.png";
                break;

            default:
                src = "error16.png";
        }

        return "chrome://tzpush/skin/" + src;
    },


    updateAccountStatus: function (id) {
        let listItem = document.getElementById("tzprefManager.accounts." + id);
        let statusimage = this.getStatusImage(id);
        if (listItem.childNodes[1].firstChild.src != statusimage) {
            listItem.childNodes[1].firstChild.src = statusimage;
        }
    },

    updateAccountName: function (id, name) {
        let listItem = document.getElementById("tzprefManager.accounts." + id);
        if (listItem.firstChild.getAttribute("label") != name) listItem.firstChild.setAttribute("label", name);
    },
    
    updateAccountsList: function (accountToSelect = -1) {
        let accountsList = document.getElementById("tzprefManager.accounts");
        let accounts = tzPush.db.getAccounts();

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
                    newListItem.setAttribute("id", "tzprefManager.accounts." + accounts.IDs[i]);
                    newListItem.setAttribute("value", accounts.IDs[i]);

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
            document.getElementById("tzprefManager.contentFrame").webNavigation.loadURI("chrome://tzpush/content/noaccounts.xul", LOAD_FLAGS_NONE, null, null, null);
        }
    },


    //load the pref page for the currently selected account (triggered by onSelect)
    loadSelectedAccount: function () {
        let accountsList = document.getElementById("tzprefManager.accounts");
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)) {
            //get id of selected account from value of selectedItem
            this.selectedAccount = accountsList.selectedItem.value;
            const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;
            document.getElementById("tzprefManager.contentFrame").webNavigation.loadURI("chrome://tzpush/content/pref.xul", LOAD_FLAGS_NONE, null, null, null);
        }
    },



    openTBtab: function (url) {
        var tabmail = null;
        var mail3PaneWindow =
            Components.classes["@mozilla.org/appshell/window-mediator;1"]
            .getService(Components.interfaces.nsIWindowMediator)
            .getMostRecentWindow("mail:3pane");
        if (mail3PaneWindow) {
            tabmail = mail3PaneWindow.document.getElementById("tabmail");
            mail3PaneWindow.focus();
            tabmail.openTab("contentTab", {
                contentPage: url
            });
        }
        return (tabmail !== null);
    }

};
