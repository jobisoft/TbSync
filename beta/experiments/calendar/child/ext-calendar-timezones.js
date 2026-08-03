/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { ExtensionCommon: { ExtensionAPI } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");

var { default: ICAL } = ChromeUtils.importESModule("resource:///modules/calendar/Ical.sys.mjs");

var { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");

this.calendar_timezones = class extends ExtensionAPI {
  getAPI(_context) {
    return {
      calendar: {
        timezones: {
          get timezoneIds() {
            return cal.timezoneService.timezoneIds;
          },
          get currentZone() {
            cal.timezoneService.wrappedJSObject._updateDefaultTimezone();
            return cal.timezoneService.defaultTimezone?.tzid;
          },
          getDefinition(tzid, returnFormat) {
            const timezoneDatabase = Cc["@mozilla.org/calendar/timezone-database;1"].getService(
              Ci.calITimezoneDatabase
            );
            let zoneInfo = timezoneDatabase.getTimezoneDefinition(tzid);

            if (returnFormat == "jcal") {
              zoneInfo = ICAL.parse(zoneInfo);
            }

            return zoneInfo;
          },
        }
      }
    };
  }
};
