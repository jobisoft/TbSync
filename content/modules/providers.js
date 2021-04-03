/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
var { ExtensionParent } = ChromeUtils.import("resource://gre/modules/ExtensionParent.jsm");

/**
 * Wrapper for notifyTools to pipe the call thru the background page to the
 * remote add-on.
 */
var Base = class {
  constructor(providerID) {
    this.providerID = providerID
  }
  onConnect() { 
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      command: "Base.onConnect" 
    });
  }  
  getProviderName() {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      command: "Base.getProviderName" 
    });
  }  
  getApiVersion() {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      command: "Base.getApiVersion" 
    });
  }  
  getProviderIcon(size, accountID = null) {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      size,
      accountID,
      command: "Base.getProviderIcon" 
    });
  }  
  getSponsors() {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      command: "Base.getSponsors" 
    });
  }    
  getContributorsUrl() {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      command: "Base.getContributorsUrl" 
    });
  }
  getMaintainerEmail() {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      command: "Base.getMaintainerEmail" 
    });
  }    
  getCreateAccountWindowUrl() {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      command: "Base.getCreateAccountWindowUrl" 
    });
  }    
  getEditAccountOverlayUrl() {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      command: "Base.getEditAccountOverlayUrl" 
    });
  }    
  getDefaultAccountEntries() {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      command: "Base.getDefaultAccountEntries" 
    });
  }    
  getDefaultFolderEntries() {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      command: "Base.getDefaultFolderEntries" 
    });
  }    
  onEnableAccount(accountID) {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      accountID,
      command: "Base.onEnableAccount" 
    });
  }    
  onDisableAccount(accountID) {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      accountID,
      command: "Base.onDisableAccount" 
    });
  }    
  onDeleteAccount(accountID) {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      accountID,
      command: "Base.onDeleteAccount" 
    });
  }
  getSortedFolders(accountID) {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      accountID,
      command: "Base.getSortedFolders" 
    });
  }  
  getConnectionTimeout(accountID) {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      accountID,
      command: "Base.getConnectionTimeout" 
    });
  }  
  syncFolderList(syncData, syncJob, syncRunNr) {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      syncData, 
      syncJob,
      syncRunNr,
      command: "Base.syncFolderList" 
    });
  }  
  syncFolder(syncData, syncJob, syncRunNr) {
    return TbSync.notifyTools.notifyBackground({
      providerID: this.providerID,
      syncData, 
      syncJob,
      syncRunNr,
      command: "Base.syncFolder" 
    });
  }
}

/**
 * Functions used by the folderlist in the main account settings tab
 */
var FolderList = class {
  /**
   * @param {string}  provider  Identifier for the provider this FolderListView is created for.
   */
  constructor(provider) {
    this.provider = provider
  }
  
  /**
   * Is called before the context menu of the folderlist is shown, allows to
   * show/hide custom menu options based on selected folder
   *
   * @param document       [in] document object of the account settings window - element.ownerDocument - menuentry?
   * @param folderData         [in] FolderData of the selected folder
   */
  onContextMenuShowing(window, folderData) {
    return TbSync.providers[this.provider].StandardFolderList.onContextMenuShowing(window, folderData);
  }


  /**
   * Returns an array of attribute objects, which define the number of columns 
   * and the look of the header
   */
  getHeader() {
    return [
      {style: "font-weight:bold;", label: "", width: "93"},
      {style: "font-weight:bold;", label: TbSync.getString("manager.resource"), width:"150"},
      {style: "font-weight:bold;", label: TbSync.getString("manager.status"), flex :"1"},
    ]
  }


  /**
   * Is called to add a row to the folderlist. After this call, updateRow is called as well.
   *
   * @param document        [in] document object of the account settings window
   * @param folderData         [in] FolderData of the folder in the row
   */        
  getRow(document, folderData) {
    //create checkBox for select state
    let itemSelCheckbox = document.createXULElement("checkbox");
    itemSelCheckbox.setAttribute("updatefield", "selectbox");
    itemSelCheckbox.setAttribute("style", "margin: 0px 0px 0px 3px;");
    itemSelCheckbox.addEventListener("command", this.toggleFolder);

    //icon
    let itemType = document.createXULElement("image");
    itemType.setAttribute("src", TbSync.providers[this.provider].StandardFolderList.getTypeImage(folderData));
    itemType.setAttribute("style", "margin: 0px 9px 0px 3px;");

    //ACL
    let roAttributes = TbSync.providers[this.provider].StandardFolderList.getAttributesRoAcl(folderData);
    let rwAttributes = TbSync.providers[this.provider].StandardFolderList.getAttributesRwAcl(folderData);
    let itemACL = document.createXULElement("button");
    itemACL.setAttribute("image", "chrome://tbsync/content/skin/acl_" + (folderData.getFolderProperty("downloadonly") ? "ro" : "rw") + ".png");
    itemACL.setAttribute("class", "plain");
    itemACL.setAttribute("style", "width: 35px; min-width: 35px; margin: 0; height:26px");
    itemACL.setAttribute("updatefield", "acl");
    if (roAttributes && rwAttributes) {
      itemACL.setAttribute("type", "menu");
      let menupopup = document.createXULElement("menupopup");
      {
        let menuitem = document.createXULElement("menuitem");
        menuitem.downloadonly = false;
        menuitem.setAttribute("class", "menuitem-iconic");
        menuitem.setAttribute("image", "chrome://tbsync/content/skin/acl_rw2.png");
        menuitem.addEventListener("command", this.updateReadOnly);
        for (const [attr, value] of Object.entries(rwAttributes)) {
          menuitem.setAttribute(attr, value);
        }                    
        menupopup.appendChild(menuitem);
      }
      
      {
        let menuitem = document.createXULElement("menuitem");
        menuitem.downloadonly = true;
        menuitem.setAttribute("class", "menuitem-iconic");
        menuitem.setAttribute("image", "chrome://tbsync/content/skin/acl_ro2.png");
        menuitem.addEventListener("command", this.updateReadOnly);
        for (const [attr, value] of Object.entries(roAttributes)) {
          menuitem.setAttribute(attr, value);
        }                    
        menupopup.appendChild(menuitem);
      }
      itemACL.appendChild(menupopup);
    }
    
    //folder name
    let itemLabel = document.createXULElement("description");
    itemLabel.setAttribute("updatefield", "foldername");

    //status
    let itemStatus = document.createXULElement("description");
    itemStatus.setAttribute("updatefield", "status");
    
    //group1
    let itemHGroup1 = document.createXULElement("hbox");
    itemHGroup1.setAttribute("align", "center");
    itemHGroup1.appendChild(itemSelCheckbox);
    itemHGroup1.appendChild(itemType);
    if (itemACL) itemHGroup1.appendChild(itemACL);

    let itemVGroup1 = document.createXULElement("vbox");
    itemVGroup1.setAttribute("width", "93");
    itemVGroup1.appendChild(itemHGroup1);

    //group2
    let itemHGroup2 = document.createXULElement("hbox");
    itemHGroup2.setAttribute("align", "center");
    itemHGroup2.setAttribute("style", "border: 1px center");
    itemHGroup2.appendChild(itemLabel);

    let itemVGroup2 = document.createXULElement("vbox");
    itemVGroup2.setAttribute("width", "150");
    itemVGroup2.setAttribute("style", "padding: 3px");
    itemVGroup2.appendChild(itemHGroup2);

    //group3
    let itemHGroup3 = document.createXULElement("hbox");
    itemHGroup3.setAttribute("align", "center");
    itemHGroup3.appendChild(itemStatus);

    let itemVGroup3 = document.createXULElement("vbox");
    itemVGroup3.setAttribute("width", "250");
    itemVGroup3.setAttribute("style", "padding: 3px");
    itemVGroup3.appendChild(itemHGroup3);

    //final row
    let row = document.createXULElement("hbox");
    row.setAttribute("style", "min-height: 24px;");
    row.appendChild(itemVGroup1);
    row.appendChild(itemVGroup2);            
    row.appendChild(itemVGroup3);            
    return row;               
  }


  /**
   * ToggleFolder event
   */
  toggleFolder(event) {
    let element = event.target;
    let folderList = element.ownerDocument.getElementById("tbsync.accountsettings.folderlist");
    if (folderList.selectedItem !== null && !folderList.disabled) {
      // the folderData obj of the selected folder is attached to its row entry
      let folder = folderList.selectedItem.folderData;

      if (!folder.accountData.isEnabled())
        return;
    
      if (folder.getFolderProperty("selected")) {
        // hasTarget() can throw an error, ignore that here
        try {
          if (!folder.targetData.hasTarget() || element.ownerDocument.defaultView.confirm(TbSync.getString("prompt.Unsubscribe"))) {
            folder.targetData.removeTarget();           
            folder.setFolderProperty("selected", false);          
          } else {
            if (element) {
              //undo users action
              element.setAttribute("checked", true);
            }
          }
        } catch (e) {
          folder.setFolderProperty("selected", false);
          Components.utils.reportError(e);
        }
      } else {
        //select and update status
        folder.setFolderProperty("selected", true);
        folder.setFolderProperty("status", "aborted");
        folder.accountData.setAccountProperty("status", "notsyncronized");
      }
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folder.accountID);
    }
  }
  
  /**
   * updateReadOnly event
   */
  updateReadOnly(event) {
    let element = event.target;
    let folderList = element.ownerDocument.getElementById("tbsync.accountsettings.folderlist");
    if (folderList.selectedItem !== null && !folderList.disabled) {
      //the folderData obj of the selected folder is attached to its row entry
      let  folder = folderList.selectedItem.folderData;

      //update value
      let value = element.downloadonly;
      folder.setFolderProperty("downloadonly", value);

      //update icon
      let button = element.parentNode.parentNode;
      if (value) {
        button.setAttribute('image','chrome://tbsync/content/skin/acl_ro.png');
      } else {
        button.setAttribute('image','chrome://tbsync/content/skin/acl_rw.png');
      }
        
      folder.targetData.setReadOnly(value);
    }
  }

  /**
   * Is called to update a row of the folderlist (the first cell is a select checkbox inserted by TbSync)
   *
   * @param document       [in] document object of the account settings window
   * @param listItem       [in] the listitem of the row, which needs to be updated
   * @param folderData        [in] FolderData for that row
   */        
  updateRow(document, listItem, folderData) {
    let foldername = TbSync.providers[this.provider].StandardFolderList.getFolderDisplayName(folderData);
    let status = folderData.getFolderStatus();
    let selected = folderData.getFolderProperty("selected");
    
    // get updatefields
    let fields = {}
    for (let f of listItem.querySelectorAll("[updatefield]")) {
      fields[f.getAttribute("updatefield")] = f;
    }
    
    // update fields
    fields.foldername.setAttribute("disabled", !selected);
    fields.foldername.setAttribute("style", selected ? "" : "font-style:italic");
    if (fields.foldername.textContent != foldername) {
      fields.foldername.textContent = foldername;
      fields.foldername.flex = "1";
    }
    
    fields.status.setAttribute("style", selected ? "" : "font-style:italic");
    if (fields.status.textContent != status) {
      fields.status.textContent = status;
      fields.status.flex = "1";
    }
    
    if (fields.hasOwnProperty("acl")) {
      fields.acl.setAttribute("image", "chrome://tbsync/content/skin/acl_" + (folderData.getFolderProperty("downloadonly") ? "ro" : "rw") + ".png");
      fields.acl.setAttribute("disabled", folderData.accountData.isSyncing());
    }
    
    // update selectbox
    let selbox = fields.selectbox;
    if (selbox) {
      if (folderData.getFolderProperty("selected")) {
        selbox.setAttribute("checked", true);
      } else {
        selbox.removeAttribute("checked");
      }
      
      if (folderData.accountData.isSyncing()) {
        selbox.setAttribute("disabled", true);
      } else {
        selbox.removeAttribute("disabled");
      }
    }
  }
}    


var providers = {

  //list of default providers (available in add menu, even if not installed)
  defaultProviders: {
    "dav" : {
      name: "CalDAV & CardDAV", 
      homepageUrl: "https://addons.thunderbird.net/addon/dav-4-tbsync/"},
    "eas" : {
      name: "Exchange ActiveSync", 
      homepageUrl: "https://addons.thunderbird.net/addon/eas-4-tbsync/"},
  },
  
  loadedProviders: null,    
  
  load: async function () {
    this.loadedProviders = {};
  },

  unload: async function () {
    for (let provider in this.loadedProviders) {
      await this.unloadProvider(provider);
    }
  },



  
  
  loadProvider:  async function (providerID, provider) {
    //only load, if not yet loaded and if the provider name does not shadow a fuction inside provider.js
    if (!this.loadedProviders.hasOwnProperty(provider) && !this.hasOwnProperty(provider)) {
      try {        
        let extension = ExtensionParent.GlobalManager.getExtension(providerID);
        let addon = await AddonManager.getAddonByID(providerID);
        this.loadedProviders[provider] = {};
        this.loadedProviders[provider].addon = addon;
        this.loadedProviders[provider].extension = extension;
        this.loadedProviders[provider].addonId = providerID;
        this.loadedProviders[provider].version = addon.version.toString();
        this.loadedProviders[provider].createAccountWindow = null;

        this[provider] = {};
        // Legacy TbSync expects to have "loaded" a provider JS file, but we now
        // load a fake class which redirects all requests to the actuall add-on.
        this[provider].Base = new Base(providerID);
        this[provider].folderList = new FolderList(provider);

        addon.contributorsURL = await this[provider].Base.getContributorsUrl();
        
        await TbSync.messenger.overlayManager.registerOverlay("chrome://tbsync/content/manager/editAccount.xhtml?provider=" + provider, await this[provider].Base.getEditAccountOverlayUrl());        
        TbSync.dump("Loaded provider", provider + "::" + await this[provider].Base.getProviderName() + " ("+this.loadedProviders[provider].version+")");
        
        // reset all accounts of this provider
        let providerData = new TbSync.ProviderData(provider);
        let accounts = providerData.getAllAccounts();
        for (let accountData of accounts) {
          // reset sync objects
          TbSync.core.resetSyncDataObj(accountData.accountID);
          
          // set all accounts which are syncing to notsyncronized 
          if (accountData.getAccountProperty("status") == "syncing") accountData.setAccountProperty("status", "notsyncronized");

          // set each folder with PENDING status to ABORTED
          let folders = TbSync.db.findFolders({"status": "pending"}, {"accountID": accountData.accountID});

          for (let f=0; f < folders.length; f++) {
            TbSync.db.setFolderProperty(folders[f].accountID, folders[f].folderID, "status", "aborted");
          }
        }
        
        await this[provider].Base.onConnect();

        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateProviderList", provider);
        Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);
        
        for (let calendar of TbSync.lightning.cal.getCalendarManager().getCalendars({})) {
          let storedProvider = calendar.getProperty("tbSyncProvider");
          if (provider == storedProvider && calendar.type == "storage" && providerData.getFolders({"target": calendar.id}).length == 0) {
            let name = calendar.name;
            calendar.name = TbSync.getString("target.orphaned") + ": " + name;
            calendar.setProperty("disabled", true);
            calendar.setProperty("tbSyncProvider", "orphaned");
            calendar.setProperty("tbSyncAccountID", "");        
          }
        }
        
      } catch (e) {
        delete this.loadedProviders[provider];
        delete this[provider];
        let info = new EventLogInfo(provider);
        TbSync.eventlog.add("error", info, "FAILED to load provider <"+provider+">", e.message);
        Components.utils.reportError(e);        
      }

    }
  },
  
  unloadProvider: async function (provider) {        
    if (this.loadedProviders.hasOwnProperty(provider)) {
      TbSync.dump("Unloading provider", provider);
      
       if (this.loadedProviders[provider].createAccountWindow) {
         this.loadedProviders[provider].createAccountWindow.close();
       }

      delete this.loadedProviders[provider];
      delete this[provider];            
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateProviderList", provider);
      Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", null);
    }
  },
  
  getDefaultAccountEntries: function (provider) {
    let defaults = TbSync.providers[provider].Base.getDefaultAccountEntries();
    
    // List of default system account properties. 
    // Do not remove search marker for doc. 
    // DefaultAccountPropsStart
    defaults.provider = provider;
    defaults.accountID = "";
    defaults.lastsynctime = 0;
    defaults.status = "disabled";
    defaults.autosync = 0;
    defaults.noAutosyncUntil = 0;
    defaults.accountname = "";
    // DefaultAccountPropsEnd

    return defaults;
  },
  
  getDefaultFolderEntries: function (accountID) {
    let provider = TbSync.db.getAccountProperty(accountID, "provider");
    let defaults = TbSync.providers[provider].Base.getDefaultFolderEntries();
    
    // List of default system folder properties.
    // Do not remove search marker for doc. 
    // DefaultFolderPropsStart
    defaults.accountID = accountID;
    defaults.targetType = "";
    defaults.cached = false;
    defaults.selected = false;
    defaults.lastsynctime = 0;
    defaults.status = "";
    defaults.foldername = "";
    defaults.downloadonly = false;
    // DefaultFolderPropsEnd
    
    return defaults;
  },
}
