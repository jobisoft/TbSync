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
        
        //init list
        for (let i=tbSync.errors.length; i > 0; i--) {
            let item = tbSyncErrorLog.addLogEntry(tbSync.errors[i-1]);
            item.setAttribute("value", i-1);
            errorlog.appendChild(item);
        }
        errorlog.selectedIndex = 0;
    },


    addLogEntry: function (entry) {
        
        //left column
        let image = document.createElement("image");
        image.setAttribute("src", "chrome://tbsync/skin/" + "warning16.png");
        image.setAttribute("style", "margin:4px;");

        let leftColumn = document.createElement("vbox");
        leftColumn.appendChild(image);
        
        //right column
        let type = document.createElement("label");
        type.setAttribute("class", "header");
        type.setAttribute("value", entry.type);
        
        let msg = document.createElement("description");
        msg.setAttribute("style", "width: 420px;");
        msg.setAttribute("class", "header");
        msg.textContent = entry.message;
        
        let rightColumn = document.createElement("vbox");
        rightColumn.appendChild(type);
        rightColumn.appendChild(msg);
        if (entry.details) {
            let lines = entry.details.split("\n");
            for (let l=0; l < lines.length; l++) {
                let line = document.createElement("description");
                line.setAttribute("style", "font-style: italic; margin: 0 1ex");                
                line.textContent = lines[l].replace("/\r/g","").trim();
                rightColumn.appendChild(line);
            }
            
        }
 
        
        //columns
        let columns = document.createElement("hbox");
        columns.appendChild(leftColumn);
        columns.appendChild(rightColumn);
        
        //richlistitem
        let richlistitem = document.createElement("richlistitem");
        richlistitem.setAttribute("style", "padding:4px");
        richlistitem.appendChild(columns);
        
        return richlistitem;
    },    
};
