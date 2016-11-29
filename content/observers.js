/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */
   
"use strict";

if (typeof tzpush === "undefined") {
    var tzpush = {}
}



tzpush.myPrefObserver = {
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
        case "autosync":
	        tzpush.Timer.auto()
            break;
        case "selectseperator":
             tzpush.changesep();
             break;
        case "go":
            switch (tzpush.prefs.getCharPref("go")) {
            case "0":
            tzpush.checkgo();
                break;
            case "1":
                tzpush.checkgo();
                break;
            case "resync":
            tzpush.prefs.setCharPref("polkey", '0')
            tzpush.prefs.setCharPref("folderID", "")
            tzpush.prefs.setCharPref("synckey", "")
            tzpush.prefs.setCharPref("LastSyncTime", "-1")
            if (tzpush.prefs.getCharPref("syncstate") === "alldone"){
            tzpush.prefs.setCharPref("go","firstsync")}
                 break;
            case "firstsync":
            tzpush.go();
            break;
            case "alldone":
            var LastSyncTime = Date.now();
	        tzpush.prefs.setCharPref("LastSyncTime", LastSyncTime);
	        break;
        }
    }
}
},


	
  
tzpush.AbListener = {
 
    onItemRemoved: function AbListener_onItemRemoved(aParentDir, aItem) {
        aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
        
        if (aParentDir.URI === tzpush.prefs.getCharPref("abname")) {
        if (aItem instanceof Components.interfaces.nsIAbCard) {
        
            var deleted = aItem.getProperty("ServerId", "");
                deleted = deleted.replace(":","COLON")
           
            Components.utils.import("resource://gre/modules/FileUtils.jsm");
            var file = FileUtils.getFile("ProfD", ["DeletedCards"]);
            file.append(deleted)
            file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, FileUtils.PERMS_FILE);


        }
	}
    },
    onItemAdded: function AbListener_onItemAdded(aParentDir, aItem) {
	  function removeSId(aParent,ServerId) { 
      var acard = aParentDir.getCardFromProperty("ServerId", ServerId, false)
       if (acard instanceof Components.interfaces.nsIAbCard) {
		   acard.setProperty("ServerId", "")
		   aParentDir.modifyCard(acard)
 }
 }
		var ServerId = ""
        aParentDir.QueryInterface(Components.interfaces.nsIAbDirectory);
        if (aParentDir.URI !== tzpush.prefs.getCharPref("abname")) {
			
        if (aItem instanceof Components.interfaces.nsIAbCard) {
			
			ServerId = aItem.getProperty("ServerId", "")
			if (ServerId !== "") {removeSId(aParentDir,ServerId)}
 }
     
      
    }},

  
    add: function AbListener_add() {
        Components.utils.import("resource://gre/modules/FileUtils.jsm");
        var dir = FileUtils.getDir("ProfD", ["DeletedCards"], true);
        var flags;
        var flags1;
        if (Components.classes["@mozilla.org/abmanager;1"]) { // Thunderbird 3
            flags = Components.interfaces.nsIAbListener.directoryItemRemoved;
            flags1 = Components.interfaces.nsIAbListener.itemAdded;
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .addAddressBookListener(tzpush.AbListener,flags | flags1);
        }
	
    else { // Thunderbird 2
            flags = Components.interfaces.nsIAddrBookSession.directoryItemRemoved;
            Components.classes["@mozilla.org/addressbook/services/session;1"]
                .getService(Components.interfaces.nsIAddrBookSession)
                .addAddressBookListener(tzpush.AbListener, flags);
        }
    },
    

    
  /**
   * Removes this listener.
   */
    remove: function AbListener_remove() {
    if (Components.classes["@mozilla.org/abmanager;1"]) // Thunderbird 3
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .removeAddressBookListener(tzpush.AbListener);
    else // Thunderbird 2
            Components.classes["@mozilla.org/addressbook/services/session;1"]
                .getService(Components.interfaces.nsIAddrBookSession)
					.removeAddressBookListener(tzpush.AbListener);
    }
}
 
 
tzpush.Timer = {
    timer : Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),
    auto : function () {
        var synctime = tzpush.prefs.getCharPref("autosync") * 1000 * 60;
        this.timer.cancel();
        if (tzpush.prefs.getCharPref("autosync") !== "0") {
            this.timer.initWithCallback(this.event, synctime, 3);
        }
    },
    
    start : function () {   tzpush.prefs.setCharPref("syncstate","alldone")
		                    if (tzpush.prefs.getCharPref("autosync") !== "0") {tzpush.checkgo()}
                            tzpush.Timer.auto();
                        },
    event : {
            notify: function (timer) {
				if (tzpush.prefs.getCharPref("autosync") !== "0") {tzpush.checkgo()}
                
            }
        }
    }
    
tzpush.Timer.start()
tzpush.myPrefObserver.register();
tzpush.AbListener.add()

