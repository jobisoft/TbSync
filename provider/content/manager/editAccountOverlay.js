/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

const dav = tbSync.providers.dav;

var tbSyncEditAccountOverlay = {

    onload: function (window, accountData) {
        this.accountData = accountData;

        let serviceprovider = this.accountData.getAccountProperty("serviceprovider");
        let isServiceProvider = dav.sync.serviceproviders.hasOwnProperty(serviceprovider);
        
        // special treatment for configuration label, which is a permanent setting and will not change by switching modes
        let configlabel = window.document.getElementById("tbsync.accountsettings.label.config");
        if (configlabel) {
            let extra = "";
            if (isServiceProvider) {
                extra = " [" + tbSync.getString("add.serverprofile." + serviceprovider, "dav") + "]";
            }
            configlabel.setAttribute("value", tbSync.getString("config.custom", "dav") + extra);
        }

        //set certain elements as "alwaysDisable", if locked by service provider
        if (isServiceProvider) {
            let items = window.document.getElementsByClassName("lockIfServiceProvider");
            for (let i=0; i < items.length; i++) {
                items[i].setAttribute("alwaysDisabled", "true");
            }
        }
    },

    stripHost: function (document, field) {
        let host = document.getElementById('tbsync.accountsettings.pref.' + field).value;
        if (host.indexOf("https://") == 0) {
            host = host.replace("https://","");
            document.getElementById('tbsync.accountsettings.pref.https').checked = true;
            this.accountData.setAccountProperty("https", true);
        } else if (host.indexOf("http://") == 0) {
            host = host.replace("http://","");
            document.getElementById('tbsync.accountsettings.pref.https').checked = false;
            this.accountData.setAccountProperty("https", false);
        }
        
        while (host.endsWith("/")) { host = host.slice(0,-1); }        
        document.getElementById('tbsync.accountsettings.pref.' + field).value = host
        this.accountData.setAccountProperty(field, host);
    }
};
