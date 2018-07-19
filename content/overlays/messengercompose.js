/*
 * This file is part of TbSync.
 *
 * TbSync is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * TbSync is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with TbSync. If not, see <https://www.gnu.org/licenses/>.
 */
 
 "use strict";

Components.utils.import("resource://gre/modules/Task.jsm");

/*
    The contact sidebar is loaded inside a browser element. That load is not seen by the windowlistener and thus overlays are not injected.
    The load is triggered/indicated by setting the src attribute of the browser -> mutation observer and delayed inject
*/

tbSync.onInjectIntoMessengerCompose = function (window) {
    // Create the MutationObserver: try to inject after the src attribute of the sidebar browser has been changed, thus the URL has been loaded
    tbSync.messengerComposeObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
          tbSync.messengerComposeObserverTimer = window.setInterval(function(){    
                let targetWindow = window.document.getElementById("sidebar").contentWindow.wrappedJSObject;
                if (targetWindow) {
                    window.clearInterval(tbSync.messengerComposeObserverTimer);
                    if (tbSync.overlayManager.hasRegisteredOverlays(targetWindow)) {
                        targetWindow.tbSync = tbSync;
                        tbSync.overlayManager.injectAllOverlays(targetWindow);
                    }                        
                }
            }, 1000);  
      });    
    });     
     
    tbSync.messengerComposeObserver.observe(window.document.getElementById("sidebar"), { attributes: true, childList: false, characterData: false });
    
    // Add autoComplete for TbSync
    if (window.document.getElementById("addressCol2#1")) {
        let autocompletesearch = window.document.getElementById("addressCol2#1").getAttribute("autocompletesearch");
        if (autocompletesearch.indexOf("tbSyncAutoCompleteSearch") == -1) {
            window.document.getElementById("addressCol2#1").setAttribute("autocompletesearch", autocompletesearch + " tbSyncAutoCompleteSearch");
        }
    }    
}

tbSync.onRemoveFromMessengerCompose = function (window) {
    let targetWindow = window.document.getElementById("sidebar").contentWindow.wrappedJSObject;
    if (tbSync.overlayManager.hasRegisteredOverlays(targetWindow)) {
        tbSync.overlayManager.removeAllOverlays(targetWindow);
    }                        
    tbSync.messengerComposeObserver.disconnect();
    
    // Remove autoComplete for TbSync
    if (window.document.getElementById("addressCol2#1")) {
        let autocompletesearch = window.document.getElementById("addressCol2#1").getAttribute("autocompletesearch").replace("tbSyncAutoCompleteSearch", "");
        window.document.getElementById("addressCol2#1").setAttribute("autocompletesearch", autocompletesearch.trim());
    }
}
