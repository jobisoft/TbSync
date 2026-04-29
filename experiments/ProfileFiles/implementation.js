/*
 * Read-only file access into the Thunderbird profile directory.
 *
 * Used by the legacy-migration runner to read the legacy TbSync JSON
 * files (`accounts68.json`, `folders68.json`, `changelog68.json`) from
 * `<profile>/TbSync/`. Adapted from the FileSystemAccess Experiment in
 * the quicktext add-on.
 *
 * Surface is deliberately minimal: existence checks + JSON reads. We
 * never write or move files - the legacy directory is left in place
 * after migration so the user has a manual recovery path if needed.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

(function (exports) {
  function profileFilePath(relativePath) {
    const profileDir = Components.classes[
      "@mozilla.org/file/directory_service;1"
    ]
      .getService(Components.interfaces.nsIProperties)
      .get("ProfD", Components.interfaces.nsIFile);
    const file = profileDir.clone();
    for (const part of relativePath.split("/").filter(Boolean)) {
      file.append(part);
    }
    return file.path;
  }

  var ProfileFiles = class extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
      return {
        ProfileFiles: {
          async exists(relativePath) {
            return await IOUtils.exists(profileFilePath(relativePath));
          },
          async readJSON(relativePath) {
            const text = await IOUtils.readUTF8(profileFilePath(relativePath));
            return JSON.parse(text);
          },
        },
      };
    }
  };

  exports.ProfileFiles = ProfileFiles;
})(this);
