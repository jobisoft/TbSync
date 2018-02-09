"use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountManager = {

    onunload: function () {
        tbSync.prefWindowObj = null;
        tbSync.dump("unload","now");
    },

    selectTab: function (t) {
        const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;
	    let sources = ["accounts.xul", "cape.xul", "catman.xul", "help.xul"];

	    //set background of all taps to white
        for (let i=0; i<sources.length; i++) {            
            document.getElementById("tbSyncAccountManager.t" + i).style.backgroundColor = "#ffffff";
	    }

	    //set background of selected tap to highlight
        document.getElementById("tbSyncAccountManager.t" + t).style.backgroundColor = "#c1d2ee";
	    
	    //load XUL
        document.getElementById("tbSyncAccountManager.contentWindow").webNavigation.loadURI("chrome://tbsync/content/manager/"+sources[t], LOAD_FLAGS_NONE, null, null, null);
    },
    
};
