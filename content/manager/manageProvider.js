/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncManageProvider = {
  
  prepInstall: function () {
    let url = window.location.toString();
    let provider = url.split("provider=")[1];
    window.document.getElementById("header").textContent = TbSync.getString("installProvider.header::" + TbSync.providers.defaultProviders[provider].name);

    window.document.getElementById("link").textContent = TbSync.providers.defaultProviders[provider].homepageUrl;
    window.document.getElementById("link").setAttribute("link", TbSync.providers.defaultProviders[provider].homepageUrl);

    window.document.getElementById("warning").hidden = TbSync.providers.defaultProviders[provider].homepageUrl.startsWith("https://addons.thunderbird.net"); 
  },

  prepMissing: function () {
    let url = window.location.toString();
    let provider = url.split("provider=")[1];

    let e = window.document.getElementById("missing");
    let v = e.textContent;
    e.textContent = v.replace("##provider##", provider.toUpperCase());
    
    if (TbSync.providers.defaultProviders.hasOwnProperty(provider)) {
      window.document.getElementById("link").textContent = TbSync.providers.defaultProviders[provider].homepageUrl;
      window.document.getElementById("link").setAttribute("link", TbSync.providers.defaultProviders[provider].homepageUrl);
    }
    
  },    
};
