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
export function resolveTarget(bucket, nodes, properties, mintId = null) {
  let n = 0;
  const mint = mintId ?? (() => `r${++n}`);
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
  // What a list will name a member by, when that member is a card only
  // this record holds. Keyed by the id the changelog used, which is what a
  // card's own stamp will match.
  const createdBy = new Map();

  for (const op of ["added", "modified"]) {
    for (const legacyItemId of bucket?.[op] ?? []) {
      const node = byKey.get(legacyItemId);
      const data = rawOf(node);
      if (!node || !data) continue;
      const entry = {
        rescueId: mint(),
        op,
        serverId: op === "added" ? null : legacyItemId,
        data,
      };
      if (op === "added") createdBy.set(legacyItemId, entry.rescueId);
      items.push(entry);
    }
  }

  for (const serverId of bucket?.deleted ?? []) {
    items.push({ rescueId: mint(), op: "deleted", serverId, data: null });
  }

  return { items, createdBy };
}

/** The id the provider stamped on an item, wherever it keeps it.
 *
 *  In this version's own data it is in the text. The previous version put a
 *  card's in a card property instead, which is why the properties are read
 *  separately and passed in here. */
export function easServerIdOf(node, properties) {
  const fromProps = properties?.[node?.id]?.[X_EAS_SERVERID_NAME];
  if (typeof fromProps === "string" && fromProps) return fromProps;
  return easServerIdFrom(rawOf(node));
}

const X_EAS_SERVERID_NAME = "X-EAS-SERVERID";

/** A mailing list, written as the vCard that describes a group of cards.
 *
 *  `KIND:group` is what RFC 6350 defines for exactly this, so a list needs
 *  no place of its own in the record and no format of its own: it is an
 *  entry like any other, and its `data` says what it is. A contact says
 *  `KIND:individual` or nothing at all, and Thunderbird writes no group
 *  vCards itself, so the two can never be confused.
 *
 *  Nothing outside reads this. A list is put back through
 *  `mailingLists.create` and `addMember`, so Thunderbird never parses it -
 *  but being the standard form, a downloaded copy means something to other
 *  software.
 *
 *  Each member names itself by the kind of reference it is using, because
 *  the two kinds survive the rebuild differently and nothing may work that
 *  out from how a token looks:
 *
 *    MEMBER:x-serverid:<id>   a card the server holds, found again by the
 *                             same value on the rebuilt card
 *    MEMBER:x-rescueid:<id>   a card only this record holds, found among
 *                             the entries the replay re-creates
 */
export function listToGroupVCard({ name, nickName, description, members }) {
  const lines = ["BEGIN:VCARD", "VERSION:4.0", "KIND:group"];
  if (name) lines.push(`FN:${escapeVCardText(name)}`);
  if (nickName) lines.push(`NICKNAME:${escapeVCardText(nickName)}`);
  if (description) lines.push(`NOTE:${escapeVCardText(description)}`);
  for (const m of members ?? []) {
    if (m?.serverId) lines.push(`MEMBER:x-serverid:${m.serverId}`);
    else if (m?.rescueId) lines.push(`MEMBER:x-rescueid:${m.rescueId}`);
  }
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

/** Read a group vCard back: its three fields and its members, each with the
 *  kind of reference it declared. Returns null for anything that is not one,
 *  which is how a contact is told apart from a list. */
export function groupVCardToList(data) {
  if (typeof data !== "string") return null;
  const unfolded = data.replace(/\r?\n[ \t]/g, "");
  if (!/^KIND:group\s*$/im.test(unfolded)) return null;

  const read = (name) => {
    const m = new RegExp(`^${name}:(.*)$`, "im").exec(unfolded);
    return m ? unescapeVCardText(m[1].trim()) : "";
  };
  const members = [];
  for (const line of unfolded.split(/\r?\n/)) {
    const m = /^MEMBER:x-(serverid|rescueid):(.*)$/i.exec(line);
    if (!m) continue;
    const value = m[2].trim();
    if (!value) continue;
    members.push(
      m[1].toLowerCase() === "serverid"
        ? { serverId: value }
        : { rescueId: value },
    );
  }
  return {
    name: read("FN"),
    nickName: read("NICKNAME"),
    description: read("NOTE"),
    members,
  };
}

/** True for the entry that is a mailing list rather than an item. */
export function isGroup(data) {
  return groupVCardToList(data) !== null;
}

function escapeVCardText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function unescapeVCardText(value) {
  return String(value).replace(/\\([\\,;nN])/g, (_, c) =>
    c === "n" || c === "N" ? "\n" : c,
  );
}

/** What a stored entry is called, for showing it to somebody. */
export function displayNameOf(data) {
  if (typeof data !== "string") return "";
  const unfolded = data.replace(/\r?\n[ \t]/g, "");
  const m = /^(?:FN|SUMMARY):(.*)$/im.exec(unfolded);
  return m ? unescapeVCardText(m[1].trim()) : "";
}

/** The identity an item already has: what Thunderbird calls it, and
 *  everything the provider has stamped on it. */
export function identityOf(text) {
  const unfolded = String(text ?? "").replace(/\r?\n[ \t]/g, "");
  const uid = /^UID:(.*)$/im.exec(unfolded)?.[1]?.trim() ?? null;
  const stamps = unfolded
    .split(/\r?\n/)
    .filter((line) => /^X-EAS-[A-Z0-9-]+[;:]/i.test(line));
  return { uid, stamps };
}

/**
 * Put the rescued content into an item without disturbing what the item is.
 *
 * An update changes what the user wrote and nothing else. Afterwards the
 * item's `UID` and every one of its `X-EAS-*` properties are exactly what
 * they were before: the first is its identity to Thunderbird, which
 * everything else in the profile refers to it by, and the rest are the
 * provider's - its identity on the server, what an organiser has been told,
 * the answer a mailbox recorded. Those are state, and an update has no
 * business touching state.
 *
 * The rescued text carries none of them, because the previous version kept
 * a card's stamp in a card property and gave calendar items no stamps at
 * all - so they have to be put back for the invariant to hold rather than
 * merely left alone.
 *
 * Every `UID` line is rewritten, not just the first: a recurring item's
 * overrides each carry one, and they all name the same item. The stamps go
 * back on the component that holds the first of them, which is the master -
 * where the provider keeps them.
 *
 * Stamps are matched by prefix, so one added later is carried without
 * anyone remembering to come back here.
 */
export function transplantIdentity({ from, into }) {
  const identity = identityOf(from);
  if (typeof into !== "string" || !into) return into;
  if (!identity.uid) return into;

  const lines = into.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out = [];
  let stampsPlaced = false;
  for (const line of lines) {
    if (/^X-EAS-[A-Z0-9-]+[;:]/i.test(line)) continue; // never the blob's
    if (/^UID:/i.test(line)) {
      out.push(`UID:${identity.uid}`);
      if (!stampsPlaced) {
        out.push(...identity.stamps);
        stampsPlaced = true;
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\r\n");
}

/** Take an item's identity off, so whatever writes it next mints its own.
 *
 *  For something the previous version created and never sent: the id it had
 *  belonged to a resource that no longer exists and the server never saw
 *  it, so keeping it gains nothing and risks colliding with an item the
 *  fresh pull has just brought back. */
export function stripIdentity(data, { keepUid = false } = {}) {
  if (typeof data !== "string") return data;
  const drop = keepUid ? /^X-EAS-[A-Z0-9-]+[;:]/i : /^(UID:|X-EAS-[A-Z0-9-]+[;:])/i;
  return data
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/)
    .filter((line) => !drop.test(line))
    .join("\r\n");
}

/** Skipped when showing an item to somebody: structure, bookkeeping, and
 *  the identity fields, which say nothing about what the user wrote and
 *  differ between any two copies of the same thing. */
const NOT_CONTENT =
  /^(BEGIN|END|VERSION|PRODID|CALSCALE|METHOD|UID|DTSTAMP|LAST-MODIFIED|CREATED|X-EAS-[A-Z0-9-]+)[;:]/i;

/**
 * An item's content, as lines somebody can read.
 *
 * The whole timezone block goes: it is several dozen lines of rules the
 * user never wrote, and two copies of one appointment differ in it for
 * reasons that have nothing to do with them.
 */
export function contentLines(text) {
  if (typeof text !== "string" || !text) return [];
  const out = [];
  let inTimezone = false;
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    if (/^BEGIN:VTIMEZONE/i.test(line)) inTimezone = true;
    else if (/^END:VTIMEZONE/i.test(line)) inTimezone = false;
    else if (!inTimezone && line.trim() && !NOT_CONTENT.test(line)) {
      out.push(line.trim());
    }
  }
  return out;
}

/**
 * What a kept change would do to an item, line by line.
 *
 * Compared as sets rather than in sequence: these are properties, not
 * prose, and an appointment whose fields come back from the server in
 * another order has not changed. A line on one side only is an addition or
 * a removal; a line on both is context.
 */
export function diffLines(before, after) {
  const a = new Set(before ?? []);
  const b = new Set(after ?? []);
  const rows = [];
  for (const line of before ?? []) {
    if (!b.has(line)) rows.push({ mark: "-", line });
  }
  for (const line of after ?? []) {
    rows.push({ mark: b.has(line) && a.has(line) ? " " : "+", line });
  }
  return rows;
}

/** A file name that survives every filesystem, from a folder's own name. */
function safeFileName(name) {
  return (
    String(name ?? "")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 80) || "resource"
  );
}

/** Take off what belongs to this installation, and leave what belongs to
 *  the item.
 *
 *  Only the provider's stamps go: they mean nothing outside the account
 *  they came from. The item keeps the id it had, for two reasons. A list
 *  can then name its members, since a `MEMBER` resolves against a UID in
 *  the same file and nowhere else. And importing the archive twice yields
 *  one copy rather than two.
 *
 *  It cannot collide with what the account already holds: the previous
 *  version named a synced item by its id on the server, and this one names
 *  it by the server's own UID, so the two never coincide.
 */
function forExport(data) {
  return stripIdentity(data, { keepUid: true });
}

/** What a rescued change can still do, now the folder holds what the server
 *  holds.
 *
 *  A change is applied to the item it was made against, found by the
 *  ServerId the server issued for it. When that item is not there any more,
 *  somebody deleted it elsewhere while this account could not sync, and the
 *  two operations part company:
 *
 *    - a change becomes a **creation**. The edit is the user's work either
 *      way, and the only other answer is to drop it, which is the one
 *      outcome that loses it. It goes back as a new item and the server
 *      issues it an identity like any other.
 *    - a deletion is **null**, having already happened. There is nothing
 *      left to offer and nothing to do.
 *
 *  `present` is the rebuilt folder keyed by ServerId. */
export function effectiveOp(entry, present) {
  if (entry.op === "added") return "added";
  if (entry.serverId && present.get(entry.serverId)) return entry.op;
  return entry.op === "modified" ? "added" : null;
}

/**
 * The rescued changes as files somebody can import: one per resource, named
 * after it, in the format that resource speaks.
 *
 * A deletion appears in no file - there is nothing to import for something
 * that was removed. A mailing list keeps its name and description but loses
 * its members, which are named here by ids that mean nothing outside this
 * record; a list of dangling references would be worse than a list of none.
 *
 * @param {object} rescue the stored record
 * @param {Map<string,{name: string, type: string}>} folderInfo by folderId
 */
export function backupFiles(rescue, folderInfo) {
  const files = [];
  const used = new Set();

  for (const held of rescue?.folders ?? []) {
    const info = folderInfo.get(held.folderId);
    const isBook = info?.type === "contacts";
    const bodies = [];

    // What each entry is called in the file, so a list can point at it.
    // Both ways a member names itself resolve here and nowhere else: this
    // record's own id, and the id the server knows the card by.
    const uidByRescueId = new Map();
    const uidByServerId = new Map();
    for (const entry of held.items ?? []) {
      const uid = entry.data ? identityOf(entry.data).uid : null;
      if (!uid) continue;
      uidByRescueId.set(entry.rescueId, uid);
      if (entry.serverId) uidByServerId.set(entry.serverId, uid);
    }

    for (const entry of held.items ?? []) {
      if (!entry.data) continue;
      if (isGroup(entry.data)) {
        bodies.push(exportGroup(entry.data, uidByRescueId, uidByServerId));
        continue;
      }
      bodies.push(forExport(entry.data));
    }
    if (!bodies.length) continue;

    const stem = safeFileName(info?.name);
    const ext = isBook ? "vcf" : "ics";
    let name = `${stem}.${ext}`;
    for (let n = 2; used.has(name); n++) name = `${stem}-${n}.${ext}`;
    used.add(name);
    files.push({
      name,
      text: isBook ? bodies.join("\r\n") : mergeCalendars(bodies),
    });
  }
  return files;
}

/** A list, with its members named the way a vCard names them.
 *
 *  Inside the record a member says which kind of name it is using, because
 *  the two kinds are resolved against different things. In a file there is
 *  only one thing to resolve against - the cards in that same file - so
 *  both become the plain `urn:uuid:` reference vCard defines, pointing at a
 *  card the reader is about to import.
 *
 *  A member that is in no file is dropped rather than left dangling. That
 *  is why the record carries the cards a list names even when nobody edited
 *  them. */
function exportGroup(data, uidByRescueId, uidByServerId) {
  const list = groupVCardToList(data);
  const lines = forExport(data)
    .split(/\r?\n/)
    .filter((line) => !/^MEMBER[;:]/i.test(line));
  const members = [];
  for (const member of list?.members ?? []) {
    const uid = member.serverId
      ? uidByServerId.get(member.serverId)
      : uidByRescueId.get(member.rescueId);
    if (uid) members.push(`MEMBER:urn:uuid:${uid}`);
  }
  const end = lines.lastIndexOf("END:VCARD");
  if (end < 0) return lines.join("\r\n");
  return [...lines.slice(0, end), ...members, ...lines.slice(end)].join("\r\n");
}

/** Several one-item calendars as one calendar.
 *
 *  Each kept item is a whole VCALENDAR of its own, and a file holding
 *  several of them end to end is not one any reader will accept. The
 *  components come out and go into a single wrapper, and a timezone is
 *  written once however many items refer to it.
 */
function mergeCalendars(bodies) {
  const seenTimezones = new Set();
  const timezones = [];
  const components = [];

  for (const body of bodies) {
    const lines = body.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
    let block = null;
    let kind = null;
    for (const line of lines) {
      if (/^BEGIN:(VTIMEZONE|VEVENT|VTODO)$/i.test(line)) {
        kind = line.slice(6).toUpperCase();
        block = [line];
        continue;
      }
      if (!block) continue;
      block.push(line);
      if (!/^END:(VTIMEZONE|VEVENT|VTODO)$/i.test(line)) continue;
      const text = block.join("\r\n");
      if (kind === "VTIMEZONE") {
        const id = /^TZID:(.*)$/im.exec(text)?.[1]?.trim() ?? text;
        if (!seenTimezones.has(id)) {
          seenTimezones.add(id);
          timezones.push(text);
        }
      } else {
        components.push(text);
      }
      block = null;
    }
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TbSync//Migration backup//EN",
    ...timezones,
    ...components,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
