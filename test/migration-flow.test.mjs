/**
 * Unit tests for the decisions of the in-place migration.
 *
 * Outside `src/`, because that tree is what the add-on ships. Run with
 * `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bootStepsFrom,
  countHeld,
  findFailure,
  foldersToRebuild,
  hasComeBack,
} from "../src/modules/migration-flow.mjs";
import { ERR } from "../src/vendor/tbsync/protocol.mjs";

const row = (over = {}) => ({
  folderId: "f1",
  displayName: "Calendar",
  selected: true,
  targetID: "t1",
  status: "success",
  ...over,
});

test("countHeld counts what is owed and ignores context entries", () => {
  assert.equal(countHeld(undefined), 0);
  assert.equal(countHeld({ folders: [] }), 0);
  assert.equal(
    countHeld({
      folders: [
        { items: [{ op: "added" }, { op: "context" }, { op: "deleted" }] },
        { items: [{ op: "modified" }] },
        {},
      ],
    }),
    3,
  );
});

test("a pulled, bound, selected folder has come back", () => {
  assert.equal(hasComeBack(row()), true);
  assert.equal(hasComeBack(row({ status: "warning" })), true);
});

test("a carried-over row, a failed one, an unbound one and a deselected one have not", () => {
  assert.equal(hasComeBack(row({ status: null })), false);
  assert.equal(hasComeBack(row({ status: "error" })), false);
  assert.equal(hasComeBack(row({ status: "aborted" })), false);
  assert.equal(hasComeBack(row({ targetID: null })), false);
  assert.equal(hasComeBack(row({ selected: false })), false);
  assert.equal(hasComeBack(undefined), false);
});

test("the rebuild takes the recorded folders that have not come back", () => {
  const rows = [
    row({ folderId: "a", status: null }), // carried over, never pulled
    row({ folderId: "b" }), // already back
    row({ folderId: "c", targetID: null, status: null }), // a failed attempt
    row({ folderId: "d", selected: false, targetID: null, status: null }), // a crash between deselect and reselect
    row({ folderId: "e", status: null }), // not in the recorded selection
  ];
  assert.deepEqual(foldersToRebuild(["a", "b", "c", "d"], rows), [
    "a",
    "c",
    "d",
  ]);
});

test("a recorded folder whose row is gone is dropped, and no record means no work", () => {
  assert.deepEqual(foldersToRebuild(["gone"], [row()]), []);
  assert.deepEqual(foldersToRebuild(undefined, [row()]), []);
});

test("everything pulled is no failure", () => {
  assert.equal(
    findFailure({
      account: { error: null },
      rows: [row(), row({ folderId: "f2", status: "warning" })],
    }),
    null,
  );
});

test("a rejected login is reported as one, whatever the folders say", () => {
  const failure = findFailure({
    account: { error: ERR.AUTH },
    rows: [row({ status: null })],
  });
  assert.equal(failure.code, ERR.AUTH);
  assert.match(failure.message, /login/);
});

test("a folder that did not come back is named with its reason", () => {
  const failure = findFailure({
    account: { error: null },
    rows: [row(), row({ displayName: "Tasks", status: "error", error: "boom" })],
  });
  assert.equal(failure.code, null);
  assert.match(failure.message, /"Tasks"/);
  assert.match(failure.message, /boom/);
});

test("a selected folder without a binding is a failure", () => {
  const failure = findFailure({
    account: {},
    rows: [row({ targetID: null, status: null, displayName: "Contacts" })],
  });
  assert.match(failure.message, /"Contacts"/);
  assert.match(failure.message, /no answer/);
});

test("a deselected row is not asked about", () => {
  assert.equal(
    findFailure({
      account: {},
      rows: [row({ selected: false, targetID: null, status: null })],
    }),
    null,
  );
});

test("the boot goes on from the last step that finished", () => {
  assert.deepEqual(bootStepsFrom("imported"), ["freeze", "rescue"]);
  assert.deepEqual(bootStepsFrom("frozen"), ["rescue"]);
});

test("a boot that has finished its steps, or has none to know about, does nothing", () => {
  assert.deepEqual(bootStepsFrom("rescued"), []);
  assert.deepEqual(bootStepsFrom(true), []);
  assert.deepEqual(bootStepsFrom(false), []);
  assert.deepEqual(bootStepsFrom(undefined), []);
});
