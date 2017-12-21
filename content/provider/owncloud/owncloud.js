"use strict";

var owncloud_common = {
    bundle: Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tbsync/locale/owncloud.strings"),
};

function owncloud_obj () {};

owncloud_obj.prototype = {
    syncdata: {},
        
    initSync: function (job, account,  folderID = "") {

        //store  current value of numberOfResync
        let numberOfResync = this.syncdata.numberOfResync;
        
        //set syncdata for this sync process (reference from outer object)
        this.syncdata = {};
        this.syncdata.account = account;
        this.syncdata.folderID = folderID;
        this.syncdata.fResync = false;
    }
    
};
