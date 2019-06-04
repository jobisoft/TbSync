/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
 
// simple dumper, who can dump to file or console
var dump = function (what, aMessage) {
    if (tbSync.prefs.getBoolPref("log.toconsole")) {
        Services.console.logStringMessage("[TbSync] " + what + " : " + aMessage);
    }
    
    if (this.prefs.getBoolPref("log.tofile")) {
        let now = new Date();
        tbSync.io.appendToFile("debug.log", "** " + now.toString() + " **\n[" + what + "] : " + aMessage + "\n\n");
    }
}
    
// get localized string from core or provider (if possible)
// TODO: move as many locales from provider to tbsync
var getString = function (msg, provider) {
    let success = false;
    let localized = msg;
    
    //spezial treatment of strings with :: like status.httperror::403
    let parts = msg.split("::");

    // if a provider is given, try to get the string from the provider
    if (provider && tbSync.providers.loadedProviders.hasOwnProperty(provider)) {
        try {
            localized = tbSync.providers.loadedProviders[provider].bundle.GetStringFromName(parts[0]);
            success = true;
        } catch (e) {}        
    }

    // if we did not yet succeed, request the tbsync bundle
    if (!success) {
        try {
            localized = tbSync.bundle.GetStringFromName(parts[0]);
            success = true;
        } catch (e) {}                    
    }

    //replace placeholders in returned string
    if (success) {
        for (let i = 0; i<parts.length; i++) {
            let regex = new RegExp( "##replace\."+i+"##", "g");
            localized = localized.replace(regex, parts[i]);
        }
    }

    return localized;
}

var generateUUID = function () {
    const uuidGenerator  = Cc["@mozilla.org/uuid-generator;1"].getService(Ci.nsIUUIDGenerator);
    return uuidGenerator.generateUUID().toString().replace(/[{}]/g, '');
}
    
// promisified implementation AddonManager.getAddonByID() (only needed in TB60)
var getAddonByID = async function (id) {
    return new Promise(function(resolve, reject) {
        function callback (addon) {
            resolve(addon);
        }
        AddonManager.getAddonByID(id, callback);
    })
}






 
var AbListData = class {
    constructor(aList) {
        this._list = aList;
    }
    
    get UID() {
        return this._list.getProperty("UID","");
    }
    
/*
   
    createMailingListCard: function (addressBook, name, id) {
        //prepare new mailinglist directory
        let mailList = Components.classes["@mozilla.org/addressbook/directoryproperty;1"].createInstance(Components.interfaces.nsIAbDirectory);
        mailList.isMailList = true;
        mailList.dirName = name;
        let mailListDirectory = addressBook.addMailList(mailList);

        //We do not get the list card after creating the list directory and would not be able to find the card without ID,
        //so we add the TBSYNCID property manually
        tbSync.db.addItemToChangeLog(addressBook.URI, mailListDirectory.URI + "#" + "TBSYNCID", id);

        //Furthermore, we cannot create a list with a given ID, so we can also not precatch this creation, because it would not find the entry in the changelog
        
        //find the list card (there is no way to get the card from the directory directly)
        return this.getCardFromProperty(addressBook, "TBSYNCID", id);
    },
    
    //helper function to find a mailinglist member by some property 
    //I could not get nsIArray.indexOf() working, so I have to loop with queryElementAt()
    findIndexOfMailingListMemberWithProperty: function(dir, prop, value, startIndex = 0) {
        for (let i=startIndex; i < dir.addressLists.length; i++) {
            let member = dir.addressLists.queryElementAt(i, Components.interfaces.nsIAbCard);
            if (member.getProperty(prop, "") == value) {
                return i;
            }
        }
        return -1;
    },
*/    
}
