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
    passWindowObjs: {}, //hold references to passWindows for every account
    
    load: async function () {
    },

    unload: async function () {
        //close window (if open)
        if (this.prefWindowObj !== null) this.prefWindowObj.close();

        //close all open password prompts
        for (var w in this.passWindowObjs) {
            if (this.passWindowObjs.hasOwnProperty(w) && this.passWindowObjs[w] !== null) {
                this.passWindowObjs[w].close();
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
}
