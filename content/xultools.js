"use strict";

var xultools = {

    getDataFromXULString: function (str) {
        let data = null;
        let xul = "";        
        if (str == "") {
            tbSync.dump("BAD XUL", "A provided XUL file is empty!");
            return null;
        }
        
        let oParser = Components.classes["@mozilla.org/xmlextras/domparser;1"].createInstance(Components.interfaces.nsIDOMParser);
        try {
            xul = oParser.parseFromString(str, "application/xml");
        } catch (e) {
            //however, domparser does not throw an error, it returns an error document
            //https://developer.mozilla.org/de/docs/Web/API/DOMParser
            //just in case
            tbSync.dump("BAD XUL", "A provided XUL file could not be parsed correctly, something is wrong.\n" + str);
            return null;
        }

        //check if xul is error document
        if (xul.documentElement.nodeName == "parsererror") {
            tbSync.dump("BAD XUL", "A provided XUL file could not be parsed correctly, something is wrong.\n" + str);
            return null;
        }
        
        if (xul.documentElement.nodeName != "overlay") {
            tbSync.dump("BAD XUL", "A provided XUL file does not look like an overlay (root node is not overlay).\n"+str);
            return null;
        }
        
        return xul.documentElement.children;
    },




    createXulElement: function (window, type, attributes) {
        let element = window.document.createElement(type);
        if  (attributes) {
            for  (let i=0; i <attributes.length; i++) {
                element.setAttribute(attributes[i].name, attributes[i].value);
                tbSync.dump("Adding", attributes[i].name + " = " + attributes[i].value);
            }
        }
        return element;
    },




    removeXulOverlay : function (window, nodes, parentElement = null) {
        //only scan toplevel elements and remove them
        let nodeList = [];
        if (nodes.length === undefined) nodeList.push(nodes);
        else nodeList = nodes;
        
        // nodelist contains all childs
        for (let node of nodeList) {
            let element = null;
            switch(node.nodeType) {
                case 1: 
                    tbSync.dump("Removing", node.nodeName);
                    if (node.hasAttribute("id")) {
                        let element = window.document.getElementById(node.getAttribute("id"));
                        if (element) {
                            tbSync.dump("OK!", node.nodeName);
                            element.parentNode.removeChild(element);
                        }
                    } 
                    break;
            }
        }
    },
    
    insertXulOverlay : function (window, nodes, parentElement = null) {
        /*
             The passed nodes value could be an entire document in a single node (type 9) or a 
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
            switch(node.nodeType) {
                case 1: 
                    // before processing this, check if it is top level element and if so, if it has insertafter or insertbefore AND those elements exist
                    let allOk = true;
                    let hookAfter = null;
                    let hookName = null;
                    let hookElement = null;
                    if (!parentElement && (node.hasAttribute("insertafter") || node.hasAttribute("insertbefore"))) {
                        hookAfter = node.hasAttribute("insertafter");
                        hookName = hookAfter ? node.getAttribute("insertafter") : node.getAttribute("insertbefore");
                        hookElement = window.document.getElementById(hookName);
                        allOk = hookElement ? true : false;
                    }
                    
                    if (allOk) {
                        tbSync.dump("Creating", node.nodeName);
                        element = tbSync.xultools.createXulElement(window, node.nodeName, node.attributes);
                        if (node.hasChildNodes) tbSync.xultools.insertXulOverlay(window, node.children, element);

                        if (parentElement) {
                            // this is a child level XUL element which needs to be added to to its parent
                            parentElement.appendChild(element);
                        } else {
                            // this is a toplevel element, which needs to be added at insertafter or insertbefore
                            tbSync.dump("ADD XUL", node.nodeName + " <" + element.id + ">");
                            if (hookAfter) hookElement.parentNode.insertBefore(element, hookElement.nextSibling);
                            else  hookElement.parentNode.insertBefore(element, hookElement);
                        }
                    } else {
                        tbSync.dump("BAD XUL", "Top level overlay element <"+ node.nodeName+"> does not have attribute insertbefore or insertafter, or the specified element does not exist. Skipped");
                    }                    
                    break;
            }
        }
    }
    
};
