import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const source = readFileSync(new URL(
  "../src/experiments/calendar/parent/ext-calendar-provider.js", import.meta.url,
), "utf8");

// Exercise the experiment itself. The host's default transport is deliberately
// capable of sending: a server-scheduled calendar must never reach it.
function loadCalendar(scheduling) {
  let sends = 0;
  const defaultTransport = { sendItems() { sends++; } };
  const scope = {
    ChromeUtils: {
      generateQI: () => () => {},
      importESModule(uri) {
        if (uri.includes("ExtensionCommon")) return { ExtensionCommon: {
          ExtensionAPI: class {}, EventManager: class {}, EventEmitter: class {},
        } };
        if (uri.includes("ExtensionUtils")) return { ExtensionUtils: { ExtensionError: Error } };
        if (uri.includes("calUtils")) return { cal: { provider: { BaseClass: class {
          initProviderBase() {}
          getProperty(name) { return name === "itip.transport" ? defaultTransport : null; }
        } } } };
        if (uri.includes("CalItipEmailTransport")) return { CalItipEmailTransport: class {
          sendItems() { sends++; }
        } };
        return {};
      },
    },
  };
  vm.runInNewContext(`${source}\nglobalThis.Calendar = ExtCalendar;`, scope);
  const calendar = new scope.Calendar({ id: "test@example.invalid" });
  calendar.capabilities = { scheduling };
  return { calendar, defaultTransport, sends: () => sends };
}

test("server scheduling reports host notifications handled and suppresses email", () => {
  const { calendar, sends } = loadCalendar("server");
  assert.equal(calendar.getSchedulingSupport(), calendar);
  assert.equal(calendar.supportsScheduling, true);
  for (const method of ["REQUEST", "REPLY", "CANCEL"]) {
    assert.equal(calendar.canNotify(method, {}), true);
    assert.equal(calendar.getProperty("itip.transport").sendItems([], {}), true);
  }
  assert.equal(sends(), 0);
});

test("disabled scheduling exposes no transport and disables identity selection", () => {
  const { calendar, sends } = loadCalendar("none");
  assert.equal(calendar.supportsScheduling, false);
  assert.equal(calendar.canNotify("REQUEST", {}), false);
  assert.equal(calendar.getProperty("itip.transport"), null);
  assert.equal(calendar.getProperty("imip.identity.disabled"), true);
  assert.equal(sends(), 0);
});

test("client scheduling retains the host email transport", () => {
  const { calendar, defaultTransport } = loadCalendar("client");
  assert.equal(calendar.supportsScheduling, true);
  assert.equal(calendar.canNotify("REQUEST", {}), false);
  assert.equal(calendar.getProperty("itip.transport"), defaultTransport);
  assert.equal(calendar.getProperty("imip.identity.disabled"), false);
});
