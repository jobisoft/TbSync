/**
 * What Thunderbird itself said while we were doing something.
 *
 * ## Why anything needs this
 *
 * A failure inside a WebExtension experiment does not arrive with its
 * message. The reply to a rejected API call carries `message` and `fileName`
 * and nothing else, and the platform keeps the message only for an
 * `ExtensionError`, a plain object, or an error whose principal the extension
 * subsumes - so anything thrown in the chrome scope is `Cu.reportError`ed to
 * the Browser Console and handed on as the literal string "An unexpected
 * error occurred". The reason is not lost; it is written somewhere no bug
 * report has ever carried.
 *
 * The ordering is what makes this work at all: that report is written while
 * the rejection is still crossing the API boundary, so by the time anything
 * catches the failure the console line already exists.
 *
 * ## Mark first, read only on failure
 *
 * A caller remembers where the console stood before it started, and asks for
 * the rest only if what it started goes wrong. The window is then exactly the
 * thing that failed - not a guess at how far back to look, and not a clock.
 *
 * Marks are values, not shared state. Two operations running at once each
 * hold their own, so neither can consume the other's output; where their
 * windows overlap, both report the overlap, which is the truth - a line
 * emitted while both were running belongs to neither in particular.
 *
 * ## Beta builds only
 *
 * `tbsyncConsole` is declared in `beta/manifest.json` and nowhere else, so in
 * a release build the API is absent, `mark` answers null, and `since` has
 * nothing to read. Every function here is a no-op there.
 *
 * Silent throughout. These run on the path to work that matters - a sync, an
 * error being recorded - and a console read that goes wrong is not a reason
 * to fail either of them.
 */

/** The mark taken as the add-on started. Two of the host's own errors - an
 *  incompatible provider, and a legacy migration that threw - never travel
 *  through a provider call, so there is no narrower "before" to give them
 *  than the moment everything began. */
let bootMark = null;

/** Remember where the console stood at startup. Called once, as early as
 *  there is anything to call it from. */
export async function markBoot() {
  bootMark = await mark();
}

/** Everything said since the add-on started, for an error that belongs to no
 *  single call. */
export async function sinceBoot() {
  return since(bootMark);
}

/** Where the console stands now, to be handed to `since` later. Null when
 *  there is no capture, which `since` reads as "nothing to report". */
export async function mark() {
  const api = globalThis.browser?.tbsyncConsole;
  if (!api) return null;
  try {
    const { lastSeq } = await api.getPosition();
    return Number.isInteger(lastSeq) ? lastSeq : null;
  } catch {
    return null;
  }
}

/** Everything the console has said since `mark`, as text - or null when
 *  there is nothing to say. */
export async function since(from) {
  const api = globalThis.browser?.tbsyncConsole;
  if (api == null || from == null) return null;
  try {
    const { entries, dropped } = await api.getMessages({ sinceSeq: from });
    if (!entries?.length) return null;
    const lines = entries.map((e) => {
      const at = e.source ? ` (${e.source}${e.line ? `:${e.line}` : ""})` : "";
      return `[${e.level}] ${e.message}${at}`;
    });
    // The capture saying its buffer rolled past what we last saw. Worth
    // stating: a gap reads like quiet otherwise.
    if (dropped) lines.unshift("[...] earlier console messages were dropped");
    return `Browser Console:\n${lines.join("\n")}`;
  } catch {
    return null;
  }
}

/** `details` for an error, with the console slice folded in after whatever
 *  was already there. Returns the original when there is nothing to add, so
 *  a caller can assign the result unconditionally. */
export function withConsole(details, tail) {
  if (!tail) return details ?? null;
  return details ? `${details}\n\n${tail}` : tail;
}
