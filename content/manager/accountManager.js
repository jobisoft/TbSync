/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountManager = {
    
    onloadoptions: function () {
        window.close();
    },    
    
    onunloadoptions: function () {
        tbSync.manager.openManagerWindow(0);
    },
    
    onload: function () {
        tbSync.AccountManagerTabs = ["accounts.xul", "catman.xul", "supporter.xul", "help.xul"];
        tbSyncAccountManager.selectTab(0);
    },
    
    onunload: function () {
        tbSync.manager.prefWindowObj = null;
    },

    selectTab: function (t) {
        const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;

        //set active tab (css selector for background color)
        for (let i=0; i<tbSync.AccountManagerTabs.length; i++) {            
            if (i==t) document.getElementById("tbSyncAccountManager.t" + i).setAttribute("active","true");
            else document.getElementById("tbSyncAccountManager.t" + i).setAttribute("active","false");
        }
        tbSync.manager.prefWindowObj.document.getElementById("tbSyncAccountManager.installProvider").hidden=true;
        
        //load XUL
        document.getElementById("tbSyncAccountManager.contentWindow").setAttribute("src", "chrome://tbsync/content/manager/"+tbSync.AccountManagerTabs[t]);
    },
    
    
    
    //help tab
    getLogPref: function() {
        let log = document.getElementById("tbSyncAccountManager.logPrefCheckbox");
        log.checked =  tbSync.prefs.getBoolPref("log.tofile");
    },
    
    toggleLogPref: function() {
        let log = document.getElementById("tbSyncAccountManager.logPrefCheckbox");
        tbSync.prefs.setBoolPref("log.tofile", log.checked);
    },
    
    initSupportWizard: function() {
        document.documentElement.getButton("finish").disabled = true;

        const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
        let menu = document.getElementById("tbsync.supportwizard.faultycomponent");

        let providers = Object.keys(tbSync.providers.loadedProviders);
        for (let i=0; i < providers.length; i++) {
            let item = document.createElementNS(XUL_NS, "menuitem");
            item.setAttribute("value", providers[i]);
            item.setAttribute("label", tbSync.tools.getLocalizedMessage("supportwizard.provider::" + tbSync[providers[i]].getNiceProviderName()));
            menu.appendChild(item); 
        }
    
        let menulist = document.getElementById("tbsync.supportwizard.faultycomponent.menulist");
        menulist.addEventListener("select", tbSyncAccountManager.checkSupportWizard);
    },
    
    checkSupportWizard: function() {
        let provider = document.getElementById("tbsync.supportwizard.faultycomponent").parentNode.value;
        let subject = document.getElementById("tbsync.supportwizard.summary").value;
        let description = document.getElementById("tbsync.supportwizard.description").value;

        //just check and update button status
        document.documentElement.getButton("finish").disabled = (provider == "" || subject == "" || description== "");        
    },

    prepareBugReport: function() {
        let provider = document.getElementById("tbsync.supportwizard.faultycomponent").parentNode.value;
        let subject = document.getElementById("tbsync.supportwizard.summary").value;
        let description = document.getElementById("tbsync.supportwizard.description").value;

        if (provider == "" || subject == "" || description== "") {
            return false;
        }

        //special if core is selected, which is not a provider
        let email = (tbSync.providers.loadedProviders.hasOwnProperty(provider)) ? tbSync[provider].getMaintainerEmail() : "john.bieling@gmx.de";
        let version = (tbSync.providers.loadedProviders.hasOwnProperty(provider)) ? " " + tbSync.providers.loadedProviders[provider].version : "";
        tbSync.manager.createBugReport(email, "[" + provider.toUpperCase() + version + "] " + subject, description);
        return true;
    },
    
    
    
    //community tab
    initCommunity: function() {
        let listOfContributors = document.getElementById("listOfContributors");
        let sponsors = {};
            
        let providers = Object.keys(tbSync.providers.loadedProviders);
        for (let i=0; i < providers.length; i++) {
            let provider = providers[i];
            let template = listOfContributors.firstElementChild.cloneNode(true);
            template.setAttribute("provider", provider);
            template.children[0].setAttribute("src", tbSync[provider].getProviderIcon(48));
            template.children[1].children[0].textContent = tbSync[provider].getNiceProviderName();
            listOfContributors.appendChild(template);
            Object.assign(sponsors, tbSync[provider].getSponsors());
        }
        listOfContributors.removeChild(listOfContributors.firstElementChild);

        let listOfSponsors = document.getElementById("listOfSponsors");
        let sponsorlist = Object.keys(sponsors);
        sponsorlist.sort();
        for (let i=0; i < sponsorlist.length; i++) {
            let sponsor = sponsors[sponsorlist[i]];
            let template = listOfSponsors.firstElementChild.cloneNode(true);
            if (sponsor.link) template.setAttribute("link", sponsor.link);
            if (sponsor.icon) template.children[0].setAttribute("src", sponsor.icon);
            template.children[1].children[0].textContent = sponsor.name;
            template.children[1].children[1].textContent = sponsor.description;
            listOfSponsors.appendChild(template);
            listOfSponsors.appendChild(template);
        }
        listOfSponsors.removeChild(listOfSponsors.firstElementChild);
    }        
};
