/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */

"use strict";

if (typeof tzpush === "undefined") {
    var tzpush = {}
}

var tzpush = {
    prefs : Components.classes["@mozilla.org/preferences-service;1"]
			.getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush."),
    hthost : "",
    PASSWORD : "",
    SERVER : "",
    USER : "",
    NEWPASSWORD : "",
    select : "",
    onopen : function () {
        this.updateprefs();
        document.getElementById('passbox').value = this.PASSWORD;
	    this.localAbs();

    }, 

    onclose : function () {

    },

    getpassword : function () {
     var SSL = this.prefs.getBoolPref("https")
     var host = this.prefs.getCharPref("host")
     var USER = this.prefs.getCharPref("user")
     if (SSL === true) {var hthost = "https://" + host}
            else {var hthost = "http://" + host}
            if (SSL === true) {var SERVER = "https://" + host + "/Microsoft-Server-ActiveSync"}
            else {var SERVER = "http://" + host + "/Microsoft-Server-ActiveSync"}
        var myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
       
        var logins = myLoginManager.findLogins({}, hthost, SERVER, null);
        var password = ''
        for (var i = 0; i < logins.length; i++) {
            if (logins[i].username === USER) {
                password = logins[i].password;
                break;
            }
       
        }
 
        if (typeof password === 'undefined') {password = ""}  
        return password
    },

    setpassword : function () {
     var SSL = this.prefs.getBoolPref("https")
     var host = this.prefs.getCharPref("host")
     var USER = this.prefs.getCharPref("user")
     if (SSL === true) {var hthost = "https://" + host}
            else {var hthost = "http://" + host}
            if (SSL === true) {var SERVER = "https://" + host + "/Microsoft-Server-ActiveSync"}
            else {var SERVER = "http://" + host + "/Microsoft-Server-ActiveSync"}
	    this.PASSWORD = this.getpassword()
	    if (this.NEWPASSWORD !== this.PASSWORD) {
        
            var nsLoginInfo = new Components.Constructor(
    "@mozilla.org/login-manager/loginInfo;1",
    Components.interfaces.nsILoginInfo,
    "init");
            var loginInfo = new nsLoginInfo(hthost, SERVER, null, USER, this.PASSWORD, "USER", "PASSWORD");
    
            var updateloginInfo = new nsLoginInfo(hthost, SERVER, null, USER, this.NEWPASSWORD, "USER", "PASSWORD");
            var myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);

            if (this.NEWPASSWORD !== '') {
                if (this.NEWPASSWORD !== this.PASSWORD) {
	                if (this.PASSWORD !== '') {
		
                        myLoginManager.removeLogin(loginInfo)
			        }
	            }
	            myLoginManager.addLogin(updateloginInfo)
	            this.updateprefs()
            }
                         else if (this.PASSWORD === "" || typeof this.PASSWORD === 'undefined') {
                myLoginManager.addLogin(updateloginInfo);
	
            }
               else {myLoginManager.removeLogin(loginInfo)}
        }
    },

    updateprefs : function () {
  
            var addressUrl = this.prefs.getCharPref("abname")
            var SSL = this.prefs.getBoolPref("https")
            var host = this.prefs.getCharPref("host")
            if (SSL === true) {this.hthost = "https://" + host}
            else {this.hthost = "http://" + host}
            if (SSL === true) {this.SERVER = "https://" + host + "/Microsoft-Server-ActiveSync"}
            else {this.SERVER = "http://" + host + "/Microsoft-Server-ActiveSync"}
            this.USER = this.prefs.getCharPref("user")
            this.PASSWORD = this.getpassword()
            this.NEWPASSWORD = ''
            var deviceType = 'Thunderbird'
            var deviceId = this.prefs.getCharPref("deviceId")
            if (deviceId === "")
            {deviceId = Date.now();
                this.prefs.setCharPref("deviceId", deviceId)
            }
            var polkey = this.prefs.getCharPref("polkey")
            var synckey = this.prefs.getCharPref("synckey")    
        },

    localAbs : function () {
     
            var count = -1
	        while (document.getElementById('localContactsFolder').children.length > 0)
		{document.getElementById('localContactsFolder').removeChild(document.getElementById('localContactsFolder').firstChild)}
	        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
	        let allAddressBooks = abManager.directories;
	        
	        while (allAddressBooks.hasMoreElements()) {  
		let addressBook = allAddressBooks.getNext();
		        if (addressBook instanceof Components.interfaces.nsIAbDirectory && 
			!addressBook.isRemote && !addressBook.isMailList && addressBook.fileName !== 'history.mab') 
			{
			        var ab = document.createElement('listitem');
			        ab.setAttribute('label', addressBook.dirName);
			        ab.setAttribute('value', addressBook.URI);
			        count = count + 1 
                    if (this.prefs.getCharPref('abname') === addressBook.URI) {
			    
				        this.select = count
				    }
                     
			        document.getElementById('localContactsFolder').appendChild(ab);
			
		        }
	        }
	
	        if (this.select !== -1) {document.getElementById('localContactsFolder').selectedIndex = this.select}
        },
  
    reset : function () {
            var addressUrl = this.prefs.getCharPref("abname")
            this.prefs.setCharPref("polkey", '0')
            this.prefs.setCharPref("folderID", "")
            this.prefs.setCharPref("synckey", "")
            this.prefs.setCharPref("LastSyncTime", "-1")
            this.prefs.setCharPref("deviceId", "")
            this.prefs.setCharPref("autosync", "0")

            var abManager = Components.classes["@mozilla.org/abmanager;1"]
		.getService(Components.interfaces.nsIAbManager);
            var addressBook = abManager.getDirectory(addressUrl);
            var card
            var cards = addressBook.childCards;
            while (cards.hasMoreElements()) {
                card = cards.getNext()
                if (card instanceof Components.interfaces.nsIAbCard) {

                    card.setProperty('ServerId', '')
                    card.setProperty("LastModifiedDate", '')
                    addressBook.modifyCard(card)

                }
            }
            Components.utils.import("resource://gre/modules/FileUtils.jsm");
            var file = FileUtils.getFile("ProfD", ["DeletedCards"]);
            var entries = file.directoryEntries;
			
            while (entries.hasMoreElements()) {
                var entry = entries.getNext()   
                entry.QueryInterface(Components.interfaces.nsIFile)
                entry.remove("true")}
        },
        
    softreset : function () {
           this.prefs.setCharPref("go","resync")
                    },

    toggelgo : function () {
    
        if (this.prefs.getCharPref("go") === "0") {
            this.prefs.setCharPref("go", "1") 
        }
    else (this.prefs.setCharPref("go", "0"))
    },


    
    cape : function () {
        function openTBtab(tempURL) {

            var tabmail = null;

            var mail3PaneWindow =
    Components.classes["@mozilla.org/appshell/window-mediator;1"]
   .getService(Components.interfaces.nsIWindowMediator)
   .getMostRecentWindow("mail:3pane");
            if (mail3PaneWindow) {
                tabmail = mail3PaneWindow.document.getElementById("tabmail");
                mail3PaneWindow.focus();
                tabmail.openTab("contentTab", {contentPage: tempURL});
            }
            return (tabmail != null)
        }

        openTBtab("http://www.c-a-p-e.co.uk")
    },
    
    notes : function () {
        function openTBtab(tempURL) {

            var tabmail = null;

            var mail3PaneWindow =
    Components.classes["@mozilla.org/appshell/window-mediator;1"]
   .getService(Components.interfaces.nsIWindowMediator)
   .getMostRecentWindow("mail:3pane");
            if (mail3PaneWindow) {
                tabmail = mail3PaneWindow.document.getElementById("tabmail");
                mail3PaneWindow.focus();
                tabmail.openTab("contentTab", {contentPage: tempURL});
            }
            return (tabmail != null)
        }

        openTBtab("chrome://tzpush/content/notes.html")
    },    
   

    updatepass : function () {
	
        this.NEWPASSWORD = document.getElementById('passbox').value
         
        this.setpassword()
    },




    setselect : function (value) {

            this.prefs.setCharPref('abname', value)
	    }

}




