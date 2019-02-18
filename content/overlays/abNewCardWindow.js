/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAbNewCardWindow = {

    onInject: function (window) {
        tbSyncAbNewCardWindow.w = window;
        window.document.getElementById("abPopup").addEventListener("select", tbSyncAbNewCardWindow.onAbSelectChangeNewCard, false);
    },

    onRemove: function (window) {
        window.document.getElementById("abPopup").removeEventListener("select", tbSyncAbNewCardWindow.onAbSelectChangeNewCard, false);
    },

    onAbSelectChangeNewCard: function () {
        //remove all overlays of all providers and insert them again (their onbeforeinject will cause only the needed one to be inserted)
        tbSync.dav.overlayManager.removeAllOverlays(tbSyncAbNewCardWindow.w);
        tbSync.dav.overlayManager.injectAllOverlays(tbSyncAbNewCardWindow.w);
        
        /*let folders = tbSync.db.findFoldersWithSetting("target", window.document.getElementById("abPopup").value);
        let cardProvider = "";
        if (folders.length == 1) {
            cardProvider = tbSync.db.getAccountSetting(folders[0].account, "provider");
        }*/

    },
        
}
