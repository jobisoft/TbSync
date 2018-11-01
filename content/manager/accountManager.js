/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountManager = {
    
    refreshUpdateButtonObserver: {
        observe: function(aSubject, aTopic, aData) {        
            document.getElementById("tbSyncAccountManager.t4").hidden = !tbSync.updatesAvailable();
        }
    },

    onloadoptions: function () {
        window.close();
    },    
    
    onunloadoptions: function () {
        tbSync.openManagerWindow(0);
    },
    
    onload: function () {
        tbSyncAccountManager.selectTab(0);
        Services.obs.addObserver(tbSyncAccountManager.refreshUpdateButtonObserver, "tbsync.refreshUpdateButton", false);

        // do we need to show the update button?        
        Services.obs.notifyObservers(null, "tbsync.refreshUpdateButton", null);
    },
    
    onunload: function () {
        Services.obs.removeObserver(tbSyncAccountManager.refreshUpdateButtonObserver, "tbsync.refreshUpdateButton");
        tbSync.prefWindowObj = null;
        if (tbSync.passWindowObj) {
            tbSync.passWindowObj.close();
        }
    },

    selectTab: function (t) {
        const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;
        let sources = ["accounts.xul", "catman.xul", "supporter.xul", "help.xul", "update.xul"];

        //set active tab (css selector for background color)
        for (let i=0; i<sources.length; i++) {            
            if (i==t) document.getElementById("tbSyncAccountManager.t" + i).setAttribute("active","true");
            else document.getElementById("tbSyncAccountManager.t" + i).setAttribute("active","false");
        }
        
        //load XUL
        document.getElementById("tbSyncAccountManager.contentWindow").setAttribute("src", "chrome://tbsync/content/manager/"+sources[t]);
    },
    
    getLogPref: function() {
        let log = document.getElementById("tbSyncAccountManager.logPrefCheckbox");
        log.checked =  tbSync.prefSettings.getBoolPref("log.tofile");
    },
    
    toggleLogPref: function() {
        let log = document.getElementById("tbSyncAccountManager.logPrefCheckbox");
        tbSync.prefSettings.setBoolPref("log.tofile", log.checked);
    },
    
    initHelpData: function() {
        let avail = tbSync.updatesAvailable(true); //true = check beta versions even though notify4beta is not enabled
        document.getElementById("bugs.latestVersion").hidden = avail;
        document.getElementById("bugs.olderVersion").hidden = !avail;
        let src = (tbSync.cmpVersions(tbSync.versionInfo.beta.number, tbSync.versionInfo.stable.number) > 0) ? "beta" : "stable";

        document.getElementById("latest.version").setAttribute("value", tbSync.versionInfo[src].number);
        document.getElementById("latest.version").setAttribute("href", tbSync.versionInfo[src].url);
        document.getElementById("latest.version").setAttribute("tooltiptext", tbSync.versionInfo[src].url);
        document.getElementById("installed.version").setAttribute("value", tbSync.providerList.eas.version);        
        this.getLogPref();
    },
    
    initUpdateData: function() {
        document.getElementById("installed.version").setAttribute("value", tbSync.providerList.eas.version + (tbSync.isBeta() ? " ("+tbSync.getLocalizedMessage("old_beta_version")+")" : ""));

        document.getElementById("mozilla.version").setAttribute("value", tbSync.versionInfo.mozilla.number + " @ " + tbSync.getLocalizedMessage("amo_repository"));
        if (tbSync.cmpVersions(tbSync.versionInfo.mozilla.number, tbSync.providerList.eas.version) > 0) {
            document.getElementById("mozilla.version").className = "text-link";
            document.getElementById("mozilla.version").setAttribute("style", "color: blue;");
            document.getElementById("mozilla.version").setAttribute("href", tbSync.versionInfo.mozilla.url);
            document.getElementById("mozilla.version").setAttribute("tooltiptext", tbSync.versionInfo.mozilla.url);
        }
        
        document.getElementById("stable.version").setAttribute("value", tbSync.versionInfo.stable.number + " @ " + tbSync.getLocalizedMessage("github_repository"));
        if (tbSync.cmpVersions(tbSync.versionInfo.stable.number, tbSync.providerList.eas.version) > 0) {
            document.getElementById("stable.version").className = "text-link";
            document.getElementById("stable.version").setAttribute("style", "color: blue;");
            document.getElementById("stable.version").setAttribute("href", tbSync.versionInfo.stable.url);
            document.getElementById("stable.version").setAttribute("tooltiptext", tbSync.versionInfo.stable.url);
        }
        
        if (tbSync.cmpVersions(tbSync.versionInfo.beta.number, tbSync.versionInfo.stable.number) > 0) {
            document.getElementById("beta.version").className = "text-link";
            document.getElementById("beta.version").setAttribute("style", "color: blue;");
            document.getElementById("beta.version").setAttribute("value", tbSync.versionInfo.beta.number);
            document.getElementById("beta.version").setAttribute("href", tbSync.versionInfo.beta.url);
            document.getElementById("beta.version").setAttribute("tooltiptext", tbSync.versionInfo.beta.url);
        }
    
        if (tbSync.cmpVersions(tbSync.versionInfo.stable.number, tbSync.providerList.eas.version) > 0) document.getElementById("tbsync.recommendation").value = tbSync.getLocalizedMessage("update_to_stable");
        else if (tbSync.cmpVersions(tbSync.versionInfo.beta.number, tbSync.providerList.eas.version) > 0) document.getElementById("tbsync.recommendation").value =tbSync.getLocalizedMessage("update_to_beta");
    }
};
