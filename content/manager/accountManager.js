/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAccountManager = {
  
  onloadoptions: function () {
    window.close();
  },    
  
  onunloadoptions: function () {
    TbSync.manager.openManagerWindow(0);
  },
  
  onload: function () {
    TbSync.AccountManagerTabs = ["accounts.xhtml", "catman.xhtml", "supporter.xhtml", "help.xhtml"];
    tbSyncAccountManager.selectTab(0);
  },
  
  onunload: function () {
    TbSync.manager.prefWindowObj = null;
  },

  selectTab: function (t) {
    const LOAD_FLAGS_NONE = Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE;

    //set active tab (css selector for background color)
    for (let i=0; i<TbSync.AccountManagerTabs.length; i++) {            
      if (i==t) document.getElementById("tbSyncAccountManager.t" + i).setAttribute("active","true");
      else document.getElementById("tbSyncAccountManager.t" + i).setAttribute("active","false");
    }
    TbSync.manager.prefWindowObj.document.getElementById("tbSyncAccountManager.installProvider").hidden=true;
    
    //load XUL
    document.getElementById("tbSyncAccountManager.contentWindow").setAttribute("src", "chrome://tbsync/content/manager/"+TbSync.AccountManagerTabs[t]);
  },
  
  
  
  //help tab
  getLogPref: function() {
    let log = document.getElementById("tbSyncAccountManager.logLevel");
    log.value = Math.min(3, TbSync.prefs.getIntPref("log.userdatalevel"));
  },
  
  toggleLogPref: function() {
    let log = document.getElementById("tbSyncAccountManager.logLevel");
    TbSync.prefs.setIntPref("log.userdatalevel", log.value);
  },
  
  initSupportWizard: async function() {
    document.getElementById("SupportWizard").getButton("finish").disabled = true;

    let menu = document.getElementById("tbsync.supportwizard.faultycomponent");

    let providers = Object.keys(TbSync.providers.loadedProviders);
    for (let i=0; i < providers.length; i++) {
      let item = document.createXULElement("menuitem");
      item.setAttribute("value", providers[i]);
      item.setAttribute("label", TbSync.getString("supportwizard.provider::" + await TbSync.providers.request(providers[i], "Base.getProviderName")));
      menu.appendChild(item); 
    }
  
    document.getElementById("tbsync.supportwizard.faultycomponent.menulist").addEventListener("select", tbSyncAccountManager.checkSupportWizard);
    document.getElementById("tbsync.supportwizard.description").addEventListener("input", tbSyncAccountManager.checkSupportWizard);
    document.addEventListener("wizardfinish", tbSyncAccountManager.prepareBugReport);

    // bug https://bugzilla.mozilla.org/show_bug.cgi?id=1618252
    document.getElementById('SupportWizard')._adjustWizardHeader();
  },
  
  checkSupportWizard: function() {
    let provider = document.getElementById("tbsync.supportwizard.faultycomponent").parentNode.value;
    let subject = document.getElementById("tbsync.supportwizard.summary").value;
    let description = document.getElementById("tbsync.supportwizard.description").value;

    //just check and update button status
    document.getElementById("SupportWizard").getButton("finish").disabled = (provider == "" || subject == "" || description== "");        
  },

  prepareBugReport: async function(event) {
    let provider = document.getElementById("tbsync.supportwizard.faultycomponent").parentNode.value;
    let subject = document.getElementById("tbsync.supportwizard.summary").value;
    let description = document.getElementById("tbsync.supportwizard.description").value;

    if (provider == "" || subject == "" || description== "") {
      event.preventDefault();
      return;
    }

    //special if core is selected, which is not a provider
    let email = (TbSync.providers.loadedProviders.hasOwnProperty(provider)) ? await TbSync.providers.request(provider, "Base.getMaintainerEmail") : "john.bieling@gmx.de";
    let version = (TbSync.providers.loadedProviders.hasOwnProperty(provider)) ? " " + TbSync.providers.loadedProviders[provider].version : "";
    TbSync.manager.createBugReport(email, "[" + provider.toUpperCase() + version + "] " + subject, description);
  },
  
  
  
  //community tab
  initCommunity: async function() {
    let listOfContributors = document.getElementById("listOfContributors");
    let sponsors = {};
      
    let providers = Object.keys(TbSync.providers.loadedProviders);
    for (let i=0; i < providers.length; i++) {
      let provider = providers[i];
      let template = listOfContributors.firstElementChild.cloneNode(true);
      template.setAttribute("provider", provider);
      template.children[0].setAttribute("src", await TbSync.providers.request(provider, "Base.getProviderIcon", [48]));
      template.children[1].children[0].textContent = await TbSync.providers.request(provider, "Base.getProviderName");
      listOfContributors.appendChild(template);
      Object.assign(sponsors, await TbSync.providers.request(provider, "Base.getSponsors"));
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
