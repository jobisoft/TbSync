/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncEventLog = {
  
  onload: function () {
    Services.obs.addObserver(tbSyncEventLog.updateEventLog, "tbsync.observer.eventlog.update", false);

    let eventlog = document.getElementById('tbsync.eventlog');
    eventlog.hidden = true;
    
    //init list
    let events = TbSync.eventlog.get();
    for (let i=0; i < events.length; i++) {
      let item = tbSyncEventLog.addLogEntry(events[i]);
      eventlog.appendChild(item);
    }

    eventlog.hidden = false;
    eventlog.ensureIndexIsVisible(eventlog.getRowCount()-1);
    document.documentElement.getButton("extra1").onclick = tbSyncEventLog.onclear;
  },

  onclear: function () {
    TbSync.eventlog.clear();

    let eventlog = document.getElementById('tbsync.eventlog');
    eventlog.hidden = true;

    for (let i=eventlog.getRowCount()-1; i>=0; i--) {
      eventlog.getItemAtIndex(i).remove();
    }
    
    eventlog.hidden = false;
  },
  
  onunload: function () {
    Services.obs.removeObserver(tbSyncEventLog.updateEventLog, "tbsync.observer.eventlog.update");
  },

  updateEventLog: {
    observe: function (aSubject, aTopic, aData) {
      let events = TbSync.eventlog.get();
      if (events.length > 0) {
        let eventlog = document.getElementById('tbsync.eventlog');
        eventlog.hidden = true;
        
        let item = tbSyncEventLog.addLogEntry(events[events.length-1]);
        eventlog.appendChild(item);

        eventlog.hidden = false;
        eventlog.ensureIndexIsVisible(eventlog.getRowCount()-1);
      }
    }
  },

  
  addLogEntry: function (entry) {
    
    //left column
    let leftColumn = document.createXULElement("vbox");
    leftColumn.setAttribute("width", "24");

    let image = document.createXULElement("image");
    let src = entry.type.endsWith("_rerun") ? "sync" : entry.type;
    image.setAttribute("src", "chrome://tbsync/content/skin/" + src + "16.png");
    image.setAttribute("style", "margin:4px 4px 4px 4px;");
    leftColumn.appendChild(image);
    
    //right column        
    let rightColumn = document.createXULElement("vbox");
    rightColumn.setAttribute("flex","1");

    let d = new Date(entry.timestamp);
    let timestamp = document.createXULElement("description");
    timestamp.setAttribute("flex", "1");
    timestamp.setAttribute("class", "header");
    timestamp.textContent = d.toLocaleTimeString();
    rightColumn.appendChild(timestamp);

      let hBox = document.createXULElement("hbox");
      hBox.flex = "1";
      let vBoxLeft = document.createXULElement("vbox");
      vBoxLeft.flex = "1";
      let vBoxRight = document.createXULElement("vbox");
      
      let msg = document.createXULElement("description");
      msg.setAttribute("flex", "1");
      msg.setAttribute("class", "header");
      msg.textContent = entry.message;
      vBoxLeft.appendChild(msg);

      if (entry.link) {
        let link = document.createXULElement("button");
        link.setAttribute("label",  TbSync.getString("manager.help"));
        link.setAttribute("oncommand",  "TbSync.manager.openLink('" + entry.link + "')");
        vBoxRight.appendChild(link);
      }

      hBox.appendChild(vBoxLeft);
      hBox.appendChild(vBoxRight);
      rightColumn.appendChild(hBox);
    
    if (entry.accountname || entry.provider) {
      let account = document.createXULElement("label");
      if (entry.accountname) account.setAttribute("value",  "Account: " + entry.accountname + (entry.provider ? " (" + entry.provider.toUpperCase() + ")" : ""));
      else account.setAttribute("value",  "Provider: " + entry.provider.toUpperCase());
      rightColumn.appendChild(account);
    }

    if (entry.foldername) {
      let folder = document.createXULElement("label");
      folder.setAttribute("value",  "Resource: " + entry.foldername);
      rightColumn.appendChild(folder);
    }

    if (entry.details) {
      let lines = entry.details.split("\n");
      let line = document.createElementNS("http://www.w3.org/1999/xhtml", "textarea");
      line.setAttribute("readonly", "true");                
      line.setAttribute("wrap", "off");                           
      line.setAttribute("rows", lines.length);                
      line.setAttribute("style", "font-family: monospace; font-size: 10px;");                
      line.setAttribute("class", "plain");                
      line.value = entry.details.trim();
      
      let container = document.createXULElement("vbox");
      container.setAttribute("style", "margin-left:1ex;margin-top:1ex;");                
      container.appendChild(line);
      
      rightColumn.appendChild(container);
    }
    
    //columns
    let columns = document.createXULElement("hbox");
    columns.setAttribute("flex", "1");
    columns.appendChild(leftColumn);
    columns.appendChild(rightColumn);
    
    //richlistitem
    let richlistitem = document.createXULElement("richlistitem");
    richlistitem.setAttribute("style", "padding:4px; border-bottom: 1px solid lightgrey;");
    richlistitem.appendChild(columns);
    
    return richlistitem;
  },    
};
