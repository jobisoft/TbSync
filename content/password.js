"use strict";

var tzPushPassword = {
    
    onload: function () {
        document.title = window.arguments[0];
        this.account = window.arguments[1];
    },

    doOK: function () {
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.notifyObservers(null, "tzpush.setPassword", this.account + "." + document.getElementById("tzpush.password").value);
    }

};
