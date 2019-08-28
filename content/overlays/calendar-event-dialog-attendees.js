/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAttendeeEventDialog = {

  onInject: function (window) {
    // Add autoComplete for TbSync
    if (window.document.getElementById("attendeeCol3#1")) {
      let autocompletesearch = window.document.getElementById("attendeeCol3#1").getAttribute("autocompletesearch");
      if (autocompletesearch.indexOf("tbSyncAutoCompleteSearch") == -1) {
        window.document.getElementById("attendeeCol3#1").setAttribute("autocompletesearch", autocompletesearch + " tbSyncAutoCompleteSearch");
      }
    }    
  },

  onRemove: function (window) {
    // Remove autoComplete for TbSync
    if (window.document.getElementById("attendeeCol3#1")) {
      let autocompletesearch = window.document.getElementById("attendeeCol3#1").getAttribute("autocompletesearch").replace("tbSyncAutoCompleteSearch", "");
      window.document.getElementById("attendeeCol3#1").setAttribute("autocompletesearch", autocompletesearch.trim());
    }
  }

}
