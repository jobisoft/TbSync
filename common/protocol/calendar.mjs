/**
 * Everything a provider does with a Thunderbird calendar.
 *
 * Thin wrapper over `messenger.calendar.calendars.*` and
 * `messenger.calendar.items.*`. Always exchanges iCal strings - the
 * wrapper pins `format: "ical"` on every write and `returnFormat: "ical"`
 * on every read so callers never need to think about jCal.
 *
 * Calendar operations tolerate "not found" (the user may have deleted
 * the calendar manually); item-level reads/writes throw on real errors
 * so the sync orchestrator can surface them.
 */

const ICAL_FORMAT = "ical";

/** Our own calendar type, registered by the `calendar_provider` manifest
 *  key. The platform derives it from the extension id, so this must match
 *  what `browser_specific_settings.gecko.id` says. */
// No provider identity is baked in. A calendar's `type` is the id of the
// add-on that supplies it, so it is the one thing here that cannot be
// shared - `createCalendar` takes it from the caller.

/** The storage calendar behind a provider calendar. Writing here is how the
 *  sync puts server data into the calendar *without* it coming back as a
 *  user edit - the provider hooks do not fire for it. The suffix is the
 *  Experiment's addressing convention; the underlying calendar carries the
 *  same id, so anything reading the calendar sees these writes at once. */
export function cacheId(calendarId) {
  return calendarId ? `${calendarId}#cache` : calendarId;
}

/* ── Calendar level ───────────────────────────────────────────────── */

/** The palette a new calendar is coloured from, carried over verbatim from
 *  v4 (`TbSync/content/modules/lightning.js`). Order matters: it is the
 *  tie-break when several colours are equally unused. */
const CALENDAR_PALETTE = [
  "#3366CC",
  "#DC3912",
  "#FF9900",
  "#109618",
  "#990099",
  "#3B3EAC",
  "#0099C6",
  "#DD4477",
  "#66AA00",
  "#B82E2E",
  "#316395",
  "#994499",
  "#22AA99",
  "#AAAA11",
  "#6633CC",
  "#E67300",
  "#8B0707",
  "#329262",
  "#5574A6",
  "#3B3EAC",
];

/**
 * Choose the colour for a calendar we are about to create: the palette entry
 * in least use across every calendar in the profile, ties going to the
 * earliest in the list.
 *
 * Needed because nothing else will supply one. ActiveSync's folder hierarchy
 * has no colour element in any protocol version, so the server cannot tell us
 * what colour a calendar "is", and Thunderbird sets none of its own - a
 * calendar created without this renders in the placeholder shade the calendar
 * API substitutes for "no colour", making every EAS calendar look alike.
 *
 * Counts all calendars rather than only ours, as v4 did: the point is a colour
 * that stands out in the user's calendar list, and the other entries in that
 * list are just as much a part of it.
 *
 * Falls back to the head of the palette if the calendar list cannot be read -
 * a colour we cannot justify is still better than failing the bind.
 */
export async function pickCalendarColor() {
  let used = [];
  try {
    const all = await messenger.calendar.calendars.query({});
    used = all.map((c) => (c?.color ?? "").toUpperCase());
  } catch {
    return CALENDAR_PALETTE[0];
  }
  let best = CALENDAR_PALETTE[0];
  let bestCount = Infinity;
  for (const color of CALENDAR_PALETTE) {
    const count = used.filter((u) => u === color.toUpperCase()).length;
    if (count < bestCount) {
      bestCount = count;
      best = color;
      if (count === 0) break;
    }
  }
  return best;
}

/**
 * Create a calendar of our own provider type. `kind` is "events" or "tasks",
 * and it decides what the calendar tells Thunderbird it can hold.
 *
 * An EAS folder stores one or the other, never both, and a calendar that
 * claims both is offered wherever either is wanted: a Tasks-backed calendar
 * turns up in the New Event dialog, a Calendar-backed one in the task
 * pickers. Saving into the wrong one produces an item the folder's codec
 * cannot express and the server predictably rejects.
 *
 * The provider as a whole still supports both - that stays declared in the
 * manifest's `calendar_provider.capabilities`, and the Experiment merges the
 * two as `{...manifestCapabilities, ...overrideCapabilities}`. So `mutable`
 * and `requiresNetwork` keep coming from the manifest while `events` and
 * `tasks` are decided here, per calendar.
 *
 * Note the names: the schema wants plain `capabilities.events` /
 * `capabilities.tasks`. `capabilities.events.supported` is Thunderbird's
 * internal property name, which the Experiment derives from these.
 *
 * This only governs what the calendar is *offered* for. The item API does
 * not consult capabilities, so a programmatic write of the wrong type still
 * lands; the push-side guard in `eas/sync-runner.mjs` is what stops one
 * reaching the server.
 *
 * Returns the new calendar id.
 */
export async function createCalendar({ name, kind, color, type, url }) {
  if (!name || typeof name !== "string" || !name.trim()) {
    throw new Error("createCalendar requires a non-empty name");
  }
  if (kind !== "events" && kind !== "tasks") {
    throw new Error(
      `createCalendar requires kind: 'events' | 'tasks' (got ${kind})`,
    );
  }
  if (!type || !url) {
    throw new Error(
      "createCalendar requires the calling add-on's calendar `type` and `url`",
    );
  }
  const props = {
    name: name.trim(),
    type,
    url,
    capabilities: {
      events: kind === "events",
      tasks: kind === "tasks",
    },
  };
  if (color) props.color = color;
  const calendar = await messenger.calendar.calendars.create(props);
  return calendar?.id ?? calendar;
}

export async function deleteCalendar(id) {
  if (!id) return;
  try {
    await messenger.calendar.calendars.remove(id);
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
}

export async function calendarExists(id) {
  if (!id) return false;
  try {
    const cal = await messenger.calendar.calendars.get(id);
    return !!cal;
  } catch {
    return false;
  }
}

export async function renameCalendar(id, name) {
  if (!id) throw new Error("renameCalendar requires an id");
  await messenger.calendar.calendars.update(id, { name });
}

/**
 * Mirror a folder's effective read-only state onto the local Thunderbird
 * calendar. When set, TB greys out event editing in the UI; the experiment's
 * sync write path bypasses the flag, so the runner can still apply server
 * changes to the local store. Tolerant of "calendar not found" because the
 * user may have deleted it manually since the folder row was bound.
 */
export async function setCalendarReadOnly(id, readOnly) {
  if (!id) return;
  try {
    await messenger.calendar.calendars.update(id, { readOnly: !!readOnly });
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
}

/* ── Item level ───────────────────────────────────────────────────── */

/**
 * List items in a calendar, optionally filtered by type ("event" or
 * "task"). Returns `[{ id, type, item: <iCal string> }]`. Tolerates
 * "calendar not found" by returning [].
 */
export async function listItems(calendarId, type) {
  if (!calendarId) return [];
  try {
    const queryOpts = { calendarId, returnFormat: ICAL_FORMAT };
    if (type) queryOpts.type = type;
    const list = await messenger.calendar.items.query(queryOpts);
    return list.map(normalizeItem);
  } catch (err) {
    if (isNotFoundError(err)) return [];
    throw err;
  }
}

export async function getItem(calendarId, id) {
  if (!calendarId || !id) return null;
  try {
    const node = await messenger.calendar.items.get(calendarId, id, {
      returnFormat: ICAL_FORMAT,
    });
    return node ? normalizeItem(node) : null;
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/**
 * Create a calendar item. Pre-specifies `id` so the changelog freeze
 * key matches the announced `onCreated` event.
 */
export async function createItem(calendarId, { id, type, ical }) {
  if (!calendarId) throw new Error("createItem requires a calendarId");
  if (!id) throw new Error("createItem requires an id");
  if (!type) throw new Error("createItem requires a type");
  if (!ical) throw new Error("createItem requires an iCal string");
  const created = await messenger.calendar.items.create(calendarId, {
    id,
    type,
    format: ICAL_FORMAT,
    item: ical,
    returnFormat: ICAL_FORMAT,
  });
  return normalizeItem(created);
}

export async function updateItem(calendarId, id, { ical }) {
  if (!calendarId) throw new Error("updateItem requires a calendarId");
  if (!id) throw new Error("updateItem requires an id");
  if (!ical) throw new Error("updateItem requires an iCal string");
  await messenger.calendar.items.update(calendarId, id, {
    format: ICAL_FORMAT,
    item: ical,
    returnFormat: ICAL_FORMAT,
  });
}

export async function deleteItem(calendarId, id) {
  if (!calendarId || !id) return;
  try {
    await messenger.calendar.items.remove(calendarId, id);
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function normalizeItem(node) {
  if (!node) return node;
  return { id: node.id, type: node.type, item: node.item };
}

function isNotFoundError(err) {
  const msg = String(err?.message ?? err ?? "");
  return /no such|not found|invalid id|unknown calendar/i.test(msg);
}
