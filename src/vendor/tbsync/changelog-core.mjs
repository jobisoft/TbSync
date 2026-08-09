/**
 * The changelog, as pure functions.
 *
 * A changelog is an array of rows, each one a pending fact about a single
 * item:
 *
 *   { kind, parentId, itemId, timestamp, status, detail? }
 *
 * A row's identity is the triple `(parentId, itemId, kind)`. Two rows
 * sharing the ids but not the kind are different items' bookkeeping and
 * must not touch each other - a mailing list and a contact can carry the
 * same id string, and a status-blind matcher silently destroyed the wrong
 * one before that was pinned down.
 *
 * Statuses come in two families:
 *   `*_by_user`   - a pending edit, to be pushed and then removed
 *   `*_by_server` - a pre-tag: an ANNOUNCEMENT that the writer is about to
 *                   make a write of its own, so the resulting Thunderbird
 *                   event must not be logged as the user's
 *
 * **THIS FILE IS THE SINGLE SOURCE OF TRUTH** and is vendored into the host
 * and into every provider - see `protocol/README.md`. Nothing here may
 * touch storage, the network, `browser.*`, or the clock: every function is
 * an `entries → entries` transform with `now` injected by the caller. That
 * is what lets the host and a provider run the same state machine over two
 * different stores and stay in step.
 */

// ── Vocabulary ────────────────────────────────────────────────────────────

/** Every `kind` a row may carry. Validated at each wire boundary so no row
 *  can be written or matched with a meaningless one. */
export const ALLOWED_CHANGELOG_KINDS = [
  "contact",
  "list",
  "list-by-name",
  "membership",
  "event",
  "task",
];

/** The observer ops a row can be recorded from. */
export const CHANGELOG_OPS = ["created", "updated", "deleted"];

/** The pre-tag statuses. Load-bearing strings: an unknown one would be
 *  invisible to `isServerTag` and masquerade as a user entry. */
export const SERVER_TAG_STATUSES = [
  "added_by_server",
  "modified_by_server",
  "deleted_by_server",
];

/** The observer op each pre-tag announces. A tag is an announcement of an
 *  imminent write, and only that write's event may consume it - any other
 *  event inside the freeze window is a bystander: ignored, with the tag
 *  left armed for the event it names. */
export const OP_FOR_TAG = {
  added_by_server: "created",
  modified_by_server: "updated",
  deleted_by_server: "deleted",
};

/** Legacy's freeze window. A `*_by_server` entry younger than this prevents
 *  the next observer event for the same row from being logged as
 *  user-initiated. After this age, the pre-tag is considered stale and
 *  cleared. */
export const FREEZE_MS = 1500;

/** When true, a fresh `*_by_server` pre-tag is REMOVED from the changelog as
 *  soon as its announced event arrives - the row was a single-use freeze
 *  marker, not durable state. When false (legacy behavior), the row is
 *  kept alive within FREEZE_MS so a hypothetical follow-up event (e.g. a
 *  stamp-update emitted by TB right after a create) can also be suppressed
 *  by the same tag.
 *
 *  Flip to `false` to restore keep-alive if a future TB version (or a
 *  different provider) starts emitting follow-ups - the leak will return
 *  but suppression will cover both events. */
export const DROP_SERVER_TAGS_ON_CONSUME = true;

// ── Predicates ────────────────────────────────────────────────────────────

export function isServerTag(status) {
  return (
    status === "added_by_server" ||
    status === "modified_by_server" ||
    status === "deleted_by_server"
  );
}

/** A pending user edit - the only kind of row that is ever pushed. */
export function isUserEntry(status) {
  return String(status).endsWith("_by_user");
}

/**
 * True when the provider, not the host's Thunderbird observer, is the source
 * of truth for user edits to a folder's target.
 *
 * Calendars: a provider supplies its own calendar type and is handed every
 * user edit directly, with the previous item attached, so it records them
 * itself and its own writes never reach the observer. Watching as well would
 * queue each edit twice and pick up the provider's downstream writes - which
 * is what pre-tagging used to have to suppress.
 *
 * Address books have no provider API worth the name - `addressBooks.provider`
 * offers only `onSearchRequest` - so they stay observed on the host, and keep
 * both halves of the status vocabulary.
 */
export function providerOwnsChanges(targetType) {
  return targetType === "calendars" || targetType === "tasks";
}

/** A row's identity: the triple, as a string key. */
export function rowKey({ parentId, itemId, kind }) {
  return `${parentId}|${itemId}|${kind}`;
}

/** Whether `entry` IS the row identified by the triple. */
export function sameRow(entry, { parentId, itemId, kind }) {
  return (
    entry.parentId === parentId &&
    entry.itemId === itemId &&
    entry.kind === kind
  );
}

// ── The user-edit state machine ───────────────────────────────────────────

/**
 * Legacy state-machine transitions for a user-side edit. Shared by everything
 * that can learn about one: the host's own observer (address books, and
 * calendars that are plain storage) and a provider that was handed the edit
 * directly. One rule, so the routes cannot drift.
 *
 * Returns the next status, or `"skip"` to leave the existing entry alone,
 * or `"drop"` to remove it (an add cancelled by a delete).
 */
export function decideUserStatus(op, prior) {
  switch (op) {
    case "created":
      switch (prior) {
        case "added_by_user":
          return "skip"; // late duplicate
        case "modified_by_user":
          return "added_by_user"; // late create after modify
        case "deleted_by_user":
          return "modified_by_user"; // removed and re-added
        default:
          return "added_by_user";
      }
    case "updated":
      switch (prior) {
        case "added_by_user":
          return "skip"; // keep pending add
        case "modified_by_user":
          return "skip"; // already pending
        case "deleted_by_user":
          return "modified_by_user"; // race: moved out + back + edited
        default:
          return "modified_by_user";
      }
    case "deleted":
      switch (prior) {
        case "added_by_user":
          return "drop"; // add + del cancels
        case "deleted_by_user":
          return "skip"; // double delete notification
        default:
          return "deleted_by_user";
      }
    default:
      return "skip";
  }
}

export function applyUserTransition(
  entries,
  { kind, parentId, itemId, op, now, priorStatus },
) {
  // The triple is the row's identity - a row of another kind sharing the
  // ids is a different item's bookkeeping and must survive this event.
  const next = entries.filter((e) => !sameRow(e, { parentId, itemId, kind }));
  const nextStatus = decideUserStatus(op, priorStatus);
  if (nextStatus === "skip") return entries; // no change at all (keep priorStatus entry)
  if (nextStatus === "drop") return next; // remove (add+del cancels, etc.)
  next.push({ kind, parentId, itemId, timestamp: now, status: nextStatus });
  return next;
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
 * writer's own event is then recorded as a user edit, costing one echo
 * push that re-asserts server state.
 */
export function applyEvent(entries, { kind, parentId, itemId, name, op, now }) {
  const exactIdx = entries.findIndex((e) =>
    sameRow(e, { parentId, itemId, kind }),
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

/** Whether two versions of a changelog differ in a way a user would see -
 *  i.e. ignoring the `*_by_server` pre-tags, which are internal freeze
 *  markers. Consumers broadcast UI updates on this rather than on
 *  reference inequality: with DROP_SERVER_TAGS_ON_CONSUME on, every
 *  suppressed event still returns a different array reference, so a
 *  reference comparison fires on every server write - thousands of UI
 *  re-renders during a bulk pull. */
export function userFacingDiffers(before, after) {
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

/** Index of the `*_by_server` pre-tag this event may consume, or -1.
 *
 *  Used by a ghost gate: an event about to be discarded still has to hand
 *  back the tag it would have consumed, but only the tag whose ANNOUNCED op
 *  it is. A tag announcing a different op belongs to an event that is still
 *  coming and must stay armed for it.
 *
 *  Age is deliberately not checked. `applyEvent` distinguishes a fresh tag
 *  (suppress the event) from a stale one (drop it and apply the event), but
 *  neither applies here: nothing is being applied, so both answers are the
 *  same - the tag has served its purpose or never will. */
export function findConsumableServerTag(
  entries,
  { kind, parentId, itemId, op },
) {
  return entries.findIndex(
    (e) =>
      sameRow(e, { parentId, itemId, kind }) &&
      isServerTag(e.status) &&
      OP_FOR_TAG[e.status] === op,
  );
}

// ── Updaters ──────────────────────────────────────────────────────────────
//
// `entries → entries` transforms, one per mutation a changelog owner can
// perform. Each returns the SAME array reference when nothing changed, which
// callers use to skip the storage write and the UI broadcast.

/**
 * Record a user edit, folding it into whatever is already queued for that
 * item. Returns `{ entries, changed }` - `changed` is false when the queue
 * did not move (a second edit of an already-queued item), so a bulk change
 * does not fire one UI update per item.
 *
 * `detail` is opaque - for calendars it carries what the item looked like
 * *before* the edit, which is the only thing that cannot be re-derived at
 * push time. It is deliberately kept from the earliest edit in a run: two
 * edits between syncs are one delta, measured against the version the server
 * last gave us, not an intermediate it never saw.
 */
export function recordUserEditUpdater(
  entries,
  { parentId, itemId, kind, op, detail, now },
) {
  const prior = entries.find((e) => sameRow(e, { parentId, itemId, kind }));
  const nextStatus = decideUserStatus(op, prior?.status ?? null);

  if (nextStatus === "skip") {
    // The queued entry stands. Still fill in a detail it lacks, so an edit
    // seen first by an observer and then reported by a provider is not left
    // without its baseline. That is not a user-facing change, so it does
    // not set `changed`.
    if (!prior || prior.detail !== undefined || detail === undefined) {
      return { entries, changed: false };
    }
    return {
      entries: entries.map((e) => (e === prior ? { ...e, detail } : e)),
      changed: false,
    };
  }

  const without = entries.filter(
    (e) => !sameRow(e, { parentId, itemId, kind }),
  );
  if (nextStatus === "drop") return { entries: without, changed: true };

  const entry = { kind, parentId, itemId, timestamp: now, status: nextStatus };
  const keep = prior?.detail ?? detail;
  if (keep !== undefined) entry.detail = keep;
  without.push(entry);
  return { entries: without, changed: true };
}

/** Replace any existing row for the triple with a server-side pre-tag, so
 *  the next observer event for that item is recognised as self-inflicted.
 *  `kind` is one of `"contact"` | `"list"` | `"list-by-name"`:
 *    - `"contact"` / `"list"` : itemId is the TB id; the observer
 *      exact-matches on the triple.
 *    - `"list-by-name"` : itemId is the list NAME. Used by list pull-
 *      creates where the TB id isn't known pre-call; the observer matches
 *      by name on the next `mailingLists.onCreated` and upgrades the row to
 *      `kind: "list", itemId: <real id>`. */
export function markServerWriteUpdater(
  entries,
  { parentId, itemId, kind, status, now },
) {
  const without = entries.filter(
    (e) => !sameRow(e, { parentId, itemId, kind }),
  );
  without.push({ kind, parentId, itemId, timestamp: now, status });
  return without;
}

/** Remove the queued **user** edit matching the triple. Used once the owner
 *  has dealt with that edit - pushed it, or established that it can never be
 *  pushed.
 *
 *  A `*_by_server` row is left alone, because it is not a queued edit. It is
 *  the note written immediately before a write of its own, telling the
 *  observer to expect that write and not log it as the user's. Both live in
 *  this one list and are told apart only by status, so a removal that
 *  ignored status took whichever happened to be there - and after
 *  `markServerWriteUpdater` that is the note, since writing one *replaces*
 *  the row it covers. Deleting it left the observer nothing to recognise,
 *  and the write was logged as a user edit: the item went dirty the moment
 *  it was pushed clean.
 *
 *  Consuming a note is the observer's job, and consuming removes it. One
 *  whose write never arrives is dropped as stale by the next event for that
 *  item; until then it is inert - never pushed (only `*_by_user` is) and not
 *  shown. */
export function removeEntryUpdater(entries, { parentId, itemId, kind }) {
  return entries.filter(
    (e) => !(sameRow(e, { parentId, itemId, kind }) && isUserEntry(e.status)),
  );
}

/** Move every row matching one of `items`' triples to the tail, preserving
 *  timestamps and status. Used after a push partially failed so the next
 *  sync attempts the un-failed items first (the failing ones land back at
 *  the head only after the rest of the queue has been drained).
 *
 *  Items not present are silently ignored; if none match, the same array is
 *  returned. */
export function moveToTailUpdater(entries, items) {
  if (!Array.isArray(items) || items.length === 0) return entries;
  const matchSet = new Set(items.map((i) => rowKey(i)));
  const stay = [];
  const move = [];
  for (const e of entries) {
    if (matchSet.has(rowKey(e))) move.push(e);
    else stay.push(e);
  }
  if (move.length === 0) return entries;
  return [...stay, ...move];
}
