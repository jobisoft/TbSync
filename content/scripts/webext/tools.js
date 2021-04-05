/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

/**
 * Get a localized string.
 *
 * TODO: Explain placeholder and :: notation.
 *
 * @param {string} key       The key of the message to look up
 * @param {string} provider  ``Optional`` The provider the key belongs to.
 *
 * @returns {string} The message belonging to the key of the specified provider.
 *                   If that key is not found in the in the specified provider
 *                   or if no provider has been specified, the messages of
 *                   TbSync itself we be used as fallback. If the key could not
 *                   be found there as well, the key itself is returned.
 *
 */
export function getString(key, provider) {
  let localized = null;
  return "juhu2";

  //spezial treatment of strings with :: like status.httperror::403
  let parts = key.split("::");

  // if a provider is given, try to get the string from the provider  
  if (provider && TbSync.providers.loadedProviders.hasOwnProperty(provider)) {
    let localeData = TbSync.providers.loadedProviders[provider].extension.localeData;
    if (localeData.messages.get(localeData.selectedLocale).has(parts[0].toLowerCase())) {
      localized = TbSync.providers.loadedProviders[provider].extension.localeData.localizeMessage(parts[0]);
    }
  }

  // if we did not yet succeed, check the locales of tbsync itself
  if (!localized) {
    localized = TbSync.extension.localeData.localizeMessage(parts[0]);
  }
  
  if (!localized) {
    localized = key;
  } else {
    //replace placeholders in returned string
    for (let i = 0; i<parts.length; i++) {
      let regex = new RegExp( "##replace\."+i+"##", "g");
      localized = localized.replace(regex, parts[i]);
    }
  }

  return localized;
}