/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncErrorLog = {
    
    onload: function () {
        let errorlog = document.getElementById('tbsync.errorlog');
        errorlog.hidden = true;
        
        //init list
        for (let i=0; i < tbSync.errors.length; i++) {
            let item = tbSyncErrorLog.addLogEntry(tbSync.errors[i]);
            errorlog.appendChild(item);
        }

        errorlog.hidden = false;
    },

    
    addLogEntry: function (entry) {
        
        //left column
        let image = document.createElement("image");
        image.setAttribute("src", "chrome://tbsync/skin/" + "warning16.png");
        image.setAttribute("style", "margin:2px 4px 4px 4px;");

        let leftColumn = document.createElement("vbox");
        leftColumn.appendChild(image);
        
        //right column        
        let d = new Date(entry.timestamp);
        let msg = document.createElement("description");
        msg.setAttribute("flex", "1");
        msg.setAttribute("class", "header");
        msg.textContent = d.toLocaleTimeString() + " : " + entry.message;

        let account = document.createElement("label");
        account.setAttribute("value",  "Account: " + entry.accountname);

        let folder = document.createElement("label");
        folder.setAttribute("value",  "Resource: " + entry.foldername);
        
        let rightColumn = document.createElement("vbox");
        rightColumn.setAttribute("flex","1");
        rightColumn.appendChild(msg);
        if (entry.accountname) rightColumn.appendChild(account);
        if (entry.foldername) rightColumn.appendChild(folder);

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
