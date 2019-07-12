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
