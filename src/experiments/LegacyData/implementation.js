/*
 * The part of the legacy lock that no WebExtension API reaches.
 *
 * An account set up by an older version is frozen until the user deals
 * with it, and freezing means its local resources stop accepting edits.
 * Calendars have `calendar.calendars.update({readOnly})`; address books
 * have nothing.
 *
 * `readOnly` is a readonly attribute on nsIAbDirectory backed by a
 * per-directory preference, enforced on addCard, modifyCard, deleteCards
 * and addMailList. `setBoolValue` is not a way around the interface, it is
 * how Thunderbird's own CardDAV code sets the same flag.
 *
 * Nothing here writes to or removes the directory itself, so the user
 * always keeps the manual recovery path.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs",
);

(function (exports) {
  var LegacyData = class extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
      return {
        LegacyData: {
          async setAddressBookReadOnly(bookUid, readOnly) {
            try {
              const book = MailServices.ab.getDirectoryFromUID(bookUid);
              if (!book) return false;
              book.setBoolValue("readOnly", !!readOnly);
              return true;
            } catch (ex) {
              // A book that is gone answers false rather than throwing:
              // this runs over every row of a locked account at boot, and
              // a resource the user deleted by hand must not stop the
              // rest from being frozen.
              return false;
            }
          },
        },
      };
    }
  };

  exports.LegacyData = LegacyData;
})(this);
