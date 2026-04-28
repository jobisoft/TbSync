import * as folders from "./folders.mjs";
import * as ui from "./messaging-ui.mjs";

/**
 * Host-owned observer for Thunderbird address-book events. Writes
 * provider-agnostic entries into `folder.changelog` for any book bound to
 * a folder with `targetID`. Providers consume the queue at sync time via
 * `getAccount()` and clear processed entries via
 * `PROVIDER_CMD.CHANGELOG_REMOVE`; they pre-tag sync writes with
 * `*_by_server` entries via `PROVIDER_CMD.CHANGELOG_MARK_SERVER_WRITE` so
 * their own TB events don't echo back as user changes.
 *
 * Entry shape (legacy-exact):
 *   { parentId, itemId, timestamp, status }
 * Statuses:
 *   added_by_user / modified_by_user / deleted_by_user      - provider consumes
 *   added_by_server / modified_by_server / deleted_by_server - suppression pre-tags
 *
 * The observer runs a state machine at event time (add+del cancels, etc.)
 * so the changelog is always in consolidated form. No separate consolidate
 * pass is needed at sync time.
 */

// Legacy's freeze window. A *_by_server entry younger than this prevents
// the next observer event for the same (parentId, itemId) from being
// logged as user-initiated. After this age, the pre-tag is considered
// stale and cleared.
const FREEZE_MS = 1500;

// When true, a fresh *_by_server pre-tag is REMOVED from the changelog as
// soon as its announced event arrives - the row was a single-use freeze
// marker, not durable state. When false (legacy behavior), the row is
// kept alive within FREEZE_MS so a hypothetical follow-up event (e.g. a
// stamp-update emitted by TB right after a create) can also be
// suppressed by the same tag.
//
// Flip to `false` to restore keep-alive if a future TB version (or a
// different provider) starts emitting follow-ups - the leak will return
// but suppression will cover both events.
const DROP_SERVER_TAGS_ON_CONSUME = true;

// bookId → {accountId, folderId}. Rebuilt from folder rows on startup and
// on every folders-changed broadcast.
const registry = new Map();

export async function init() {
  // One-shot listener registration - TB fires these for every address-book
  // mutation regardless of provenance; we filter by registry.
  messenger.contacts.onCreated.addListener(node => handle("contact", "created", node));
  messenger.contacts.onUpdated.addListener(node => handle("contact", "updated", node));
  messenger.contacts.onDeleted.addListener((parentId, id) =>
    handle("contact", "deleted", { parentId, id })
  );
  messenger.mailingLists.onCreated.addListener(node => handle("list", "created", node));
  messenger.mailingLists.onUpdated.addListener(node => handle("list", "updated", node));
  messenger.mailingLists.onDeleted.addListener((parentId, id) =>
    handle("list", "deleted", { parentId, id })
  );

  // Calendar / task event observers. The experiment fires onCreated /
  // onUpdated with the full CalendarItem; we only need (id, calendarId,
  // type) so we skip the returnFormat option and drop the payload.
  // onRemoved gives us only `(calendarId, itemId)` - the item type is
  // already gone, so we tag with a generic kind and resolve to the real
  // kind from an existing changelog entry inside `handle`.
  messenger.calendar.items.onCreated.addListener(item =>
    handle(kindForCalendarItem(item), "created", { parentId: item.calendarId, id: item.id })
  );
  messenger.calendar.items.onUpdated.addListener(item =>
    handle(kindForCalendarItem(item), "updated", { parentId: item.calendarId, id: item.id })
  );
  messenger.calendar.items.onRemoved.addListener((calendarId, itemId) =>
    handle("calendar-item", "deleted", { parentId: calendarId, id: itemId })
  );

  // Keep `folder.targetName` in sync with the user's local TB address-book
  // label - the manager's resource-list cell shows targetName for
  // successfully-synced folders. Only watched books are mirrored.
  messenger.addressBooks.onUpdated.addListener(node => handleBookRename(node));

  await rebuildRegistry();

  // Folder rows change → rebuild the registry so newly-bound books start
  // being watched and detached books stop.
  ui.onInternalEvent(event => {
    if (event?.type === "folders-changed") {
      rebuildRegistry().catch(err =>
        console.warn("[tbsync] changelog-watcher registry rebuild failed:", err)
      );
    }
  });
}

export async function rebuildRegistry() {
  const watched = await folders.listWatchedTargets();
  registry.clear();
  for (const { accountId, folderId, targetID } of watched) {
    registry.set(targetID, { accountId, folderId });
  }
}

async function handleBookRename(node) {
  if (!node?.id) return;
  const owner = registry.get(node.id);
  if (!owner) return;  // book not watched
  const row = await folders.get(owner.accountId, owner.folderId);
  if (!row || row.targetName === node.name) return;   // nothing actually changed
  try {
    await folders.update(owner.accountId, owner.folderId, { targetName: node.name });
    ui.broadcast({ type: "folders-changed", accountId: owner.accountId });
  } catch (err) {
    console.warn("[tbsync] book-rename update failed:", err?.message ?? err);
  }
}

function kindForCalendarItem(item) {
  return item?.type === "task" ? "task" : "event";
}

async function handle(kind, op, node) {
  const parentId = node?.parentId;
  const itemId = node?.id;
  if (!parentId || !itemId) return;
  const owner = registry.get(parentId);
  if (!owner) return;  // book not watched

  // List-create events also carry a name, which the watcher needs to find
  // a `kind: "list-by-name"` pre-tag the provider stamped before calling
  // `messenger.mailingLists.create` (TB doesn't accept a UID there, so the
  // pre-tag's itemId is the name until onCreated tells us the real id).
  const name = (kind === "list" && op === "created") ? (node?.name ?? null) : null;

  // Broadcast only when the user-facing changelog content actually
  // changed. With DROP_SERVER_TAGS_ON_CONSUME on, every suppressed event
  // still returns a different array reference (with the consumed
  // *_by_server tag removed), so a reference comparison would fire a
  // folders-changed broadcast on every server write - thousands of UI
  // re-renders during a bulk pull and a locked manager.
  let userFacingChanged = false;
  try {
    await folders.mutateChangelog(owner.accountId, owner.folderId, entries => {
      // calendar.items.onRemoved doesn't tell us if the deleted item was
      // an event or a task. Resolve to the actual kind from any existing
      // entry (provider pre-tags use "event" / "task") so the freeze key
      // matches; default to "event" if no prior entry exists.
      let resolvedKind = kind;
      if (kind === "calendar-item") {
        const prior = entries.find(e => e.parentId === parentId && e.itemId === itemId);
        resolvedKind = prior?.kind === "task" ? "task" : "event";
      }
      const next = applyEvent(entries, {
        kind: resolvedKind, parentId, itemId, name, op, now: Date.now()
      });
      userFacingChanged = userFacingDiffers(entries, next);
      return next;
    });
  } catch (err) {
    console.warn(`[tbsync] changelog-watcher ${kind}.${op} failed:`, err?.message ?? err);
    return;
  }
  if (userFacingChanged) {
    ui.broadcast({ type: "folders-changed", accountId: owner.accountId });
  }
}

function userFacingDiffers(before, after) {
  if (before === after) return false;
  const a = before.filter(e => !isServerTag(e.status));
  const b = after.filter(e => !isServerTag(e.status));
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i].parentId !== b[i].parentId) return true;
    if (a[i].itemId   !== b[i].itemId)   return true;
    if (a[i].kind     !== b[i].kind)     return true;
    if (a[i].status   !== b[i].status)   return true;
  }
  return false;
}

/**
 * Apply a single observer event to the changelog. Returns the new (or
 * same-by-reference) entries array.
 *
 * Order of precedence:
 *   1. Fresh exact-match `*_by_server` pre-tag (same parentId, itemId AND
 *      kind) → do not log the event as user-initiated. With
 *      DROP_SERVER_TAGS_ON_CONSUME the row is also removed; otherwise
 *      the tag stays alive within FREEZE_MS so a follow-up event for
 *      the same item is also suppressed. The kind filter prevents a
 *      contact event from claiming a list pre-tag whose itemId happens
 *      to be the same string (and vice versa).
 *   2. Fresh `kind: "list-by-name"` pre-tag (parentId match, itemId ===
 *      node.name) on a `list.created` event → do not log the event as
 *      user-initiated. With DROP_SERVER_TAGS_ON_CONSUME the row is
 *      removed; otherwise it's rewritten in place to
 *      `kind: "list", itemId: <real id>` so any follow-up event matches
 *      by exact id.
 *   3. Stale pre-tag (age ≥ 1500ms) → clear it, then run normal transition.
 *   4. No pre-tag → run legacy state-machine transition based on existing
 *      `*_by_user` status (or none).
 */
function applyEvent(entries, { kind, parentId, itemId, name, op, now }) {
  const exactIdx = entries.findIndex(e =>
    e.parentId === parentId && e.itemId === itemId && e.kind === kind
  );
  const exact = exactIdx >= 0 ? entries[exactIdx] : null;

  // 1. Exact-match pre-tag handling.
  if (exact && isServerTag(exact.status)) {
    const ageMs = now - (exact.timestamp ?? 0);
    if (ageMs < FREEZE_MS) {
      // Do not log the event as user-initiated. With
      // DROP_SERVER_TAGS_ON_CONSUME also remove the row (single-use
      // freeze); otherwise leave it in place so any follow-up event
      // within the window is also suppressed.
      return DROP_SERVER_TAGS_ON_CONSUME
        ? [...entries.slice(0, exactIdx), ...entries.slice(exactIdx + 1)]
        : entries;
    }
    // Stale pre-tag: drop it, fall through as if no entry existed.
    return applyUserTransition(
      [...entries.slice(0, exactIdx), ...entries.slice(exactIdx + 1)],
      { kind, parentId, itemId, op, now, priorStatus: null }
    );
  }

  // 2. List-by-name match for list pull-creates. The provider couldn't
  // pre-assign the TB id (mailingLists.create takes no UID), so it
  // pre-tagged with the list's name as itemId. Now that we know the
  // real id, either drop the row (DROP_SERVER_TAGS_ON_CONSUME) or
  // rewrite it so future events match by exact id.
  if (kind === "list" && op === "created" && name) {
    const matchIdx = entries.findIndex(e =>
      e.parentId === parentId &&
      e.kind === "list-by-name" &&
      e.itemId === name &&
      isServerTag(e.status) &&
      (now - (e.timestamp ?? 0)) < FREEZE_MS
    );
    if (matchIdx >= 0) {
      const original = entries[matchIdx];
      if (DROP_SERVER_TAGS_ON_CONSUME) {
        return [...entries.slice(0, matchIdx), ...entries.slice(matchIdx + 1)];
      }
      const next = [...entries];
      next[matchIdx] = {
        kind: "list",
        parentId,
        itemId,
        timestamp: now,
        status: original.status,
      };
      return next;
    }
  }

  // 3 + 4. No pre-tag → apply the user-event state transition.
  return applyUserTransition(entries, {
    kind, parentId, itemId, op, now,
    priorStatus: exact?.status ?? null,
  });
}

function applyUserTransition(entries, { kind, parentId, itemId, op, now, priorStatus }) {
  const next = entries.filter(e => !(e.parentId === parentId && e.itemId === itemId));
  const nextStatus = decideUserStatus(op, priorStatus);
  if (nextStatus === "skip") return entries;   // no change at all (keep priorStatus entry)
  if (nextStatus === "drop") return next;      // remove (add+del cancels, etc.)
  next.push({ kind, parentId, itemId, timestamp: now, status: nextStatus });
  return next;
}

/**
 * Legacy state-machine transitions for contact/list events. The semantics
 * are identical for both kinds - the observer doesn't need to know which
 * it's processing.
 */
function decideUserStatus(op, prior) {
  switch (op) {
    case "created":
      switch (prior) {
        case "added_by_user":    return "skip";                // late duplicate
        case "modified_by_user": return "added_by_user";       // late create after modify
        case "deleted_by_user":  return "modified_by_user";    // removed and re-added
        default:                 return "added_by_user";
      }
    case "updated":
      switch (prior) {
        case "added_by_user":    return "skip";                // keep pending add
        case "modified_by_user": return "skip";                // already pending
        case "deleted_by_user":  return "modified_by_user";    // race: moved out + back + edited
        default:                 return "modified_by_user";
      }
    case "deleted":
      switch (prior) {
        case "added_by_user":    return "drop";                // add + del cancels
        case "deleted_by_user":  return "skip";                // double delete notification
        default:                 return "deleted_by_user";
      }
    default:
      return "skip";
  }
}

function isServerTag(status) {
  return status === "added_by_server"
      || status === "modified_by_server"
      || status === "deleted_by_server";
}
