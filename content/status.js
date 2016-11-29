/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */
   
"use strict";

if (typeof tzpush === "undefined") {
    var tzpush = {}
}



tzpush.statusObserver = {
	prefs : Components.classes["@mozilla.org/preferences-service;1"]
			.getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush."),
    

   
    register: function () {
		
		
        var prefService = Components.classes["@mozilla.org/preferences-service;1"]
                                .getService(Components.interfaces.nsIPrefService);
        this.branch = prefService.getBranch("extensions.tzpush.");
        this.branch.addObserver("", this, false);
    
    },
 
    unregister: function () {
        this.branch.removeObserver("", this);
    },
    
    observe: function (aSubject, aTopic, aData) {
		switch (aData) {
	case "syncstate":
            var state = this.prefs.getCharPref("syncstate")
            	
		var status = document.getElementById("tzstatus");
		status.label = "TzPush is: " + state;
	}},
	

	
	

	}




tzpush.statusObserver.register()


