/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
 
var manager = {

  prefWindowObj: null,
  
  load: async function () {
  },

  unload: async function () {
    //close window (if open)
    if (this.prefWindowObj !== null) this.prefWindowObj.close();
  },





  openManagerWindow: function(event) {
    if (!event.button) { //catches zero or undefined
      if (TbSync.enabled) {
        // check, if a window is already open and just put it in focus
        if (this.prefWindowObj === null) {
          this.prefWindowObj = TbSync.window.open("chrome://tbsync/content/manager/accountManager.xul", "TbSyncAccountManagerWindow", "chrome,centerscreen");
        }
        this.prefWindowObj.focus();
      } else {
        //this.popupNotEnabled();
      }
    }
  },

  popupNotEnabled: function () {
    TbSync.dump("Oops", "Trying to open account manager, but init sequence not yet finished");
    let msg = TbSync.getString("OopsMessage") + "\n\n";
    let v = Services.appinfo.platformVersion; 
    if (TbSync.prefs.getIntPref("log.userdatalevel") == 0) {
      if (TbSync.window.confirm(msg + TbSync.getString("UnableToTraceError"))) {
        TbSync.prefs.setIntPref("log.userdatalevel", 1);
        TbSync.window.alert(TbSync.getString("RestartThunderbirdAndTryAgain"));
      }
    } else {
      if (TbSync.window.confirm(msg + TbSync.getString("HelpFixStartupError"))) {
        this.createBugReport("john.bieling@gmx.de", msg, "");
      }
    }
  },
  
  openTBtab: function (url) {
    let tabmail = null;
    if (TbSync.window) {
      tabmail = TbSync.window.document.getElementById("tabmail");
      TbSync.window.focus();
      tabmail.openTab("contentTab", {
        contentPage: url
      });
    }
    return (tabmail !== null);
  },

  openTranslatedLink: function (url) {
    let googleCode = TbSync.getString("google.translate.code");
    if (googleCode != "en" && googleCode != "google.translate.code") {
      this.openLink("https://translate.google.com/translate?hl=en&sl=en&tl="+TbSync.getString("google.translate.code")+"&u="+url);
    } else {
      this.openLink(url);
    }
  },

  openLink: function (url) {
    let ioservice = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);
    let uriToOpen = ioservice.newURI(url, null, null);
    let extps = Components.classes["@mozilla.org/uriloader/external-protocol-service;1"].getService(Components.interfaces.nsIExternalProtocolService);
    extps.loadURI(uriToOpen, null);    
  },
  
  openBugReportWizard: function () {
    if (!TbSync.debugMode) {
      this.prefWindowObj.alert(TbSync.getString("NoDebugLog"));
    } else {
      this.prefWindowObj.openDialog("chrome://tbsync/content/manager/support-wizard/support-wizard.xul", "support-wizard", "dialog,centerscreen,chrome,resizable=no");
    }
  },
  
  createBugReport: function (email, subject, description) {
    let fields = Components.classes["@mozilla.org/messengercompose/composefields;1"].createInstance(Components.interfaces.nsIMsgCompFields); 
    let params = Components.classes["@mozilla.org/messengercompose/composeparams;1"].createInstance(Components.interfaces.nsIMsgComposeParams); 

    fields.to = email; 
    fields.subject = "TbSync " + TbSync.addon.version.toString() + " bug report: " + subject; 
    fields.body = "Hi,\n\n" +
      "attached you find my debug.log for the following error:\n\n" + 
      description; 

    params.composeFields = fields; 
    params.format = Components.interfaces.nsIMsgCompFormat.PlainText; 

    let attachment = Components.classes["@mozilla.org/messengercompose/attachment;1"].createInstance(Components.interfaces.nsIMsgAttachment);
    attachment.contentType = "text/plain";
    attachment.url =  'file://' + TbSync.io.getAbsolutePath("debug.log");
    attachment.name = "debug.log";
    attachment.temporary = false;

    params.composeFields.addAttachment(attachment);        
    MailServices.compose.OpenComposeWindowWithParams (null, params);    
  }
}




/**
 * Functions used by the folderlist in the main account settings tab
 */
manager.FolderList = class {
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
    itemACL.setAttribute("image", "chrome://tbsync/skin/acl_" + (folderData.getFolderProperty("downloadonly") ? "ro" : "rw") + ".png");
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
        menuitem.setAttribute("image", "chrome://tbsync/skin/acl_rw2.png");
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
        menuitem.setAttribute("image", "chrome://tbsync/skin/acl_ro2.png");
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
        if (!folder.targetData.hasTarget() || element.ownerDocument.defaultView.confirm(TbSync.getString("prompt.Unsubscribe"))) {
          folder.targetData.removeTarget();           
          folder.setFolderProperty("selected", false);          
        } else {
          if (element) {
            //undo users action
            element.setAttribute("checked", true);
          }
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
        button.setAttribute('image','chrome://tbsync/skin/acl_ro.png');
      } else {
        button.setAttribute('image','chrome://tbsync/skin/acl_rw.png');
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
      fields.acl.setAttribute("image", "chrome://tbsync/skin/acl_" + (folderData.getFolderProperty("downloadonly") ? "ro" : "rw") + ".png");
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
