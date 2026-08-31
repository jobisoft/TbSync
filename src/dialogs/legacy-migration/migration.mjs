/**
 * Migrating a carried-over account.
 *
 * The account is locked: it cannot sync, its resources cannot be edited,
 * and it cannot be disconnected, because it holds changes a previous
 * version never sent and no server can give those back. This window is the
 * way out. It rebuilds every resource from the server, then offers the
 * rescued changes back and lets the user choose which to restore.
 *
 * Three states, one window: what is about to happen, what is happening, and
 * what was kept. Closing it before the first step changes nothing - the
 * account is still locked and the offer still stands.
 *
 * It talks over the same port the manager uses. The port is named, not
 * page-bound, so this needs no plumbing of its own, and the progress that
 * arrives while the rebuild runs is the ordinary broadcast every connected
 * page gets.
 */

import { localizeDocument } from "../../vendor/i18n/i18n.mjs";
import { createManagerClient } from "../../modules/manager-client.mjs";
import { buildZip } from "../../modules/zip.mjs";

const $ = (id) => document.getElementById(id);
const i18n = (key, fallback, subs) =>
  browser.i18n.getMessage(key, subs) || fallback;

const accountId = new URLSearchParams(location.search).get("accountId");

let offer = null;
let plan = null;

const client = createManagerClient({
  onEvent: (event) => {
    if (event?.type !== "migration-progress") return;
    if (event.accountId !== accountId) return;
    $("running-step").textContent =
      event.step === "syncing"
        ? i18n(
            "migration.running.syncing",
            `Downloading ${event.folder}…`,
            [event.folder],
          )
        : i18n(
            "migration.running.replacing",
            `Replacing ${event.folder}…`,
            [event.folder],
          );
  },
});

function show(which) {
  for (const id of ["intro", "running", "replay", "done"]) {
    $(id).hidden = id !== which;
  }
}

function showError(err) {
  const box = $("error");
  box.textContent = String(err?.message ?? err);
  box.classList.add("visible");
}

function checkboxes() {
  return [...document.querySelectorAll("#rows input[type=checkbox]:not(:disabled)")];
}

/** Created and edited are taken by default; a deletion is not. Removing
 *  something is the one operation here that cannot be undone by the next
 *  sync, so it is the one the user has to ask for. */
function defaultTaken(op) {
  return op === "added" || op === "modified";
}

/** What the thing is, rather than where it lives. The folder it belongs to
 *  is one of this account's own and says little; whether a row is about a
 *  contact, an appointment or a task is what makes a mixed list readable. */
function typeLabel(type) {
  if (type === "contacts") return i18n("migration.type.contact", "Contact");
  if (type === "tasks") return i18n("migration.type.task", "Task");
  if (type === "list") return i18n("migration.type.list", "Mailing list");
  return i18n("migration.type.event", "Event");
}

function operationLabel(op) {
  if (op === "added") return i18n("migration.op.added", "Add");
  if (op === "modified") return i18n("migration.op.modified", "Update");
  return i18n("migration.op.deleted", "Delete");
}

function render() {
  const body = $("rows");
  body.replaceChildren();
  let total = 0;
  for (const folder of plan.folders) {
    for (const row of folder.rows) {
      total++;
      const tr = document.createElement("tr");
      if (!row.available) tr.className = "unavailable";

      const check = document.createElement("td");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.rescueId = row.rescueId;
      box.checked = row.available && defaultTaken(row.op);
      box.disabled = !row.available;
      box.addEventListener("change", syncCheckAll);
      check.append(box);

      const what = document.createElement("td");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "reveal";
      toggle.textContent =
        row.name || i18n("migration.item.unnamed", "(no name)");
      what.append(toggle);

      const op = document.createElement("td");
      op.className = row.available ? `op ${row.op}` : "op gone";
      op.textContent = row.available
        ? operationLabel(row.op)
        : i18n("migration.op.gone", "no longer on the server");

      const type = document.createElement("td");
      type.textContent = typeLabel(row.type);

      tr.append(check, what, op, type);
      body.append(tr);

      // What the change actually is, under the row that offers it. Folded
      // away to begin with: the list is for choosing, and a page of
      // properties per row would bury it.
      const detail = document.createElement("tr");
      detail.className = "detail";
      detail.hidden = true;
      const cell = document.createElement("td");
      cell.colSpan = 4;
      const pre = document.createElement("div");
      pre.className = "diff";
      for (const { mark, line } of row.detail ?? []) {
        const div = document.createElement("div");
        div.className =
          mark === "+" ? "added" : mark === "-" ? "removed" : "same";
        div.textContent = `${mark} ${line}`;
        pre.append(div);
      }
      if (!row.detail?.length) {
        pre.textContent = i18n("migration.detail.empty", "Nothing to show.");
      }
      cell.append(pre);
      detail.append(cell);
      body.append(detail);
      toggle.addEventListener("click", () => {
        detail.hidden = !detail.hidden;
        toggle.classList.toggle("open", !detail.hidden);
      });
    }
  }

  $("replay-lead").textContent = total
    ? i18n(
        "migration.replay.lead",
        "Your resources have been rebuilt from the server. Please select " +
          "which of the rescued local changes should be restored:",
      )
    : i18n(
        "migration.replay.none",
        "Your resources have been rebuilt from the server. There are no " +
          "rescued local changes to restore.",
      );
  syncCheckAll();
  show("replay");
}

/** The header box reports the rows rather than holding a state of its own:
 *  checked when every row it can reach is taken, indeterminate while they
 *  disagree. A row the server no longer has is disabled and out of its
 *  reach, so a table of nothing but those leaves it disabled too. */
function syncCheckAll() {
  const boxes = checkboxes();
  const taken = boxes.filter((b) => b.checked).length;
  const all = $("check-all");
  all.disabled = !boxes.length;
  all.checked = boxes.length > 0 && taken === boxes.length;
  all.indeterminate = taken > 0 && taken < boxes.length;
}

$("check-all").addEventListener("change", (event) => {
  for (const box of checkboxes()) box.checked = event.target.checked;
  syncCheckAll();
});

async function load() {
  localizeDocument();
  try {
    offer = await client.rpc("getMigrationOffer", { accountId });
  } catch (err) {
    showError(err);
    return;
  }
  $("intro-text").textContent = i18n(
    "migration.intro.lead",
    `${offer.changes} changes to "${offer.accountName}" were never synchronized with the server and have been rescued.`,
    [String(offer.changes), offer.accountName],
  );
  show("intro");
}

$("btn-download").addEventListener("click", async () => {
  try {
    const { files } = await client.rpc("getRescueBackup", { accountId });
    if (!files.length) return;
    const encoder = new TextEncoder();
    const url = URL.createObjectURL(
      buildZip(files.map((f) => ({ name: f.name, data: encoder.encode(f.text) }))),
    );
    await browser.downloads.download({
      url,
      filename: `tbsync-local-only-changes-${accountId}.zip`,
      saveAs: true,
    });
    // Freed once the download has been handed over, not before: revoking a
    // blob url the download has not read yet cancels it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    showError(err);
  }
});

$("btn-start").addEventListener("click", async () => {
  show("running");
  $("running-step").textContent = "";
  try {
    plan = await client.rpc("startMigration", { accountId });
  } catch (err) {
    showError(err);
    show("intro");
    return;
  }
  render();
});

$("btn-apply").addEventListener("click", async () => {
  const take = checkboxes()
    .filter((c) => c.checked)
    .map((c) => c.dataset.rescueId);
  $("btn-apply").disabled = true;
  try {
    const result = await client.rpc("applyMigration", { accountId, take });
    // A mailing list is one of the rescued changes the count on the first
    // screen offered, and it is restored through its own step rather than
    // the per-item one, so it is counted back in here.
    const restored = result.applied + result.lists;
    $("done-text").textContent = i18n(
      "migration.done",
      `${restored} changes were restored and are waiting to be synchronized. The account is ready to use.`,
      [String(restored)],
    );
    show("done");
  } catch (err) {
    showError(err);
    $("btn-apply").disabled = false;
  }
});

$("btn-close").addEventListener("click", () => window.close());

load();
