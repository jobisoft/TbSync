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
    authWindowObjs: {}, //hold references to authWindows for every account
    
    load: async function () {
    },

    unload: async function () {
        //close window (if open)
        if (this.prefWindowObj !== null) this.prefWindowObj.close();

        //close all open password prompts
        for (var w in this.authWindowObjs) {
            if (this.authWindowObjs.hasOwnProperty(w) && this.authWindowObjs[w] !== null) {
                this.authWindowObjs[w].close();
            }
        }
    },





    openManagerWindow: function(event) {
        if (!event.button) { //catches zero or undefined
            if (tbSync.enabled) {
                // check, if a window is already open and just put it in focus
                if (this.prefWindowObj === null) {
                    this.prefWindowObj = tbSync.window.open("chrome://tbsync/content/manager/accountManager.xul", "TbSyncAccountManagerWindow", "chrome,centerscreen");
                }
                this.prefWindowObj.focus();
            } else {
                //this.popupNotEnabled();
            }
        }
    },

    popupNotEnabled: function () {
        tbSync.dump("Oops", "Trying to open account manager, but init sequence not yet finished");
        let msg = tbSync.getString("OopsMessage") + "\n\n";
        let v = Services.appinfo.platformVersion; 
        if (Services.vc.compare(v, "60.*") <= 0 && Services.vc.compare(v, "52.0") >= 0) {
            if (!tbSync.prefs.getBoolPref("log.tofile")) {
                if (tbSync.window.confirm(msg + tbSync.getString("UnableToTraceError"))) {
                    tbSync.prefs.setBoolPref("log.tofile", true);
                    tbSync.window.alert(tbSync.getString("RestartThunderbirdAndTryAgain"));
                }
            } else {
                if (tbSync.window.confirm(msg + tbSync.getString("HelpFixStartupError"))) {
                    this.createBugReport("john.bieling@gmx.de", msg, "");
                }
            }
        } else {
            tbSync.window.alert(msg + tbSync.getString("VersionOfThunderbirdNotSupported"));
        }
    },
    
    openTBtab: function (url) {
        let tabmail = null;
        if (tbSync.window) {
            tabmail = tbSync.window.document.getElementById("tabmail");
            tbSync.window.focus();
            tabmail.openTab("contentTab", {
                contentPage: url
            });
        }
        return (tabmail !== null);
    },

    openTranslatedLink: function (url) {
        let googleCode = tbSync.getString("google.translate.code");
        if (googleCode != "en" && googleCode != "google.translate.code") {
            this.openLink("https://translate.google.com/translate?hl=en&sl=en&tl="+tbSync.getString("google.translate.code")+"&u="+url);
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
        if (Services.vc.compare(Services.appinfo.platformVersion, "60.*") <= 0 && Services.vc.compare(Services.appinfo.platformVersion, "52.0") >= 0) {
            if (!tbSync.debugMode) {
                this.prefWindowObj.alert(tbSync.getString("NoDebugLog"));
            } else {
                this.prefWindowObj.openDialog("chrome://tbsync/content/manager/support-wizard/support-wizard.xul", "support-wizard", "dialog,centerscreen,chrome,resizable=no");
            }
        } else {
            this.prefWindowObj.alert(tbSync.getString("VersionOfThunderbirdNotSupported"));
        }
    },
    
    createBugReport: function (email, subject, description) {
        let fields = Components.classes["@mozilla.org/messengercompose/composefields;1"].createInstance(Components.interfaces.nsIMsgCompFields); 
        let params = Components.classes["@mozilla.org/messengercompose/composeparams;1"].createInstance(Components.interfaces.nsIMsgComposeParams); 

        fields.to = email; 
        fields.subject = "TbSync " + tbSync.addon.version.toString() + " bug report: " + subject; 
        fields.body = "Hi,\n\n" +
            "attached you find my debug.log for the following error:\n\n" + 
            description; 

        params.composeFields = fields; 
        params.format = Components.interfaces.nsIMsgCompFormat.PlainText; 

        let attachment = Components.classes["@mozilla.org/messengercompose/attachment;1"].createInstance(Components.interfaces.nsIMsgAttachment);
        attachment.contentType = "text/plain";
        attachment.url =  'file://' + tbSync.io.getAbsolutePath("debug.log");
        attachment.name = "debug.log";
        attachment.temporary = false;

        params.composeFields.addAttachment(attachment);        
        MailServices.compose.OpenComposeWindowWithParams (null, params);    
    },
    
    /**
     * Functions used by the folderlist in the main account settings tab
     */
    DefaultFolderList : class {
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
        onContextMenuShowing(document, folderData) {
            return tbSync.providers[this.provider].standardFolderList.onContextMenuShowing(document, folderData);
        }


        /**
         * Returns an array of attribute objects, which define the number of columns 
         * and the look of the header
         */
        getHeader() {
            return [
                {style: "font-weight:bold;", label: "", width: "93"},
                {style: "font-weight:bold;", label: tbSync.getString("manager.resource"), width:"150"},
                {style: "font-weight:bold;", label: tbSync.getString("manager.status"), flex :"1"},
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
            let itemSelCheckbox = document.createElement("checkbox");
            itemSelCheckbox.setAttribute("updatefield", "selectbox");
            itemSelCheckbox.setAttribute("style", "margin: 0px 0px 0px 3px;");
            itemSelCheckbox.addEventListener("command", this.toggleFolder);

            //icon
            let itemType = document.createElement("image");
            itemType.setAttribute("src", tbSync.providers[this.provider].standardFolderList.getTypeImage(folderData));
            itemType.setAttribute("style", "margin: 0px 9px 0px 3px;");

            //ACL
            let roAttributes = tbSync.providers[this.provider].standardFolderList.getAttributesRoAcl(folderData);
            let rwAttributes = tbSync.providers[this.provider].standardFolderList.getAttributesRwAcl(folderData);
            let itemACL = document.createElement("button");
            itemACL.setAttribute("image", "chrome://tbsync/skin/acl_" + (folderData.getFolderSetting("downloadonly") == "1" ? "ro" : "rw") + ".png");
            itemACL.setAttribute("class", "plain");
            itemACL.setAttribute("style", "width: 35px; min-width: 35px; margin: 0; height:26px");
            itemACL.setAttribute("updatefield", "acl");
            if (roAttributes && rwAttributes) {
                itemACL.setAttribute("type", "menu");
                let menupopup = document.createElement("menupopup");
                {
                    let menuitem = document.createElement("menuitem");
                    menuitem.setAttribute("value", "0");
                    menuitem.setAttribute("class", "menuitem-iconic");
                    menuitem.setAttribute("image", "chrome://tbsync/skin/acl_rw2.png");
                    menuitem.addEventListener("command", this.updateReadOnly);
                    for (const [attr, value] of Object.entries(rwAttributes)) {
                        menuitem.setAttribute(attr, value);
                    }                    
                    menupopup.appendChild(menuitem);
                }
                
                {
                    let menuitem = document.createElement("menuitem");
                    menuitem.setAttribute("value", "1");
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
            let itemLabel = document.createElement("description");
            itemLabel.setAttribute("updatefield", "name");

            //status
            let itemStatus = document.createElement("description");
            itemStatus.setAttribute("updatefield", "status");
            
            //group1
            let itemHGroup1 = document.createElement("hbox");
            itemHGroup1.setAttribute("align", "center");
            itemHGroup1.appendChild(itemSelCheckbox);
            itemHGroup1.appendChild(itemType);
            if (itemACL) itemHGroup1.appendChild(itemACL);

            let itemVGroup1 = document.createElement("vbox");
            itemVGroup1.setAttribute("width", "93");
            itemVGroup1.appendChild(itemHGroup1);

            //group2
            let itemHGroup2 = document.createElement("hbox");
            itemHGroup2.setAttribute("align", "center");
            itemHGroup2.setAttribute("width", "146");
            itemHGroup2.appendChild(itemLabel);

            let itemVGroup2 = document.createElement("vbox");
            itemVGroup2.setAttribute("style", "padding: 3px");
            itemVGroup2.appendChild(itemHGroup2);

            //group3
            let itemHGroup3 = document.createElement("hbox");
            itemHGroup3.setAttribute("align", "center");
            itemHGroup3.setAttribute("width", "200");
            itemHGroup3.appendChild(itemStatus);

            let itemVGroup3 = document.createElement("vbox");
            itemVGroup3.setAttribute("style", "padding: 3px");
            itemVGroup3.appendChild(itemHGroup3);

            //final row
            let row = document.createElement("hbox");
            row.setAttribute("style", "min-height: 24px;");
            row.appendChild(itemVGroup1);
            row.appendChild(itemVGroup2);            
            row.appendChild(itemVGroup3);            
            return row;               
        }


        toggleFolder(event) {
            let element = event.target;
            let folderList = element.ownerDocument.getElementById("tbsync.accountsettings.folderlist");
            if (folderList.selectedItem !== null && !folderList.disabled) {
                // the folderData obj of the selected folder is attached to its row entry
                let folder = folderList.selectedItem.folderData;

                if (!folder.accountData.isEnabled())
                    return;
            
                if (folder.getFolderSetting("selected") == "1") {
                    if (folder.getFolderSetting("target") == "" || element.ownerDocument.defaultView.confirm(tbSync.getString("prompt.Unsubscribe"))) {
                        //deselect folder
                        folder.setFolderSetting("selected", "0");
                        //remove folder, which will trigger the listener in tbsync which will clean up everything
                        folder.targetData.removeTarget(); 
                    } else {
                        if (element) {
                            //undo users action
                            element.setAttribute("checked", true);
                        }
                    }
                } else {
                    //select and update status
                    folder.setFolderSetting("selected", "1");
                    folder.setFolderSetting("status", "aborted");
                    folder.accountData.setAccountSetting("status", "notsyncronized");
                }
                Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folder.accountID);
            }
        }
        
        updateReadOnly(event) {
            let element = event.target;
            let folderList = element.ownerDocument.getElementById("tbsync.accountsettings.folderlist");
            if (folderList.selectedItem !== null && !folderList.disabled) {
                //the folderData obj of the selected folder is attached to its row entry
                let  folder = folderList.selectedItem.folderData;

                //update value
                let value = element.value;
                folder.setFolderSetting("downloadonly", value);

                //update icon
                let button = element.parentNode.parentNode;
                if (value == "0") {
                    button.setAttribute('image','chrome://tbsync/skin/acl_rw.png');
                } else {
                    button.setAttribute('image','chrome://tbsync/skin/acl_ro.png');
                }
                    
                //update ro flag if calendar (the default folderlist only support addressbook and calendar target)
                let type = folder.getFolderSetting("targetType");
                switch (type) {
                    case "addressbook":
                        break;
                    case "calendar":
                        {
                            // get it, if it exists, does not create it
                            let target = folder.targetData.checkTarget();
                            if (target) {
                                target.setProperty("readOnly", value == '1');
                            }
                        }
                        break;
                }
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
            let name = folderData.getFolderSetting("name");
            let status = folderData.getFolderStatus();
            let selected = folderData.getFolderSetting("selected");
            
            // get updatefields
            let fields = {}
            for (let f of listItem.querySelectorAll("[updatefield]")) {
                fields[f.getAttribute("updatefield")] = f;
            }
            
            // update fields
            fields.name.setAttribute("disabled", !selected);
            fields.name.setAttribute("style", selected ? "" : "font-style:italic");
            if (fields.name.textContent != name) fields.name.textContent = name;
            
            fields.status.setAttribute("style", selected ? "" : "font-style:italic");
            if (fields.status.textContent != status) fields.status.textContent = status;
            
            if (fields.hasOwnProperty("acl")) {
                fields.acl.setAttribute("image", "chrome://tbsync/skin/acl_" + (folderData.getFolderSetting("downloadonly") == "1" ? "ro" : "rw") + ".png");
                fields.acl.setAttribute("disabled", folderData.accountData.isSyncing());
            }
            
            // update selectbox
            let selbox = fields.selectbox;
            if (selbox) {
                if (folderData.getFolderSetting("selected") == "1") {
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
}
