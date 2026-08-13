/**
 * Unit tests for the calendar wrapper's owner handling. Run with
 * `npm test` (node --test).
 *
 * The rule under test: a calendar must be told whose mailbox it is, and
 * told only when that changes. Left undeclared, Thunderbird falls back
 * to the DEFAULT mail account's identity, so a calendar belonging to one
 * mailbox claims another's address and invitations in it read as already
 * handled. Declared on every sync instead, each write would persist an
 * override and notify observers for no reason.
 *
 * `messenger` is faked here - these tests cover this file's own logic,
 * never Thunderbird's calendar API.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  createCalendar,
  deferSchedulingToServer,
  setCalendarOwner,
} from "./calendar.mjs";

/** Records what the wrapper asked the platform to do. */
let calls;
let calendars;

beforeEach(() => {
  calls = { create: [], update: [] };
  calendars = new Map();
  globalThis.messenger = {
    calendar: {
      calendars: {
        async create(props) {
          calls.create.push(props);
          const id = `cal-${calls.create.length}`;
          calendars.set(id, { id, capabilities: props.capabilities });
          return { id };
        },
        async get(id) {
          return calendars.get(id) ?? null;
        },
        async update(id, props) {
          calls.update.push({ id, props });
          const cal = calendars.get(id);
          if (cal) {
            cal.capabilities = { ...cal.capabilities, ...props.capabilities };
          }
        },
      },
    },
  };
});

const base = {
  name: "Calendar",
  kind: "events",
  type: "ext-test",
  url: "https://example.invalid/",
};

test("a calendar is created carrying its owner", async () => {
  await createCalendar({
    ...base,
    organizer: "mailto:john@example.org",
    organizerName: "John",
  });
  const { capabilities } = calls.create[0];
  assert.equal(capabilities.organizer, "mailto:john@example.org");
  assert.equal(capabilities.organizerName, "John");
  assert.equal(capabilities.events, true, "the kind still decides events");
  assert.equal(capabilities.tasks, false);
});

test("an unknown owner is left undeclared, not declared empty", async () => {
  await createCalendar({ ...base });
  const { capabilities } = calls.create[0];
  assert.ok(!("organizer" in capabilities));
  assert.ok(!("organizerName" in capabilities));
});

test("setCalendarOwner writes once and then stays quiet", async () => {
  const id = (await createCalendar({ ...base })).id ?? "cal-1";
  const owner = { organizer: "mailto:john@example.org", organizerName: "John" };

  assert.equal(await setCalendarOwner(id, owner), true, "first call declares");
  assert.equal(calls.update.length, 1);
  assert.deepEqual(calls.update[0].props.capabilities, owner);

  assert.equal(
    await setCalendarOwner(id, owner),
    false,
    "declaring the same owner again must not write",
  );
  assert.equal(calls.update.length, 1, "no second write");

  assert.equal(
    await setCalendarOwner(id, {
      organizer: "mailto:other@example.org",
      organizerName: "John",
    }),
    true,
    "a changed address is written",
  );
  assert.equal(calls.update.length, 2);
});

test("a calendar is created leaving the invitations to the server", async () => {
  // Without this the calendar gets Thunderbird's default, "client", and both
  // Thunderbird and the server mail every attendee.
  await createCalendar({ ...base });
  assert.equal(calls.create[0].capabilities.scheduling, "server");
});

test("deferSchedulingToServer writes once and then stays quiet", async () => {
  // A calendar made before this shipped: it says nothing about scheduling,
  // which is what Thunderbird reads as "client".
  calendars.set("old", { id: "old", capabilities: { events: true } });

  assert.equal(await deferSchedulingToServer("old"), true, "first call writes");
  assert.deepEqual(calls.update[0].props.capabilities, { scheduling: "server" });
  assert.equal(
    calls.update[0].props.capabilities.events,
    undefined,
    "only the one capability is sent - the platform merges the rest",
  );

  assert.equal(await deferSchedulingToServer("old"), false, "already declared");
  assert.equal(calls.update.length, 1, "no second write");
});

test("deferSchedulingToServer is quiet about a calendar that is gone", async () => {
  assert.equal(await deferSchedulingToServer(""), false, "no id");
  assert.equal(await deferSchedulingToServer("missing"), false);
  assert.equal(calls.update.length, 0, "nothing was written");
});

test("setCalendarOwner does nothing without an owner or a calendar", async () => {
  assert.equal(await setCalendarOwner("cal-1", {}), false, "no owner");
  assert.equal(await setCalendarOwner("", { organizer: "mailto:a@b" }), false);
  assert.equal(
    await setCalendarOwner("missing", { organizer: "mailto:a@b" }),
    false,
    "a calendar that is gone is not an error here",
  );
  assert.equal(calls.update.length, 0, "nothing was written");
});
