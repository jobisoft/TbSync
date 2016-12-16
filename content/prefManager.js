"use strict";

Components.utils.import("chrome://tzpush/content/tzcommon.jsm");

var tzprefManager = {

    selectedAccount: null,
    accounts: null,


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
            if (confirm(tzcommon.getLocalizedMessage("promptDeleteAccount").replace("##accountName##",accountsList.selectedItem.label))) {
                tzcommon.removeAccount(accountsList.selectedItem.value);
                this.updateAccountsList();
            };
        }
    },


    updateAccountsList: function (accountToSelect = -1) {
        //clear current accounts list
        let accountsList = document.getElementById("tzprefManager.accounts");
        accountsList.clearSelection();
        for (let i=accountsList.getRowCount(); i>0; i--) {
            accountsList.removeItemAt(i-1);
        }

        this.accounts = tzcommon.getAccounts();
        if (this.accounts !== null) {
            //accounts array is without order, extract keys (ids) and loop over keys
            let accountIDs = Object.keys(this.accounts).sort();
            //add all found accounts and select the one identified by accountToSelect (if given)
            let selIdx = 0;
            for (let i = 0; i < accountIDs.length; i++) {
                accountsList.appendItem(this.accounts[accountIDs[i]], accountIDs[i]);
                if (accountToSelect == accountIDs[i]) selIdx = i;
            }
            accountsList.selectedIndex = selIdx;
            accountsList.ensureIndexIsVisible(selIdx);
        } else {
            //No defined accounts, load dummy
            const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;
            document.getElementById("contentFrame").webNavigation.loadURI("chrome://tzpush/content/help.html", LOAD_FLAGS_NONE, null, null, null);            
        }
    },


    updateAccountName: function (id, name) {
        let accountsList = document.getElementById("tzprefManager.accounts");
        for (let i=0; i<accountsList.getRowCount(); i++) {
            if (accountsList.getItemAtIndex(i).value == id) {
                accountsList.getItemAtIndex(i).label = name;
                break;
            }
        }
    },
    
    
    //load the pref page for the currently selected account (triggered by onSelect)
    loadSelectedAccount: function () {
        let accountsList = document.getElementById("tzprefManager.accounts");
        if (accountsList.selectedItem !== null && !isNaN(accountsList.selectedItem.value)) {
            //get id of selected account from value of selectedItem
            this.selectedAccount = accountsList.selectedItem.value;
            const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;
            document.getElementById("contentFrame").webNavigation.loadURI("chrome://tzpush/content/pref.xul", LOAD_FLAGS_NONE, null, null, null);
        }
    },




    cape: function () {
        function openTBtab(tempURL) {
            var tabmail = null;
            var mail3PaneWindow =
                Components.classes["@mozilla.org/appshell/window-mediator;1"]
                .getService(Components.interfaces.nsIWindowMediator)
                .getMostRecentWindow("mail:3pane");
            if (mail3PaneWindow) {
                tabmail = mail3PaneWindow.document.getElementById("tabmail");
                mail3PaneWindow.focus();
                tabmail.openTab("contentTab", {
                    contentPage: tempURL
                });
            }
            return (tabmail != null);
        }
        openTBtab("http://www.c-a-p-e.co.uk");
    },


};
