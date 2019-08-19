/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { tbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

const dav = tbSync.providers.dav;

var tbSyncDavNewAccount = {
    
    onLoad: function () {
        this.providerData = new tbSync.ProviderData("dav");
        
        this.elementName = document.getElementById('tbsync.newaccount.name');
        this.elementUser = document.getElementById('tbsync.newaccount.user');
        this.elementPass = document.getElementById('tbsync.newaccount.password');
        this.elementServer = document.getElementById('tbsync.newaccount.server');
        this.elementCalDavServer = document.getElementById('tbsync.newaccount.caldavserver');
        this.elementCardDavServer = document.getElementById('tbsync.newaccount.carddavserver');
        this.serviceproviderlist = document.getElementById('tbsync.newaccount.serviceproviderlist');
        
        //init list
        this.serviceproviderlist.appendChild(this.addProviderEntry("sabredav32.png", "discovery"));
        this.serviceproviderlist.appendChild(this.addProviderEntry("sabredav32.png", "custom"));
        for (let p in dav.sync.serviceproviders) {
            this.serviceproviderlist.appendChild(this.addProviderEntry(dav.sync.serviceproviders[p].icon +"32.png", p));
        }
        this.serviceproviderlist.selectedIndex = 0;
        this.validating = false;
        
        document.addEventListener("wizardfinish", tbSyncDavNewAccount.onFinish.bind(this));
        document.addEventListener("wizardcancel", tbSyncDavNewAccount.onCancel.bind(this));
        document.getElementById("firstPage").addEventListener("pageshow", tbSyncDavNewAccount.showFirstPage.bind(this));
        document.getElementById("secondPage").addEventListener("pageshow", tbSyncDavNewAccount.showSecondPage.bind(this));
    },
    
    addProviderEntry: function (icon, serviceprovider) {
        let name =  tbSync.getString("add.serverprofile."+serviceprovider, "dav");
        let description =  tbSync.getString("add.serverprofile."+serviceprovider+".description", "dav");
        
        //left column
        let image = document.createXULElement("image");
        image.setAttribute("src", "chrome://dav4tbsync/skin/" + icon);
        image.setAttribute("style", "margin:1ex;");

        let leftColumn = document.createXULElement("vbox");
        leftColumn.appendChild(image);
        
        //right column
        let label = document.createXULElement("label");
        label.setAttribute("class", "header");
        label.setAttribute("value", name);
        
        let desc = document.createXULElement("description");
        desc.setAttribute("style", "width: 300px");
        desc.textContent = description;
        
        let rightColumn = document.createXULElement("vbox");
        rightColumn.appendChild(label);
        rightColumn.appendChild(desc);
        
        //columns
        let columns = document.createXULElement("hbox");
        columns.appendChild(leftColumn);
        columns.appendChild(rightColumn);
        
        //richlistitem
        let richlistitem = document.createXULElement("richlistitem");
        richlistitem.setAttribute("style", "padding:4px");
        richlistitem.setAttribute("value", serviceprovider);
        richlistitem.appendChild(columns);
        
        return richlistitem;
    },

    clearValues: function () {
        //clear fields
        this.elementUser.value = "";
        this.elementPass.value = "";
        this.elementServer.value = "";
        this.elementCalDavServer.value = "";                
        this.elementCardDavServer.value = "";

        let serviceprovider =  this.serviceproviderlist.value;        
        if (serviceprovider == "discovery" || serviceprovider == "custom") {
            this.elementName.value = "";
        } else {
            this.elementName.value = tbSync.getString("add.serverprofile."+serviceprovider, "dav");
        }
    },
    
    showFirstPage: function () {
        document.getElementById("tbsync.newaccount.wizard").canAdvance = true;
        this.validating = false;
    },
    
    showSecondPage: function () {
        tbSyncDavNewAccount.onUserTextInput();
        
        let serviceprovider =  this.serviceproviderlist.value;        
        //show/hide additional descriptions (if avail)
        let dFound = 0;
        for (let i=1; i < 4; i++) {
            let dElement = document.getElementById("tbsync.newaccount.details" + i);
            let dLocaleString = "add.serverprofile."+serviceprovider+".details" + i;
            let dLocaleValue = tbSync.getString(dLocaleString, "dav");
            
            if (dLocaleValue == dLocaleString) {
                dElement.textContent = "";
                dElement.hidden = true;
            } else {
                dFound++;
                dElement.textContent = dLocaleValue
                dElement.hidden =false;
            }
        }
        
        //hide Notes header, if no descriptions avail
        let dLabel = document.getElementById("tbsync.newaccount.details.header");
        dLabel.hidden = (dFound == 0);
                
        //always show the two server URLs, excpet for "discovery" serviceprovider
        if (serviceprovider == "discovery") {
            document.getElementById("tbsync.newaccount.caldavserver.row").hidden = true;
            document.getElementById("tbsync.newaccount.carddavserver.row").hidden = true;
            document.getElementById("tbsync.newaccount.server.row").hidden = false;
            this.elementCalDavServer.disabled = false;
            this.elementCardDavServer.disabled = false;
        } else {
            document.getElementById("tbsync.newaccount.server.row").hidden = true;            
            if (serviceprovider == "custom") {
                document.getElementById("tbsync.newaccount.caldavserver.row").hidden = false;
                document.getElementById("tbsync.newaccount.carddavserver.row").hidden = false;
                this.elementCalDavServer.disabled = false;
                this.elementCardDavServer.disabled = false;
            } else {
                document.getElementById("tbsync.newaccount.caldavserver.row").hidden = true;
                document.getElementById("tbsync.newaccount.carddavserver.row").hidden = true;
                this.elementCalDavServer.disabled = true;
                this.elementCardDavServer.disabled = true;
                this.elementCalDavServer.value = dav.sync.serviceproviders[serviceprovider].caldav;
                this.elementCardDavServer.value = dav.sync.serviceproviders[serviceprovider].carddav;
            }            
        }
        
        this.validating = false;
        document.getElementById("tbsync.spinner").hidden = true;
        document.getElementById("tbsync.error").hidden = true;
    },
    
    onUnload: function () {
    },

    advance: function () {
        document.getElementById("tbsync.newaccount.wizard").advance(null);
    },
    
    onUserTextInput: function () {
        document.documentElement.getButton("finish").disabled = (this.elementServer.value.trim() + this.elementCalDavServer.value.trim() + this.elementCardDavServer.value.trim() == "" || this.elementName.value.trim() == "" || this.elementUser.value == "" || this.elementPass.value == "");
    },

    onFinish: function (event) {
        if (document.documentElement.getButton("finish").disabled == false) {
            //initiate validation of server connection,
            document.getElementById("tbsync.newaccount.wizard").canRewind = false;
            document.documentElement.getButton("finish").disabled = true;
            this.validating = true;                
            this.validate();
        }
        event.preventDefault();
    },

    validate: async function () {
        document.getElementById("tbsync.error").hidden = true;
        document.getElementById("tbsync.spinner").hidden = false;

        let accountname = this.elementName.value.trim();

        this.newAccountInfo = {};
        this.newAccountInfo.username = this.elementUser.value;
        this.newAccountInfo.password = this.elementPass.value;
        this.newAccountInfo.caldavserver = this.elementCalDavServer.value.trim();
        this.newAccountInfo.carddavserver = this.elementCardDavServer.value.trim();
       
        this.newAccountInfo.serviceprovider = this.serviceproviderlist.value;        
        if (this.newAccountInfo.serviceprovider == "discovery") {
            this.newAccountInfo.serviceprovider = "custom";
            let server = this.elementServer.value.trim();
            while (server.endsWith("/")) { server = server.slice(0,-1); }        
            
            this.newAccountInfo.caldavserver = server + "/.well-known/caldav";
            this.newAccountInfo.carddavserver = server + "/.well-known/carddav";
        } else {
            while (this.newAccountInfo.caldavserver.endsWith("/")) { this.newAccountInfo.caldavserver = this.newAccountInfo.caldavserver.slice(0,-1); }        
            while (this.newAccountInfo.carddavserver.endsWith("/")) { this.newAccountInfo.carddavserver = this.newAccountInfo.carddavserver.slice(0,-1); }        
        }

        //HTTP or HTTPS? Default to https, if http is not explicitly specified
        this.newAccountInfo.https = !(this.newAccountInfo.caldavserver.toLowerCase().substring(0,7) == "http://");
        this.newAccountInfo.caldavserver = this.newAccountInfo.caldavserver.replace("https://","").replace("http://","");
        this.newAccountInfo.carddavserver = this.newAccountInfo.carddavserver.replace("https://","").replace("http://","");

        let davjobs = {
            cal : {valid: false, error: "", server: this.newAccountInfo.caldavserver},
            card : {valid: false, error: "", server: this.newAccountInfo.carddavserver},
        };
        
        for (let job in davjobs) {
            if (!davjobs[job].server) {
                davjobs[job].valid = true;
                continue;
            }

            let connectionData = new dav.network.ConnectionData();
            connectionData.password = this.newAccountInfo.password;
            connectionData.username = this.newAccountInfo.username;
            connectionData.https = this.newAccountInfo.https;
            connectionData.timeout = 15000;
            connectionData.type = job;
            
            //only needed for proper error reporting - that dav needs this is beyond API - connectionData is not used by TbSync
            //connectionData is a structure which contains all the information needed to establish and evaluate a network connection
            connectionData.eventLogInfo = new tbSync.EventLogInfo("dav", accountname);

            //build full url, so we do not need fqdn
            let url = "http" + (connectionData.https ? "s" : "") + "://" + davjobs[job].server;
            
            try {
                let response = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:current-user-principal /></d:prop></d:propfind>", url , "PROPFIND", connectionData, {"Depth": "0", "Prefer": "return-minimal"});
                // allow 404 because iCloud sends it on valid answer (yeah!)
                let principal = (response && response.multi) ? dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["d","current-user-principal"], ["d","href"]], null, ["200","404"]) : null;
                davjobs[job].valid = (principal !== null);
                if (!davjobs[job].valid) {
                    davjobs[job].error = job+"davservernotfound";
                    tbSync.eventlog.add("warning", connectionData.eventLogInfo, davjobs[job].error, response.commLog);
                }
            } catch (e) {
                davjobs[job].valid = false;
                davjobs[job].error = e.statusData ? e.statusData.message : e.message;
                
                if (e.name == "dav4tbsync") {
                    tbSync.eventlog.add("warning", connectionData.eventLogInfo, e.statusData.message ,e.statusData.details);
                } else {
                    Components.utils.reportError(e);
                }
            }
        }
        
        if (davjobs.cal.valid || davjobs.card.valid) {
            tbSyncDavNewAccount.addAccount(accountname, this.newAccountInfo);
            this.validating = false;
            document.getElementById("tbsync.newaccount.wizard").cancel();
        } else {
            //only display one error
            let badjob = !davjobs.cal.valid ? "cal" : "card";
            switch (davjobs[badjob].error.toString().split("::")[0]) {
                case "401":
                case "403":
                case "404":
                case "500":
                case "503":
                case "network":
                case "security":
                    document.getElementById("tbsync.error.message").textContent = tbSync.getString("info.error") + ": " + tbSync.getString("status."+davjobs[badjob].error, "dav");
                    break;
                default:
                    document.getElementById("tbsync.error.message").textContent = tbSync.getString("info.error") + ": " + tbSync.getString("status.networkerror", "dav");
            }
                        
            document.getElementById("tbsync.spinner").hidden = true;
            document.getElementById("tbsync.error").hidden = false;
            document.getElementById("tbsync.newaccount.wizard").canRewind = true;
            document.documentElement.getButton("finish").disabled = false;
            this.validating = false;
        }
    },
    
    onClose: function () {
        //disallow closing of wizard while validating
        return !this.validating;
    },

    onCancel: function (event) {
        //disallow closing of wizard while validating
        if (this.validating) {
            event.preventDefault();
        }
    },
    

    addAccount (accountname, newAccountInfo) {        
        let newAccountEntry = this.providerData.getDefaultAccountEntries();
        newAccountEntry.createdWithProviderVersion = this.providerData.getVersion();

        newAccountEntry.https = newAccountInfo.https
        newAccountEntry.serviceprovider = newAccountInfo.serviceprovider;
        newAccountEntry.calDavHost = newAccountInfo.caldavserver;
        newAccountEntry.cardDavHost = newAccountInfo.carddavserver;
    
        // Add the new account.
        let newAccountData = this.providerData.addAccount(accountname, newAccountEntry);
        dav.network.getAuthData(newAccountData).updateLoginData(newAccountInfo.username, newAccountInfo.password);

        window.close();
    }
};
