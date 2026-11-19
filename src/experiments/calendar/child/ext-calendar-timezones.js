/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { ExtensionCommon: { ExtensionAPI } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");

var { ExtensionUtils: { ExtensionError } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");

var { default: ICAL } = ChromeUtils.importESModule("resource:///modules/calendar/Ical.sys.mjs");

var { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");

// COMPAT (TB <= 153 only, not needed on release): This runs in the child
// process, where the timezone service is a fresh instance that Thunderbird's
// own startup never touched. Without startup() the zone list is empty and
// there is no default timezone. Thunderbird 154 (Bug 2022873) moved that work
// into the service's constructor and removed startup(), hence the probe: it
// is a no-op there.
cal.timezoneService.startup?.(null);

this.calendar_timezones = class extends ExtensionAPI {
  getAPI(context) {
    return {
      calendar: {
        timezones: {
          get timezoneIds() {
            // Objects handed to the extension must be cloned into its scope,
            // otherwise the extension gets a wrapper it may not touch
            // ("Permission denied to access property ...").
            return Cu.cloneInto([...cal.timezoneService.timezoneIds], context.cloneScope);
          },
          get currentZone() {
            // COMPAT (TB <= 153 only, not needed on release): There used to be
            // a call to wrappedJSObject._updateDefaultTimezone() here. It
            // throws on TB 154+ (Bug 2022873 made it a #private method), and
            // it is not needed: once the service is running (see startup()
            // above for TB <= 153), it keeps defaultTimezone up to date itself.
            //
            // null means the host has no default timezone, which is not
            // expected once the service is running. It is reported as null,
            // never as an empty string, which could be mistaken for a zone id.
            return cal.timezoneService.defaultTimezone?.tzid ?? null;
          },
          getDefinition(tzid, returnFormat) {
            const timezoneDatabase = Cc["@mozilla.org/calendar/timezone-database;1"].getService(
              Ci.calITimezoneDatabase
            );
            const zoneInfo = timezoneDatabase.getTimezoneDefinition(tzid);

            // An unknown id yields an empty definition. Report that as null
            // instead of an empty string (or, for jcal, an empty array).
            if (!zoneInfo) {
              return null;
            }

            if (!returnFormat || returnFormat == "jcal") {
              // The parsed jCal is an object, so it needs cloning (see above).
              return Cu.cloneInto(ICAL.parse(zoneInfo), context.cloneScope);
            } else if (returnFormat == "ical") {
              return zoneInfo;
            }

            throw new ExtensionError(`Invalid return format: ${returnFormat}`);
          },
        }
      }
    };
  }
};
