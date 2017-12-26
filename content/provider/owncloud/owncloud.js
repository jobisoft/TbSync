"use strict";

var owncloud = {
    bundle: Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tbsync/locale/owncloud.strings"),

    onload: function () {
        //finish init by calling main init()
        tbSync.init("owncloud");
    },

};

owncloud.onload();
