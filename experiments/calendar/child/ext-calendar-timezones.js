/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var {
  ExtensionCommon: { ExtensionAPI },
} = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs",
);

var { default: ICAL } = ChromeUtils.importESModule(
  "resource:///modules/calendar/Ical.sys.mjs",
);

var { cal } = ChromeUtils.importESModule(
  "resource:///modules/calendar/calUtils.sys.mjs",
);

this.calendar_timezones = class extends ExtensionAPI {
  getAPI(context) {
    return {
      calendar: {
        timezones: {
          get timezoneIds() {
            return Cu.cloneInto([...cal.timezoneService.timezoneIds], context.cloneScope);
          },
          get currentZone() {
            return cal.timezoneService.defaultTimezone?.tzid ?? "";
          },
          getDefinition(tzid, returnFormat) {
            const timezoneDatabase = Cc[
              "@mozilla.org/calendar/timezone-database;1"
            ].getService(Ci.calITimezoneDatabase);
            const zoneInfo = timezoneDatabase.getTimezoneDefinition(tzid);

            if (returnFormat == "jcal") {
              return Cu.cloneInto(ICAL.parse(zoneInfo), context.cloneScope);
            } else if (returnFormat == "ical") {
              return zoneInfo;
            }

            throw new ExtensionError(`Invalid return format: ${returnFormat}`);
          },
        },
      },
    };
  }
};
