/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { tbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

/*
  The contact sidebar is loaded inside a browser element. That load is not seen by the windowlistener and thus overlays are not injected.
  The load is triggered/indicated by setting the src attribute of the browser -> mutation observer and delayed inject
*/

var tbSyncMessengerCompose = {

  onInject: function (window) {
    // Create the MutationObserver: try to inject after the src attribute of the sidebar browser has been changed, thus the URL has been loaded
    tbSyncMessengerCompose.mObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        tbSyncMessengerCompose.timer = window.setInterval(function(){    
          let targetWindow = window.document.getElementById("sidebar").contentWindow.wrappedJSObject;
          if (targetWindow) {
            window.clearInterval(tbSyncMessengerCompose.timer);
            tbSync.messenger.overlayManager.injectAllOverlays(targetWindow);
          }
        }, 1000);  
      });    
    });     
     
    tbSyncMessengerCompose.mObserver.observe(window.document.getElementById("sidebar"), { attributes: true, childList: false, characterData: false });
    
    // Add autoComplete for TbSync
    if (window.document.getElementById("addressCol2#1")) {
      let autocompletesearch = window.document.getElementById("addressCol2#1").getAttribute("autocompletesearch");
      if (autocompletesearch.indexOf("tbSyncAutoCompleteSearch") == -1) {
        window.document.getElementById("addressCol2#1").setAttribute("autocompletesearch", autocompletesearch + " tbSyncAutoCompleteSearch");
      }
    }    
  },

  onRemove: function (window) {
    let targetWindow = window.document.getElementById("sidebar").contentWindow.wrappedJSObject;
    tbSync.messenger.overlayManager.removeAllOverlays(targetWindow);
    tbSyncMessengerCompose.mObserver.disconnect();
    
    // Remove autoComplete for TbSync
    if (window.document.getElementById("addressCol2#1")) {
      let autocompletesearch = window.document.getElementById("addressCol2#1").getAttribute("autocompletesearch").replace("tbSyncAutoCompleteSearch", "");
      window.document.getElementById("addressCol2#1").setAttribute("autocompletesearch", autocompletesearch.trim());
    }
  }
}
