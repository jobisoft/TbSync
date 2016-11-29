/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */
   
// Pretty print by http://jsbeautifier.org/

"use strict";

if (typeof tzpush === "undefined") {
    var tzpush = {};
}



tzpush = {
    prefs: Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush."),
    mLoadNumber: 0,

    initialize: function ABOverlay_initialize() {
        if (!(typeof OnLoadCardView === "function")) {
            // if it has tried to load more than 50 times something is wrong, so quit
            if (tzpush.mLoadNumber < 50) {
                setTimeout(tzpush.initialize, 200);
            } else {
                tzpush.myDump("tzpush overlay", "OnLoadCardView not available")
            }
            tzpush.mLoadNumber++;
            return;
        }

        tzpush.originalOnLoadCardView = OnLoadCardView
        OnLoadCardView = tzpush.myOnLoadCardView
        tzpush.originalDisplayCardViewPane = DisplayCardViewPane;
        DisplayCardViewPane = tzpush.myDisplayCardViewPane
    },
    
    myDump: function(what, aMessage) {
        var consoleService = Components.classes["@mozilla.org/consoleservice;1"]
            .getService(Components.interfaces.nsIConsoleService);
        consoleService.logStringMessage(what + " : " + aMessage);
    },

    myOnLoadCardView: function() {
        tzpush.originalOnLoadCardView.apply(this, arguments)
    },
    
    myDisplayCardViewPane: function(realCard) {
        var visible
        tzpush.originalDisplayCardViewPane.apply(this, arguments)
        var zThirdEmail = zSecondaryEmail + " 2"
        cvData.cvEmail3Box = document.getElementById("cvEmail3Box");
        cvData.cvEmail3 = document.getElementById("cvEmail3");

        visible = HandleLink(
            cvData.cvEmail3,
            zThirdEmail,
            realCard.getProperty("Email3Address", ""),
            cvData.cvEmail3Box,
            "mailto:" + realCard.getProperty("Email3Address", "")) || visible;
    },
    
    toggelgo: function() {
        if (this.prefs.getCharPref("go") === "0") {
            this.prefs.setCharPref("go", "1")
        } else {
           this.prefs.setCharPref("go", "0")
        }
    },

}




window.addEventListener("load",
    /** Initializes the ABOverlay class when the window has finished loading */
    function tzpushLoadListener() {
        window.removeEventListener("load", tzpushLoadListener, false);
        tzpush.initialize()
    },
    false);
