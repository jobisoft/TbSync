import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const source = readFileSync(new URL(
  "../src/experiments/calendar/parent/ext-calendar-calendars.js", import.meta.url,
), "utf8");

function loadClear(deleteCalendar, own = true) {
  const notifications = [];
  const storage = { QueryInterface() { return this; }, deleteCalendar };
  const calendar = {
    wrappedJSObject: { mObservers: { notify: (...args) => notifications.push(args) } },
  };
  const scope = {
    ChromeUtils: { importESModule(uri) {
      if (uri.includes("ExtensionCommon")) return { ExtensionCommon: {
        ExtensionAPI: class {}, EventManager: class { api() { return {}; } },
      } };
      if (uri.includes("ExtensionUtils")) return { ExtensionUtils: { ExtensionError: Error } };
      if (uri.includes("calUtils")) return { cal: { manager: { getCalendarById: () => calendar } } };
      return { getResolvedCalendarById: () => storage, isOwnCalendar: () => own };
    } },
    Ci: { calICalendarProvider: {} },
  };
  vm.runInNewContext(source, scope);
  const api = new scope.calendar_calendars().getAPI({ extension: { uuid: "test", manifest: { version: "test" } } });
  return { clear: api.calendar.calendars.clear, notifications, storage };
}

test("clear awaits promise-only storage deletion before notifying observers", async () => {
  let finish;
  let called = false;
  const { clear, notifications, storage } = loadClear(function (calendar) {
    assert.equal(calendar, storage);
    called = true;
    return new Promise(resolve => { finish = resolve; });
  });
  const pending = clear("calendar#cache");
  assert.equal(called, true);
  assert.equal(notifications.length, 0);
  finish();
  await pending;
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][0], "onLoad");
});

test("clear propagates storage failure without reporting a reload", async () => {
  const failure = new Error("storage deletion failed");
  const { clear, notifications } = loadClear(async () => { throw failure; });
  await assert.rejects(clear("calendar#cache"), error => error === failure);
  assert.equal(notifications.length, 0);
});

test("clear refuses foreign and non-cached calendars before storage deletion", async () => {
  let calls = 0;
  const { clear } = loadClear(async () => { calls++; }, false);
  await assert.rejects(clear("calendar"), /Cannot clear non-cached calendar/);
  await assert.rejects(clear("calendar#cache"), /Cannot clear foreign calendar/);
  assert.equal(calls, 0);
});
