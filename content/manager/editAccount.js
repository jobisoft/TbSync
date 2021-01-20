/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { OS }  =ChromeUtils.import("resource://gre/modules/osfile.jsm");
var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountSettings = {

  accountID: null,
  provider: null,
  settings: null,
  updateTimer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

  updateFolderListObserver: {
    observe: function (aSubject, aTopic, aData) {
      //only run if is request for this account and main frame is visible
      let accountID = aData;            
      if (accountID == tbSyncAccountSettings.accountID && !document.getElementById('tbsync.accountsettings.frame').hidden) {
        //make sure, folderlist is visible, otherwise our updates will be discarded (may cause errors)
        tbSyncAccountSettings.updateFolderList();
        tbSyncAccountSettings.updateGui();
      }
    }
  },

  reloadAccountSettingObserver: {
    observe: function (aSubject, aTopic, aData) {
      //only run if is request for this account and main frame is visible
      let data = JSON.parse(aData);
      if (data.accountID == tbSyncAccountSettings.accountID && !document.getElementById('tbsync.accountsettings.frame').hidden) {
        tbSyncAccountSettings.reloadSetting(data.setting);
      }
    }
  },

  updateGuiObserver: {
    observe: function (aSubject, aTopic, aData) {
      //only run if is request for this account and main frame is visible
      let accountID = aData;            
      if (accountID == tbSyncAccountSettings.accountID && !document.getElementById('tbsync.accountsettings.frame').hidden) {
        tbSyncAccountSettings.updateGui();
      }
    }
  },

  updateSyncstateObserver: {
    observe: function (aSubject, aTopic, aData) {
      //only run if is request for this account and main frame is visible
      let accountID = aData;            
      if (accountID == tbSyncAccountSettings.accountID && !document.getElementById('tbsync.accountsettings.frame').hidden) {
        let syncstate = TbSync.core.getSyncDataObject(accountID).getSyncState().state;
        if (syncstate == "accountdone") {
          tbSyncAccountSettings.updateGui();
        } else {
          tbSyncAccountSettings.updateSyncstate();
        }
      }
    }
  },

  onload: function () {
    //load observers
    Services.obs.addObserver(tbSyncAccountSettings.updateFolderListObserver, "tbsync.observer.manager.updateFolderList", false);
    Services.obs.addObserver(tbSyncAccountSettings.updateGuiObserver, "tbsync.observer.manager.updateAccountSettingsGui", false);
    Services.obs.addObserver(tbSyncAccountSettings.reloadAccountSettingObserver, "tbsync.observer.manager.reloadAccountSetting", false);
    Services.obs.addObserver(tbSyncAccountSettings.updateSyncstateObserver, "tbsync.observer.manager.updateSyncstate", false);
    //get the selected account from the loaded URI
    tbSyncAccountSettings.accountID = window.location.toString().split("id=")[1];
    tbSyncAccountSettings.accountData = new TbSync.AccountData(tbSyncAccountSettings.accountID);

    //get information for that acount
    tbSyncAccountSettings.provider = TbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, "provider");
    tbSyncAccountSettings.settings = Object.keys(TbSync.providers.getDefaultAccountEntries(tbSyncAccountSettings.provider)).sort();

    //add header to folderlist
    let header = TbSync.providers[tbSyncAccountSettings.provider].folderList.getHeader();
    let folderlistHeader = window.document.getElementById('tbsync.accountsettings.folderlist.header');
    for (let h=0; h < header.length; h++) {
      let listheader = window.document.createXULElement("treecol");
      for (let a in header[h]) {
        if (header[h].hasOwnProperty(a)) {
          listheader.setAttribute(a, header[h][a]);
        }
      }
      folderlistHeader.appendChild(listheader);
    }        
    
    //load overlays from the provider (if any)
    TbSync.messenger.overlayManager.injectAllOverlays(window, "chrome://tbsync/content/manager/editAccount.xhtml?provider=" + tbSyncAccountSettings.provider);
    if (window.tbSyncEditAccountOverlay && window.tbSyncEditAccountOverlay.hasOwnProperty("onload")) {
      tbSyncEditAccountOverlay.onload(window, new TbSync.AccountData(tbSyncAccountSettings.accountID));
    }
    tbSyncAccountSettings.loadSettings();
    
    //done, folderlist must be updated while visible
    document.getElementById('tbsync.accountsettings.frame').hidden = false;	    
    tbSyncAccountSettings.updateFolderList();      

    if (OS.Constants.Sys.Name == "Darwin") { //we might need to find a way to detect MacOS like styling, other themes move the header bar into the tabpanel as well
      document.getElementById('manager.tabpanels').style["padding-top"] = "3ex";
    }
  },


  onunload: function () {
    tbSyncAccountSettings.updateTimer.cancel();
    if (!document.getElementById('tbsync.accountsettings.frame').hidden) {
      Services.obs.removeObserver(tbSyncAccountSettings.updateFolderListObserver, "tbsync.observer.manager.updateFolderList");
      Services.obs.removeObserver(tbSyncAccountSettings.updateGuiObserver, "tbsync.observer.manager.updateAccountSettingsGui");
      Services.obs.removeObserver(tbSyncAccountSettings.reloadAccountSettingObserver, "tbsync.observer.manager.reloadAccountSetting");
      Services.obs.removeObserver(tbSyncAccountSettings.updateSyncstateObserver, "tbsync.observer.manager.updateSyncstate");
    }
  },
  

   folderListVisible: function () {
    let box = document.getElementById('tbsync.accountsettings.folderlist').getBoundingClientRect();
    let visible = box.width && box.height;
    return visible;
  },
  

  reloadSetting: function (setting) {
    let pref = document.getElementById("tbsync.accountsettings.pref." + setting);
    let label = document.getElementById("tbsync.accountsettings.label." + setting);

    if (pref) {
      //is this a checkbox?
      if (pref.tagName == "checkbox") {
        //BOOL
        if (TbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, setting)) pref.setAttribute("checked", true);
        else pref.setAttribute("checked", false);
      } else {
        //Not BOOL
        pref.value = TbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, setting);
      }
    }    
  },


  /**
   * Run through all defined TbSync settings and if there is a corresponding
   * field in the settings dialog, fill it with the stored value.
   */
  loadSettings: function () {
    for (let i=0; i < tbSyncAccountSettings.settings.length; i++) {
      let pref = document.getElementById("tbsync.accountsettings.pref." + tbSyncAccountSettings.settings[i]);
      let label = document.getElementById("tbsync.accountsettings.label." + tbSyncAccountSettings.settings[i]);

      if (pref) {
        //is this a checkbox?
        let event = "blur";
        if (pref.tagName == "checkbox") {
          //BOOL
          if (TbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, tbSyncAccountSettings.settings[i])) pref.setAttribute("checked", true);
          else pref.setAttribute("checked", false);
          event = "command";
        } else {
          //Not BOOL
          if (pref.tagName == "menulist") {
            pref.value = TbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, tbSyncAccountSettings.settings[i]);
            event = "command";
          } else {
            pref.setAttribute("value", TbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, tbSyncAccountSettings.settings[i]));
          }
        }
        
        pref.addEventListener(event, function() {tbSyncAccountSettings.instantSaveSetting(this)});
      }
    }
    
    tbSyncAccountSettings.updateGui();        
  },

  updateGui: function () {
    let status = TbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, "status");

    let isConnected = TbSync.core.isConnected(tbSyncAccountSettings.accountID);
    let isEnabled = TbSync.core.isEnabled(tbSyncAccountSettings.accountID);      
    let isSyncing = TbSync.core.isSyncing(tbSyncAccountSettings.accountID);
    
    { //disable settings if connected or syncing
      let items = document.getElementsByClassName("lockIfConnected");
      for (let i=0; i < items.length; i++) {
        if (isConnected || isSyncing || items[i].getAttribute("alwaysDisabled") == "true") {
          items[i].setAttribute("disabled", true);
          items[i].style["color"] =  "darkgrey";            
        } else {
          items[i].removeAttribute("disabled");
          items[i].style["color"] = "black";
        }                    
      }
    }

    document.getElementById('tbsync.accountsettings.connectbtn.container').hidden = !(isEnabled && !isConnected && !isSyncing); 
    //currently we use a fixed button which is hidden during sync
    //document.getElementById('tbsync.accountsettings.connectbtn').label = TbSync.getString("manager." + (isSyncing ? "connecting" : "tryagain"));
    
    { //show elements if connected (this also hides/unhides the folderlist)
      let items = document.getElementsByClassName("showIfConnected");
      for (let i=0; i < items.length; i++) {
        items[i].hidden = !isConnected;    
      }
    }

    { //show elements if enabled
      let items = document.getElementsByClassName("showIfEnabled");
      for (let i=0; i < items.length; i++) {
        items[i].hidden = !isEnabled;    
      }
    }
    
    document.getElementById('tbsync.accountsettings.enabled').checked = isEnabled;
    document.getElementById('tbsync.accountsettings.enabled').disabled = isSyncing;
    document.getElementById('tbsync.accountsettings.folderlist').disabled = isSyncing;
    document.getElementById('tbsync.accountsettings.syncbtn').disabled = isSyncing;
    document.getElementById('tbsync.accountsettings.connectbtn').disabled = isSyncing;
  
    tbSyncAccountSettings.updateSyncstate();
  
    //change color of syncstate according to status
    let showEventLogButton = false;
    switch (status) {
      case "success":
      case "disabled":
      case "syncing":
        document.getElementById("syncstate").removeAttribute("style");
        break;
      
      case "notsyncronized":
        document.getElementById("syncstate").setAttribute("style","color: red");
        break;
      
      default:
        document.getElementById("syncstate").setAttribute("style","color: red");
        showEventLogButton = TbSync.eventlog.get(tbSyncAccountSettings.accountID).length > 0;
    }
    document.getElementById('tbsync.accountsettings.eventlogbtn').hidden = !showEventLogButton;
  },

  updateSyncstate: function () {
    tbSyncAccountSettings.updateTimer.cancel();

    // if this account is beeing synced, display syncstate, otherwise print status
    let status = TbSync.db.getAccountProperty(tbSyncAccountSettings.accountID, "status");
    let isSyncing = TbSync.core.isSyncing(tbSyncAccountSettings.accountID);
    let isConnected = TbSync.core.isConnected(tbSyncAccountSettings.accountID);
    let isEnabled = TbSync.core.isEnabled(tbSyncAccountSettings.accountID);
    let syncdata = TbSync.core.getSyncDataObject(tbSyncAccountSettings.accountID);

    if (isSyncing) {
      let accounts = TbSync.db.getAccounts().data;
      
      let s = syncdata.getSyncState();
      let syncstate = s.state;
      let synctime = s.timestamp;

      let msg = TbSync.getString("syncstate." + syncstate, tbSyncAccountSettings.provider);
    
      if (syncstate.split(".")[0] == "send") {
        // append timeout countdown
        let diff = Date.now() - synctime;
        if (diff > 2000) msg = msg + " (" + Math.round((TbSync.providers[tbSyncAccountSettings.provider].Base.getConnectionTimeout(tbSyncAccountSettings.accountData) - diff)/1000) + "s)";
        // re-schedule update, if this is a waiting syncstate
        tbSyncAccountSettings.updateTimer.init(tbSyncAccountSettings.updateSyncstate, 1000, 0);
      }            
      document.getElementById("syncstate").textContent = msg;
    } else {
      let localized = TbSync.getString("status." + (isEnabled ? status : "disabled"), tbSyncAccountSettings.provider);
      document.getElementById("syncstate").textContent = localized;
    }
        
    
    if (tbSyncAccountSettings.folderListVisible()) {
      //update syncstates of folders in folderlist, if visible - remove obsolete entries while we are here
      let folderData = TbSync.providers[tbSyncAccountSettings.provider].Base.getSortedFolders(tbSyncAccountSettings.accountData);
      let folderList = document.getElementById("tbsync.accountsettings.folderlist");

      for (let i=folderList.getRowCount()-1; i>=0; i--) {
        let item = folderList.getItemAtIndex(i);
        if (folderData.filter(f => f.folderID == item.folderData.folderID).length == 0) {
          item.remove();
        } else {
          TbSync.providers[tbSyncAccountSettings.provider].folderList.updateRow(document, item, item.folderData);
        }
      }
    }
  },

  updateFolderList: function () {
    //get updated list of folderIDs
    let folderData = TbSync.providers[tbSyncAccountSettings.provider].Base.getSortedFolders(tbSyncAccountSettings.accountData);
    
    //remove entries from folderlist, which no longer exists and build reference array with  current elements
    let folderList = document.getElementById("tbsync.accountsettings.folderlist");
    folderList.hidden=true;

    let foldersElements = {};
    for (let i=folderList.getRowCount()-1; i>=0; i--) {
      if (folderData.filter(f => f.folderID == folderList.getItemAtIndex(i).folderData.folderID).length == 0) {
        folderList.getItemAtIndex(i).remove();
      } else {
        foldersElements[folderList.getItemAtIndex(i).folderData.folderID] = folderList.getItemAtIndex(i);
      }
    }

    //update folderlist
    for (let i=0; i < folderData.length; i++) {
      let nextItem = null;
      
      //if this entry does not exist, create it
      if (foldersElements.hasOwnProperty(folderData[i].folderID)) {
        //get reference to current element
        nextItem = foldersElements[folderData[i].folderID];
      } else {
        //add new entry, attach FolderData of this folder as folderData
        nextItem = document.createXULElement("richlistitem");
        nextItem.folderData = folderData[i];
        
        //add row
        nextItem.appendChild(TbSync.providers[tbSyncAccountSettings.provider].folderList.getRow(document, folderData[i]));
      }

      //add/move row and update its content
      let addedItem = folderList.appendChild(nextItem);
      TbSync.providers[tbSyncAccountSettings.provider].folderList.updateRow(document, addedItem, folderData[i]);

      //ensureElementIsVisible also forces internal update of rowCount, which sometimes is not updated automatically upon appendChild
      folderList.ensureElementIsVisible(addedItem);
    }
    folderList.hidden = false;
  },





  instantSaveSetting: function (field) {
    let setting = field.id.replace("tbsync.accountsettings.pref.","");
    let value = "";
    
    if (field.tagName == "checkbox") {
      if (field.checked) value = true;
      else value = false;
    } else {
      value = field.value;
    }
    TbSync.db.setAccountProperty(tbSyncAccountSettings.accountID, setting, value);
    
    if (setting == "accountname") {
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateAccountName", tbSyncAccountSettings.accountID + ":" + field.value);
    }
    TbSync.db.saveAccounts(); //write modified accounts to disk
  },

  toggleEnableState: function (element) {
    if (!TbSync.core.isConnected(tbSyncAccountSettings.accountID)) {
      //if not connected, we can toggle without prompt
      Services.obs.notifyObservers(null, "tbsync.observer.manager.toggleEnableState", tbSyncAccountSettings.accountID);
      return;
    }      

    if (window.confirm(TbSync.getString("prompt.Disable"))) {
      Services.obs.notifyObservers(null, "tbsync.observer.manager.toggleEnableState", tbSyncAccountSettings.accountID);
    } else {
      //invalid, toggle checkbox back
      element.setAttribute("checked", true);
    }
  },

  
  onFolderListContextMenuShowing: function () {
    let folderList = document.getElementById("tbsync.accountsettings.folderlist");
    let aFolderIsSelected = (!folderList.disabled && folderList.selectedItem !== null && folderList.selectedItem.value !== undefined);
    let menupopup = document.getElementById("tbsync.accountsettings.FolderListContextMenu");
    
    if (aFolderIsSelected) {
      TbSync.providers[tbSyncAccountSettings.provider].folderList.onContextMenuShowing(window, folderList.selectedItem.folderData);
    } else {
      TbSync.providers[tbSyncAccountSettings.provider].folderList.onContextMenuShowing(window, null);
    }
  },

};
