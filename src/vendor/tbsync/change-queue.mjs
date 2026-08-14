/**
 * Where a pending user edit waits until the next sync can push it.
 *
 * A provider owns this. The platform hands it the edit - directly for a
 * calendar it supplies, through an address-book event for a book it watches
 * - and in both cases the record must be durable before the provider
 * answers, and must not depend on anything outside the add-on being alive.
 * A provider keeps its resources working with the host absent, and a record
 * that needed the host would be unmakeable on every host reload, update and
 * background suspend.
 *
 * ## Sessions
 *
 * A folder row outlives its bindings: deselect and reselect, delete the
 * calendar and let the next sync re-create it, and the queue from before
 * belongs to something that is gone. Pushing those edits into the new
 * binding would resurrect items the user deleted along with the calendar.
 *
 * The host names the current binding in `folder.sessionId` and mints a new
 * one whenever it ends one. So every key here is a session id and nothing
 * else: finding our queue means looking up the session the row names, and a
 * queue whose session no row names is garbage by that fact alone. `sweep()`
 * drops those. No teardown message is needed, and none is trusted -
 * Disconnect and Remove have to work when this add-on is broken, so they
 * cannot depend on it doing anything.
 *
 * The consequence worth stating: edits made while the host is down are
 * filed under the last session we saw. If that binding was torn down in the
 * meantime, they go with it. That is the correct answer, not a compromise.
 */

import { serialize } from "./storage-queue.mjs";
import {
  applyEvent,
  familyOf,
  findConsumableServerTag,
  FOR_SENDMAIL,
  isUserEntry,
  markServerWriteUpdater,
  moveToTailUpdater,
  recordSendMailUpdater,
  recordUserEditUpdater,
  removeEntryUpdater,
  removeSendMailUpdater,
  userFacingDiffers,
} from "./changelog-core.mjs";

/** One key per session. The value carries the account and folder it belongs
 *  to, so a sweep can report what it dropped without parsing keys. */
const QUEUE_PREFIX = "queue.";

/** Which folder each resource we sync belongs to, as
 *  `targetID -> {accountId, folderId, sessionId, targetType}`.
 *
 *  An item hook is handed a calendar id and an address-book event a book id,
 *  and neither may ask the host who owns it - that is the round trip this
 *  whole module exists to remove. So the answer is kept here, refreshed every time we
 *  legitimately have the folder rows in hand (a sync, a lifecycle event).
 *  Stale is survivable and self-correcting: a wrong session files the edit
 *  where the next sweep will find it, which is exactly what a torn-down
 *  binding deserves. */
const BINDINGS_KEY = "queue.bindings";

const queueKey = (sessionId) => `${QUEUE_PREFIX}${sessionId}`;

async function readQueue(sessionId) {
  const key = queueKey(sessionId);
  const rv = await browser.storage.local.get({ [key]: null });
  const bag = rv[key];
  return Array.isArray(bag?.entries) ? bag.entries : [];
}

/** Read, transform, write - serialised against every other storage mutation
 *  in this extension context, so a sync draining the queue and a hook adding
 *  to it cannot interleave. Returning the same array short-circuits the
 *  write, as it does on the host. */
function mutate(binding, updater) {
  const { accountId, folderId, sessionId } = binding;
  return serialize(async () => {
    const key = queueKey(sessionId);
    const rv = await browser.storage.local.get({ [key]: null });
    const bag = rv[key] ?? {};
    const before = Array.isArray(bag.entries) ? bag.entries : [];
    const after = updater(before) ?? before;
    if (after === before) return before;
    await browser.storage.local.set({
      [key]: { ...bag, accountId, folderId, sessionId, entries: after },
    });
    return after;
  });
}

/** Same read-modify-write, over the ghost-gate hashes rather than the queue.
 *  They live in the same per-session bag because they share its lifetime
 *  exactly: a hash describes a card in a book that this binding created, and
 *  means nothing once the binding ends. */
function mutateHashes(binding, updater) {
  const { accountId, folderId, sessionId } = binding;
  return serialize(async () => {
    const key = queueKey(sessionId);
    const rv = await browser.storage.local.get({ [key]: null });
    const bag = rv[key] ?? {};
    const before = bag.hashes && typeof bag.hashes === "object" ? bag.hashes : {};
    const after = updater(before) ?? before;
    if (after === before) return before;
    await browser.storage.local.set({
      [key]: { ...bag, accountId, folderId, sessionId, hashes: after },
    });
    return after;
  });
}

/**
 * The queue for one binding. `binding` must carry the folder's CURRENT
 * `sessionId` - read it from the folder row, never from a variable that has
 * outlived a sync.
 */
export function localQueue(binding) {
  // Whether anything watches the resource this queue belongs to. An address
  // book is observed - Thunderbird fires an event for every write, including
  // ours - so our own writes must be announced first or they come back as
  // the user's. A calendar we supply is not: those writes go to
  // `<id>#cache`, which fires nothing, so a pre-tag there would never be
  // consumed and would accumulate one row per synced item.
  const observed = !!binding.observed;

  return {
    owner: "local",
    observed,

    /** Everything waiting to be pushed, oldest first. */
    async pending() {
      const entries = await readQueue(binding.sessionId);
      return entries.filter((e) => isUserEntry(e?.status));
    },

    /** Every row, unfiltered - what GET_CHANGELOG answers with. Identical
     *  to `pending()` in practice, since nothing writes a pre-tag here, but
     *  the two questions are not the same question. */
    async entries() {
      return readQueue(binding.sessionId);
    },

    /** Fold a user edit into whatever is already queued for that item.
     *  Returns the resulting number of pending entries, which the caller
     *  reports to the host for the needs-sync badge. */
    async record({ parentId, itemId, kind, op, detail }) {
      const after = await mutate(binding, (entries) => {
        const result = recordUserEditUpdater(entries, {
          parentId,
          itemId,
          kind,
          op,
          detail,
          now: Date.now(),
        });
        return result.entries;
      });
      return after.filter((e) => isUserEntry(e?.status)).length;
    },

    /** Every message this binding still owes, oldest first.
     *
     *  Read by the phase that sends them, which runs after the pull so that
     *  what it says reflects the settled item rather than what we hoped to
     *  push. */
    async sendMailPending() {
      const entries = await readQueue(binding.sessionId);
      return entries.filter((e) => familyOf(e?.status) === FOR_SENDMAIL);
    },

    /** Note that this item owes a message, or leave the existing note
     *  alone. See `recordSendMailUpdater` for why the first note wins.
     *
     *  Deliberately does not return a pending count: a note is not a
     *  pending change and must not move the needs-sync badge on a folder
     *  that is otherwise fully synced. */
    async recordSendMail({ parentId, itemId, kind, status, detail }) {
      await mutate(binding, (entries) => {
        const result = recordSendMailUpdater(entries, {
          parentId,
          itemId,
          kind,
          status,
          detail,
          now: Date.now(),
        });
        return result.entries;
      });
    },

    /** Drop the note, once the message has been dealt with - sent, refused,
     *  or found to have nothing to say. One attempt, so all three are the
     *  same thing here. */
    async removeSendMail({ parentId, itemId, kind }) {
      await mutate(binding, (entries) =>
        removeSendMailUpdater(entries, { parentId, itemId, kind }),
      );
    },

    /** Drop the queued edit for this item - pushed, or established as
     *  unpushable. */
    async remove({ parentId, itemId, kind }) {
      await mutate(binding, (entries) =>
        removeEntryUpdater(entries, { parentId, itemId, kind }),
      );
    },

    /** Send failed items behind the rest, so the next sync tries the
     *  healthy ones first. */
    async moveToTail(items) {
      if (!items?.length) return;
      await mutate(binding, (entries) => moveToTailUpdater(entries, items));
    },

    /** Announce a write we are about to make, so the observer recognises the
     *  event it produces instead of logging it as the user's. A no-op on an
     *  unobserved resource - see `observed` above. */
    async markServerWrite({ parentId, itemId, kind, status }) {
      if (!observed) return;
      await mutate(binding, (entries) =>
        markServerWriteUpdater(entries, {
          parentId,
          itemId,
          kind,
          status,
          now: Date.now(),
        }),
      );
    },

    /** Fold an observed Thunderbird event into the queue, applying the
     *  pre-tag rules. Returns whether the user-facing content changed, which
     *  is what a caller broadcasts on - every suppressed event still yields a
     *  new array (the consumed tag is gone), so comparing references would
     *  fire on every server write. */
    async recordEvent({ kind, parentId, itemId, name, op }) {
      let changed = false;
      await mutate(binding, (entries) => {
        const next = applyEvent(entries, {
          kind,
          parentId,
          itemId,
          name,
          op,
          now: Date.now(),
        });
        changed = userFacingDiffers(entries, next);
        return next;
      });
      return changed;
    },

    /** Hand back the pre-tag an event would have consumed, for an event that
     *  is being discarded before it reaches `recordEvent`. Only the tag whose
     *  announced op this event is: one announcing a different op belongs to
     *  an event still to come and must stay armed for it. */
    async consumeServerTag({ kind, parentId, itemId, op }) {
      await mutate(binding, (entries) => {
        const idx = findConsumableServerTag(entries, {
          kind,
          parentId,
          itemId,
          op,
        });
        if (idx < 0) return entries;
        return [...entries.slice(0, idx), ...entries.slice(idx + 1)];
      });
    },

    /** The content hash last seen for a card, or null. */
    async getHash(itemId) {
      const key = queueKey(binding.sessionId);
      const rv = await browser.storage.local.get({ [key]: null });
      return rv[key]?.hashes?.[itemId] ?? null;
    },

    async setHash(itemId, hash) {
      await mutateHashes(binding, (m) =>
        m[itemId] === hash ? m : { ...m, [itemId]: hash },
      );
    },

    async dropHash(itemId) {
      await mutateHashes(binding, (m) => {
        if (!(itemId in m)) return m;
        const { [itemId]: _gone, ...rest } = m;
        return rest;
      });
    },

    async count() {
      const entries = await readQueue(binding.sessionId);
      return entries.filter((e) => isUserEntry(e?.status)).length;
    },
  };
}

// ── Bindings ──────────────────────────────────────────────────────────────

/** Record which folder each of these calendars belongs to. Called whenever
 *  folder rows are in hand for an honest reason; cheap enough to do every
 *  time and worth more than the bytes it costs, since it is what lets an
 *  item hook answer without the host. */
export function rememberBindings(list) {
  return serialize(async () => {
    const rv = await browser.storage.local.get({ [BINDINGS_KEY]: {} });
    const map = rv[BINDINGS_KEY] ?? {};
    let dirty = false;
    for (const { targetID, accountId, folderId, sessionId, targetType } of list) {
      if (!targetID || !sessionId) continue;
      const prior = map[targetID];
      if (
        prior?.accountId === accountId &&
        prior?.folderId === folderId &&
        prior?.sessionId === sessionId &&
        prior?.targetType === targetType
      ) {
        continue;
      }
      map[targetID] = { accountId, folderId, sessionId, targetType };
      dirty = true;
    }
    if (dirty) await browser.storage.local.set({ [BINDINGS_KEY]: map });
    return map;
  });
}

/** The folder a calendar belongs to, as last recorded. Null when we have
 *  never been told - a calendar that no sync of ours ever bound. */
export async function lookupBinding(targetID) {
  if (!targetID) return null;
  const rv = await browser.storage.local.get({ [BINDINGS_KEY]: {} });
  return rv[BINDINGS_KEY]?.[targetID] ?? null;
}

// ── Sweeping ──────────────────────────────────────────────────────────────

/**
 * Drop every queue whose session no folder row names, and every binding
 * whose target no folder row points at. Two different questions, so two
 * different inputs: `liveSessions` decides what a queue belongs to,
 * `liveTargets` decides whether a local resource is still bound.
 *
 * This is the entire teardown path. A folder deselected, an account
 * disconnected, a calendar deleted, a whole account removed while this
 * add-on was uninstalled - all of them end the same way: the host stops
 * naming a session, and the next time we look we do not recognise it.
 *
 * Returns `{queues, orphans}` - what was deleted, and the local resources
 * those bindings pointed at. A caller passes the orphans to the host, which
 * marks any that still exist; see REPORT_ORPHANED_TARGETS.
 *
 * Only ever called with rows actually read from the host. Sweeping against
 * an empty or partial list would delete live queues, so a caller that could
 * not read the rows must not call this at all.
 */
export function sweep({ liveSessions, liveTargets } = {}) {
  const live = liveSessions instanceof Set
    ? liveSessions
    : new Set(liveSessions ?? []);
  const targets = liveTargets instanceof Set
    ? liveTargets
    : new Set(liveTargets ?? []);
  return serialize(async () => {
    const all = await browser.storage.local.get(null);
    const drop = [];
    for (const [key, bag] of Object.entries(all)) {
      if (!key.startsWith(QUEUE_PREFIX)) continue;
      if (key === BINDINGS_KEY) continue;
      const sessionId = key.slice(QUEUE_PREFIX.length);
      if (live.has(sessionId)) continue;
      drop.push({
        key,
        accountId: bag?.accountId ?? null,
        folderId: bag?.folderId ?? null,
        entries: Array.isArray(bag?.entries) ? bag.entries.length : 0,
      });
    }

    // A binding is judged on its TARGET, not on its session. A session that
    // merely moved on still describes a resource the host is naming, and
    // that resource is very much alive; what makes one an orphan is that no
    // folder row points at it any more. Judging by session would have
    // called a rebound folder orphaned and left a live calendar renamed and
    // switched off.
    const bindings = all[BINDINGS_KEY] ?? {};
    const keptBindings = {};
    const orphans = [];
    for (const [targetID, b] of Object.entries(bindings)) {
      if (targets.has(targetID)) {
        keptBindings[targetID] = b;
        continue;
      }
      // Usually already deleted - every ordinary teardown removes the
      // resource before we get here - so this is a list of candidates and
      // the host skips the ones that are gone.
      orphans.push({
        targetID,
        targetType: b?.targetType ?? null,
        accountId: b?.accountId ?? null,
        folderId: b?.folderId ?? null,
      });
    }

    if (drop.length) await browser.storage.local.remove(drop.map((d) => d.key));
    if (orphans.length) {
      await browser.storage.local.set({ [BINDINGS_KEY]: keptBindings });
    }
    return { queues: drop, orphans };
  });
}
