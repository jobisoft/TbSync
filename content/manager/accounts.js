/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { tbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

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
  
  hasInstalledProvider: function (accountID) {
    let provider = tbSync.db.getAccountProperty(accountID, "provider");
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
  toggleAccountEnableState: function (accountID) {
    if (tbSyncAccounts.hasInstalledProvider(accountID)) {
      let isEnabled = tbSync.core.isEnabled(accountID);
      
      if (isEnabled) {
        //we are enabled and want to disable (do not ask, if not connected)
        tbSync.core.disableAccount(accountID);
        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountSettingsGui", accountID);
        tbSyncAccounts.updateAccountStatus(accountID);
      } else {
        //we are disabled and want to enabled
        tbSync.core.enableAccount(accountID);
        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountSettingsGui", accountID);
        tbSync.core.syncAccount("sync", accountID);
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

  setStatusImage: function (accountID, obj) {
    let statusImage = this.getStatusImage(accountID, obj.src);
    if (statusImage != obj.src) {
      obj.src = statusImage;
    }
  },
  
  getStatusImage: function (accountID, current = "") {
    let src = "";   

    if (!tbSyncAccounts.hasInstalledProvider(accountID)) {
      src = "error16.png";
    } else {
      switch (tbSync.db.getAccountProperty(accountID, "status").split(".")[0]) {
        case "success":
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
              tbSync.core.getSyncDataObject(accountID).accountManagerLastUpdated = 0;
              break;
          }                
          if ((Date.now() - tbSync.core.getSyncDataObject(accountID).accountManagerLastUpdated) < 300) {
            return current;
          }
          tbSync.core.getSyncDataObject(accountID).accountManagerLastUpdated = Date.now();
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
      let obj = listItem.childNodes[0];
      obj.src = tbSyncAccounts.hasInstalledProvider(id) ? tbSync.providers[accountData.getAccountProperty("provider")].api.getProviderIcon(16, accountData) : "chrome://tbsync/skin/provider16.png";
    }
  },

  updateAccountStatus: function (id) {
    let listItem = document.getElementById("tbSyncAccounts.accounts." + id);
    if (listItem) {
      let obj = listItem.childNodes[2];
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
    if (listItem.childNodes[1].getAttribute("value") != name) {
      listItem.childNodes[1].setAttribute("value", name);
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
    if (selectedAccount !== null && tbSync.db.getAccountProperty(selectedAccount, "provider") == provider) {
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
        let item = accountsList.getItemAtIndex(i);
        listedAccounts.push(item.value);
        if (accounts.allIDs.indexOf(item.value) == -1) {
          item.remove();
        }
      }

      //accounts array is without order, extract keys (ids) and loop over keys
      for (let i = 0; i < accounts.allIDs.length; i++) {

        if (listedAccounts.indexOf(accounts.allIDs[i]) == -1) {
          //add all missing accounts (always to the end of the list)
          let newListItem = document.createElement("richlistitem");
          newListItem.setAttribute("id", "tbSyncAccounts.accounts." + accounts.allIDs[i]);
          newListItem.setAttribute("value", accounts.allIDs[i]);
          newListItem.setAttribute("align", "center");
          newListItem.setAttribute("label", accounts.data[accounts.allIDs[i]].accountname);
          newListItem.setAttribute("style", "padding: 5px 0px;");
          newListItem.setAttribute("ondblclick", "tbSyncAccounts.toggleEnableState();");
          
          //add icon (use "install provider" icon, if provider not installed)
          let itemType = document.createElement("image");
          itemType.setAttribute("width", "16");
          itemType.setAttribute("height", "16");
          itemType.setAttribute("style", "margin: 0px 0px 0px 5px;");
          newListItem.appendChild(itemType);

          //add account name
          let itemLabel = document.createElement("label");
          itemLabel.setAttribute("flex", "1");
          newListItem.appendChild(itemLabel);

          //add account status
          let itemStatus = document.createElement("image");
          itemStatus.setAttribute("width", "16");
          itemStatus.setAttribute("height", "16");
          itemStatus.setAttribute("style", "margin: 0px 5px;");
          newListItem.appendChild(itemStatus);
          
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
        accountsList.getItemAtIndex(i).remove();
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
      entry.setAttribute("image", tbSync.providers[provider].api.getProviderIcon(16));
      entry.setAttribute("hidden", false);
    } else if (isDefault) {
      entry.setAttribute("label", tbSync.providers.defaultProviders[provider].name);
      entry.setAttribute("image", "chrome://tbsync/skin/provider16.png");                    
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
      let provider = tbSync.db.getAccountProperty(selectedAccount, "provider");            
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
    tbSync.providers.loadedProviders[provider].createAccountWindow = window.openDialog(tbSync.providers[provider].api.getCreateAccountWindowUrl(), "TbSyncNewAccountWindow", "centerscreen,resizable=no", providerData);
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
