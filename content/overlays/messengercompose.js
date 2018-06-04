Components.utils.import("resource://gre/modules/Task.jsm");

/*
    The contact sidebar is loaded inside a browser element. That load is not seen by the windowlistener and thus overlays are not injected.
    The load is triggered/indicated by setting the src attribute of the browser -> mutation observer and delayed inject
*/

tbSync.onInjectIntoMessengerCompose = function (window) {
    // create the MutationObserver: try to inject after the src attribute of the sidebar browser has been changed, thus the URL has been loaded
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
}

tbSync.onRemoveFromMessengerCompose = function (window) {
    let targetWindow = window.document.getElementById("sidebar").contentWindow.wrappedJSObject;
    if (tbSync.overlayManager.hasRegisteredOverlays(targetWindow)) {
        tbSync.overlayManager.removeAllOverlays(targetWindow);
    }                        
    tbSync.messengerComposeObserver.disconnect();
}
