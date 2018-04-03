"use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountManager = {
    
    onload: function () {
        tbSyncAccountManager.selectTab(0);

        // do we need to show the update button?        
        let updateBeta = (tbSync.prefSettings.getBoolPref("notify4beta") || tbSyncAccountManager.isBeta()) && (tbSync.cmpVersions(tbSync.versionInfo.beta.number, tbSync.versionInfo.installed) > 0);
        let updateStable = (tbSync.cmpVersions(tbSync.versionInfo.stable.number, tbSync.versionInfo.installed)> 0);
        document.getElementById("tbSyncAccountManager.t5").hidden = !(updateBeta || updateStable);
    },
    
    onunload: function () {
        tbSync.prefWindowObj = null;
    },

    
    isBeta: function () {
        return (tbSync.versionInfo.installed.split(".").length > 3);
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
    
    initUpdateData: function() {
        document.getElementById("installed.version").setAttribute("value", tbSync.versionInfo.installed + (tbSyncAccountManager.isBeta() ? " (Beta version)" : ""));

        document.getElementById("mozilla.version").setAttribute("value", tbSync.versionInfo.mozilla.number + " (from Thunderbird AddOn repository)");
        document.getElementById("stable.version").setAttribute("value", tbSync.versionInfo.stable.number + " (from TbSync github repository)");
        document.getElementById("beta.version").setAttribute("value", tbSync.versionInfo.beta.number);

        document.getElementById("mozilla.version").setAttribute("href", tbSync.versionInfo.mozilla.url);
        document.getElementById("stable.version").setAttribute("href", tbSync.versionInfo.stable.url);
        document.getElementById("beta.version").setAttribute("href", tbSync.versionInfo.beta.url);

        document.getElementById("mozilla.version").setAttribute("tooltiptext", tbSync.versionInfo.mozilla.url);
        document.getElementById("stable.version").setAttribute("tooltiptext", tbSync.versionInfo.stable.url);
        document.getElementById("beta.version").setAttribute("tooltiptext", tbSync.versionInfo.beta.url);
        
        if (tbSync.cmpVersions(tbSync.versionInfo.stable.number, tbSync.versionInfo.installed) > 0) document.getElementById("tbsync.recommendation").value = "Recommendation: Update to the latest stable version.";
        else if (tbSync.cmpVersions(tbSync.versionInfo.beta.number, tbSync.versionInfo.installed) > 0) document.getElementById("tbsync.recommendation").value = "Recommendation: Update to the latest beta version.";
        else document.getElementById("tbsync.recommendation").value = "You are running the latest version of the " +( tbSync.prefSettings.getBoolPref("notify4beta") || tbSyncAccountManager.isBeta() ? "beta" : "stable")+ " release channel.";
    }
};
