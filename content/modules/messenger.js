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
    this.overlayManager = new OverlayManager(TbSync.extension, {verbose: 0});
    await this.overlayManager.registerOverlay("chrome://messenger/content/messenger.xhtml", "chrome://tbsync/content/overlays/messenger.xhtml");
    Services.obs.addObserver(this.initSyncObserver, "tbsync.observer.sync", false);
    Services.obs.addObserver(this.syncstateObserver, "tbsync.observer.manager.updateSyncstate", false);

    //inject overlays
    this.overlayManager.startObserving();

  },

  unload: async function () {
    //unload overlays
    this.overlayManager.stopObserving();

    Services.obs.removeObserver(this.initSyncObserver, "tbsync.observer.sync");
    Services.obs.removeObserver(this.syncstateObserver, "tbsync.observer.manager.updateSyncstate");
  },

  // observer to catch changing syncstate and to update the status bar.
  syncstateObserver: {
    observe: function (aSubject, aTopic, aData) {
      //update status bar in all main windows
      let windows = Services.wm.getEnumerator("mail:3pane");
      while (windows.hasMoreElements()) {
        let domWindow = windows.getNext();
        if (TbSync) {
          let status = domWindow.document.getElementById("tbsync.status");
          if (status) {
            let label = "TbSync: ";
            
            if (TbSync.enabled) {

              //check if any account is syncing, if not switch to idle
              let accounts = TbSync.db.getAccounts();
              let idle = true;
              let err = false;
          
              for (let i=0; i<accounts.allIDs.length && idle; i++) {
                if (!accounts.IDs.includes(accounts.allIDs[i])) {
                  err = true;
                  continue;
                }
          
                //set idle to false, if at least one account is syncing
                if (TbSync.core.isSyncing(accounts.allIDs[i])) idle = false;
            
                //check for errors
                switch (TbSync.db.getAccountProperty(accounts.allIDs[i], "status")) {
                  case "success":
                  case "disabled":
                  case "notsyncronized":
                  case "syncing":
                    break;
                  default:
                    err = true;
                }
              }

              if (idle) {
                if (err) label += TbSync.getString("info.error");   
                else label += TbSync.getString("info.idle");   
              } else {
                label += TbSync.getString("status.syncing");
              }
            } else {
              label += "Loading";
            }
            status.value = label;
          }
        }
      }
    }
  },
  
  // observer to init sync
  initSyncObserver: {
    observe: function (aSubject, aTopic, aData) {
      if (TbSync.enabled) {
        TbSync.core.syncAllAccounts();
      } else {
        //TbSync.manager.popupNotEnabled();
      }
    }
  },    
}
