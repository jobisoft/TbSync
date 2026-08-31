/**
 * Unit tests for reading the edits the previous version never sent.
 *
 * The ids below are verbatim from a real capture of a migrated profile
 * (`~/Documents/GitHub/tbsync-migration-snapshots/v4-capture-20260830/`),
 * not invented ones - which is the point, because every assumption about
 * their shape has been wrong at least once.
 *
 * Outside `src/`, because that tree is what the add-on ships. Run with
 * `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLegacyChangelog,
  keysOf,
  resolveTarget,
} from "../src/modules/legacy-rescue.mjs";

// The three resources of the captured account, keyed as the changelog
// keys them: by the id of the local resource.
const CONTACTS = "d630b086-4e01-43d5-834a-516450a3c5bc";
const CALENDAR = "f896f9b6-89e0-4375-912d-b76a499b9422";
const TASKS = "baba2c79-9983-4325-8e38-c0d4d957197f";

/** The capture's eleven rows, trimmed only in the length of the ids. */
const REAL = [
  { parentId: CONTACTS, itemId: "Ued67e:57a5…5c2c78", timestamp: 1788122415967, status: "added_by_server" },
  { parentId: CONTACTS, itemId: "Ued67e:57a5…ca1978", timestamp: 1788122416026, status: "added_by_server" },
  { parentId: CONTACTS, itemId: "Ued67e:57a5…c81978", timestamp: 1788122416085, status: "added_by_server" },
  { parentId: CONTACTS, itemId: "Ued67e:57a5…c01978", timestamp: 1788122416142, status: "added_by_server" },
  { parentId: CONTACTS, itemId: "Ued67e:57a5…7c4570", timestamp: 1788122416200, status: "added_by_server" },
  { parentId: TASKS, itemId: "U9fc3a:57a5…cd1978", timestamp: 1788122418290, status: "added_by_server" },
  { parentId: TASKS, itemId: "U9fc3a:57a5…3d1978", timestamp: 1788122418350, status: "added_by_server" },
  // The deferred-creation marker: a timestamp where a status belongs.
  { parentId: CONTACTS, itemId: "3764e8f1-96ac-4e4e-a4a2-34005f9bd541#DelayedUserCreation", timestamp: 1788122453499, status: 1788122453499 },
  // The three the user made and the old version never sent - one per
  // resource. Each is named by a UUID that version minted itself, because
  // the server has never seen these items.
  { parentId: CONTACTS, itemId: "96651c65-3bd2-4135-b071-f34093987c92", timestamp: 1788122453504, status: "added_by_user" },
  { parentId: CALENDAR, itemId: "82018f97-c3cf-4c86-8055-cd7f6f0734ca", timestamp: 1788122471944, status: "added_by_user" },
  { parentId: TASKS, itemId: "faba6978-73a9-46b2-a89b-8539ee40adfc", timestamp: 1788122497980, status: "added_by_user" },
];

test("only the user's own pending edits come back", () => {
  const r = parseLegacyChangelog(REAL);
  assert.deepEqual(r.counts, { added: 3, modified: 0, deleted: 0 });
  assert.deepEqual(r.targets[CALENDAR].added, [
    "82018f97-c3cf-4c86-8055-cd7f6f0734ca",
  ]);
  assert.deepEqual(r.targets[CONTACTS].added, [
    "96651c65-3bd2-4135-b071-f34093987c92",
  ]);
});

test("a row with an unrecognised status is ignored and counted", () => {
  // The capture's deferred-creation marker. Recognised by its status not
  // being one of the six - the id is never inspected, so a marker written
  // some other way is ignored the same way.
  const r = parseLegacyChangelog(REAL);
  assert.equal(r.ignored, 1);
});

test("server pre-tags are not edits of ours, and are not 'ignored' either", () => {
  const r = parseLegacyChangelog([
    { parentId: TASKS, itemId: "a", timestamp: 1, status: "added_by_server" },
    { parentId: TASKS, itemId: "b", timestamp: 2, status: "modified_by_server" },
    { parentId: TASKS, itemId: "c", timestamp: 3, status: "deleted_by_server" },
  ]);
  assert.deepEqual(r.counts, { added: 0, modified: 0, deleted: 0 });
  assert.equal(r.ignored, 0, "a known status is understood, not skipped");
});

test("the three pending operations are kept apart", () => {
  const r = parseLegacyChangelog([
    { parentId: TASKS, itemId: "a", timestamp: 1, status: "added_by_user" },
    { parentId: TASKS, itemId: "b", timestamp: 2, status: "modified_by_user" },
    { parentId: TASKS, itemId: "c", timestamp: 3, status: "deleted_by_user" },
  ]);
  assert.deepEqual(r.targets[TASKS], {
    added: ["a"],
    modified: ["b"],
    deleted: ["c"],
  });
});

// Several pending edits to one item combine by the same rules the previous
// version used when it wrote them (`decideUserStatus` in
// `changelog-core.mjs`). Keeping the most recent row instead would turn a
// pending add into a modification, and the replay would then try to update
// an item the server has never seen.
const rows = (...pairs) =>
  pairs.map(([status, timestamp]) => ({
    parentId: TASKS,
    itemId: "a",
    timestamp,
    status,
  }));
const owed = (...pairs) => parseLegacyChangelog(rows(...pairs)).targets[TASKS];

test("created then edited is still a create", () => {
  assert.deepEqual(owed(["added_by_user", 1], ["modified_by_user", 2]), {
    added: ["a"],
    modified: [],
    deleted: [],
  });
});

test("created then deleted cancels out entirely", () => {
  // The server never saw it, so there is nothing to add and nothing to
  // delete - and no resource to look it up in either.
  assert.equal(owed(["added_by_user", 1], ["deleted_by_user", 2]), undefined);
});

test("edited then deleted is a delete", () => {
  assert.deepEqual(owed(["modified_by_user", 1], ["deleted_by_user", 2]), {
    added: [],
    modified: [],
    deleted: ["a"],
  });
});

test("deleted then re-created is an edit", () => {
  assert.deepEqual(owed(["deleted_by_user", 1], ["added_by_user", 2]), {
    added: [],
    modified: ["a"],
    deleted: [],
  });
});

test("edits combine in the order they were made, not the order they are read", () => {
  assert.deepEqual(owed(["modified_by_user", 9], ["added_by_user", 1]), {
    added: ["a"],
    modified: [],
    deleted: [],
  });
});

test("the same id in two resources is two separate items", () => {
  const r = parseLegacyChangelog([
    { parentId: TASKS, itemId: "a", timestamp: 1, status: "added_by_user" },
    { parentId: CALENDAR, itemId: "a", timestamp: 2, status: "added_by_user" },
  ]);
  assert.equal(r.counts.added, 2);
});

test("anything that is not a list of rows is no answer at all", () => {
  for (const bad of [null, undefined, {}, "", 0]) {
    assert.equal(parseLegacyChangelog(bad), null);
  }
});

test("an item answers to its own id", () => {
  assert.deepEqual(keysOf({ id: "82018f97" }, null), ["82018f97"]);
});

test("a card answers to any of its property values", () => {
  // The stamp is a card property, and *which* property is the provider's
  // business - so every value is a key and the host never learns the name.
  const props = {
    "3764e8f1": {
      DisplayName: "Migration Test",
      "X-EAS-SERVERID": "96651c65-3bd2-4135-b071-f34093987c92",
    },
  };
  const keys = keysOf({ id: "3764e8f1" }, props);
  assert.ok(keys.includes("3764e8f1"));
  assert.ok(keys.includes("96651c65-3bd2-4135-b071-f34093987c92"));
});

test("an event answers to the stamp in its own text", () => {
  const ical = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:82018f97",
    "X-EAS-SERVERID:U2f1ad:57a543ff",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const keys = keysOf({ id: "local-1", item: ical }, null);
  assert.ok(keys.includes("U2f1ad:57a543ff"));
});

test("a stamp wrapped across lines is still read whole", () => {
  // Both formats fold long lines, and a ServerId is long enough to be
  // folded in practice; reading the first line only would truncate it.
  const ical =
    "BEGIN:VCALENDAR\r\nX-EAS-SERVERID:U2f1ad:57a543ff54dc4fadad3d\r\n bb0ec2054d075c2c78\r\nEND:VCALENDAR";
  const keys = keysOf({ id: "local-1", item: ical }, null);
  assert.ok(
    keys.includes("U2f1ad:57a543ff54dc4fadad3dbb0ec2054d075c2c78"),
    `folded value not rejoined: ${JSON.stringify(keys)}`,
  );
});

test("a card is resolved by the id the changelog names, not by its own", () => {
  // The failure this exists for: the changelog names the stamp, the
  // contacts API reports a different id, and matching on the API's id
  // alone finds nothing and drops every unsent contact in silence.
  const vCard = "BEGIN:VCARD\r\nUID:3764e8f1\r\nEND:VCARD";
  const r = resolveTarget(
    { added: ["96651c65-3bd2-4135-b071-f34093987c92"], modified: [], deleted: [] },
    [{ id: "3764e8f1", vCard }],
    { "3764e8f1": { "X-EAS-SERVERID": "96651c65-3bd2-4135-b071-f34093987c92" } },
  );
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].data, vCard);
  // Never sent, so the server has no id for it - and that is recorded as a
  // fact rather than left for a reader to deduce from the id's look.
  assert.equal(r.items[0].serverId, null);
});

test("an edit to an item the server holds keeps the server's id", () => {
  const vCard = "BEGIN:VCARD\r\nUID:card-1\r\nEND:VCARD";
  const serverId = "Ued67e:57a543ff54dc4fadad3dbb0ec2054d075c2c78000000";
  const r = resolveTarget(
    { added: [], modified: [serverId], deleted: [] },
    [{ id: "card-1", vCard }],
    { "card-1": { "X-EAS-SERVERID": serverId } },
  );
  assert.deepEqual(r.items, [{ op: "modified", serverId, data: vCard }]);
});

test("a deletion is an edit with an id and no data", () => {
  const serverId = "U9fc3a:57a543ff54dc4fadad3dbb0ec2054d078c7279000000";
  const r = resolveTarget({ added: [], modified: [], deleted: [serverId] }, [], null);
  assert.deepEqual(r.items, [{ op: "deleted", serverId, data: null }]);
});

test("a card read straight from the contacts API is still recovered", () => {
  // The API puts the vCard at `properties.vCard`; a wrapper lifts it to the
  // top level. Reading only the lifted shape reported the item as gone and
  // dropped it - silently, since "no longer present" is a legitimate
  // outcome. Measured live: two of three items rescued, the contact lost.
  const vCard = "BEGIN:VCARD\r\nUID:3764e8f1\r\nEND:VCARD";
  const r = resolveTarget(
    { added: ["96651c65"], modified: [], deleted: [] },
    [{ id: "3764e8f1", properties: { vCard } }],
    { "3764e8f1": { "X-EAS-SERVERID": "96651c65" } },
  );
  assert.equal(r.items.length, 1, "the card must be found in either shape");
  assert.equal(r.items[0].data, vCard);
});

test("the bytes are carried, not rebuilt", () => {
  const ical =
    "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:82018f97\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const r = resolveTarget(
    { added: ["82018f97"], modified: [], deleted: [] },
    [{ id: "82018f97", item: ical }],
    null,
  );
  assert.equal(r.items[0].data, ical);
});

test("an id is carried byte for byte, colons and all", () => {
  // One ServerId composed by the server, not a prefix we added. Nothing
  // splits it, and nothing matches on a part of it.
  const serverId = "Ued67e:57a543ff54dc4fadad3dbb0ec2054d075c2c78000000";
  const vCard = `BEGIN:VCARD\r\nUID:card-1\r\nX-EAS-SERVERID:${serverId}\r\nEND:VCARD`;
  const r = resolveTarget(
    { added: [], modified: [serverId], deleted: [] },
    [{ id: "card-1", vCard }],
    null,
  );
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].serverId, serverId);
});

test("a ServerId that is itself colon-shaped resolves to its own item", () => {
  // Some servers issue ids like `6:125`. A split on the colon would look
  // up `6` and pair the wrong item, or none.
  const nodes = [
    { id: "a", vCard: "BEGIN:VCARD\r\nX-EAS-SERVERID:6:125\r\nEND:VCARD" },
    { id: "b", vCard: "BEGIN:VCARD\r\nX-EAS-SERVERID:6:1250\r\nEND:VCARD" },
  ];
  const r = resolveTarget({ added: [], modified: ["6:125"], deleted: [] }, nodes, null);
  assert.deepEqual(r.items, [
    { op: "modified", serverId: "6:125", data: nodes[0].vCard },
  ]);
});

test("a row naming an item the resource does not hold yields nothing", () => {
  // No data behind it, so nothing could ever be replayed from it, and an
  // opaque id with no item is not something anyone can be shown or act on.
  // A deletion is different: it never had an item to find.
  const r = resolveTarget(
    { added: [], modified: ["gone"], deleted: ["bye"] },
    [],
    null,
  );
  assert.deepEqual(r.items, [
    { op: "deleted", serverId: "bye", data: null },
  ]);
});

test("a key two items both answer to identifies neither", () => {
  const nodes = [
    { id: "a", vCard: "BEGIN:VCARD\r\nX-EAS-SERVERID:same\r\nEND:VCARD" },
    { id: "b", vCard: "BEGIN:VCARD\r\nX-EAS-SERVERID:same\r\nEND:VCARD" },
  ];
  const r = resolveTarget({ added: [], modified: ["same"], deleted: [] }, nodes, null);
  assert.deepEqual(r.items, []);
});

test("an item present but empty is not rescued blank", () => {
  const r = resolveTarget(
    { added: ["x"], modified: [], deleted: [] },
    [{ id: "x" }],
    null,
  );
  assert.deepEqual(r.items, []);
});
