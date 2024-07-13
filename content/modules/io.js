/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
"use strict";

ChromeUtils.defineESModuleGetters(this, {
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
});

var io = {

  storageDirectory : PathUtils.join(PathUtils.profileDir, "TbSync"),

  load: async function () {
  },

  unload: async function () {
  },

  getAbsolutePath: function(filename) {
    return PathUtils.join(this.storageDirectory, filename);
  },
  
  initFile: function (filename) {
    let file = new FileUtils.File(PathUtils.join(PathUtils.profileDir, "TbSync", filename));
    //create a stream to write to that file
    let foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
    foStream.init(file, 0x02 | 0x08 | 0x20, parseInt("0666", 8), 0); // write, create, truncate
    foStream.close();
  },

  appendToFile: function (filename, data) {
    let file = new FileUtils.File(PathUtils.join(PathUtils.profileDir, "TbSync", filename));
    //create a strem to write to that file
    let foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
    foStream.init(file, 0x02 | 0x08 | 0x10, parseInt("0666", 8), 0); // write, create, append
    foStream.write(data, data.length);
    foStream.close();
  },    
}
