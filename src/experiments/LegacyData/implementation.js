/*
 * The parts of the legacy lock and rescue that no WebExtension API reaches.
 *
 * `setAddressBookReadOnly` - an account set up by an older version is
 * frozen until the user deals with it, and freezing means its local
 * resources stop accepting edits. Calendars have
 * `calendar.calendars.update({readOnly})`; address books have nothing.
 * `readOnly` is a readonly attribute on nsIAbDirectory backed by a
 * per-directory preference, enforced on addCard, modifyCard, deleteCards
 * and addMailList. `setBoolValue` is not a way around the interface, it is
 * how Thunderbird's own CardDAV code sets the same flag.
 *
 * `readCardProperties` - the contacts API returns DisplayName, FirstName,
 * LastName, PrimaryEmail and vCard, and stops. A provider's identifier for
 * a card is written as a card property and is invisible through it, so a
 * changelog entry naming a card by that identifier would match nothing.
 * Measured, not assumed. Returns *all* properties rather than one by name:
 * which property carries a provider's id is the provider's business, and
 * the host has no reason to learn it.
 *
 * Nothing here writes to or removes a directory, so the user always keeps
 * the manual recovery path.
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
          async readCardProperties(bookUid) {
            const out = {};
            try {
              const book = MailServices.ab.getDirectoryFromUID(bookUid);
              if (!book) return out;
              for (const card of book.childCards) {
                const props = {};
                for (const p of card.properties) {
                  props[p.name] = String(p.value);
                }
                // Keyed by the id the contacts API reports, so a caller can
                // join the two without another lookup.
                out[card.UID] = props;
              }
            } catch (ex) {
              // A book that is gone yields nothing, which is the answer
              // rather than an error: every teardown deletes resources, and
              // a rescue must not fail because one is already missing.
            }
            return out;
          },

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
