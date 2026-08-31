/**
 * Reading the edits the previous version queued and never sent.
 *
 * A carried-over account is locked: it cannot sync, its resources are
 * read-only and it cannot be disconnected. All of that exists to protect
 * one thing - the edits the old version had pending when the user updated,
 * which live nowhere but in those local resources. This module turns the
 * old changelog plus the current contents of a resource into a record of
 * those edits.
 *
 * Pure: no `browser.*`, no storage, no I/O. The caller supplies the rows
 * and the items and decides what to do with the result.
 *
 * ## Ids are opaque
 *
 * An id is a token. It is compared whole or not at all - never split, never
 * stripped of a prefix, never tested for shape. That matters most where an
 * id contains a colon: `Ued67e:57a5…` is one ServerId composed that way by
 * the server, not a collection id glued onto an item id by us, and other
 * servers issue ones like `6:125`. Splitting on the colon would invent a
 * boundary the server never put there.
 *
 * It is also why the join to a rebuilt resource works later without any
 * conversion: `X-EAS-SERVERID` holds the ServerId exactly as the server
 * issued it, in the old version and in this one alike, so the value rescued
 * here and the value stamped on the replacement are the same string.
 */

/** The six statuses the legacy changelog uses. `*_by_user` is a pending
 *  edit - the thing we are here for. `*_by_server` is an echo-suppression
 *  pre-tag and is none of our business; `changelog-core.mjs` documents
 *  both kinds.
 *
 *  Anything else is ignored, which is how the one odd row in a real capture
 *  is handled: a deferred-creation marker carrying a timestamp where a
 *  status belongs. Keyed off the unrecognised status rather than off what
 *  its `itemId` looks like, so nothing has to inspect an id to classify a
 *  row - and so whatever else that version may have written is ignored the
 *  same way. */
const OPS = new Map([
  ["added_by_user", "added"],
  ["modified_by_user", "modified"],
  ["deleted_by_user", "deleted"],
  ["added_by_server", null],
  ["modified_by_server", null],
  ["deleted_by_server", null],
]);

/**
 * How two pending edits to one item combine.
 *
 * The previous version wrote its changelog through this same state machine
 * - it lives on as `decideUserStatus` in `changelog-core.mjs` - so a file
 * it finished writing holds at most one pending edit per item and this is
 * never needed. It is here for a file it did *not* finish: interrupted,
 * hand-edited, or written by a build that collapsed them wrongly.
 *
 * Keeping only the most recent row instead would be a judgement, and a
 * damaging one: an item created and then edited is still an item the server
 * has never seen, and calling that a modification would make the replay
 * update something that is not there.
 *
 * `null` means the two cancel - an item added and then deleted was never
 * sent, so there is nothing to add and nothing to delete.
 *
 * Deliberately a copy rather than an import: this reads a format that is
 * finished and cannot change again, so it must not follow a machine that
 * still can.
 */
const MERGE = {
  added: { added: "added", modified: "added", deleted: null },
  modified: { added: "added", modified: "modified", deleted: "deleted" },
  deleted: { added: "modified", modified: "modified", deleted: "deleted" },
};

/**
 * Group the legacy changelog into the pending edits, per resource.
 *
 * Returns `null` for anything that is not a list of rows - a missing file,
 * a truncated one, a shape from some other version. That is "no answer",
 * distinct from a valid empty answer.
 *
 * @param {Array<{parentId, itemId, timestamp, status}>} entries
 * @returns {{targets: Object, counts: Object, ignored: number}|null}
 */
export function parseLegacyChangelog(entries) {
  if (!Array.isArray(entries)) return null;

  const targets = {};
  let ignored = 0;
  // What is owed per resource and item, after combining every pending edit
  // recorded against it - see MERGE.
  const merged = new Map();
  const pending = [];

  for (const row of entries) {
    const parentId = row?.parentId;
    const itemId = row?.itemId;
    if (!parentId || !itemId) {
      ignored++;
      continue;
    }
    if (!OPS.has(row?.status)) {
      ignored++;
      continue;
    }
    const op = OPS.get(row.status);
    if (op === null) continue; // A server pre-tag: not an edit of ours.

    const key = `${parentId}\u0000${itemId}`;
    const at = Number(row.timestamp) || 0;
    pending.push({ key, parentId, itemId, op, at });
  }

  // Oldest first, so the edits combine in the order they were made.
  pending.sort((a, b) => a.at - b.at);
  for (const { key, parentId, itemId, op } of pending) {
    const prior = merged.get(key);
    const next = prior ? MERGE[prior.op][op] : op;
    if (next === null) merged.delete(key);
    else merged.set(key, { parentId, itemId, op: next });
  }

  const counts = { added: 0, modified: 0, deleted: 0 };
  for (const { parentId, itemId, op } of merged.values()) {
    const bucket = (targets[parentId] ??= {
      added: [],
      modified: [],
      deleted: [],
    });
    bucket[op].push(itemId);
    counts[op]++;
  }

  return { targets, counts, ignored };
}

/**
 * Every value a stored item can be known by.
 *
 * The changelog names an item either by the id its resource gave it or by
 * the `X-EAS-SERVERID` the provider stamped on it. Which of the two is
 * never decided: both are candidate keys and the caller compares them
 * whole. The stamp lives in a card *property*, which the contacts API does
 * not return, so the caller passes the properties it read separately; for
 * an event or task it is in the item's own text and is found there.
 *
 * Every property value is a candidate, not one looked up by name: which
 * property carries a provider's identifier is the provider's business, and
 * the host has no reason to learn it.
 */
export function keysOf(node, properties) {
  const keys = new Set();
  if (node?.id) keys.add(String(node.id));

  const bag = properties?.[node?.id];
  if (bag && typeof bag === "object") {
    for (const value of Object.values(bag)) {
      if (typeof value === "string" && value) keys.add(value);
    }
  }

  // An event or task carries its stamp inline. Read as a property of the
  // text, not by pattern-matching an id out of it.
  const stamp = easServerIdFrom(rawOf(node));
  if (stamp) keys.add(stamp);

  return [...keys];
}

/** The item's own text, in whichever shape it arrived.
 *
 *  The contacts API returns a card's vCard under `properties.vCard`, and
 *  the host's wrapper lifts it to the top level. Reading only the lifted
 *  shape reported a card as gone and dropped it in silence, because "no
 *  longer present" is a legitimate outcome - so both are accepted. */
function rawOf(node) {
  return (
    node?.vCard ?? node?.ical ?? node?.item ?? node?.properties?.vCard ?? null
  );
}

const X_EAS_SERVERID = /^X-EAS-SERVERID(?:;[^:\r\n]*)?:(.*)$/im;

/** The `X-EAS-SERVERID` value in an item's text, or null.
 *
 *  Unfolding first: iCal and vCard wrap long lines, and a ServerId is long
 *  enough to be wrapped in practice. */
function easServerIdFrom(raw) {
  if (typeof raw !== "string" || !raw) return null;
  const unfolded = raw.replace(/\r?\n[ \t]/g, "");
  const m = X_EAS_SERVERID.exec(unfolded);
  const value = m?.[1]?.trim();
  return value || null;
}

/**
 * Match one resource's pending edits against what the resource still holds.
 *
 * `bucket` is one entry of `parseLegacyChangelog().targets`; `nodes` are
 * the items read from that resource; `properties` maps an item id to its
 * properties, for the resource type that keeps its stamp out of the text.
 *
 * Each edit comes back as `{ op, serverId, data }`, and that is everything
 * a replay needs:
 *
 *   - `serverId` is the server's own id, or **null** when the server has
 *     never had the item. Which it is follows from the operation, not from
 *     the look of an id: an addition is by definition something never sent,
 *     while a modification or a deletion is of something the server holds.
 *     Deciding it here, once, where the evidence is, keeps every later
 *     reader from inferring it from an id's appearance.
 *   - `data` is the item's own text, byte for byte. Everything else about
 *     the item is already in there - its UID, and whether it is a card, an
 *     event or a task - so nothing is copied out beside it to fall out of
 *     step.
 *
 * A deletion carries no data: the item is gone by definition, and its
 * serverId is what finds its replacement afterwards.
 *
 * A row naming an item the resource does not hold yields nothing at all.
 * There is no data behind it, so nothing could ever be replayed from it,
 * and an opaque id with no item behind it is not something anyone can be
 * shown or act on. The changelog is simply ahead of the resource there.
 */
export function resolveTarget(bucket, nodes, properties) {
  const byKey = new Map();
  for (const node of nodes ?? []) {
    for (const key of keysOf(node, properties)) {
      // First writer wins, and a key claimed twice is a key that identifies
      // nothing - drop it rather than pick one.
      if (byKey.has(key)) byKey.set(key, null);
      else byKey.set(key, node);
    }
  }

  const items = [];
  for (const op of ["added", "modified"]) {
    for (const legacyItemId of bucket?.[op] ?? []) {
      const node = byKey.get(legacyItemId);
      const data = rawOf(node);
      if (!node || !data) continue;
      items.push({
        op,
        serverId: op === "added" ? null : legacyItemId,
        data,
      });
    }
  }

  for (const serverId of bucket?.deleted ?? []) {
    items.push({ op: "deleted", serverId, data: null });
  }

  return { items };
}
