"use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountManager = {
    
    onload: function () {
        tbSyncAccountManager.selectTab(0);

        // do we need to show the update button?        
        document.getElementById("tbSyncAccountManager.t5").hidden = !tbSync.updatesAvailable();
    },
    
    onunload: function () {
        tbSync.prefWindowObj = null;
    },

    selectTab: function (t) {
        const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;
        let sources = ["accounts.xul", "cape.xul", "catman.xul", "supporter.xul", "help.xul", "update.xul"];

        //set active tab (css selector for background color)
        for (let i=0; i<sources.length; i++) {            
            if (i==t) document.getElementById("tbSyncAccountManager.t" + i).setAttribute("active","true");
            else document.getElementById("tbSyncAccountManager.t" + i).setAttribute("active","false");
        }
        
        //load XUL
        document.getElementById("tbSyncAccountManager.contentWindow").webNavigation.loadURI("chrome://tbsync/content/manager/"+sources[t], LOAD_FLAGS_NONE, null, null, null);
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
        document.getElementById("latest.version").setAttribute("value", tbSync.versionInfo.beta.number);
        document.getElementById("latest.version").setAttribute("href", tbSync.versionInfo.beta.url);
        document.getElementById("latest.version").setAttribute("tooltiptext", tbSync.versionInfo.beta.url);
        this.getLogPref();
    },
    
    initUpdateData: function() {
        document.getElementById("installed.version").setAttribute("value", tbSync.versionInfo.installed + (tbSync.isBeta() ? " (Beta version)" : ""));

        document.getElementById("mozilla.version").setAttribute("value", tbSync.versionInfo.mozilla.number + " @ Thunderbird AddOn repository");
        if (tbSync.cmpVersions(tbSync.versionInfo.mozilla.number, tbSync.versionInfo.installed) > 0) {
            document.getElementById("mozilla.version").className = "text-link";
            document.getElementById("mozilla.version").setAttribute("href", tbSync.versionInfo.mozilla.url);
            document.getElementById("mozilla.version").setAttribute("tooltiptext", tbSync.versionInfo.mozilla.url);
        }
        
        document.getElementById("stable.version").setAttribute("value", tbSync.versionInfo.stable.number + " @ TbSync github repository");
        if (tbSync.cmpVersions(tbSync.versionInfo.stable.number, tbSync.versionInfo.installed) > 0) {
            document.getElementById("stable.version").className = "text-link";
            document.getElementById("stable.version").setAttribute("href", tbSync.versionInfo.stable.url);
            document.getElementById("stable.version").setAttribute("tooltiptext", tbSync.versionInfo.stable.url);
        }
        
        if (tbSync.cmpVersions(tbSync.versionInfo.beta.number, tbSync.versionInfo.stable.number) > 0) {
            document.getElementById("beta.version").className = "text-link";
            document.getElementById("beta.version").setAttribute("value", tbSync.versionInfo.beta.number);
            document.getElementById("beta.version").setAttribute("href", tbSync.versionInfo.beta.url);
            document.getElementById("beta.version").setAttribute("tooltiptext", tbSync.versionInfo.beta.url);
        }
    
        if (tbSync.cmpVersions(tbSync.versionInfo.stable.number, tbSync.versionInfo.installed) > 0) document.getElementById("tbsync.recommendation").value = "Recommendation: Update to the latest stable version.";
        else if (tbSync.cmpVersions(tbSync.versionInfo.beta.number, tbSync.versionInfo.installed) > 0) document.getElementById("tbsync.recommendation").value = "Recommendation: Update to the latest beta version.";
        else document.getElementById("tbsync.recommendation").value = "You are running the latest version of the " +( tbSync.prefSettings.getBoolPref("notify4beta") || tbSync.isBeta() ? "beta" : "stable")+ " release channel.";
    }
};
