/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { tbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncNewCardWindow = {

    onInject: function (window) {
        window.document.getElementById("abPopup").parentNode.addEventListener("select", tbSyncNewCardWindow.onAbSelectChangeNewCard, false);
        
        let items = window.document.getElementsByClassName("abMenuItem");
        for (let i=0; i < items.length; i++) {
            let icon = "";
            let abURI = items[i].value;
            
            if (abURI) {
                let ab = MailServices.ab.getDirectory(abURI);
                if (!ab.isMailList && !ab.isRemote) {
                    try {
                        icon = ab.getStringValue("tbSyncIcon", "");
                    } catch (e) {}
                }
            }
            
            if (icon) {
                items[i].setAttribute("TbSyncIcon", icon);
            }
        }
    },

    onRemove: function (window) {
        window.document.getElementById("abPopup").parentNode.removeEventListener("select", tbSyncNewCardWindow.onAbSelectChangeNewCard, false);
        let items = window.document.getElementsByClassName("abMenuItem");
        for (let i=0; i < items.length; i++) {
            if (items[i].getAttribute("TbSyncIcon")) {
                items[i].removeAttribute("TbSyncIcon");
            }
        }
    },
    
    onAbSelectChangeNewCard: function () {        
        window.sizeToContent();
    },    
}
