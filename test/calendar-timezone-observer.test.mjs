import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/experiments/calendar/parent/ext-calendar-timezones.js", import.meta.url), "utf8");

test("timezone changes are emitted after the host refreshes its cached zone", () => {
  const topics = new Map();
  const prefs = new Map();
  const service = { defaultTimezone: { tzid: "Europe/Warsaw" } };
  const emitted = [];
  let register;
  const context = vm.createContext({
    ChromeUtils: {
      generateQI: () => () => {},
      importESModule: uri => uri.includes("ExtensionCommon")
        ? { ExtensionCommon: { ExtensionAPI: class {}, EventManager: class {
          constructor(options) { register = options.register; }
          api() { return {}; }
        } } }
        : { cal: { timezoneService: service } },
    },
    Services: {
      prefs: {
        addObserver: (name, observer) => prefs.set(name, observer),
        removeObserver: name => prefs.delete(name),
      },
      obs: {
        addObserver: (observer, name) => topics.set(name, observer),
        removeObserver: (_observer, name) => topics.delete(name),
      },
    },
  });
  vm.runInContext(source, context);
  new context.calendar_timezones().getAPI({});
  const unregister = register({ sync: value => emitted.push(value) });

  // Thunderbird can deliver the system topic before its own observer runs.
  topics.get("default-timezone-changed").observe();
  assert.deepEqual(emitted, []);
  service.defaultTimezone = { tzid: "America/New_York" };
  assert.ok(topics.has("defaultTimezoneChanged"));
  topics.get("defaultTimezoneChanged").observe();
  topics.get("defaultTimezoneChanged").observe();
  assert.deepEqual(emitted, ["America/New_York"]);

  // The older XPCOM service still needs its refresh hook on pref changes.
  let refreshes = 0;
  service.wrappedJSObject = { _updateDefaultTimezone() {
    refreshes++;
    if (service.defaultTimezone.tzid != "UTC") {
      service.defaultTimezone = { tzid: "UTC" };
      topics.get("defaultTimezoneChanged").observe();
    }
  } };
  prefs.get("calendar.timezone.local").observe();
  assert.equal(refreshes, 2);
  assert.deepEqual(emitted, ["America/New_York", "UTC"]);

  unregister();
  assert.equal(topics.size, 0);
  assert.equal(prefs.size, 0);
});
