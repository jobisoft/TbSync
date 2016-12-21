"use strict";

Components.utils.import("chrome://tzpush/content/tzcommon.jsm");
//TODO (for production): after migration, delete the data stored in prefs, the user might get confused at a later time, if that old account data is remigrated again, if the db was deleted
var tzprefManager = {

    selectedAccount: null,


    onload: function () {
        //scan accounts, update list and select first entry (because no id is passed to updateAccountList)
        //the onSelect event of the List will load the selected account
        this.updateAccountsList(); 
    },


    addAccount: function () {
        //create a new account and pass its id to updateAccountsList, which wil select it
        //the onSelect event of the List will load the selected account
        this.updateAccountsList(tzcommon.addAccount());
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
            
            if (confirm(tzcommon.getLocalizedMessage("promptDeleteAccount").replace("##accountName##", accountsList.selectedItem.label))) {
                tzcommon.removeAccount(accountsList.selectedItem.value);
                this.updateAccountsList(nextAccount);
            }
        }
    },

    getStatusImage: function (account) {
        let imagesrc = "disconnected.png";
        //if not connected show discon, otherwise check for error
        if (tzcommon.getAccountSetting(account, "connected")) {
            if (tzcommon.getAccountSetting(account, "lastError") != "") imagesrc = "error.png"
            else imagesrc = "ok.png";
        }
        return "chrome://tzpush/skin/" + imagesrc;
    },

    updateAccountsList: function (accountToSelect = -1) {
        let accountsList = document.getElementById("tzprefManager.accounts");
        let accounts = tzcommon.getAccounts();

        if (accounts !== null) {

            //get current accounts in list and remove entries of accounts no longer there
            let listedAccounts = [];
            for (let i=accountsList.getRowCount()-1; i>=0; i--) {
                listedAccounts.push(accountsList.getItemAtIndex (i).value);
                if (!accounts.hasOwnProperty(accountsList.getItemAtIndex(i).value)) {
                    accountsList.removeItemAt(i);
                }
            }

            //accounts array is without order, extract keys (ids) and loop over keys
            let accountIDs = Object.keys(accounts).sort((a, b) => a - b);
            for (let i = 0; i < accountIDs.length; i++) {

                if (listedAccounts.indexOf(accountIDs[i]) == -1) {
                    //add all missing accounts (always to the end of the list)
                    let newListItem = document.createElement("richlistitem");
                    newListItem.setAttribute("id", "tzprefManager.accounts." + accountIDs[i]);
                    newListItem.setAttribute("value", accountIDs[i]);

                    //add account name
                    let itemLabelCell = document.createElement("listcell");
                    itemLabelCell.setAttribute("class", "label");
                    itemLabelCell.setAttribute("flex", "1");
                    let itemLabel = document.createElement("label");
                    itemLabel.setAttribute("value", accounts[accountIDs[i]]);
                    itemLabelCell.appendChild(itemLabel);
                    newListItem.appendChild(itemLabelCell);

                    //add account status
                    let itemStatusCell = document.createElement("listcell");
                    itemStatusCell.setAttribute("class", "img");
                    itemStatusCell.setAttribute("width", "34");
                    itemStatusCell.setAttribute("height", "34");
                    let itemStatus = document.createElement("image");
                    itemStatus.setAttribute("src", this.getStatusImage(accountIDs[i]));
                    itemStatus.setAttribute("style", "margin:2px;");
                    itemStatusCell.appendChild(itemStatus);

                    newListItem.appendChild(itemStatusCell);
                    accountsList.appendChild(newListItem);
                } else {
                    //update existing entries in list
                    this.updateAccountName(accountIDs[i], accounts[accountIDs[i]]);
                    this.updateAccountStatus(accountIDs[i]);
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


    updateAccountName: function (id, name) {
        let listItem = document.getElementById("tzprefManager.accounts." + id);
        if (listItem.childNodes[0].firstChild.value != name) listItem.childNodes[0].firstChild.value = name;
    },
    
    updateAccountStatus: function (id) {
        let listItem = document.getElementById("tzprefManager.accounts." + id);
        if (listItem.childNodes[1].firstChild.src != this.getStatusImage(id)) listItem.childNodes[1].firstChild.src = this.getStatusImage(id);
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
