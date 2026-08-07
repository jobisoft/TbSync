import * as folders from "./folders.mjs";
import { decideUserStatus } from "./folders.mjs";
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
  messenger.contacts.onCreated.addListener((node) =>
    handle("contact", "created", node),
  );
  messenger.contacts.onUpdated.addListener((node) =>
    handle("contact", "updated", node),
  );
  messenger.contacts.onDeleted.addListener((parentId, id) =>
    handle("contact", "deleted", { parentId, id }),
  );
  messenger.mailingLists.onCreated.addListener((node) =>
    handle("list", "created", node),
  );
  messenger.mailingLists.onUpdated.addListener((node) =>
    handle("list", "updated", node),
  );
  messenger.mailingLists.onDeleted.addListener((parentId, id) =>
    handle("list", "deleted", { parentId, id }),
  );

  // Membership: the user putting a contact into a mailing list, or taking it
  // out. Its own kind rather than a change to either party, because it is a
  // change to neither - the contact's fields are untouched and so is the
  // list's name, so re-pushing either would send bytes the server already
  // has while still not saying what actually changed.
  //
  // `onMemberAdded` hands back a ContactNode whose parentId is the *list*
  // (measured; a card's own node carries the book instead) and
  // `onMemberRemoved` gives the pair directly, so either way both halves
  // arrive - which is what lets the entry name the exact pair the user
  // touched rather than "something about this list changed".
  messenger.mailingLists.onMemberAdded.addListener((node) =>
    handleMembership("created", node?.parentId, node?.id),
  );
  messenger.mailingLists.onMemberRemoved.addListener((parentId, id) =>
    handleMembership("deleted", parentId, id),
  );

  // Keep `folder.targetName` in sync with the user's local TB address-book
  // or calendar label - the manager's resource-list cell shows targetName
  // for successfully-synced folders. Only watched targets are mirrored.
  messenger.addressBooks.onUpdated.addListener((node) =>
    handleTargetRename(node?.id, node?.name),
  );

  // If the user deletes the local TB resource (address book or calendar)
  // that a folder is bound to, deselect the folder and clear its target -
  // the row stays so the user can re-enable it via the manager later, but
  // sync stops attempting to write to a non-existent target.
  messenger.addressBooks.onDeleted.addListener((id) => handleTargetRemoved(id));

  await rebuildRegistry();

  // Folder rows change → rebuild the registry so newly-bound books start
  // being watched and detached books stop.
  ui.onInternalEvent((event) => {
    if (event?.type === "folders-changed") {
      rebuildRegistry().catch((err) =>
        console.warn(
          "[tbsync] changelog-watcher registry rebuild failed:",
          err,
        ),
      );
    }
  });
}

/**
 * True when the provider, not this observer, is the source of truth for user
 * edits to a folder's target.
 *
 * Calendars: a provider supplies its own calendar type and is handed every
 * user edit directly, with the previous item attached, so it reports them
 * itself and its own writes never reach us. Watching as well would queue each
 * edit twice and pick up the provider's downstream writes - which is what
 * pre-tagging used to have to suppress.
 *
 * Address books have no provider API worth the name - `addressBooks.provider`
 * offers only `onSearchRequest` - so they stay observed here, and keep both
 * halves of the status vocabulary.
 */
export function providerOwnsChanges(targetType) {
  return targetType === "calendars" || targetType === "tasks";
}

export async function rebuildRegistry() {
  const watched = await folders.listWatchedTargets();
  registry.clear();
  for (const { accountId, folderId, targetID, targetType } of watched) {
    if (providerOwnsChanges(targetType)) continue;
    registry.set(targetID, { accountId, folderId });
  }
}

async function handleTargetRename(targetID, name) {
  if (!targetID) return;
  const owner = registry.get(targetID);
  if (!owner) return; // target not watched
  const row = await folders.get(owner.accountId, owner.folderId);
  if (!row || row.targetName === name) return; // nothing actually changed
  try {
    await folders.update(owner.accountId, owner.folderId, {
      targetName: name,
    });
    ui.broadcast({ type: "folders-changed", accountId: owner.accountId });
  } catch (err) {
    console.warn("[tbsync] target-rename update failed:", err?.message ?? err);
  }
}

/** The observer's own route: it only knows targets it watches, so the
 *  registry is both the lookup and the filter. */
async function handleTargetRemoved(targetID) {
  if (!targetID) return;
  const owner = registry.get(targetID);
  if (!owner) return; // target not watched
  await clearFolderTarget(owner.accountId, owner.folderId, targetID);
}

/** Undo a folder's binding to a local resource that no longer exists.
 *
 *  The row stays so the folder can be enabled again later; it just stops
 *  pointing at something that is gone, and stops syncing until it is.
 *
 *  Shared with `FOLDER_TARGET_REMOVED`, which a provider calls for the
 *  resources it supplies itself. That route resolves the folder from the
 *  folder table rather than from the registry - the registry deliberately
 *  does not contain provider-owned targets, so a lookup there would always
 *  miss. */
export async function clearFolderTarget(accountId, folderId, targetID) {
  const row = await folders.get(accountId, folderId);
  if (!row) return;
  if (row.targetID == null && !row.selected) return; // already cleared
  try {
    await folders.update(accountId, folderId, {
      targetID: null,
      targetName: null,
      selected: false,
      contactHashes: {},
    });
    if (targetID) registry.delete(targetID);
    ui.broadcast({ type: "folders-changed", accountId });
  } catch (err) {
    console.warn("[tbsync] target-removed update failed:", err?.message ?? err);
  }
}

/** Drop a `*_by_server` pre-tag for this item, for an event the ghost gate
 *  is about to discard - but only the tag whose ANNOUNCED op this event
 *  is. A ghost-suppressed created/updated is, in every real flow, the
 *  provider's own announced write arriving byte-identical; a tag
 *  announcing a different op (e.g. deleted_by_server) belongs to an event
 *  that is still coming and must stay armed for it.
 *
 *  Age is deliberately not checked. `applyEvent` distinguishes a fresh tag
 *  (suppress the event) from a stale one (drop it and apply the event), but
 *  neither applies here: nothing is being applied, so both answers are the
 *  same - the tag has served its purpose or never will.
 *
 *  The trade this makes: a ghost arriving in the gap between a provider
 *  announcing a write and making it would take the tag early, and the
 *  provider's own write would then be logged as a user edit. That gap is the
 *  microseconds between two consecutive statements, and the cost if it is
 *  ever hit is one redundant push. Not clearing the tag costs a *lost user
 *  edit* on every no-op provider write, which is common on a pull. */
async function consumeServerTag(owner, { kind, parentId, itemId, op }) {
  try {
    await folders.mutateChangelog(
      owner.accountId,
      owner.folderId,
      (entries) => {
        const idx = entries.findIndex(
          (e) =>
            e.parentId === parentId &&
            e.itemId === itemId &&
            e.kind === kind &&
            isServerTag(e.status) &&
            OP_FOR_TAG[e.status] === op,
        );
        if (idx < 0) return entries;
        return [...entries.slice(0, idx), ...entries.slice(idx + 1)];
      },
    );
  } catch (err) {
    console.warn(
      "[tbsync] consuming a server pre-tag failed:",
      err?.message ?? err,
    );
  }
}

async function computeHash(vcard) {
  const bytes = new TextEncoder().encode(vcard);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Decide whether a contact create/update event is a TB ghost (same
 *  vCard bytes as last seen) or a real change. Reads the vCard,
 *  computes SHA-1, compares against `folder.contactHashes[itemId]`,
 *  and records the new hash on first sight or on mismatch.
 *
 *  Returns `"suppress"` if the event should be dropped, `"proceed"`
 *  otherwise. Failure modes (no vCard available, storage error)
 *  fail open to `"proceed"` so the legacy state machine still runs. */
async function ghostGate(owner, op, itemId) {
  let vcard;
  try {
    const node = await messenger.contacts.get(itemId);
    vcard = node.properties.vCard;
  } catch (err) {
    console.warn("[tbsync] contact-hash read failed:", err?.message ?? err);
    return "proceed";
  }
  if (typeof vcard !== "string" || vcard.length === 0) return "proceed";

  const newHash = await computeHash(vcard);

  if (op === "updated") {
    const folder = await folders.get(owner.accountId, owner.folderId);
    const prior = folder?.contactHashes?.[itemId] ?? null;
    if (prior !== null && prior === newHash) return "suppress";
  }

  await folders
    .mutateContactHashes(owner.accountId, owner.folderId, (m) =>
      m[itemId] === newHash ? m : { ...m, [itemId]: newHash },
    )
    .catch((err) =>
      console.warn("[tbsync] contact-hash store failed:", err?.message ?? err),
    );
  return "proceed";
}

/** A contact entering or leaving a mailing list.
 *
 *  Split from `handle` for one reason: the ids arrive the other way round.
 *  Every other event names the book in `parentId`, which is what the
 *  registry is keyed by; here `parentId` is the list, so the book has to be
 *  fetched before the owner can be found at all. The entry then keeps the
 *  list as its parent, so `(listId, contactId, "membership")` identifies the
 *  pair exactly - and a provider that cannot store memberships sees an
 *  unfamiliar `kind` and drops it, rather than mistaking it for a contact. */
async function handleMembership(op, listId, contactId) {
  if (!listId || !contactId) return;
  let bookId = null;
  try {
    bookId = (await messenger.mailingLists.get(listId))?.parentId ?? null;
  } catch {
    // List already gone - deleting a list fires a member-removed event per
    // member, and the list itself may lose the race. Nothing to record:
    // the list's own deleted entry carries everything the provider needs.
    return;
  }
  const owner = bookId ? registry.get(bookId) : null;
  if (!owner) return; // book not watched
  await recordEvent(owner, {
    kind: "membership",
    parentId: listId,
    itemId: contactId,
    name: null,
    op,
  });
}

async function handle(kind, op, node) {
  const parentId = node?.parentId;
  const itemId = node?.id;
  if (!parentId || !itemId) return;
  const owner = registry.get(parentId);
  if (!owner) return; // book not watched

  // Contact-only ghost gate. TB fires onUpdated for usage-tracking
  // (PopularityIndex, address-picker recency); those don't change the
  // vCard bytes, so a hash compare suppresses them before they touch
  // the changelog. Created/updated also (re)record the hash so the
  // next ghost has a baseline; deleted prunes the entry.
  if (kind === "contact") {
    if (op === "deleted") {
      folders
        .mutateContactHashes(owner.accountId, owner.folderId, (m) => {
          if (!(itemId in m)) return m;
          const { [itemId]: _drop, ...rest } = m;
          return rest;
        })
        .catch((err) =>
          console.warn(
            "[tbsync] contact-hash remove failed:",
            err?.message ?? err,
          ),
        );
    } else if (op === "created" || op === "updated") {
      const decision = await ghostGate(owner, op, itemId);
      if (decision === "suppress") {
        // Discarding the event must not discard someone's pre-tag with it.
        // Returning here skips `applyEvent`, which is the only thing that
        // consumes one - so a provider write that changed no bytes (the
        // server echoing back what we already hold) left its tag behind,
        // and that tag then suppressed the user's *next* edit to the item
        // for the rest of the freeze window.
        await consumeServerTag(owner, { kind, parentId, itemId, op });
        return;
      }
    }
  }

  // List-create events also carry a name, which the watcher needs to find
  // a `kind: "list-by-name"` pre-tag the provider stamped before calling
  // `messenger.mailingLists.create` (TB doesn't accept a UID there, so the
  // pre-tag's itemId is the name until onCreated tells us the real id).
  const name =
    kind === "list" && op === "created" ? (node?.name ?? null) : null;

  await recordEvent(owner, { kind, parentId, itemId, name, op });
}

/** Fold one observed event into the owning folder's changelog, and tell the
 *  manager only when the result differs in a way a user would see. */
async function recordEvent(owner, { kind, parentId, itemId, name, op }) {
  // Broadcast only when the user-facing changelog content actually
  // changed. With DROP_SERVER_TAGS_ON_CONSUME on, every suppressed event
  // still returns a different array reference (with the consumed
  // *_by_server tag removed), so a reference comparison would fire a
  // folders-changed broadcast on every server write - thousands of UI
  // re-renders during a bulk pull and a locked manager.
  let userFacingChanged = false;
  try {
    await folders.mutateChangelog(
      owner.accountId,
      owner.folderId,
      (entries) => {
        const next = applyEvent(entries, {
          kind,
          parentId,
          itemId,
          name,
          op,
          now: Date.now(),
        });
        userFacingChanged = userFacingDiffers(entries, next);
        return next;
      },
    );
  } catch (err) {
    console.warn(
      `[tbsync] changelog-watcher ${kind}.${op} failed:`,
      err?.message ?? err,
    );
    return;
  }
  if (userFacingChanged) {
    ui.broadcast({ type: "folders-changed", accountId: owner.accountId });
  }
}

function userFacingDiffers(before, after) {
  if (before === after) return false;
  const a = before.filter((e) => !isServerTag(e.status));
  const b = after.filter((e) => !isServerTag(e.status));
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i].parentId !== b[i].parentId) return true;
    if (a[i].itemId !== b[i].itemId) return true;
    if (a[i].kind !== b[i].kind) return true;
    if (a[i].status !== b[i].status) return true;
  }
  return false;
}

/**
 * Apply a single observer event to the changelog. Returns the new (or
 * same-by-reference) entries array.
 *
 * Order of precedence:
 *   1a. Fresh exact-match `*_by_server` pre-tag (same parentId, itemId AND
 *       kind) whose announced op matches this event → do not log the
 *       event as user-initiated. With DROP_SERVER_TAGS_ON_CONSUME the row
 *       is also removed; otherwise the tag stays alive within FREEZE_MS
 *       so a follow-up event for the same item is also suppressed. The
 *       kind filter prevents a contact event from claiming a list
 *       pre-tag whose itemId happens to be the same string (and vice
 *       versa).
 *   1b. Fresh pre-tag, NON-matching op → the event is ignored outright
 *       and the tag stays armed. The tag is an announcement: the write
 *       it names is imminent and will supersede whatever this bystander
 *       event carried (a user edit under a deleted_by_server tag is
 *       about to be deleted anyway). Consuming here instead used to turn
 *       the announced event into a phantom user action - e.g. an interim
 *       edit ate a deleted_by_server tag and the announced deletion was
 *       then recorded as deleted_by_user, pushing a redundant Delete the
 *       server answered with NOT_FOUND.
 *   2. Fresh `kind: "list-by-name"` pre-tag (parentId match, itemId ===
 *      node.name) on a `list.created` event → do not log the event as
 *      user-initiated. With DROP_SERVER_TAGS_ON_CONSUME the row is
 *      removed; otherwise it's rewritten in place to
 *      `kind: "list", itemId: <real id>` so any follow-up event matches
 *      by exact id.
 *   3. Stale pre-tag (age ≥ 1500ms) → clear it, then run normal transition.
 *   4. No pre-tag → run legacy state-machine transition based on existing
 *      `*_by_user` status (or none).
 *
 * Known ambiguity, accepted: a same-op race (the user edits in the
 * milliseconds before the announced write's event arrives) is
 * indistinguishable - the user's event consumes the tag and the
 * provider's own event is then recorded as a user edit, costing one echo
 * push that re-asserts server state.
 */
function applyEvent(entries, { kind, parentId, itemId, name, op, now }) {
  const exactIdx = entries.findIndex(
    (e) => e.parentId === parentId && e.itemId === itemId && e.kind === kind,
  );
  const exact = exactIdx >= 0 ? entries[exactIdx] : null;

  // 1. Exact-match pre-tag handling.
  if (exact && isServerTag(exact.status)) {
    const ageMs = now - (exact.timestamp ?? 0);
    if (ageMs < FREEZE_MS) {
      // 1b. A bystander event: not the op this tag announces. Ignore it
      // and keep the tag armed for the announced event. Must NOT fall
      // through to applyUserTransition - that would record the event
      // with the tag as priorStatus and its status-blind filter would
      // delete the tag.
      if (OP_FOR_TAG[exact.status] !== op) return entries;
      // 1a. The announced event. Do not log it as user-initiated. With
      // DROP_SERVER_TAGS_ON_CONSUME also remove the row (single-use
      // freeze); otherwise leave it in place so a follow-up event of
      // the same op within the window is also suppressed.
      return DROP_SERVER_TAGS_ON_CONSUME
        ? [...entries.slice(0, exactIdx), ...entries.slice(exactIdx + 1)]
        : entries;
    }
    // Stale pre-tag: drop it, fall through as if no entry existed.
    return applyUserTransition(
      [...entries.slice(0, exactIdx), ...entries.slice(exactIdx + 1)],
      { kind, parentId, itemId, op, now, priorStatus: null },
    );
  }

  // 2. List-by-name match for list pull-creates. The provider couldn't
  // pre-assign the TB id (mailingLists.create takes no UID), so it
  // pre-tagged with the list's name as itemId. Now that we know the
  // real id, either drop the row (DROP_SERVER_TAGS_ON_CONSUME) or
  // rewrite it so future events match by exact id.
  if (kind === "list" && op === "created" && name) {
    const matchIdx = entries.findIndex(
      (e) =>
        e.parentId === parentId &&
        e.kind === "list-by-name" &&
        e.itemId === name &&
        isServerTag(e.status) &&
        now - (e.timestamp ?? 0) < FREEZE_MS,
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
    kind,
    parentId,
    itemId,
    op,
    now,
    priorStatus: exact?.status ?? null,
  });
}

function applyUserTransition(
  entries,
  { kind, parentId, itemId, op, now, priorStatus },
) {
  const next = entries.filter(
    (e) => !(e.parentId === parentId && e.itemId === itemId),
  );
  const nextStatus = decideUserStatus(op, priorStatus);
  if (nextStatus === "skip") return entries; // no change at all (keep priorStatus entry)
  if (nextStatus === "drop") return next; // remove (add+del cancels, etc.)
  next.push({ kind, parentId, itemId, timestamp: now, status: nextStatus });
  return next;
}

function isServerTag(status) {
  return (
    status === "added_by_server" ||
    status === "modified_by_server" ||
    status === "deleted_by_server"
  );
}

/** The observer op each pre-tag announces. A tag is an announcement of an
 *  imminent provider write, and only that write's event may consume it -
 *  any other event inside the freeze window is a bystander: ignored, with
 *  the tag left armed for the event it names. */
const OP_FOR_TAG = {
  added_by_server: "created",
  modified_by_server: "updated",
  deleted_by_server: "deleted",
};

/** Pure internals, exported for the unit tests (`npm test`). Nothing else
 *  imports these. */
export const __internals = { applyEvent, isServerTag, OP_FOR_TAG, FREEZE_MS };
