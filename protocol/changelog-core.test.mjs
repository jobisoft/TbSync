/**
 * Unit tests for the changelog core: `applyEvent` and the op-matched
 * pre-tag consumption. Run with `npm test` (node --test).
 *
 * The rule under test: a `*_by_server` pre-tag is an ANNOUNCEMENT of an
 * imminent provider write, and only that write's event may consume it.
 * Any other event inside the freeze window is ignored outright - not
 * recorded, and the tag stays armed. After FREEZE_MS a stale tag is
 * dropped and the event is applied normally.
 *
 * The core is the file every consumer vendors, so one run of these covers
 * the host and every provider at once.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyEvent,
  FREEZE_MS,
  markServerWriteUpdater,
  moveToTailUpdater,
  OP_FOR_TAG,
  recordUserEditUpdater,
  removeEntryUpdater,
} from "./changelog-core.mjs";

const NOW = 1_000_000;
const P = "book-1";
const I = "item-1";

function tag(status, ageMs = 0) {
  return {
    kind: "contact",
    parentId: P,
    itemId: I,
    timestamp: NOW - ageMs,
    status,
  };
}

function event(op, overrides = {}) {
  return { kind: "contact", parentId: P, itemId: I, name: null, op, now: NOW, ...overrides };
}

const TAGS = ["added_by_server", "modified_by_server", "deleted_by_server"];
const OPS = ["created", "updated", "deleted"];

test("each tag is consumed by exactly its announced op", () => {
  for (const status of TAGS) {
    const out = applyEvent([tag(status)], event(OP_FOR_TAG[status]));
    assert.deepEqual(out, [], `${status} must be consumed by ${OP_FOR_TAG[status]}`);
  }
});

test("a non-matching op is ignored and the tag stays armed (full matrix)", () => {
  for (const status of TAGS) {
    for (const op of OPS) {
      if (OP_FOR_TAG[status] === op) continue;
      const entries = [tag(status)];
      const out = applyEvent(entries, event(op));
      assert.equal(
        out,
        entries,
        `${status} + ${op}: must return the SAME array - nothing recorded, tag kept`,
      );
    }
  }
});

test("S1: interim edit under a deleted_by_server tag leaves an empty changelog", () => {
  // The scenario that motivated the rule: deletion announced, a real user
  // modification lands in the window, then the announced deletion arrives.
  // The modification is moot (the item is going away) and the end state
  // must be a clean changelog - no phantom deleted_by_user, no redundant
  // Delete push.
  let entries = [tag("deleted_by_server")];
  entries = applyEvent(entries, event("updated"));
  assert.equal(entries.length, 1, "the interim edit must not consume the tag");
  assert.equal(entries[0].status, "deleted_by_server");
  entries = applyEvent(entries, event("deleted"));
  assert.deepEqual(entries, [], "the announced deletion consumes the tag");
});

test("a stale tag is dropped and the event applies normally", () => {
  const out = applyEvent([tag("deleted_by_server", FREEZE_MS + 1)], event("updated"));
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "modified_by_user", "stale tag gone, real edit recorded");
});

test("no tag: the user state machine is untouched", () => {
  // add + delete cancels
  let entries = applyEvent([], event("created"));
  assert.equal(entries[0].status, "added_by_user");
  entries = applyEvent(entries, event("deleted"));
  assert.deepEqual(entries, [], "add+del must cancel");
  // double delete is a no-op
  entries = applyEvent([], event("deleted"));
  assert.equal(entries[0].status, "deleted_by_user");
  const again = applyEvent(entries, event("deleted"));
  assert.equal(again, entries, "double delete must be skipped");
});

test("a same-id row of another kind survives the event untouched", () => {
  // A changelog row's identity is the triple (parentId, itemId, kind).
  // A list pre-tag neither suppresses a contact event with the same ids
  // nor is destroyed by its transition - the contact event records
  // alongside it. (This pinned the item-4 unification: before it, the
  // status-blind transition filter silently deleted the foreign row.)
  const entries = [{ ...tag("added_by_server"), kind: "list" }];
  const out = applyEvent(entries, event("created"));
  assert.equal(out.length, 2, "both rows present");
  assert.ok(out.some((e) => e.kind === "list" && e.status === "added_by_server"));
  assert.ok(out.some((e) => e.kind === "contact" && e.status === "added_by_user"));
});

test("list-by-name pull-create consumption is unaffected", () => {
  const entries = [
    {
      kind: "list-by-name",
      parentId: P,
      itemId: "My List",
      timestamp: NOW,
      status: "added_by_server",
    },
  ];
  const out = applyEvent(
    entries,
    event("created", { kind: "list", itemId: "real-id-1", name: "My List" }),
  );
  assert.deepEqual(out, [], "the named pre-tag is consumed by the list create");
});

// ── The updaters ──────────────────────────────────────────────────────────
//
// The four mutations a changelog owner can perform, whether it keeps its
// queue in a host folder row or in its own storage.

const row = (overrides = {}) => ({
  kind: "event",
  parentId: P,
  itemId: I,
  op: "updated",
  now: NOW,
  ...overrides,
});

test("recordUserEdit folds an edit into what is already queued", () => {
  // First edit queues; a second edit of the same item is a no-op, so the
  // caller doesn't fire one UI update per item on a bulk change.
  const first = recordUserEditUpdater([], row({ op: "created" }));
  assert.equal(first.changed, true);
  assert.equal(first.entries[0].status, "added_by_user");

  const second = recordUserEditUpdater(first.entries, row({ op: "updated" }));
  assert.equal(second.changed, false, "an update on a pending add is a no-op");
  assert.equal(second.entries, first.entries, "same array, no storage write");

  // add + delete cancels: nothing was ever on the server.
  const third = recordUserEditUpdater(first.entries, row({ op: "deleted" }));
  assert.equal(third.changed, true);
  assert.deepEqual(third.entries, []);
});

test("recordUserEdit keeps the EARLIEST detail across edits", () => {
  // `detail` is the pre-edit baseline: two edits between syncs are one
  // delta measured against the version the server last gave us, never an
  // intermediate it never saw.
  const first = recordUserEditUpdater([], row({ op: "updated", detail: "v1" }));
  const second = recordUserEditUpdater(
    first.entries,
    row({ op: "deleted", detail: "v2" }),
  );
  assert.equal(second.entries[0].status, "deleted_by_user");
  assert.equal(second.entries[0].detail, "v1", "the first baseline survives");
});

test("recordUserEdit backfills a detail a queued row lacks", () => {
  const queued = recordUserEditUpdater([], row({ op: "updated" }));
  assert.equal(queued.entries[0].detail, undefined);
  const filled = recordUserEditUpdater(
    queued.entries,
    row({ op: "updated", detail: "v1" }),
  );
  assert.equal(filled.entries[0].detail, "v1");
  assert.equal(filled.changed, false, "backfilling is not a user-facing change");
});

test("markServerWrite replaces the row it covers", () => {
  const queued = recordUserEditUpdater([], row({ op: "updated" })).entries;
  const tagged = markServerWriteUpdater(queued, {
    parentId: P,
    itemId: I,
    kind: "event",
    status: "modified_by_server",
    now: NOW,
  });
  assert.equal(tagged.length, 1, "the pre-tag replaces, it does not stack");
  assert.equal(tagged[0].status, "modified_by_server");
});

test("removeEntry takes the user edit and never the pre-tag", () => {
  // The two live in one list and are told apart only by status. A removal
  // that ignored status took whichever was there - and after a
  // markServerWrite that is the pre-tag, which left the observer nothing to
  // recognise: the item went dirty the moment it was pushed clean.
  const entries = [
    { kind: "event", parentId: P, itemId: I, timestamp: NOW, status: "modified_by_user" },
    { kind: "event", parentId: P, itemId: "other", timestamp: NOW, status: "added_by_server" },
  ];
  const out = removeEntryUpdater(entries, {
    parentId: P,
    itemId: I,
    kind: "event",
  });
  assert.deepEqual(out, [entries[1]], "only the user edit goes");

  const kept = removeEntryUpdater(entries, {
    parentId: P,
    itemId: "other",
    kind: "event",
  });
  assert.equal(kept.length, 2, "a pre-tag is not a queued edit - it stays");
});

test("removeEntry ignores a same-id row of another kind", () => {
  const entries = [
    { kind: "event", parentId: P, itemId: I, timestamp: NOW, status: "modified_by_user" },
    { kind: "task", parentId: P, itemId: I, timestamp: NOW, status: "modified_by_user" },
  ];
  const out = removeEntryUpdater(entries, { parentId: P, itemId: I, kind: "event" });
  assert.deepEqual(out, [entries[1]], "the task row is another item's bookkeeping");
});

test("moveToTail re-orders without rewriting", () => {
  const mk = (itemId) => ({
    kind: "event",
    parentId: P,
    itemId,
    timestamp: NOW,
    status: "modified_by_user",
  });
  const entries = [mk("a"), mk("b"), mk("c")];
  const out = moveToTailUpdater(entries, [
    { parentId: P, itemId: "a", kind: "event" },
  ]);
  assert.deepEqual(
    out.map((e) => e.itemId),
    ["b", "c", "a"],
    "the failing item waits behind the rest of the queue",
  );
  assert.equal(out[2], entries[0], "the row itself is untouched");

  const none = moveToTailUpdater(entries, [
    { parentId: P, itemId: "zz", kind: "event" },
  ]);
  assert.equal(none, entries, "no match: same array, no storage write");
});
