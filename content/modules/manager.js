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
          this.prefWindowObj = TbSync.window.open("chrome://tbsync/content/manager/accountManager.xhtml", "TbSyncAccountManagerWindow", "chrome,centerscreen");
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
    let tabmail = TbSync.window.document.getElementById("tabmail");
    if (TbSync.window && tabmail) {
      TbSync.window.focus();
      return tabmail.openTab("contentTab", {
        contentPage: url
      });
    }
    return null;
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
      this.prefWindowObj.openDialog("chrome://tbsync/content/manager/support-wizard/support-wizard.xhtml", "support-wizard", "dialog,centerscreen,chrome,resizable=no");
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
  },

  viewDebugLog: function() {

    if (this.debugLogWindow) {
      let tabmail = TbSync.window.document.getElementById("tabmail");
      tabmail.closeTab(this.debugLogWindow.tabNode);
      this.debugLogWindow = null;
    } 
    this.debugLogWindow = this.openTBtab('file://' + TbSync.io.getAbsolutePath("debug.log"));
  },
}
