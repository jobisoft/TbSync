/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAddressBook = {

  onInject: function (window) {
    //hook into getProperties of abDirTreeItem to inject our own icons for the address books
    if (!window.abDirTreeItem.prototype.hasOwnProperty("_origBeforeTbSyncGetProperties")) {
      window.abDirTreeItem.prototype._origBeforeTbSyncGetProperties = window.abDirTreeItem.prototype.getProperties;
      window.abDirTreeItem.prototype.getProperties = function () {
        //get original properties
        let properties = this._origBeforeTbSyncGetProperties().split(" ");
        
        let type = "";
        if (!this._directory.isMailList && !this._directory.isRemote) {
          try {
            type = TbSync.addressbook.getStringValue(this._directory, "tbSyncIcon", "");
          } catch (e) {}
        }
        
        if (type) properties.push(type);
        return properties.join(" ");
      }
    }
  },

  onRemove: function (window) {
    window.abDirTreeItem.prototype.getProperties = window.abDirTreeItem.prototype._origBeforeTbSyncGetProperties;
    delete window.abDirTreeItem.prototype._origBeforeTbSyncGetProperties;
  }
}
