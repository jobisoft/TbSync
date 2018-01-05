"use strict";

var xmltools = {

    isString : function (obj) {
        return (Object.prototype.toString.call(obj) === '[object String]');
    },
        
    checkString : function(d) {
        if (this.isString(d)) return d;
        else return "";
    },	    
        
    nodeAsArray : function (node) {
        let a = [];
        if (node) {
            //return, if already an array
            if (node instanceof Array) return node;

            //else push node into an array
            a.push(node);
        }
        return a;
    },

    getWbxmlDataField: function(wbxmlData,path) {
    if (wbxmlData) {		
        let pathElements = path.split(".");
        let data = wbxmlData;
        let valid = true;
        for (let x = 0; valid && x < pathElements.length; x++) {
            if (data[pathElements[x]]) data = data[pathElements[x]];
            else valid = false;
        }
        if (valid) return data;
    }
    return false
    },

    //print content of xml data object (if debug output enabled)
    printXmlData : function (data, lvl = 0) {
        if ((tbSync.prefSettings.getBoolPref("log.toconsole") || tbSync.prefSettings.getBoolPref("log.tofile")) && tbSync.prefSettings.getBoolPref("log.easdata")) {
            let dump = "";
            for (let d in data) {
                if (typeof(data[d]) == "object") {
                    dump = dump + " ".repeat(lvl) + d + " => \n" + this.printXmlData(data[d], lvl+1);
                    dump = dump + " ".repeat(lvl) + d + " <= \n";
                } else {
                    dump = dump + " ".repeat(lvl) + d + " = [" + data[d] + "]\n";
                }
            }
            if (lvl == 0) tbSync.dump("Extracted XML data", "\n" + dump);
            else return dump;
        }
    },

    getDataFromXMLString: function (str) {
        let data = null;
        let xml = "";        
        if (str == "") return data;
        
        let oParser = Components.classes["@mozilla.org/xmlextras/domparser;1"].createInstance(Components.interfaces.nsIDOMParser);
        try {
            xml = oParser.parseFromString(str, "application/xml");
        } catch (e) {
            //however, domparser does not throw an error, it returns an error document
            //https://developer.mozilla.org/de/docs/Web/API/DOMParser
            //just in case
            throw eas.finishSync("mailformed-xml", eas.flags.abortWithError);
        }

        //check if xml is error document
        if (xml.documentElement.nodeName == "parsererror") {
            tbSync.dump("BAD XML",str);
            throw eas.finishSync("mailformed-xml", eas.flags.abortWithError);
        }

        try {
            data = this.getDataFromXML(xml);
        } catch (e) {
            throw eas.finishSync("mailformed-data", eas.flags.abortWithError);
        }
        
        return data;
    },
    
    //create data object from XML node
    getDataFromXML : function (nodes) {
        
        /*
         * The passed nodes value could be an entire document in a single node (type 9) or a 
         * single element node (type 1) as returned by getElementById. It could however also 
         * be an array of nodes as returned by getElementsByTagName or a nodeList as returned
         * by childNodes. In that case node.length is defined.
         */        
        
        // create the return object
        let obj = {};
        let nodeList = [];
        let multiplicity = {};
        
        if (nodes.length === undefined) nodeList.push(nodes);
        else nodeList = nodes;
        
        // nodelist contains all childs, if two childs have the same name, we cannot add the chils as an object, but as an array of objects
        for (let node of nodeList) { 
            if (node.nodeType == 1 || node.nodeType == 3) {
                if (!multiplicity.hasOwnProperty(node.nodeName)) multiplicity[node.nodeName] = 0;
                multiplicity[node.nodeName]++;
                //if this nodeName has multiplicity > 1, prepare obj  (but only once)
                if (multiplicity[node.nodeName]==2) obj[node.nodeName] = [];
            }
        }

        // process nodes
        for (let node of nodeList) { 
            switch (node.nodeType) {
                case 9: 
                    //document node, dive directly and process all children
                    if (node.hasChildNodes) obj = this.getDataFromXML(node.childNodes);
                    break;
                case 1: 
                    //element node
                    if (node.hasChildNodes) {
                        //if this is an element with only one text child, do not dive, but get text childs value
                        let o;
                        if (node.childNodes.length == 1 && node.childNodes.item(0).nodeType==3) {
                            o = node.childNodes.item(0).nodeValue;
                        } else {
                            o = this.getDataFromXML(node.childNodes);
                        }
                        //check, if we can add the object directly, or if we have to push it into an array
                        if (multiplicity[node.nodeName]>1) obj[node.nodeName].push(o)
                        else obj[node.nodeName] = o; 
                    }
                    break;
            }
        }
        return obj;
    }
    
};
