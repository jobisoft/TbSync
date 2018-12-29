/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

var tbSyncErrorLog = {
    
    onload: function () {
        Services.obs.addObserver(tbSyncErrorLog.updateErrorLog, "tbSyncErrorLog.update", false);

        let errorlog = document.getElementById('tbsync.errorlog');
        errorlog.hidden = true;
        
        //init list
        for (let i=0; i < tbSync.errors.length; i++) {
            let item = tbSyncErrorLog.addLogEntry(tbSync.errors[i]);
            errorlog.appendChild(item);
        }

        errorlog.hidden = false;
        errorlog.ensureIndexIsVisible(errorlog.getRowCount()-1);
        document.documentElement.getButton("extra1").onclick = tbSyncErrorLog.onclear;

    },

    onclear: function () {
        tbSync.errors = [];

        let errorlog = document.getElementById('tbsync.errorlog');
        errorlog.hidden = true;

        for (let i=errorlog.getRowCount()-1; i>=0; i--) {
            errorlog.removeItemAt(i);
        }
        
        errorlog.hidden = false;
    },
    
    onunload: function () {
        Services.obs.removeObserver(tbSyncErrorLog.updateErrorLog, "tbSyncErrorLog.update");
    },

    updateErrorLog: {
        observe: function (aSubject, aTopic, aData) {
            let errorlog = document.getElementById('tbsync.errorlog');
            errorlog.hidden = true;
            
            let item = tbSyncErrorLog.addLogEntry(tbSync.errors[tbSync.errors.length-1]);
            errorlog.appendChild(item);

            errorlog.hidden = false;
            errorlog.ensureIndexIsVisible(errorlog.getRowCount()-1);
        }
    },

    
    addLogEntry: function (entry) {
        
        //left column
        let leftColumn = document.createElement("vbox");

        let image = document.createElement("image");
        image.setAttribute("src", "chrome://tbsync/skin/" + "warning16.png");
        image.setAttribute("style", "margin:2px 4px 4px 4px;");
        leftColumn.appendChild(image);
        
        //right column        
        let rightColumn = document.createElement("vbox");
        rightColumn.setAttribute("flex","1");

        let d = new Date(entry.timestamp);
        let timestamp = document.createElement("description");
        timestamp.setAttribute("flex", "1");
        timestamp.setAttribute("class", "header");
        timestamp.textContent = d.toLocaleTimeString();
        rightColumn.appendChild(timestamp);

            let hBox = document.createElement("hbox");
            hBox.flex = "1";
            let vBoxLeft = document.createElement("vbox");
            vBoxLeft.flex = "1";
            let vBoxRight = document.createElement("vbox");
            
            let msg = document.createElement("description");
            msg.setAttribute("flex", "1");
            msg.setAttribute("class", "header");
            msg.textContent = entry.message;
            vBoxLeft.appendChild(msg);

            if (entry.link) {
                let link = document.createElement("button");
                link.setAttribute("label",  tbSync.getLocalizedMessage("manager.help"));
                link.setAttribute("oncommand",  "tbSync.openLink('" + entry.link + "')");
                vBoxRight.appendChild(link);
            }

            hBox.appendChild(vBoxLeft);
            hBox.appendChild(vBoxRight);
            rightColumn.appendChild(hBox);
        
        if (entry.accountname) {
            let account = document.createElement("label");
            account.setAttribute("value",  "Account: " + entry.accountname);
            rightColumn.appendChild(account);
        }

        if (entry.foldername) {
            let folder = document.createElement("label");
            folder.setAttribute("value",  "Resource: " + entry.foldername);
            rightColumn.appendChild(folder);
        }

        if (entry.details) {
            let lines = entry.details.split("\n");
            let line = document.createElement("textbox");
            line.setAttribute("readonly", "true");                
            line.setAttribute("multiline", "true");                
            line.setAttribute("rows", lines.length);                
            line.setAttribute("style", "font-family: monospace; font-size: 10px; overflow: auto;");                
            line.setAttribute("class", "plain");                
            line.setAttribute("value", entry.details.trim());
            
            let container = document.createElement("vbox");
            container.setAttribute("style", "margin-left:1ex;margin-top:1ex;");                
            container.appendChild(line);
            
            rightColumn.appendChild(container);
        }
        
        //columns
        let columns = document.createElement("hbox");
        columns.setAttribute("flex", "1");
        columns.appendChild(leftColumn);
        columns.appendChild(rightColumn);
        
        //richlistitem
        let richlistitem = document.createElement("richlistitem");
        richlistitem.setAttribute("style", "padding:4px; border-bottom: 1px solid lightgrey;");
        richlistitem.appendChild(columns);
        
        return richlistitem;
    },    
};
