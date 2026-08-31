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
  backupFiles,
  contentLines,
  diffLines,
  displayNameOf,
  easServerIdOf,
  effectiveOp,
  groupVCardToList,
  identityOf,
  isGroup,
  keysOf,
  listToGroupVCard,
  parseLegacyChangelog,
  resolveTarget,
  stripIdentity,
  transplantIdentity,
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
  assert.deepEqual(r.items, [
    { rescueId: "r1", op: "modified", serverId, data: vCard },
  ]);
});

test("a deletion is an edit with an id and no data", () => {
  const serverId = "U9fc3a:57a543ff54dc4fadad3dbb0ec2054d078c7279000000";
  const r = resolveTarget({ added: [], modified: [], deleted: [serverId] }, [], null);
  assert.deepEqual(r.items, [
    { rescueId: "r1", op: "deleted", serverId, data: null },
  ]);
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
    { rescueId: "r1", op: "modified", serverId: "6:125", data: nodes[0].vCard },
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
    { rescueId: "r1", op: "deleted", serverId: "bye", data: null },
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

test("every entry gets an id of the record's own, and a creation can be named by it", () => {
  // A list points at a card only this record holds, and that pointer has to
  // be to the entry - there is nothing else to point at, since the card has
  // no id on the server and the one it had locally is not kept.
  const vCard = "BEGIN:VCARD\r\nFN:new\r\nEND:VCARD";
  const r = resolveTarget(
    { added: ["placeholder-1"], modified: [], deleted: [] },
    [{ id: "card-1", vCard }],
    { "card-1": { "X-EAS-SERVERID": "placeholder-1" } },
  );
  assert.equal(r.items[0].rescueId, "r1");
  assert.equal(r.createdBy.get("placeholder-1"), "r1");
});

test("an id names an entry, and only entries this run creates get named", () => {
  // An edited item is found again by its own server id, so nothing needs to
  // point at its entry - and pointing at it would say "re-created", which
  // is not what happens to it.
  const vCard = "BEGIN:VCARD\r\nFN:x\r\nEND:VCARD";
  const r = resolveTarget(
    { added: [], modified: ["Ued67e:57a5"], deleted: [] },
    [{ id: "card-1", vCard }],
    { "card-1": { "X-EAS-SERVERID": "Ued67e:57a5" } },
  );
  assert.equal(r.items[0].rescueId, "r1");
  assert.equal(r.createdBy.size, 0);
});

test("a list becomes a group vCard and comes back the same", () => {
  const data = listToGroupVCard({
    name: "Team; Nord",
    nickName: "team",
    description: "two\nlines",
    members: [{ serverId: "Ued67e:57a5" }, { rescueId: "r4" }],
  });
  assert.ok(isGroup(data));
  assert.deepEqual(groupVCardToList(data), {
    name: "Team; Nord",
    nickName: "team",
    description: "two\nlines",
    members: [{ serverId: "Ued67e:57a5" }, { rescueId: "r4" }],
  });
});

test("a contact is not a list", () => {
  assert.equal(isGroup("BEGIN:VCARD\r\nFN:Someone\r\nEND:VCARD"), false);
  assert.equal(groupVCardToList("BEGIN:VCARD\r\nKIND:individual\r\nEND:VCARD"), null);
});

test("the stamp is read from a card property or from the text", () => {
  // The previous version kept a card's in a property; this one writes it
  // into the vCard. Both are the same question.
  assert.equal(
    easServerIdOf({ id: "c1" }, { c1: { "X-EAS-SERVERID": "Ued67e:57a5" } }),
    "Ued67e:57a5",
  );
  assert.equal(
    easServerIdOf({ id: "c2", vCard: "BEGIN:VCARD\r\nX-EAS-SERVERID:6:125\r\nEND:VCARD" }, null),
    "6:125",
  );
  assert.equal(easServerIdOf({ id: "c3", vCard: "BEGIN:VCARD\r\nEND:VCARD" }, null), null);
});

// An update changes what the user wrote and nothing else. Afterwards the
// item's UID and every X-EAS-* property are exactly what they were.
const SERVER_EVENT = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:server-uid",
  "SUMMARY:as the server has it",
  "X-EAS-SERVERID:U2f1ad:57a543ff",
  "X-EAS-MEETINGSTATUS:1",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const RESCUED_EVENT = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:the-old-uid",
  "SUMMARY:what the user wrote",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("an update leaves the UID and every stamp exactly as they were", () => {
  const before = identityOf(SERVER_EVENT);
  const after = identityOf(
    transplantIdentity({ from: SERVER_EVENT, into: RESCUED_EVENT }),
  );
  assert.equal(after.uid, before.uid);
  assert.deepEqual(after.stamps, before.stamps);
});

test("an update still carries the user's content", () => {
  const out = transplantIdentity({ from: SERVER_EVENT, into: RESCUED_EVENT });
  assert.ok(out.includes("SUMMARY:what the user wrote"));
  assert.ok(!out.includes("SUMMARY:as the server has it"));
  assert.ok(!out.includes("the-old-uid"));
});

test("a recurring item keeps a UID on every component", () => {
  // A master and its overrides all carry one and all name the same item, so
  // rewriting only the first would leave the rest naming something else.
  const rescued = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:the-old-uid",
    "SUMMARY:series",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:the-old-uid",
    "RECURRENCE-ID:20260901T090000",
    "SUMMARY:one occurrence",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const out = transplantIdentity({ from: SERVER_EVENT, into: rescued });
  const uids = out.split("\r\n").filter((l) => l.startsWith("UID:"));
  assert.deepEqual(uids, ["UID:server-uid", "UID:server-uid"]);
  // And the stamps go back once, on the component holding the first of them.
  assert.equal(out.split("\r\n").filter((l) => l.startsWith("X-EAS-")).length, 2);
});

test("stamps the rescued text should not have are not carried in", () => {
  // Nothing in the record should be stamped, but if anything ever is, the
  // item being updated is what says what its stamps are.
  const impostor = RESCUED_EVENT.replace(
    "SUMMARY:what the user wrote",
    "SUMMARY:what the user wrote\r\nX-EAS-SERVERID:not-this-one",
  );
  const out = transplantIdentity({ from: SERVER_EVENT, into: impostor });
  assert.ok(!out.includes("not-this-one"));
  assert.deepEqual(identityOf(out).stamps, identityOf(SERVER_EVENT).stamps);
});

test("a card is transplanted the same way", () => {
  const server =
    "BEGIN:VCARD\r\nUID:card-uid\r\nFN:Server\r\nX-EAS-SERVERID:Ued67e:57a5\r\nEND:VCARD";
  const rescued = "BEGIN:VCARD\r\nUID:old\r\nFN:What the user typed\r\nEND:VCARD";
  const out = transplantIdentity({ from: server, into: rescued });
  assert.deepEqual(identityOf(out), identityOf(server));
  assert.ok(out.includes("FN:What the user typed"));
});

test("a creation goes in with no identity at all", () => {
  const out = stripIdentity(
    "BEGIN:VCARD\r\nUID:minted-by-the-old-version\r\nX-EAS-SERVERID:placeholder\r\nFN:New\r\nEND:VCARD",
  );
  assert.equal(out, "BEGIN:VCARD\r\nFN:New\r\nEND:VCARD");
});

test("what an entry is called, for showing it", () => {
  assert.equal(displayNameOf("BEGIN:VCARD\r\nFN:Ada Lovelace\r\nEND:VCARD"), "Ada Lovelace");
  assert.equal(displayNameOf("BEGIN:VEVENT\r\nSUMMARY:Team\\, Nord\r\nEND:VEVENT"), "Team, Nord");
  assert.equal(displayNameOf(null), "");
});

test("what is shown of an item is what the user wrote", () => {
  // Not the structure, not the bookkeeping, and not the timezone rules -
  // two copies of one appointment differ in those for reasons that have
  // nothing to do with anybody.
  const ical = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Mozilla.org//EN",
    "VERSION:2.0",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Berlin",
    "BEGIN:STANDARD",
    "DTSTART:18930401T000000",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    "UID:u1",
    "DTSTAMP:20260101T000000Z",
    "LAST-MODIFIED:20260101T000000Z",
    "X-EAS-SERVERID:U2f1ad:57a5",
    "SUMMARY:Test Event",
    "LOCATION:Room 1",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  assert.deepEqual(contentLines(ical), [
    "SUMMARY:Test Event",
    "LOCATION:Room 1",
  ]);
});

test("a folded line is read whole before being shown", () => {
  // The break and the space that marks it both go, so what comes back is
  // the value as it was written.
  assert.deepEqual(
    contentLines("BEGIN:VCARD\r\nNOTE:one \r\n two\r\nEND:VCARD"),
    ["NOTE:one two"],
  );
});

test("a change reads as what it takes away and what it puts", () => {
  const rows = diffLines(
    ["SUMMARY:Test Event", "LOCATION:Room 1"],
    ["SUMMARY:Test Event (edited)", "LOCATION:Room 1"],
  );
  assert.deepEqual(rows, [
    { mark: "-", line: "SUMMARY:Test Event" },
    { mark: "+", line: "SUMMARY:Test Event (edited)" },
    { mark: " ", line: "LOCATION:Room 1" },
  ]);
});

test("a creation is all additions and a deletion all removals", () => {
  assert.deepEqual(diffLines([], ["FN:New"]), [{ mark: "+", line: "FN:New" }]);
  assert.deepEqual(diffLines(["FN:Old"], []), [{ mark: "-", line: "FN:Old" }]);
});

test("properties that came back in another order have not changed", () => {
  // These are fields, not prose: the server is free to hand them over in
  // whatever order it likes.
  const rows = diffLines(["A:1", "B:2"], ["B:2", "A:1"]);
  assert.equal(rows.filter((r) => r.mark !== " ").length, 0);
});

// The backup is for reading elsewhere: ordinary vCard and iCalendar, one
// file per resource, with this installation's own marks taken off.
const BOOK = "book-1";
const CAL = "cal-1";
const INFO = new Map([
  [BOOK, { name: "Kontakte", type: "contacts" }],
  [CAL, { name: "Kalender", type: "calendars" }],
]);
const card = (uid, fn) =>
  `BEGIN:VCARD\r\nVERSION:4.0\r\nFN:${fn}\r\nUID:${uid}\r\nX-EAS-SERVERID:s-${uid}\r\nEND:VCARD`;

test("the provider's marks come off and the item keeps its own id", () => {
  const [file] = backupFiles(
    { folders: [{ folderId: BOOK, items: [{ rescueId: "r1", op: "added", serverId: null, data: card("u1", "One") }] }] },
    INFO,
  );
  assert.equal(file.name, "Kontakte.vcf");
  assert.ok(!file.text.includes("X-EAS-"), "no stamp survives");
  assert.ok(file.text.includes("UID:u1"), "the item keeps its id");
});

test("a list names its members by a reference the file can resolve", () => {
  // Inside the record a member says which kind of name it uses; in a file
  // there is only one thing to point at, so both become urn:uuid.
  const group = [
    "BEGIN:VCARD",
    "VERSION:4.0",
    "KIND:group",
    "FN:Team",
    "MEMBER:x-rescueid:r1",
    "MEMBER:x-serverid:s-u2",
    "END:VCARD",
  ].join("\r\n");
  const [file] = backupFiles(
    {
      folders: [
        {
          folderId: BOOK,
          items: [
            { rescueId: "r1", op: "added", serverId: null, data: card("u1", "One") },
            { rescueId: "r2", op: "added", serverId: null, data: group },
            // the member nobody edited, carried so the list is a list
            { rescueId: "r3", op: "context", serverId: "s-u2", data: card("u2", "Two") },
          ],
        },
      ],
    },
    INFO,
  );
  assert.ok(file.text.includes("MEMBER:urn:uuid:u1"));
  assert.ok(file.text.includes("MEMBER:urn:uuid:u2"));
  assert.ok(file.text.includes("UID:u2"), "the carried member is in the file");
});

test("a member no file holds is dropped rather than left dangling", () => {
  const group =
    "BEGIN:VCARD\r\nVERSION:4.0\r\nKIND:group\r\nFN:Team\r\nMEMBER:x-serverid:s-gone\r\nEND:VCARD";
  const [file] = backupFiles(
    { folders: [{ folderId: BOOK, items: [{ rescueId: "r1", op: "added", serverId: null, data: group }] }] },
    INFO,
  );
  assert.ok(!file.text.includes("MEMBER"), "no reference to nothing");
  assert.ok(file.text.includes("FN:Team"), "the list itself survives");
});

test("a deletion is in no file - there is nothing to import", () => {
  const files = backupFiles(
    { folders: [{ folderId: BOOK, items: [{ rescueId: "r1", op: "deleted", serverId: "s-x", data: null }] }] },
    INFO,
  );
  assert.deepEqual(files, []);
});

test("several kept items become one calendar, with one copy of a timezone", () => {
  const event = (uid, summary) =>
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Berlin",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `SUMMARY:${summary}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
  const [file] = backupFiles(
    {
      folders: [
        {
          folderId: CAL,
          items: [
            { rescueId: "r1", op: "added", serverId: null, data: event("e1", "One") },
            { rescueId: "r2", op: "added", serverId: null, data: event("e2", "Two") },
          ],
        },
      ],
    },
    INFO,
  );
  assert.equal(file.name, "Kalender.ics");
  assert.equal(file.text.match(/BEGIN:VCALENDAR/g).length, 1, "one wrapper");
  assert.equal(file.text.match(/BEGIN:VTIMEZONE/g).length, 1, "one timezone");
  assert.equal(file.text.match(/BEGIN:VEVENT/g).length, 2);
});

test("a folder name that could not be a file name still becomes one", () => {
  const info = new Map([[BOOK, { name: "Kon/takte: *?", type: "contacts" }]]);
  const [file] = backupFiles(
    { folders: [{ folderId: BOOK, items: [{ rescueId: "r1", op: "added", serverId: null, data: card("u1", "One") }] }] },
    info,
  );
  assert.ok(!/[\\/:*?"<>|]/.test(file.name), `unusable name: ${file.name}`);
});

/* ------------------------------------------------------------------ *
 * What a rescued change can still do.
 *
 * The folder has been rebuilt from the server, so an item the server no
 * longer has is not there. A change made against it cannot be applied as a
 * change, and dropping it is the one outcome that loses the user's work, so
 * it goes back as a creation. A deletion in that state has already
 * happened.
 * ------------------------------------------------------------------ */

test("a change is a change while its item is there", () => {
  const present = new Map([["S1", { id: "local-1" }]]);
  assert.equal(effectiveOp({ op: "modified", serverId: "S1" }, present), "modified");
  assert.equal(effectiveOp({ op: "deleted", serverId: "S1" }, present), "deleted");
});

test("a change whose item is gone becomes a creation", () => {
  assert.equal(effectiveOp({ op: "modified", serverId: "S1" }, new Map()), "added");
});

test("a deletion whose item is gone is already done", () => {
  assert.equal(effectiveOp({ op: "deleted", serverId: "S1" }, new Map()), null);
});

test("a creation is a creation whatever the folder holds", () => {
  assert.equal(effectiveOp({ op: "added", serverId: null }, new Map()), "added");
  assert.equal(
    effectiveOp({ op: "added", serverId: null }, new Map([["S1", { id: "x" }]])),
    "added",
  );
});

test("an id is compared whole, never taken apart", () => {
  const serverId = "Ued67e:57a543ff54dc4fadad3dbb0ec2054d075c2c78000000";
  const present = new Map([[serverId, { id: "local-1" }]]);
  assert.equal(effectiveOp({ op: "modified", serverId }, present), "modified");
  assert.equal(
    effectiveOp({ op: "modified", serverId: serverId.split(":")[1] }, present),
    "added",
  );
});
