/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var tbSyncAccountManager = {
  
  onload: function () {
    i18n.updateDocument({})
    switch (document.body.id) {
      case "managerBody":
        this.AccountManagerTabs = {
          t0: "accounts.html",
          t1: "catman.html",
          t2: "help.html",
          installProvider: "",
        };
        this.selectTab("t0");
        for (const [key, value] of Object.entries(this.AccountManagerTabs)) {
          let element = document.getElementById(key);
          element.addEventListener("click",() => {this.selectTab(key)});
          element.addEventListener("mouseover", (e) => {e.target.style.cursor = "pointer"});
          element.addEventListener("oouseout", (e) => {e.target.style.cursor = "default"});
        }
      break;

      case "helpBody":
        this.getLogPref();  
        document.getElementById("logLevel").addEventListener("change",() => {
          tbSyncAccountManager.toggleLogPref();
        });
        document.getElementById("wikilink").addEventListener("click",() => {
          tbSyncAccountManager.openTranslatedLink('https://github.com/jobisoft/TbSync/wiki');
        });
      break;

      case "catmanBody":
        document.getElementById("catmanlink").addEventListener("click",() => {
          messenger.windows.openDefaultBrowser('https://addons.thunderbird.net/addon/categorymanager/');
        });
      break;
    }  
  },
  
  selectTab: function (tab) {
    //set active tab (css selector for background color)
    for (const [key, value] of Object.entries(this.AccountManagerTabs)) {
      if (key == tab) {
        document.getElementById(key).setAttribute("active","true");
        document.getElementById("contentWindow").setAttribute("src", `/content/manager/${value}`);
      } else {
        document.getElementById(key).setAttribute("active","false");
      }
    }
    document.getElementById("installProvider").hidden=true;
  },

  
  //help tab
  openTranslatedLink: function (url) {
    let googleCode = messenger.i18n.getMessage("google.translate.code");
    if (googleCode != "en" && googleCode != "google.translate.code") {
      messenger.windows.openDefaultBrowser(
        `https://translate.google.com/translate?hl=en&sl=en&tl=${googleCode}&u=${url}`
      );
    } else {
      messenger.windows.openDefaultBrowser(
        url
      );
    }
  },

  getLogPref: async function() {
    let log = document.getElementById("logLevel");
    let value = await preferences.getPref("log.userdatalevel");
    log.value = Math.min(3, value);
  },
  
  toggleLogPref: async function() {
    let log = document.getElementById("logLevel");
    preferences.setPref("log.userdatalevel", log.value);
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
};

window.addEventListener('DOMContentLoaded', tbSyncAccountManager.onload.bind(tbSyncAccountManager));
