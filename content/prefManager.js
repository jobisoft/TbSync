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


    onunload: function () {
    },


    addAccount: function () {
        //create a new account and pass its id to updateAccountsList, which wil select it
        //the onSelect event of the List will load the selected account
        this.updateAccountsList(tzcommon.addAccount());
    },


    updateAccountsList: function (itemToSelect) {
        this.accounts = tzcommon.getAccounts();
        //accounts array is without order, extract keys (ids) and get the first one
        let accountIDs = Object.keys(this.accounts).sort();

        // if no itemToSelect is given, select the first one
        if (!itemToSelect && accountIDs.length > 0) itemToSelect = accountIDs[0];
        
        //clear accounts list
        let accountsList = document.getElementById("tzprefManager.accounts");
        accountsList.clearSelection();
        for (let i=accountsList.getRowCount(); i>0; i--) {
            accountsList.removeItemAt(i-1);
        }
        //add all found accounts
        for (let i = 0; i < accountIDs.length; i++) {
            let newListItem = document.createElement("listitem");
            newListItem.setAttribute("id", "account." +accountIDs[i]);
            if (itemToSelect && itemToSelect == accountIDs[i]) {
                //newListItem.setAttribute("selected", "true");
            }

            let accountName = document.createElement("listcell");
            accountName.setAttribute("label", this.accounts[accountIDs[i]]);
            newListItem.appendChild(accountName);
      
            accountsList.appendChild(newListItem);
        }
    },


    //load the pref page for the currently selected account
    loadSelectedAccount: function () {
        let accountsList = document.getElementById("tzprefManager.accounts");
        if (accountsList.selectedIndex != -1) {
            //get id of selected account from id of selectedItem
            this.selectedAccount = accountsList.selectedItem.id.split(".")[1];
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


    notes: function () {
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
        openTBtab("chrome://tzpush/content/notes.html");
    }

};
