"use strict";

var EXPORTED_SYMBOLS = ["OverlayManager"];

Components.utils.import("resource://gre/modules/NetUtil.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/Task.jsm");

function OverlayManager(addonData) {
    this.addonData = addonData;
    this.registeredOverlays = {};
    this.overlays =  {};
    this.decoder = new TextDecoder();
        
    this.hasRegisteredOverlays = function (window) {
        return this.registeredOverlays.hasOwnProperty(window.location.href);
    };

    this.registerOverlay = Task.async (function* (dst, overlay) {
        if (!this.registeredOverlays[dst]) this.registeredOverlays[dst] = [];
        this.registeredOverlays[dst].push(overlay);

        let xul = yield this.fetchFile(overlay, "String");
	    //let xuldata = yield OS.File.read(this.addonData.installPath.path + overlay);        
        //let xul = this.decoder.decode(xuldata);
        
        this.overlays[overlay] = xul;
    });  

    this.injectAllOverlays = function (window) {
        for (let i=0; i < this.registeredOverlays[window.location.href].length; i++) {
            window.console.log("Injecting:", this.registeredOverlays[window.location.href][i]);

            let overlayNode = this.getDataFromXULString(this.overlays[this.registeredOverlays[window.location.href][i]]);

            //get and load scripts
            let scripts = this.getScripts(overlayNode.children);
            for (let i=0; i < scripts.length; i++){
                window.console.log("Loading", scripts[i]);
                Services.scriptloader.loadSubScript(scripts[i], window);
            }

            //eval onbeforeinject, if that returns false, inject is aborted
            let inject = true;
            if (overlayNode.hasAttribute("onbeforeinject")) {
                let onbeforeinject = overlayNode.getAttribute("onbeforeinject");
                window.console.log("Executing", onbeforeinject);
                inject = window.eval(onbeforeinject);
            }

            if (inject) {
                this.insertXulOverlay(window, overlayNode.children);
                //execute oninject
                if (overlayNode.hasAttribute("oninject")) {
                    let oninject = overlayNode.getAttribute("oninject");
                    window.console.log("Executing", oninject);
                    // the source for this eval is part of this XPI, cannot be changed by user. If I do not mess things up, this does not impose a security issue
                    window.eval(oninject);
                }
            }
        }
    };
    
    this.removeAllOverlays = function (window) {
        for (let i=0; i < this.registeredOverlays[window.location.href].length; i++) {
            window.console.log("Removing:", this.registeredOverlays[window.location.href][i]);
            
            let overlayNode = this.getDataFromXULString(this.overlays[this.registeredOverlays[window.location.href][i]]);

            if (overlayNode.hasAttribute("onremove")) {
                let onremove = overlayNode.getAttribute("onremove");
                window.console.log("Executing", onremove);
                // the source for this eval is part of this XPI, cannot be changed by user. If I do not mess things up, this does not impose a security issue
                window.eval(onremove);
            }

            this.removeXulOverlay(window, overlayNode.children);
        }
    };

    this.getDataFromXULString = function (str) {
        let data = null;
        let xul = "";        
        if (str == "") {
            throw "BAD XUL: A provided XUL file is empty!";
        }
        
        let oParser = Components.classes["@mozilla.org/xmlextras/domparser;1"].createInstance(Components.interfaces.nsIDOMParser); //TB61 new DOMParser(); //
        try {
            xul = oParser.parseFromString(str, "application/xml");
        } catch (e) {
            //however, domparser does not throw an error, it returns an error document
            //https://developer.mozilla.org/de/docs/Web/API/DOMParser
            //just in case
            throw "BAD XUL: A provided XUL file could not be parsed correctly, something is wrong.\n" + str;
        }

        //check if xul is error document
        if (xul.documentElement.nodeName == "parsererror") {
            throw "BAD XUL: A provided XUL file could not be parsed correctly, something is wrong.\n" + str;
        }
        
        if (xul.documentElement.nodeName != "overlay") {
            throw "BAD XUL: A provided XUL file does not look like an overlay (root node is not overlay).\n" + str;
        }
        
        return xul.documentElement;
    };


    this.createXulElement = function (window, node) {
        //check for namespace
        let typedef = node.nodeName.split(":");
        if (typedef.length == 2) typedef[0] = node.lookupNamespaceURI(typedef[0]);
        
        let element = (typedef.length==2) ? window.document.createElementNS(typedef[0], typedef[1]) : window.document.createElement(typedef[0]);
        if  (node.attributes) {
            for  (let i=0; i <node.attributes.length; i++) {
                element.setAttribute(node.attributes[i].name, node.attributes[i].value);
            }
        }
        return element;
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

            if (node.nodeName == "script") {
                // ignore script tags
            } else if (node.nodeName == "toolbarpalette") {
                // handle toolbarpalette tags
            } else if (node.nodeType == 1) {

                if (!parentElement) {
                    if (node.hasAttribute("appendto")) hookMode = "appendto";
                    if (node.hasAttribute("insertbefore")) hookMode ="insertbefore";
                    if (node.hasAttribute("insertafter")) hookMode = "insertafter";
                    hookName = node.getAttribute(hookMode);
                    hookElement = window.document.getElementById(hookName);
                    
                    if (!hookElement) {
                        window.console.log("BAD XUL", "The hook element <"+hookName+"> of top level overlay element <"+ node.nodeName+"> does not exist. Skipped");
                        continue;
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
                            window.console.log("BAD XUL", "Top level overlay element <"+ node.nodeName+"> uses unknown hook type <"+hookMode+">. Skipped.");
                            continue;
                    }
                    window.console.log("Adding <"+element.id+"> ("+window.document.getElementById(element.id).tagName+")  " + hookMode + " <" + hookName + ">");
                }                
            }            
        }
    };

    this.getScripts = function (nodes) {
        /*
             The passed nodes value could be an entire window.document in a single node (type 9) or a 
             single element node (type 1) as returned by getElementById. It could however also 
             be an array of nodes as returned by getElementsByTagName or a nodeList as returned
             by childNodes. In that case node.length is defined.
         */
        let nodeList = [];
        if (nodes.length === undefined) nodeList.push(nodes);
        else nodeList = nodes;

        //collect all toplevel scripts and execute at the end
        let scripts = [];
        
        // nodelist contains all childs
        for (let node of nodeList) {

            if (node.nodeName == "script") {
                // handle script tags
                switch (node.getAttribute("type")) {
                    case "text/javascript":
                    case "application/javascript":
                        if (node.hasAttribute("src")) scripts.push(node.getAttribute("src"));
                        break;
                }
            }
        }
        
        return scripts;
    };

    //read file from within the XPI package
    this.fetchFile = function (aURL, returnType = "Array") {
        return new Promise((resolve, reject) => {
            let uri = Services.io.newURI(aURL);
            let channel = Services.io.newChannelFromURI2(uri,
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
                    if (returnType == "Array") {
                        resolve(data.replace("\r","").split("\n"))
                    } else {
                        resolve(data);
                    }
                } catch (ex) {
                    reject(ex);
                }
            });
        });
    };
        
}
