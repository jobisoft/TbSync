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
    let elements = window.document.getElementsByClassName("textbox-addressingWidget");
    for (let element of elements) {
      let autocompletesearch = element.getAttribute("autocompletesearch");
      if (autocompletesearch.indexOf("tbSyncAutoCompleteSearch") == -1) {
        element.setAttribute("autocompletesearch", autocompletesearch + " tbSyncAutoCompleteSearch");
      }
    }    
  },

  onRemove: function (window) {
    // Remove autoComplete for TbSync
    let elements = window.document.getElementsByClassName("textbox-addressingWidget");
    for (let element of elements) {
      let autocompletesearch = element.getAttribute("autocompletesearch").replace("tbSyncAutoCompleteSearch", "");
      element.setAttribute("autocompletesearch", autocompletesearch.trim());
    }
  }

}
