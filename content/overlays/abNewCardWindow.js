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
        //remove overlays of all providers (if injected)
        for (let provider in tbSync.loadedProviders) {
            if (tbSync.loadedProviders.hasOwnProperty(provider)) {
                tbSync[provider].getOverlayManager().removeAllOverlays(tbSyncAbNewCardWindow.w);
            }
        }
        
        //inject overlays of all providers (their onbeforeinject will cause only the needed one to be inserted)
        for (let provider in tbSync.loadedProviders) {
            if (tbSync.loadedProviders.hasOwnProperty(provider)) {
                tbSync[provider].getOverlayManager().injectAllOverlays(tbSyncAbNewCardWindow.w);
            }
        }        
    },
        
}
