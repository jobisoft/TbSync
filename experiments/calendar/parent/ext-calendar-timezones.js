/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { ExtensionCommon: { ExtensionAPI, EventManager } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");

var { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");

this.calendar_timezones = class extends ExtensionAPI {
  getAPI(context) {
    return {
      calendar: {
        timezones: {
          onUpdated: new EventManager({
            context,
            name: "calendar.timezones.onUpdated",
            register: fire => {
              cal.timezoneService.wrappedJSObject._updateDefaultTimezone();
              let lastValue = cal.timezoneService.defaultTimezone?.tzid;

              const observer = {
                QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
                observe(_subject, _topic, _data) {
                  // Make sure the default timezone is updated before firing
                  cal.timezoneService.wrappedJSObject._updateDefaultTimezone();
                  const currentValue = cal.timezoneService.defaultTimezone?.tzid;
                  if (currentValue != lastValue) {
                    lastValue = currentValue;
                    fire.sync(currentValue);
                  }
                }
              };

              Services.prefs.addObserver("calendar.timezone.useSystemTimezone", observer);
              Services.prefs.addObserver("calendar.timezone.local", observer);
              Services.obs.addObserver(observer, "default-timezone-changed");
              return () => {
                Services.obs.removeObserver(observer, "default-timezone-changed");
                Services.prefs.removeObserver("calendar.timezone.local", observer);
                Services.prefs.removeObserver("calendar.timezone.useSystemTimezone", observer);
              };
            },
          }).api(),
        }
      }
    };
  }
};
