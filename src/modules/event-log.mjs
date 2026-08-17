import { DEFAULT_SETTINGS, EVENT_LOG_MAX, KEYS } from "./storage-keys.mjs";
import { serialize } from "../vendor/tbsync/storage-queue.mjs";
import * as ui from "./messaging-ui.mjs";

/**
 * Event log, backed by IndexedDB.
 *
 * Session-scoped by convention rather than by storage: the store is emptied
 * the first time this module opens it in a process, so the log a user sees
 * always belongs to the running Thunderbird (matching legacy TbSync's
 * `debug.log` lifecycle). IndexedDB persists across restarts, so that wipe
 * is what keeps the promise - and it also means a crash leaves nothing
 * behind on the next start.
 *
 * Why not `storage.session`, which is where this lived: that API has no
 * append. `storage.set(key, array)` rewrites the whole value, so the cost
 * of one line grew with the number of lines already logged, and every line
 * additionally broadcast the entire log to every listener through
 * `storage.onChanged`. Measured on a real report, entries carrying a wire
 * dump average 40 KB, so a full log is tens of megabytes - re-serialised
 * per line, several times a second during a sync. IndexedDB adds one
 * record and leaves the rest untouched, which is what makes the unlimited
 * setting possible at all.
 *
 * IndexedDB has no cross-context change event - a transaction notifies
 * only the connection that ran it, and the observer proposal that would
 * have fixed that was never shipped anywhere. So an appended entry is
 * announced on the manager port instead, one entry per message, which is
 * what `storage.onChanged` used to do for the price of the entire log.
 *
 * Entry shape (required fields):
 *   { level, message, ...optional }
 * where level ∈ { "error", "warning", "info", "debug" }. The level drives
 * both the capture gate (entries above the current logLevel threshold are
 * dropped) and the UI row coloring in the Event Log tab.
 */

export const LEVELS = Object.freeze(["error", "warning", "info", "debug"]);

/** Threshold index for each level. An entry is kept iff
 *  LEVEL_INDEX[entry.level] <= settings.logLevel. */
const LEVEL_INDEX = Object.freeze({ error: 0, warning: 1, info: 2, debug: 3 });

const DB_NAME = "tbsync-event-log";
const DB_VERSION = 1;
const STORE = "entries";

/** Present for as long as this Thunderbird session lasts, and gone after a
 *  restart - which is how the store knows whether to start empty. */
const SESSION_MARK = "tbsync.eventLogSession";

/** Trimming one record per append would run a delete transaction on every
 *  line once the log is full. Overshooting by this much and then dropping
 *  the excess in one pass keeps that to one transaction per batch. */
const TRIM_SLACK = 250;

/** seq is per-process and starts at 0, because the store starts empty. */
let nextSeq = 0;
/** Live count, so the trim does not have to count the store per append. */
let entryCount = 0;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Keyed by seq: monotonic, so "oldest" is "lowest key" and a
        // cursor walks the log in the order it happened.
        db.createObjectStore(STORE, { keyPath: "seq" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).then(async (db) => {
    // Is this a new Thunderbird session, or has the background page merely
    // been suspended and woken? The database cannot say - it survives both
    // - but `storage.session` can: it is dropped on restart and kept
    // across a suspend. Getting this wrong either way is destructive: wipe
    // on every wake and a long capture disappears under the user; never
    // wipe and the log outlives the session it belongs to, with `nextSeq`
    // restarting at 0 against keys that already exist.
    const rv = await browser.storage.session.get({ [SESSION_MARK]: false });
    if (rv[SESSION_MARK]) {
      // Woken. Adopt what is already stored.
      entryCount = (await runTx(db, "readonly", (s) => s.count())) ?? 0;
      nextSeq = await seqAfterLast(db);
    } else {
      await runTx(db, "readwrite", (store) => store.clear());
      entryCount = 0;
      nextSeq = 0;
      await browser.storage.session.set({ [SESSION_MARK]: true });
    }
    return db;
  });
  // A rejected promise left in the cache would fail every later append for
  // the rest of the session, so a failed open is forgotten and the next
  // caller tries again.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/** One past the highest key in the store, or 0 when it is empty.
 *
 *  The cursor is read inside its own transaction on purpose: a cursor is
 *  not valid once the transaction has finished, so the key has to be
 *  taken in the handler rather than from the resolved value. */
function seqAfterLast(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).openKeyCursor(null, "prev");
    let seq = 0;
    req.onsuccess = () => {
      const c = req.result;
      if (c) seq = c.key + 1;
    };
    tx.oncomplete = () => resolve(seq);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

/** Run one transaction and resolve with the request's result, or with
 *  undefined for requests that have none. Rejects on abort or error, so a
 *  caller never sees a half-applied write. */
function runTx(db, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let out;
    const req = work(tx.objectStore(STORE));
    if (req) req.onsuccess = () => (out = req.result);
    tx.oncomplete = () => resolve(out);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

function assertValidLevel(level) {
  if (!LEVELS.includes(level)) {
    throw new Error(
      `event-log: level must be one of ${LEVELS.join("|")} (got ${JSON.stringify(level)})`,
    );
  }
}

async function currentSettings() {
  const rv = await browser.storage.local.get({
    [KEYS.SETTINGS]: DEFAULT_SETTINGS,
  });
  return { ...DEFAULT_SETTINGS, ...(rv[KEYS.SETTINGS] ?? {}) };
}

/** Drop the oldest entries once the log has overshot its limit. */
async function trim(db, limit) {
  if (entryCount <= limit + TRIM_SLACK) return;
  const excess = entryCount - limit;
  await runTx(db, "readwrite", (store) => {
    let dropped = 0;
    const cur = store.openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c || dropped >= excess) return;
      c.delete();
      dropped += 1;
      c.continue();
    };
    return null;
  });
  entryCount -= excess;
}

/** Append an entry if its level passes the current capture threshold.
 *  Returns the stamped entry on persist, or `null` if the gate dropped it.
 *  Throws (via `assertValidLevel`) on bad input.
 *
 *  Serialised against the other writers so seq stays dense and the trim
 *  sees a settled count. */
export function append(entry) {
  assertValidLevel(entry?.level);
  return serialize(async () => {
    try {
      const settings = await currentSettings();
      if (LEVEL_INDEX[entry.level] > settings.logLevel) return null;
      const db = await openDb();
      const stamped = {
        ...entry,
        timestamp: entry.timestamp ?? Date.now(),
        seq: nextSeq++,
      };
      await runTx(db, "readwrite", (store) => store.add(stamped));
      entryCount += 1;
      if (!settings.eventLogUnlimited) await trim(db, EVENT_LOG_MAX);
      // Only open manager tabs pay for this, and only for the one entry.
      ui.broadcast({ type: "event-log-entry", entry: stamped });
      return stamped;
    } catch (err) {
      // A log that cannot write is not a reason to fail the work being
      // logged, and most callers `await` this from inside a sync. A bad
      // level still throws above - that is a caller bug, not a storage
      // failure.
      console.warn("[tbsync] event log: could not store an entry:", err);
      return null;
    }
  });
}

/** The log, oldest first.
 *
 *  `sinceSeq` returns only what was appended after that seq. `limit` keeps
 *  the newest N, for the initial load of a UI that cannot show more. */
export async function list({ sinceSeq = null, limit = null } = {}) {
  const db = await openDb();
  const range =
    sinceSeq == null ? null : IDBKeyRange.lowerBound(sinceSeq, true);
  const all = await runTx(db, "readonly", (store) => store.getAll(range));
  const entries = all ?? [];
  return limit != null && entries.length > limit
    ? entries.slice(entries.length - limit)
    : entries;
}

export function clear() {
  return serialize(async () => {
    const db = await openDb();
    await runTx(db, "readwrite", (store) => store.clear());
    entryCount = 0;
    // seq restarts with the store, so the manager has to drop what it
    // holds rather than reconcile seqs that have gone backwards.
    nextSeq = 0;
    ui.broadcast({ type: "event-log-cleared" });
  });
}
