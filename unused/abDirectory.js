/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

var abDirectory = {

    component : null,
    cid : null,

    /**
     * Register the component.
     */
    register : function () {
        var name = "@mozilla.org/addressbook/directory;1?type=tbsync-abdirectory";
        var description = "TbSync AbDirectory";
        var uuidGenerator = Components.classes["@mozilla.org/uuid-generator;1"].getService(Components.interfaces.nsIUUIDGenerator);

        this.cid = uuidGenerator.generateUUID();
        this.component = new this.Directory();
        
        /*Services.console.logStringMessage("abDirectory.js: register"
             + "\n  id: " + this.cid 
             + "\n  description: " + description
             + "\n  name: " + name + "\n");*/
        
        var componentManager = Components.manager.QueryInterface(Components.interfaces.nsIComponentRegistrar);
        componentManager.registerFactory(this.cid, description, name, this.component);
    },

    /**
     * Unregister the component
     */
    unregister : function () {
        //Services.console.logStringMessage("abDirectory.js: unregister");
        var componentManager = Components.manager.QueryInterface(Components.interfaces.nsIComponentRegistrar);
        componentManager.unregisterFactory(this.cid, this.component);
        this.cid = null;
        this.component = null;
    },

    /**
     * Class Constructor
     */
    Directory : function () {
        //Services.console.logStringMessage("abDirectory.js: constructor");
        this.mValue = "";
        this.mQuery = "";
        this.mDirPrefId = "";
        this.mDescription = "";
        this.mURI = "";
        this.mCardCache = {};

            //https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/wrappedJSObject
        this.wrappedJSObject = this;
    },

}





abDirectory.Directory.prototype = {
    constructor: abDirectory.Directory,

    wrappedJSObject: null,

    /* nsIAbCollection (parent of nsIAbDirectory) */
    get readOnly() {
        return false;
    },

    get isRemote() {
        return false;
    },

    get isSecure() {
        let url = this.serverURL;
        return (url && (url.indexOf("https") == 0));
    },

    cardForEmailAddress: function(emailAddress) {
        return null;
    },

    getCardFromProperty: function(aProperty, aValue, aCaseSensitive) {
       return null;
    },

    getCardsFromProperty: function(aProperty, aValue, aCaseSensitive) {
        return null;
    },


    /* nsIAbDirectory */
    propertiesChromeURI: "chrome://sogo-connector/content/addressbook/preferences.addressbook.groupdav.xul",

    get dirName() {
        //Services.console.logStringMessage("get dirname: " + this.mDescription);
        return this.mDescription;
    },
    set dirName(val) {
        //Services.console.logStringMessage("set dirname: " + val);
        if (this.mDescription != val) {
            let oldValue = this.mDescription;
            this.mDescription = String(val);
            
            let prefName = this.mDirPrefId;
            //let service = Components.classes["@mozilla.org/preferences-service;1"]
            //                        .getService(Components.interfaces.nsIPrefService);
            try {
                let branch = Services.prefs.getBranch(prefName + ".");
                branch.setCharPref("description", this.mDescription);
            }
            catch(e) {
                dump("directory-properties: exception (new directory '" + prefName
                     + "', URI '" + this.mValue + "' ?):" + e + "\n");
            }

            MailServices.ab.notifyItemPropertyChanged(this, "DirName", oldValue, val);
        }
    },

    get dirType() {
        return 0;
    },

    get fileName() {
        //Services.console.logStringMessage("get filename");
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get URI() {
        //Services.console.logStringMessage("get uri: " + this.mValue);
        return this.mValue;
    },

    get position() {
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get lastModifiedDate() {
        return 0;
    },
    set lastModifiedDate(val) {
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get isMailList() {
        return false;
    },

    /* retrieve the sub-directories */
    get childNodes() {
        let resultArray = Components.classes["@mozilla.org/array;1"]
                                    .createInstance(Components.interfaces.nsIArray);
        return resultArray.enumerate();
    },

    get childCards() {
        let resultArray = Components.classes["@mozilla.org/array;1"]
                                    .createInstance(Components.interfaces.nsIArray);
        return resultArray.enumerate();
    },

    get isQuery() {
        return (this.mQuery && this.mQuery.length > 0);
    },

    init: function(uri) {
        //Services.console.logStringMessage("INIT: " + uri);
        let gABPrefix = "tbsync-abdirectory://";
        //if (uri.indexOf(gABPrefix) == 0) {
            let prefName = uri.substr(gABPrefix.length);
            let quMark = uri.indexOf("?");
            if (quMark > 1) {
                this.mQuery = uri.substr(quMark);
                prefName = prefName.substr(0, quMark - gABPrefix.length);
            }
            this.mValue = gABPrefix + prefName;
            this.mDirPrefId = prefName;
        //Services.console.logStringMessage("prefName: " + prefName);

            let branch = Services.prefs.getBranch(prefName + ".");
            this.mDescription = branch.getCharPref("description","");
            this.mURI = branch.getCharPref("uri","");
        //} else throw "unknown uri: " + uri;        
    },

    deleteDirectory: function (directory) {
        //Services.console.logStringMessage("deleteDirectory");
        ////throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    hasCard: function(cards) {
        //Services.console.logStringMessage("hasCard");
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    hasDirectory: function(dir) {
        //Services.console.logStringMessage("hasDirectory");
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    addCard: function(card) {
        //Services.console.logStringMessage("addCard");
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    modifyCard: function(modifiedCard) {
        //Services.console.logStringMessage("modifyCard");
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    deleteCards: function(cards) {
        //Services.console.logStringMessage("deleteCards");
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    dropCard: function(card, needToCopyCard) {
        //Services.console.logStringMessage("dropCard");
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    useForAutocomplete: function(aIdentityKey) {
        return false;
    },

    get supportsMailingLists() {
        return false;
    },

    get addressLists() {
        return this.mAddressLists;
    },
    set addressLists(val) {
        this.mAddressLists = val;
    },

    addMailList: function(list) {
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get listNickName() {
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get description() {
        //Services.console.logStringMessage("get description: " + this.mDescription);
        return this.mDescription;
    },
    set description(val) {
        //Services.console.logStringMessage("set description");
        this.mDescription = val;
    },

    editMailListToDatabase: function(listCard) {
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    copyMailList: function(aSrcList) {
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    createNewDirectory: function(aDirName, aURI, aType, aPrefName) {
        //Services.console.logStringMessage("createNewDirectory("+aDirName +", " + aURI+", " + aType+", " + aPrefName + ")");
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    createDirectoryByURI: function(displayName, uri) {
        //Services.console.logStringMessage("createDirectoryByURIy("+displayName+", " + uri  +")");
        //throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get dirPrefId() {
        //Services.console.logStringMessage("get dirPref: " + this.mDirPrefId);
        return this.mDirPrefId;
    },
    set dirPrefId(val) {
        //Services.console.logStringMessage("set dirPref");
        if (this.mDirPrefId != val) {
            this.mDirPrefId = val;
        }
    },

    getIntValue: function(aName, aDefaultValue) {
        return 0;
    },

    getBoolValue: function(aName, aDefaultValue) {
       return false;
    },

    getStringValue: function(aName, aDefaultValue) {
        return "";
    },
    getLocalizedStringValue: function(aName, aDefaultValue) {
       return "";
    },

    setIntValue: function(aName, aValue) {
    },
    setBoolValue: function(aName, aValue) {
    },
    setStringValue: function(aName, aValue) {
    },
    setLocalizedStringValue: function(aName, aValue) {
    },


    // nsIFactory implementation
    createInstance: function (outer, iid) {
        //Services.console.logStringMessage("abDirectory.js: createInstance ("+outer+", " + iid + ")");
        return this.QueryInterface(iid);
    },

    QueryInterface: XPCOMUtils.generateQI(["nsIFactory", "nsIAbDirectory", "nsIAbCollection"]),    
}
