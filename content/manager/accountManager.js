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
    
    onloadoptions: function () {
        window.close();
    },    
    
    onunloadoptions: function () {
        tbSync.openManagerWindow(0);
    },
    
    onload: function () {
        tbSyncAccountManager.selectTab(0);
    },
    
    onunload: function () {
        tbSync.prefWindowObj = null;
        if (tbSync.passWindowObj) {
            tbSync.passWindowObj.close();
        }
    },

    selectTab: function (t) {
        const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;
        let sources = ["accounts.xul", "catman.xul", "supporter.xul", "help.xul"];

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
    }
};
