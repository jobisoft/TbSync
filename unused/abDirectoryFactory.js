/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

var abDirectoryFactory = {

    component : null,
    cid : null,

    /**
     * Register the component.
     */
    register : function () {
        var name = "@mozilla.org/addressbook/directory-factory;1?name=tbsync-abdirectory";
        var description = "TbSync AbDirectory Factory";
        var uuidGenerator = Components.classes["@mozilla.org/uuid-generator;1"].getService(Components.interfaces.nsIUUIDGenerator);

        this.cid = uuidGenerator.generateUUID();
        this.component = new this.Factory();

        Services.console.logStringMessage("abDirectoryFactory.js: register"
             + "\n  id: " + this.cid 
             + "\n  description: " + description
             + "\n  name: " + name + "\n");
        
        var componentManager = Components.manager.QueryInterface(Components.interfaces.nsIComponentRegistrar);
        componentManager.registerFactory(this.cid, description, name, this.component);
    },

    /**
     * Unregister the component
     */
    unregister : function () {
        Services.console.logStringMessage("abDirectoryFactory.js: unregister");
        var componentManager = Components.manager.QueryInterface(Components.interfaces.nsIComponentRegistrar);
        componentManager.unregisterFactory(this.cid, this.component);
        this.cid = null;
        this.component = null;
    },

    /**
     * Class Constructor
     */
    Factory : function () {
        Services.console.logStringMessage("abDirectoryFactory.js: constructor");
    },

}





abDirectoryFactory.Factory.prototype = {
    constructor: abDirectoryFactory.Factory,
    flags: 0,
    
    // nsIFactory implementation
    createInstance: function (outer, iid) {
        Services.console.logStringMessage("abDirectoryFactory.js: createInstance ("+outer+", " + iid + ")");
        return this.QueryInterface(iid);
    },
      
    /* nsIAbDirFactory */
    getDirectories: function(aDirName, aURI, aPrefId) {
                Services.console.logStringMessage("DirectoryFactory.js: getDirectories"
             + "\n  aDirName: " + aDirName
             + "\n  aURI: " + aURI
             + "\n  aPrefId: " + aPrefId + "\n");

        let baseArray = Components.classes["@mozilla.org/array;1"]
            .createInstance(Components.interfaces.nsIMutableArray);

        try {
            let directoryURI = "tbsync-abdirectory://" + aPrefId;
            Services.console.logStringMessage("Getting directory at URI: " + directoryURI + "\n");
            let directory = MailServices.ab.getDirectory(directoryURI);
            baseArray.appendElement(directory, false);
        } catch (e) {
            Services.console.logStringMessage("Error in getDirectories(): " + e + "\n");
        }
        
        let directoryEnum = baseArray.enumerate();
        return directoryEnum;
    },

    //void deleteDirectory ( nsIAbDirectory directory )
    deleteDirectory: function(directory) {
         Services.console.logStringMessage("DirectoryFactory.js: deleteDirectory: directory: " + directory + "\n");
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    getInterfaces: function(count) {
        const ifaces = [
            Components.interfaces.nsIAbDirFactory,
            Components.interfaces.nsIClassInfo,
            Components.interfaces.nsISupports];
        count.value = ifaces.length;
        return ifaces;
    },

    QueryInterface: function(aIID) {
        if (!aIID.equals(Components.interfaces.nsIAbDirFactory)
            && !aIID.equals(Components.interfaces.nsIClassInfo)
            && !aIID.equals(Components.interfaces.nsISupports)) {
             //Services.console.logStringMessage("CardDAVDirectoryFactory.js: NO INTERFACE: "  + aIID + "\n");
            throw Components.results.NS_ERROR_NO_INTERFACE;
        }
        return this;
    }      
}
