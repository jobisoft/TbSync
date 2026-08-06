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
              // Up to Thunderbird 153 the timezone service is an XPCOM
              // service, so wrappedJSObject reaches the JS implementation and
              // _updateDefaultTimezone() forces a refresh before we read the
              // current zone. Thunderbird 154 made it a plain ESM singleton
              // with no XPCOM wrapper, and made that method a #private field
              // (Bug 2022873), so both hops are gone - and the refresh is
              // redundant there anyway, because the service observes the same
              // two prefs and the same system-timezone topic we do below.
              //
              // Probed rather than compared against Services.appinfo.version:
              // the version boundary only holds until someone backports, and
              // this degrades to "no refresh needed" instead of a TypeError.
              cal.timezoneService.wrappedJSObject?._updateDefaultTimezone?.();
              let lastValue = cal.timezoneService.defaultTimezone?.tzid;

              const observer = {
                QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
                observe(_subject, _topic, _data) {
                  // Make sure the default timezone is updated before firing.
                  // No-op on 154+, where the service refreshes itself - see
                  // the note in register() above.
                  cal.timezoneService.wrappedJSObject?._updateDefaultTimezone?.();
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
