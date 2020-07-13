/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var EXPORTED_SYMBOLS = ["OverlayManager"];

var { NetUtil } = ChromeUtils.import("resource://gre/modules/NetUtil.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

function OverlayManager(extension, options = {}) {
  this.registeredOverlays = {};
  this.overlays =  {};
  this.stylesheets = {};
  this.options = {verbose: 0};
  this.extension = extension;
  
  let userOptions = Object.keys(options);
  for (let i=0; i < userOptions.length; i++) {
    this.options[userOptions[i]] = options[userOptions[i]];
  }



  this.windowListener = {
    that: this,
    onOpenWindow: function(xulWindow) {
      let window = xulWindow.QueryInterface(Components.interfaces.nsIInterfaceRequestor).getInterface(Components.interfaces.nsIDOMWindow);
      this.that.injectAllOverlays(window);
    },
    onCloseWindow: function(xulWindow) { },
    onWindowTitleChange: function(xulWindow, newTitle) { }
  };

  


  this.startObserving = function () {
    let windows = Services.wm.getEnumerator(null);
    while (windows.hasMoreElements()) {
      let window = windows.getNext();
      //inject overlays for this window
      this.injectAllOverlays(window);
    }

    Services.wm.addListener(this.windowListener);
  };

  this.stopObserving = function () {
    Services.wm.removeListener(this.windowListener);

    let  windows = Services.wm.getEnumerator(null);
    while (windows.hasMoreElements()) {
      let window = windows.getNext();            
      //remove overlays (if any)
      this.removeAllOverlays(window);
    }
  };

  this.hasRegisteredOverlays = function (window) {
    return this.registeredOverlays.hasOwnProperty(window.location.href);
  };

  this.registerOverlay = async function (dst, overlay) {
    if (overlay.startsWith("chrome://")) {
      let xul = null;
      try {
        xul = await this.readChromeFile(overlay);
      } catch (e) {
        console.log("Error reading file <"+overlay+"> : " + e);
        return;
      }
      let rootNode = this.getDataFromXULString(xul);
  
      if (rootNode) {
        //get urls of stylesheets to load them
        let styleSheetUrls = this.getStyleSheetUrls(rootNode);
        for (let i=0; i<styleSheetUrls.length; i++) {
        //we must replace, since we do not know, if it changed - could have been an update
        //if (!this.stylesheets.hasOwnProperty(styleSheetUrls[i])) {
          this.stylesheets[styleSheetUrls[i]] = await this.readChromeFile(styleSheetUrls[i]);
        //}
        }
        
        if (!this.registeredOverlays[dst]) this.registeredOverlays[dst] = [];
        if (!this.registeredOverlays[dst].includes(overlay)) this.registeredOverlays[dst].push(overlay);
        
        this.overlays[overlay] = rootNode;
      }
    } else {
      console.log("Only chrome:// URIs can be registered as overlays.");
    }
  };  

  this.getDataFromXULString = function (str) {
    let data = null;
    let xul = "";        
    if (str == "") {
      if (this.options.verbose>1) Services.console.logStringMessage("[OverlayManager] BAD XUL: A provided XUL file is empty!");
      return null;
    }

    let oParser = new DOMParser();
    try {
      xul = oParser.parseFromString(str, "application/xml");
    } catch (e) {
      //however, domparser does not throw an error, it returns an error document
      //https://developer.mozilla.org/de/docs/Web/API/DOMParser
      //just in case
      if (this.options.verbose>1) Services.console.logStringMessage("[OverlayManager] BAD XUL: A provided XUL file could not be parsed correctly, something is wrong.\n" + str);
      return null;
    }

    //check if xul is error document
    if (xul.documentElement.nodeName == "parsererror") {
      if (this.options.verbose>1) Services.console.logStringMessage("[OverlayManager] BAD XUL: A provided XUL file could not be parsed correctly, something is wrong.\n" + str);
      return null;
    }
    
    if (xul.documentElement.nodeName != "overlay") {
      if (this.options.verbose>1) Services.console.logStringMessage("[OverlayManager] BAD XUL: A provided XUL file does not look like an overlay (root node is not overlay).\n" + str);
      return null;
    }
    
    return xul;
  };





  this.injectAllOverlays = async function (window, _href = null) {
    if (window.document.readyState != "complete") {
      // Make sure the window load has completed.
      await new Promise(resolve => {
      window.addEventListener("load", resolve, { once: true });
      });
    }

    let href = (_href === null) ? window.location.href : _href;   
    if (this.options.verbose>1) Services.console.logStringMessage("[OverlayManager] Injecting into new window: " + href);
    let injectCount = 0;
    for (let i=0; this.registeredOverlays[href] && i < this.registeredOverlays[href].length; i++) {
      if (this.injectOverlay(window, this.registeredOverlays[href][i])) injectCount++;
    }
    if (injectCount > 0) {
        // dispatch a custom event to indicate we finished loading the overlay
        let event = new Event("DOMOverlayLoaded_" + this.extension.id);
        window.document.dispatchEvent(event);
    }
  };

  this.removeAllOverlays = function (window) {
    if (!this.hasRegisteredOverlays(window))
      return;
    
    for (let i=0; i < this.registeredOverlays[window.location.href].length; i++) {            
      this.removeOverlay(window, this.registeredOverlays[window.location.href][i]);
    }        
  };




  this.injectOverlay = function (window, overlay) {
    if (!window.hasOwnProperty("injectedOverlays")) window.injectedOverlays = [];

    if (window.injectedOverlays.includes(overlay)) {
      if (this.options.verbose>2) Services.console.logStringMessage("[OverlayManager] NOT Injecting: " + overlay);
      return false;
    }            

    let rootNode = this.overlays[overlay];

    if (rootNode) {
      let overlayNode = rootNode.documentElement;
      if (overlayNode) {
        //get and load scripts
        let scripts = this.getScripts(rootNode, overlayNode);
        for (let i=0; i < scripts.length; i++){
          if (this.options.verbose>3) Services.console.logStringMessage("[OverlayManager] Loading: " + scripts[i]);
          try {
            Services.scriptloader.loadSubScript(scripts[i], window);
          } catch (e) {
            Components.utils.reportError(e);          
          }
        }
        
        let omscopename = overlayNode.hasAttribute("omscope") ? overlayNode.getAttribute("omscope") : null;
        let omscope = omscopename ? window[omscopename] : window;

        let inject = true;
        if (omscope.hasOwnProperty("onBeforeInject")) {
          if (this.options.verbose>3) Services.console.logStringMessage("[OverlayManager] Executing " + (omscopename ? omscopename : "window") + ".onBeforeInject()");
          try {
            inject = omscope.onBeforeInject(window);
          } catch (e) {
            Components.utils.reportError(e);          
          }
        }

        if (inject) {
          if (this.options.verbose>2) Services.console.logStringMessage("[OverlayManager] Injecting: " + overlay);
          window.injectedOverlays.push(overlay);
          
          //get urls of stylesheets to add preloaded files
          let styleSheetUrls = this.getStyleSheetUrls(rootNode);
          for (let i=0; i<styleSheetUrls.length; i++) {
            let namespace = overlayNode.lookupNamespaceURI("html");
            let element = window.document.createElementNS(namespace, "style");
            element.id = styleSheetUrls[i];
            element.textContent = this.stylesheets[styleSheetUrls[i]];
            window.document.documentElement.appendChild(element);
            if (this.options.verbose>3) Services.console.logStringMessage("[OverlayManager] Stylesheet: " + styleSheetUrls[i]);
          }                        

          this.insertXulOverlay(window, overlayNode.children);
          if (omscope.hasOwnProperty("onInject")) {
            if (this.options.verbose>3) Services.console.logStringMessage("[OverlayManager] Executing " + (omscopename ? omscopename : "window") + ".onInject()");
            try {
              omscope.onInject(window);
            } catch (e) {
              Components.utils.reportError(e);          
            }
          }
          
          // add to injectCounter
          return true;
        }
      }
    }

    // nothing injected, do not add to inject counter
    return false;
  };

  this.removeOverlay = function (window, overlay) {
    if (!window.hasOwnProperty("injectedOverlays")) window.injectedOverlays = [];

    if (!window.injectedOverlays.includes(overlay)) {
      if (this.options.verbose>2) Services.console.logStringMessage("[OverlayManager] NOT Removing: " + overlay);
      return;
    }

    if (this.options.verbose>2) Services.console.logStringMessage("[OverlayManager] Removing: " + overlay);
    window.injectedOverlays = window.injectedOverlays.filter(e => (e != overlay));
    
    let rootNode = this.overlays[overlay];
    if (rootNode) {
      let overlayNode = rootNode.documentElement;
      if (overlayNode) {
        let omscopename = overlayNode.hasAttribute("omscope") ? overlayNode.getAttribute("omscope") : null;
        let omscope = omscopename ? window[omscopename] : window;
        
        if (omscope.hasOwnProperty("onRemove")) {
          if (this.options.verbose>3) Services.console.logStringMessage("[OverlayManager] Executing " + (omscopename ? omscopename : "window") + ".onRemove()");
          try {
            omscope.onRemove(window);
          } catch (e) {
            Components.utils.reportError(e);          
          }
        }

        this.removeXulOverlay(window, overlayNode.children);
      }
      
      //get urls of stylesheets to remove styte tag
      let styleSheetUrls = this.getStyleSheetUrls(rootNode);
      for (let i=0; i<styleSheetUrls.length; i++) {
        let element = window.document.getElementById(styleSheetUrls[i]);
        if (element) {
          element.parentNode.removeChild(element);
        }
      }
    }
  };
  










  this.getStyleSheetUrls = function (rootNode) {
    let sheetsIterator = rootNode.evaluate("processing-instruction('xml-stylesheet')", rootNode, null, 0, null); //PathResult.ANY_TYPE = 0
    let urls = [];
    
    let sheet;
    while (sheet = sheetsIterator.iterateNext()) { //returns object XMLStylesheetProcessingInstruction]
      let attr=sheet.data.split(" ");
      for (let a=0; a < attr.length; a++) {
        if (attr[a].startsWith("href=")) urls.push(attr[a].substring(6,attr[a].length-1));
      }
    }
    return urls;
  };
  
  this.getScripts = function(rootNode, overlayNode) {
    let nodeIterator = rootNode.evaluate("./script", overlayNode, null, 0, null); //PathResult.ANY_TYPE = 0
    let scripts = [];

    let node;
    while (node = nodeIterator.iterateNext()) {
      if (node.hasAttribute("src") && node.hasAttribute("type") && node.getAttribute("type").toLowerCase().includes("javascript")) {
        scripts.push(node.getAttribute("src"));
      }
    } 
    return scripts;
  };










  this.createXulElement = function (window, node, forcedNodeName = null) {
    //check for namespace
    let typedef = forcedNodeName ? forcedNodeName.split(":") : node.nodeName.split(":");
    if (typedef.length == 2) typedef[0] = node.lookupNamespaceURI(typedef[0]);
    
    let CE = {}
    if (node.attributes && node.attributes.getNamedItem("is")) {
      for  (let i=0; i <node.attributes.length; i++) {
        if (node.attributes[i].name == "is") {
          CE = { "is" : node.attributes[i].value };
          break;
        }
      }
    }

    let element = (typedef.length==2) ? window.document.createElementNS(typedef[0], typedef[1]) : window.document.createXULElement(typedef[0], CE);
    if  (node.attributes) {
      for  (let i=0; i <node.attributes.length; i++) {
        element.setAttribute(node.attributes[i].name, node.attributes[i].value);
      }
    }

    //add text child nodes as textContent
    if (node.hasChildNodes) {
      let textContent = "";
      for (let child of node.childNodes) {
        if (child.nodeType == "3") {
          textContent += child.nodeValue;
        }
      }
      if (textContent) element.textContent = textContent
    }

    return element;
  };

  this.insertXulOverlay = function (window, nodes, parentElement = null) {
    /*
       The passed nodes value could be an entire window.document in a single node (type 9) or a 
       single element node (type 1) as returned by getElementById. It could however also 
       be an array of nodes as returned by getElementsByTagName or a nodeList as returned
       by childNodes. In that case node.length is defined.
     */
    let nodeList = [];
    if (nodes.length === undefined) nodeList.push(nodes);
    else nodeList = nodes;
    
    // nodelist contains all childs
    for (let node of nodeList) {
      let element = null;
      let hookMode = null;
      let hookName = null;
      let hookElement = null;
      
      if (node.nodeName == "script" && node.hasAttribute("src")) {
        //skip, since they are handled by getScripts()
      } else if (node.nodeType == 1) {

        if (!parentElement) { //misleading: if it does not have a parentElement, it is a top level element
          //Adding top level elements without id is not allowed, because we need to be able to remove them!
          if (!node.hasAttribute("id")) {
            if (this.options.verbose>1) Services.console.logStringMessage("[OverlayManager] BAD XUL: A top level <" + node.nodeName+ "> element does not have an ID. Skipped");
            continue;
          }

          //check for inline script tags
          if (node.nodeName == "script") {
            let element = this.createXulElement(window, node, "html:script"); //force as html:script
            window.document.documentElement.appendChild(element);
            continue;                        
          }
          
          //check for inline style
          if (node.nodeName == "style") {
            let element = this.createXulElement(window, node, "html:style"); //force as html:style
            window.document.documentElement.appendChild(element);
            continue;
          }
          
          if (node.hasAttribute("appendto")) hookMode = "appendto";
          if (node.hasAttribute("insertbefore")) hookMode ="insertbefore";
          if (node.hasAttribute("insertafter")) hookMode = "insertafter";
          
          if (hookMode) {
            hookName = node.getAttribute(hookMode);
            hookElement = window.document.getElementById(hookName);
          
            if (!hookElement) {
              if (this.options.verbose>1) Services.console.logStringMessage("[OverlayManager] BAD XUL: The hook element <"+hookName+"> of top level overlay element <"+ node.nodeName+"> does not exist. Skipped");
              continue;
            }
          } else {
            hookMode = "appendto";
            hookName = "ROOT";
            hookElement = window.document.documentElement;
          }                    
        }
        
        element = this.createXulElement(window, node);
        if (node.hasChildNodes) this.insertXulOverlay(window, node.children, element);

        if (parentElement) {
          // this is a child level XUL element which needs to be added to to its parent
          parentElement.appendChild(element);
        } else {
          // this is a toplevel element, which needs to be added at insertafter or insertbefore
          switch (hookMode) {
            case "appendto": 
              hookElement.appendChild(element);
              break;
            case "insertbefore":
              hookElement.parentNode.insertBefore(element, hookElement);
              break;
            case "insertafter":
              hookElement.parentNode.insertBefore(element, hookElement.nextSibling);
              break;
            default:
              if (this.options.verbose>1) Services.console.logStringMessage("[OverlayManager] BAD XUL: Top level overlay element <"+ node.nodeName+"> uses unknown hook type <"+hookMode+">. Skipped.");
              continue;
          }
          if (this.options.verbose>3) Services.console.logStringMessage("[OverlayManager] Adding <"+element.id+"> ("+element.tagName+")  " + hookMode + " <" + hookName + ">");
        }                
      }            
    }
  };

  this.removeXulOverlay = function (window, nodes, parentElement = null) {
    //only scan toplevel elements and remove them
    let nodeList = [];
    if (nodes.length === undefined) nodeList.push(nodes);
    else nodeList = nodes;
    
    // nodelist contains all childs
    for (let node of nodeList) {
      let element = null;
      switch(node.nodeType) {
        case 1: 
          if (node.hasAttribute("id")) {
            let element = window.document.getElementById(node.getAttribute("id"));
            if (element) {
              element.parentNode.removeChild(element);
            }
          } 
          break;
      }
    }
  };










  //read file from within the XPI package
  this.readChromeFile = function (aURL) {
    if (this.options.verbose>3) Services.console.logStringMessage("[OverlayManager] Reading file: " + aURL);
    return new Promise((resolve, reject) => {
      let uri = Services.io.newURI(aURL);
      let channel = Services.io.newChannelFromURI(uri,
                 null,
                 Services.scriptSecurityManager.getSystemPrincipal(),
                 null,
                 Components.interfaces.nsILoadInfo.SEC_REQUIRE_SAME_ORIGIN_DATA_INHERITS,
                 Components.interfaces.nsIContentPolicy.TYPE_OTHER);

      NetUtil.asyncFetch(channel, (inputStream, status) => {
        if (!Components.isSuccessCode(status)) {
          reject(status);
          return;
        }

        try {
          let data = NetUtil.readInputStreamToString(inputStream, inputStream.available());
          resolve(data);
        } catch (ex) {
          reject(ex);
        }
      });
    });
  };
    
}
