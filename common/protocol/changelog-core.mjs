/**
 * The changelog, as pure functions.
 *
 * A changelog is an array of rows, each one a pending fact about a single
 * item:
 *
 *   { kind, parentId, itemId, timestamp, status, detail? }
 *
 * A row's identity is `(parentId, itemId, kind, family)`. Two rows sharing
 * the ids but not the kind are different items' bookkeeping and must not
 * touch each other - a mailing list and a contact can carry the same id
 * string, and a status-blind matcher silently destroyed the wrong one
 * before that was pinned down.
 *
 * The family is the fourth part for the same reason, and was added when the
 * third one arrived: two rows about the *same* item, in different families,
 * answer different questions and must not destroy each other either. Every
 * matcher here names the family it means. The two that legitimately span
 * families say so at the call site.
 *
 * Statuses come in three families, the suffix being the family:
 *   `*_by_user`      - a pending edit, to be pushed and then removed
 *   `*_by_server`    - a pre-tag: an ANNOUNCEMENT that the writer is about
 *                      to make a write of its own, so the resulting
 *                      Thunderbird event must not be logged as the user's
 *   `*_for_sendMail` - a message this item still owes to somebody outside,
 *                      noted when the edit was made because that is the only
 *                      moment the item's previous version exists. Never
 *                      pushed, never shown, removed by the phase that sends
 *
 * `kind` is validated **on the writing entry points only** (`applyEvent`,
 * `recordUserEditUpdater`, `markServerWriteUpdater`): those are where a new
 * row is born, and a row born with a kind outside `CHANGELOG_KINDS` matches
 * nothing ever after. The removal-side functions (`removeEntryUpdater`,
 * `moveToTailUpdater`, `findConsumableServerTag`) deliberately do NOT
 * validate - they match rows that already exist, including rows written
 * before validation existed, and a provider's own cleanup path hands them
 * the offending kind verbatim. Validating there would make a bad legacy row
 * permanently unremovable, which is worse than the typo it would catch.
 *
 * **THIS FILE IS THE SINGLE SOURCE OF TRUTH** and is vendored into the host
 * and into every provider - see `common/README.md`. Nothing here may
 * touch storage, the network, `browser.*`, or the clock: every function is
 * an `entries → entries` transform with `now` injected by the caller. That
 * is what lets the host and a provider run the same state machine over two
 * different stores and stay in step.
 */

// ── Vocabulary ────────────────────────────────────────────────────────────

/** Every kind a changelog row can carry. Load-bearing strings: the kind is
 *  a third of the row's identity, so one outside this list creates a row no
 *  matcher will ever find. Singular, always - `createCalendar` takes a
 *  *plural* `kind` ("events"/"tasks") from a different vocabulary, and that
 *  near-miss is exactly the typo this list exists to catch. */
export const CHANGELOG_KINDS = Object.freeze([
  "contact",
  "list",
  "list-by-name",
  "membership",
  "event",
  "task",
]);

/** Throw unless `kind` is one of `CHANGELOG_KINDS`. Called by the writing
 *  entry points only - see the module docstring for why removal must stay
 *  unvalidated. */
export function assertChangelogKind(kind) {
  if (!CHANGELOG_KINDS.includes(kind)) {
    throw new Error(
      `changelog: unknown kind ${JSON.stringify(kind)} - ` +
        `expected one of ${CHANGELOG_KINDS.join(", ")}`,
    );
  }
}

/** The pre-tag statuses. Load-bearing strings: an unknown one would be
 *  invisible to `isServerTag` and masquerade as a user entry. */
export const SERVER_TAG_STATUSES = [
  "added_by_server",
  "modified_by_server",
  "deleted_by_server",
];

/** The statuses of the third family: a message this item still owes to
 *  somebody outside, recorded when the edit is made because that is the only
 *  moment the previous version of the item exists.
 *
 *  Named for the intent, not for something that happened: unlike the other
 *  two families, one of these rows is a note about work still to do.
 *
 *  Never pushed (`isUserEntry` is false for them), never shown as a pending
 *  change, and removed only by the phase that sends the message. They sit
 *  beside the `*_by_user` row for the same item rather than replacing it -
 *  which is why the family is part of a row's identity. */
export const SENDMAIL_STATUSES = [
  "added_for_sendMail",
  "modified_for_sendMail",
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
const DROP_SERVER_TAGS_ON_CONSUME = true;

// ── Predicates ────────────────────────────────────────────────────────────

function isServerTag(status) {
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

/** The three families, as identity values. A row belongs to exactly one,
 *  derived from its status suffix - the suffix is the family. */
export const BY_USER = "by_user";
export const BY_SERVER = "by_server";
export const FOR_SENDMAIL = "for_sendMail";

/** Which family a status belongs to, or null for one we do not know.
 *
 *  A null family is deliberately unmatched by `sameRow`: a row written by a
 *  future version, or one corrupted in storage, is then inert rather than
 *  being mistaken for a member of whichever family asked. It stays visible
 *  to the unfiltered readers, so it can be seen - but nothing here will
 *  remove it, and only `sweep()` retiring the whole session clears it. The
 *  trade is deliberate: a row we cannot identify is one we cannot act on
 *  correctly either, and guessing is how the wrong row gets destroyed. */
export function familyOf(status) {
  const s = String(status);
  if (s.endsWith("_by_user")) return BY_USER;
  if (s.endsWith("_by_server")) return BY_SERVER;
  if (s.endsWith("_for_sendMail")) return FOR_SENDMAIL;
  return null;
}

/** A row's identity, as a string key. */
function rowKey({ parentId, itemId, kind, family }) {
  return `${parentId}|${itemId}|${kind}|${family}`;
}

/** Whether `entry` IS the row identified by the quadruple.
 *
 *  `family` is as load-bearing as the other three. Two rows can share the
 *  triple and belong to different families - a queued user edit and the
 *  note that a mail is owed for it are both about the same item and must
 *  not touch each other. Every matcher here therefore names the family it
 *  means, and the two that legitimately span families say so at the call
 *  site rather than by leaving the argument off. */
function sameRow(entry, { parentId, itemId, kind, family }) {
  return (
    entry.parentId === parentId &&
    entry.itemId === itemId &&
    entry.kind === kind &&
    familyOf(entry.status) === family
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
function decideUserStatus(op, prior) {
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

function applyUserTransition(
  entries,
  { kind, parentId, itemId, op, now, priorStatus },
) {
  const nextStatus = decideUserStatus(op, priorStatus);
  if (nextStatus === "skip") return entries; // no change at all (keep priorStatus entry)
  // The quadruple is the row's identity - a row of another kind, or of
  // another family, is different bookkeeping and must survive this event.
  // In particular a note that a mail is owed outlives every edit made while
  // it waits: it records what the recipients were last told, which no later
  // edit changes. A deletion is the exception, and the only one.
  const next = dropSendMailOnDelete(
    entries.filter(
      (e) => !sameRow(e, { parentId, itemId, kind, family: BY_USER }),
    ),
    { parentId, itemId, kind, op },
  );
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
 *       about to be deleted anyway). Consuming here instead would turn the
 *       announced event into a phantom user action: an interim edit eats a
 *       deleted_by_server tag, the announced deletion is then recorded as
 *       deleted_by_user, and a redundant Delete goes out for an item the
 *       server answers NOT_FOUND for.
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
  assertChangelogKind(kind);
  // Two lookups, because a pre-tag and a queued user edit are different
  // rows now: one asks "is a write of ours imminent", the other "what was
  // already pending". Before the family joined the identity these could be
  // one lookup, since only one row per triple could exist.
  const exactIdx = entries.findIndex((e) =>
    sameRow(e, { parentId, itemId, kind, family: BY_SERVER }),
  );
  const exact = exactIdx >= 0 ? entries[exactIdx] : null;
  const pending = entries.find((e) =>
    sameRow(e, { parentId, itemId, kind, family: BY_USER }),
  );

  // 1. Exact-match pre-tag handling.
  if (exact) {
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
    // Stale pre-tag: drop it, fall through as if the tag had never been
    // there. `pending` rather than null, because dropping the tag does not
    // drop a queued edit that was sitting beside it - today it never is,
    // since writing a tag replaces one, but reading the state we actually
    // have costs nothing and does not depend on that staying true.
    return applyUserTransition(
      [...entries.slice(0, exactIdx), ...entries.slice(exactIdx + 1)],
      { kind, parentId, itemId, op, now, priorStatus: pending?.status ?? null },
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
    priorStatus: pending?.status ?? null,
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
  // Only a pending user edit is user-facing. A pre-tag is an internal
  // freeze marker, and a `*_for_sendMail` note is bookkeeping for a message
  // the sync still owes - neither is a change the user made or can act on,
  // and broadcasting on them would repaint the manager for work nobody
  // asked about.
  const a = before.filter((e) => familyOf(e.status) === BY_USER);
  const b = after.filter((e) => familyOf(e.status) === BY_USER);
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
      sameRow(e, { parentId, itemId, kind, family: BY_SERVER }) &&
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
  assertChangelogKind(kind);
  const prior = entries.find((e) =>
    sameRow(e, { parentId, itemId, kind, family: BY_USER }),
  );
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

  const without = dropSendMailOnDelete(
    entries.filter(
      (e) => !sameRow(e, { parentId, itemId, kind, family: BY_USER }),
    ),
    { parentId, itemId, kind, op },
  );
  if (nextStatus === "drop") return { entries: without, changed: true };

  const entry = { kind, parentId, itemId, timestamp: now, status: nextStatus };
  const keep = prior?.detail ?? detail;
  if (keep !== undefined) entry.detail = keep;
  without.push(entry);
  return { entries: without, changed: true };
}

/**
 * Record that this item owes a message, or leave an existing note alone.
 *
 * **The first note wins outright** - status and `detail` both. `detail`
 * holds the item as the recipients last saw it, and a later edit does not
 * change what they were told. The status stands for the same reason: while
 * an invitation is still owed nobody knows the meeting exists, so every
 * edit before it goes out is carried by that one invitation rather than by
 * an invitation and a correction.
 *
 * There are no status transitions here, and that is only possible because a
 * user delete drops the note - see `dropSendMailOnDelete`. Without it,
 * delete-then-re-create would leave a note measuring against an item nobody
 * holds any more, and this function would need a rule for it.
 *
 * Returns `{ entries, changed }`, `changed` false when a note already
 * existed.
 */
export function recordSendMailUpdater(
  entries,
  { parentId, itemId, kind, status, detail, now },
) {
  assertChangelogKind(kind);
  if (!SENDMAIL_STATUSES.includes(status)) {
    throw new Error(
      `changelog: ${JSON.stringify(status)} is not a sendMail status - ` +
        `expected one of ${SENDMAIL_STATUSES.join(", ")}`,
    );
  }
  const row = { parentId, itemId, kind, family: FOR_SENDMAIL };
  if (entries.some((e) => sameRow(e, row))) return { entries, changed: false };

  const entry = { kind, parentId, itemId, timestamp: now, status };
  if (detail !== undefined) entry.detail = detail;
  return { entries: [...entries, entry], changed: true };
}

/** Drop any message owed for an item the user has just deleted.
 *
 *  A deletion is never announced - that is a product rule, not an omission -
 *  so an item on its way out owes nobody anything, whatever was noted while
 *  it existed. Applied by both user-edit paths rather than left to callers,
 *  because a caller that forgets leaves a note for an item that no longer
 *  exists, and the only thing standing between that and a wrong message is a
 *  guard much further downstream.
 *
 *  It also keeps the note's own rules trivial: without it, delete-then-
 *  re-create would leave a stale baseline for the new item to trip over. */
function dropSendMailOnDelete(entries, { parentId, itemId, kind, op }) {
  if (op !== "deleted") return entries;
  return removeSendMailUpdater(entries, { parentId, itemId, kind });
}

/** Remove the note for this item, once the message has been dealt with -
 *  sent, refused by the server, or established as having nothing to say.
 *  All three are the same to this function: there is one attempt, and the
 *  note goes either way, so nothing can accumulate that never clears. */
export function removeSendMailUpdater(entries, { parentId, itemId, kind }) {
  return entries.filter(
    (e) => !sameRow(e, { parentId, itemId, kind, family: FOR_SENDMAIL }),
  );
}

/** Replace any existing row for the triple with a server-side pre-tag, so
 *  the next observer event for that item is recognised as self-inflicted.
 *  `kind` is any of `CHANGELOG_KINDS`; two get special observer handling:
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
  assertChangelogKind(kind);
  // Spans two families deliberately: the note replaces the pending user
  // edit it covers, which is what `removeEntryUpdater` documents and relies
  // on. It must NOT reach the third - a mail owed for this item is about
  // what the recipients were told, and our own write says nothing about
  // that.
  const without = entries.filter(
    (e) =>
      !sameRow(e, { parentId, itemId, kind, family: BY_USER }) &&
      !sameRow(e, { parentId, itemId, kind, family: BY_SERVER }),
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
 *  this one list and are told apart only by status, and after
 *  `markServerWriteUpdater` the note is the row that is there - writing one
 *  *replaces* the row it covers. So a status-blind removal would take the
 *  note, leaving the observer nothing to recognise and the write logged as a
 *  user edit: the item goes dirty the moment it is pushed clean.
 *
 *  Consuming a note is the observer's job, and consuming removes it. One
 *  whose write never arrives is dropped as stale by the next event for that
 *  item; until then it is inert - never pushed (only `*_by_user` is) and not
 *  shown. */
export function removeEntryUpdater(entries, { parentId, itemId, kind }) {
  return entries.filter(
    (e) => !sameRow(e, { parentId, itemId, kind, family: BY_USER }),
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
  // Re-staging is about the push queue, so it moves user edits and nothing
  // else. A note that a mail is owed is not queued work and has no place in
  // the ordering.
  const matchSet = new Set(
    items.map((i) => rowKey({ ...i, family: BY_USER })),
  );
  const stay = [];
  const move = [];
  for (const e of entries) {
    if (matchSet.has(rowKey({ ...e, family: familyOf(e.status) })))
      move.push(e);
    else stay.push(e);
  }
  if (move.length === 0) return entries;
  return [...stay, ...move];
}
