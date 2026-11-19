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
              const service = cal.timezoneService;

              // COMPAT (TB <= 153 only, not needed on release): On TB <= 153
              // the service is an XPCOM service and wrappedJSObject reaches
              // _updateDefaultTimezone(). TB 154 (Bug 2022873) made it a plain
              // ESM singleton and the method #private, so both are gone there.
              const isLegacyService = !!service.wrappedJSObject?._updateDefaultTimezone;

              if (!isLegacyService) {
                // The service announces this once it has applied a new
                // default, and only when the zone really changed. It is the
                // single trigger: the prefs and the system timezone topic are
                // not observed here, because we could run before the service
                // has reacted to them and read its old default.
                const announceObserver = {
                  QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
                  observe(_subject, _topic, _data) {
                    fire.sync(service.defaultTimezone?.tzid);
                  },
                };
                Services.obs.addObserver(announceObserver, "defaultTimezoneChanged");
                return () => {
                  Services.obs.removeObserver(announceObserver, "defaultTimezoneChanged");
                };
              }

              // COMPAT (TB <= 153 only, not needed on release): Everything
              // below. On TB <= 153 we have to watch the prefs and the system
              // timezone ourselves and tell the service to update before we
              // read its default, and we need lastValue to only report real
              // changes.
              service.wrappedJSObject._updateDefaultTimezone();
              let lastValue = service.defaultTimezone?.tzid;

              const legacyObserver = {
                QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
                observe(_subject, _topic, _data) {
                  service.wrappedJSObject._updateDefaultTimezone();
                  const currentValue = service.defaultTimezone?.tzid;
                  if (currentValue != lastValue) {
                    lastValue = currentValue;
                    fire.sync(currentValue);
                  }
                }
              };

              Services.prefs.addObserver("calendar.timezone.useSystemTimezone", legacyObserver);
              Services.prefs.addObserver("calendar.timezone.local", legacyObserver);
              Services.obs.addObserver(legacyObserver, "default-timezone-changed");
              return () => {
                Services.obs.removeObserver(legacyObserver, "default-timezone-changed");
                Services.prefs.removeObserver("calendar.timezone.local", legacyObserver);
                Services.prefs.removeObserver("calendar.timezone.useSystemTimezone", legacyObserver);
              };
            },
          }).api(),
        }
      }
    };
  }
};
