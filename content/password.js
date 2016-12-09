"use strict";

Components.utils.import("chrome://tzpush/content/tzcommon.jsm");

var tzpassword = {
    
    onload: function () {
        document.title = window.arguments[1];
    },

    doOK: function () {
        var retVals = window.arguments[0];
        retVals.password = document.getElementById("tzpush.password").value;
        return (retVals.password !== "");
    },

    doCANCEL: function () {
        var retVals = window.arguments[0];
        retVals.password = "";
        return true;
    }

};
