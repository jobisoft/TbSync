/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
var messenger = {

  overlayManager : null,
  
  load: async function () {
    this.overlayManager = new OverlayManager({verbose: 0});
    await this.overlayManager.registerOverlay("chrome://messenger/content/messenger.xul", "chrome://tbsync/content/overlays/messenger.xul");        
    await this.overlayManager.registerOverlay("chrome://messenger/content/messengercompose/messengercompose.xul", "chrome://tbsync/content/overlays/messengercompose.xul");
    await this.overlayManager.registerOverlay("chrome://calendar/content/calendar-event-dialog-attendees.xul", "chrome://tbsync/content/overlays/calendar-event-dialog-attendees.xul");
    await this.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://tbsync/content/overlays/addressbookiconsoverlay.xul");
    await this.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://tbsync/content/overlays/abNewCardWindowOverlay.xul");

    // The abCSS.xul overlay is just adding a CSS file.
    await this.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://tbsync/content/overlays/abCSS.xul");
    await this.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://tbsync/content/overlays/abCSS.xul");
    
    //inject overlays
    this.overlayManager.startObserving();

    Services.obs.addObserver(this.initSyncObserver, "tbsync.observer.sync", false);
    Services.obs.addObserver(this.syncstateObserver, "tbsync.observer.manager.updateSyncstate", false);
    Services.obs.addObserver(this.syncstateObserver, "tbsync.observer.initialized", false);	
  },

  unload: async function () {
    //unload overlays
    this.overlayManager.stopObserving();

    Services.obs.removeObserver(this.initSyncObserver, "tbsync.observer.sync");
    Services.obs.removeObserver(this.syncstateObserver, "tbsync.observer.manager.updateSyncstate");
    Services.obs.removeObserver(this.syncstateObserver, "tbsync.observer.initialized");        
  },

  // observer to catch changing syncstate and to update the status bar.
  syncstateObserver: {
    observe: function (aSubject, aTopic, aData) {
      //update status bar
      if (tbSync) {
        let status = tbSync.window.document.getElementById("tbsync.status");
        if (status) {
          let label = "TbSync: ";
          
          if (tbSync.enabled) {

            //check if any account is syncing, if not switch to idle
            let accounts = tbSync.db.getAccounts();
            let idle = true;
            let err = false;
        
            for (let i=0; i<accounts.allIDs.length && idle; i++) {
              if (!accounts.IDs.includes(accounts.allIDs[i])) {
                err = true;
                continue;
              }
        
              //set idle to false, if at least one account is syncing
              if (tbSync.core.isSyncing(accounts.allIDs[i])) idle = false;
          
              //check for errors
              switch (tbSync.db.getAccountProperty(accounts.allIDs[i], "status")) {
                case "success":
                case "disabled":
                case "notsyncronized":
                case "nolightning":
                case "syncing":
                  break;
                default:
                  err = true;
              }
            }

            if (idle) {
              if (err) label += tbSync.getString("info.error");   
              else label += tbSync.getString("info.idle");   
            } else {
              label += tbSync.getString("info.sync");
            }
          } else {
            label += "Loading";
          }
          status.label = label;
        }
      }
    }
  },
  
  // observer to init sync
  initSyncObserver: {
    observe: function (aSubject, aTopic, aData) {
      if (tbSync.enabled) {
        tbSync.core.syncAllAccounts();
      } else {
        //tbSync.manager.popupNotEnabled();
      }
    }
  },    
}
