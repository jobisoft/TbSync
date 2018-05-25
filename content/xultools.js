"use strict";

var xultools = {

    registeredOverlays: {},
    overlays: {},

    hasRegisteredOverlays: function (window) {
        return xultools.registeredOverlays.hasOwnProperty(window.location.href);
    },

    injectAllOverlays: function (window) {
        for (let i=0; i < xultools.registeredOverlays[window.location.href].length; i++) {
            window.console.log("Injecting:", xultools.registeredOverlays[window.location.href][i]);
            xultools.insertXulOverlay(window, xultools.overlays[xultools.registeredOverlays[window.location.href][i]]);
        }
    },
    
    removeAllOverlays: function (window) {
        for (let i=0; i < xultools.registeredOverlays[window.location.href].length; i++) {
            window.console.log("Removing:", xultools.registeredOverlays[window.location.href][i]);
            xultools.removeXulOverlay(window, xultools.overlays[xultools.registeredOverlays[window.location.href][i]]);
        }
    },

    registerOverlay: Task.async (function* (dst, overlay) {
        if (!xultools.registeredOverlays[dst]) xultools.registeredOverlays[dst] = [];
        xultools.registeredOverlays[dst].push(overlay);

        //let xul = yield tbSync.fetchFile(overlay, "String");
	    let xuldata = yield OS.File.read(tbSync.addonData.installPath.path + overlay);
        
        let decoder = new TextDecoder();        // This decoder can be reused for several reads
        let xul = decoder.decode(xuldata);
        
        tbSync.dump(tbSync.addonData.installPath.path + overlay, xul);
        xultools.overlays[overlay] = xultools.getDataFromXULString(xul);
        tbSync.window.console.log("Found", xultools.overlays[overlay].length);
    }),  
	
    getDataFromXULString: function (str) {
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
        
        return xul.documentElement.children;
    },


    createXulElement: function (window, node) {
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
    },


    removeXulOverlay: function (window, nodes, parentElement = null) {
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
    },
    

    insertXulOverlay: function (window, nodes, parentElement = null) {
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
                // handle script tags
                switch (node.getAttribute("type")) {
                    case "text/javascript":
                    case "application/javascript":
                        window.console.log("src: ", node.getAttribute("src"));
                        Services.scriptloader.loadSubScript(node.getAttribute("src"), window);
                        break;
                }
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
                
                element = xultools.createXulElement(window, node);
                if (node.hasChildNodes) xultools.insertXulOverlay(window, node.children, element);

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
    }
    
};
