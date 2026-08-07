/**
 * Unit tests for the changelog watcher's pure core: `applyEvent` and the
 * op-matched pre-tag consumption. Run with `npm test` (node --test).
 *
 * The rule under test: a `*_by_server` pre-tag is an ANNOUNCEMENT of an
 * imminent provider write, and only that write's event may consume it.
 * Any other event inside the freeze window is ignored outright - not
 * recorded, and the tag stays armed. After FREEZE_MS a stale tag is
 * dropped and the event is applied normally.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { __internals } from "../src/modules/changelog-watcher.mjs";

const { applyEvent, OP_FOR_TAG, FREEZE_MS } = __internals;

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
