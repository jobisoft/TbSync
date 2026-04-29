import { DEFAULT_SETTINGS, EVENT_LOG_MAX, KEYS } from "./storage-keys.mjs";
import { serialize } from "./storage-queue.mjs";

/**
 * Ring-buffered event log, backed by browser.storage.session.
 *
 * Session-scoped so the buffer is cleared on every Thunderbird restart
 * (matches legacy TbSync's `debug.log` lifecycle). Oldest entries fall off
 * once the buffer exceeds EVENT_LOG_MAX.
 *
 * Entry shape (required fields):
 *   { level, message, ...optional }
 * where level ∈ { "error", "warning", "debug" }. The level drives both the
 * capture gate (entries above the current logLevel threshold are dropped)
 * and the UI row coloring in the Event Log tab.
 */

export const LEVELS = Object.freeze(["error", "warning", "info", "debug"]);

/** Threshold index for each level. Appended entry is kept iff
 *  LEVEL_INDEX[entry.level] < settings.logLevel. */
const LEVEL_INDEX = Object.freeze({ error: 0, warning: 1, info: 2, debug: 3 });

function assertValidLevel(level) {
  if (!LEVELS.includes(level)) {
    throw new Error(
      `event-log: level must be one of ${LEVELS.join("|")} (got ${JSON.stringify(level)})`,
    );
  }
}

async function currentLogLevel() {
  const rv = await browser.storage.local.get({
    [KEYS.SETTINGS]: DEFAULT_SETTINGS,
  });
  return rv[KEYS.SETTINGS]?.logLevel ?? DEFAULT_SETTINGS.logLevel;
}

/** Append an entry to the session log if its level passes the current
 *  capture threshold. Returns the stamped entry on persist, or `null` if
 *  the gate dropped it. Throws (via `assertValidLevel`) on bad input. */
export function append(entry) {
  assertValidLevel(entry?.level);
  return serialize(async () => {
    const threshold = await currentLogLevel();
    if (LEVEL_INDEX[entry.level] > threshold) return null;
    const rv = await browser.storage.session.get({ [KEYS.EVENT_LOG]: [] });
    const log = rv[KEYS.EVENT_LOG];
    const stamped = { ...entry, timestamp: entry.timestamp ?? Date.now() };
    log.push(stamped);
    if (log.length > EVENT_LOG_MAX) {
      log.splice(0, log.length - EVENT_LOG_MAX);
    }
    await browser.storage.session.set({ [KEYS.EVENT_LOG]: log });
    return stamped;
  });
}

export async function list() {
  const rv = await browser.storage.session.get({ [KEYS.EVENT_LOG]: [] });
  return rv[KEYS.EVENT_LOG];
}

export function clear() {
  return serialize(() => browser.storage.session.set({ [KEYS.EVENT_LOG]: [] }));
}
