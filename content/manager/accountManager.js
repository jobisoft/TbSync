"use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountManager = {

    onload: function () {
        tbSyncAccountManager.selectTab(0);
    },
    
    onunload: function () {
        tbSync.prefWindowObj = null;
        tbSync.dump("unload","now");
    },

    selectTab: function (t) {
        const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;
	    let sources = ["accounts.xul", "cape.xul", "catman.xul", "help.xul"];

	    //set active tab (css selector for background color)
        for (let i=0; i<sources.length; i++) {            
            if (i==t) document.getElementById("tbSyncAccountManager.t" + i).setAttribute("active","true");
            else document.getElementById("tbSyncAccountManager.t" + i).setAttribute("active","false");
	    }
	    
	    //load XUL
        document.getElementById("tbSyncAccountManager.contentWindow").webNavigation.loadURI("chrome://tbsync/content/manager/"+sources[t], LOAD_FLAGS_NONE, null, null, null);
    },
    
};
