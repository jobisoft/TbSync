/*
 * This file is part of TbSync.
 *
 * TbSync is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * TbSync is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with TbSync. If not, see <https://www.gnu.org/licenses/>.
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
