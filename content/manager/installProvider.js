/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncInstallProvider = {
    
    onload: function () {
        let url = window.location.toString();
        let provider = url.split("provider=")[1];
        window.document.getElementById("header").textContent = tbSync.getLocalizedMessage("installProvider.header::" + tbSync.providerList[provider].name);

        window.document.getElementById("link").textContent = tbSync.providerList[provider].homepageUrl;
        window.document.getElementById("link").setAttribute("link", tbSync.providerList[provider].homepageUrl);

        window.document.getElementById("warning").hidden = tbSync.providerList[provider].homepageUrl.startsWith("https://addons.thunderbird.net"); 
    },
    
};
