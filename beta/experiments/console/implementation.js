/**
 * Read Thunderbird's console. Beta builds only.
 *
 * Platform errors never reach the add-on's event log - a TypeError thrown
 * inside CalRecurrenceInfo, an iCal parse complaint, a failed script load in
 * a content process. They go to the Browser Console, which no WebExtension
 * API can read, so debugging from outside Thunderbird meant asking a human to
 * copy them out. This exposes them to the bridge instead.
 *
 * It is an Experiment because `nsIConsoleService` is chrome-only; there is no
 * other route. It ships in `beta/`, so no ATN build contains it.
 *
 * **There are two pipes, and a listener on one is blind to the other.**
 * `nsIConsoleService` carries platform errors, `Cu.reportError` and uncaught
 * rejections. `console.*` calls - from chrome and from every add-on - go to
 * the ConsoleAPI instead. Both are read here, and `via` says which an entry
 * came from.
 *
 * **What neither pipe carries**, measured rather than assumed: a logger made
 * with `console.createInstance(...)` reaches no console at all, with or
 * without a prefix or a `maxLogLevel`. The event is only built when the
 * console has a global, and a chrome instance made without a window has
 * none. That is the idiom most of Thunderbird uses for its own diagnostics,
 * so its module logs are not visible from here - a prefixed instance routes
 * to MozLog under the prefix as the module name, and `logging.<prefix>` is
 * what reaches those. Worth knowing before adding a third listener in the
 * hope of catching them.
 *
 * Everything is captured, unfiltered: the caller decides what matters, and a
 * filter here would be one more thing to be wrong about at the moment
 * something unexpected happens. Be aware that "everything" includes other
 * add-ons' output and whatever they put in it, and that an event reaching
 * both pipes is held twice - `via` is what makes that legible.
 */

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs",
);

/** Ring buffer size. The platform's own backlog is a few hundred, so this
 *  holds roughly one Thunderbird session's worth of anything interesting. */
const MAX_MESSAGES = 1000;

const held = [];
let nextSeq = 0;
let listener = null;
let apiListener = null;

/** The ConsoleAPI's own store, which is both the backlog and the way to
 *  subscribe. A service rather than a module import - the same handle
 *  DevTools' web console takes. */
function consoleApiStorage() {
  return Cc["@mozilla.org/consoleAPI-storage;1"].getService(
    Ci.nsIConsoleAPIStorage,
  );
}

/** Take an entry into the ring buffer. Both pipes end here, so neither can
 *  forget the sequence number or the trim. */
function push(entry) {
  entry.seq = nextSeq++;
  held.push(entry);
  if (held.length > MAX_MESSAGES) held.splice(0, held.length - MAX_MESSAGES);
}

/** nsIScriptError.errorFlags, which is a bitmask rather than a level. */
function levelOf(scriptError) {
  const flags = scriptError.flags ?? 0;
  if (flags & Ci.nsIScriptError.infoFlag) return "info";
  if (flags & Ci.nsIScriptError.warningFlag) return "warning";
  return "error";
}

/** Flatten a console message into something JSON can carry. Two shapes
 *  arrive here: nsIScriptError, which knows where it came from, and a bare
 *  nsIConsoleMessage, which is just text. */
function capture(message) {
  let entry;
  try {
    if (message instanceof Ci.nsIScriptError) {
      entry = {
        level: levelOf(message),
        message: message.errorMessage,
        source: message.sourceName || null,
        line: message.lineNumber || null,
        column: message.columnNumber || null,
        category: message.category || null,
        // Milliseconds since the epoch: the IDL says this one is
        // "initialized as JS_now/1000 so that it can be compared to
        // Date.now", and the microsecond value is a separate attribute.
        at: message.timeStamp || Date.now(),
        via: "console-service",
      };
    } else {
      entry = {
        level: "log",
        message: message.message ?? String(message),
        source: null,
        line: null,
        column: null,
        category: null,
        at: Date.now(),
        via: "console-service",
      };
    }
  } catch (err) {
    // A message we cannot read is still worth knowing arrived.
    entry = {
      level: "log",
      message: `<unreadable console message: ${err}>`,
      source: null,
      line: null,
      column: null,
      category: null,
      at: Date.now(),
      via: "console-service",
    };
  }
  push(entry);
}

/** Take the platform's existing backlog, once, so a caller sees what
 *  happened before it thought to ask - which is usually the interesting
 *  part. */
function seedFromBacklog() {
  for (const message of Services.console.getMessageArray() ?? []) {
    capture(message);
  }
}

/** One logged value as text.
 *
 *  An Error is worth its stack, since that is the whole reason anyone is
 *  reading this. Anything else is tried as JSON and falls back to `String`,
 *  which is what catches the values JSON refuses - a cycle, a proxy, a
 *  BigInt. Never throws: this runs while something else is already going
 *  wrong. */
function textOf(value) {
  try {
    if (value instanceof Error) return value.stack || String(value);
    if (typeof value === "object" && value !== null) {
      return JSON.stringify(value) ?? String(value);
    }
    return String(value);
  } catch {
    return String(value);
  }
}

/** Flatten a ConsoleAPI event into the same entry shape the other pipe
 *  produces.
 *
 *  The prefix is folded into the text rather than kept as its own field:
 *  it names the logger that spoke ("calendar"), which is the most useful
 *  identifier on the line, and the consumer renders the message and the
 *  source and nothing else. */
function captureApiEvent(wrapped) {
  let entry;
  try {
    const event = wrapped?.wrappedJSObject ?? wrapped;
    const args = Array.isArray(event.arguments) ? event.arguments : [];
    const text = args.map(textOf).join(" ");
    entry = {
      // `console.warn` arrives as "warn"; the other pipe says "warning".
      // One spelling, so a report does not show two names for one level.
      level: event.level === "warn" ? "warning" : (event.level ?? "log"),
      message: event.prefix ? `${event.prefix}: ${text}` : text,
      source: event.filename || null,
      line: event.lineNumber || null,
      column: event.columnNumber || null,
      category: null,
      at: event.timeStamp || Date.now(),
      via: "console-api",
    };
  } catch (err) {
    entry = {
      level: "log",
      message: `<unreadable console-api event: ${err}>`,
      source: null,
      line: null,
      column: null,
      category: null,
      at: Date.now(),
      via: "console-api",
    };
  }
  push(entry);
}

/** The ConsoleAPI's backlog, the counterpart of `seedFromBacklog`. Called
 *  with no window id, `getEvents` hands back everything it holds. */
function seedFromApiBacklog() {
  try {
    for (const event of consoleApiStorage().getEvents() ?? []) {
      captureApiEvent(event);
    }
  } catch {
    // A backlog we cannot read is not a reason to give up the live feed.
  }
}

var tbsyncConsole = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    if (!listener) {
      seedFromBacklog();
      listener = {
        QueryInterface: ChromeUtils.generateQI(["nsIConsoleListener"]),
        observe: capture,
      };
      Services.console.registerListener(listener);
    }
    if (!apiListener) {
      seedFromApiBacklog();
      apiListener = captureApiEvent;
      // The principal has to be the system one, or the storage clones the
      // message out of our reach before we ever see it - the same handle
      // DevTools' own console listener takes.
      consoleApiStorage().addLogEventListener(
        apiListener,
        Cc["@mozilla.org/systemprincipal;1"].createInstance(Ci.nsIPrincipal),
      );
    }

    return {
      tbsyncConsole: {
        async getMessages(options) {
          const from = Number.isInteger(options?.sinceSeq)
            ? options.sinceSeq
            : -1;
          const entries = held.filter((e) => e.seq > from);
          return {
            entries,
            lastSeq: held.length ? held[held.length - 1].seq : from,
            // True when the buffer rolled past what the caller last saw, so
            // a gap is reported rather than looking like quiet.
            dropped: held.length > 0 && from >= 0 && held[0].seq > from + 1,
          };
        },

        /** Where the capture stands, without its contents.
         *
         *  A caller that wants "what happened while I was doing this" needs
         *  a number before it starts and the messages only if it fails.
         *  `getMessages` would hand back the whole buffer to answer that,
         *  every time, for a call that usually succeeds. */
        async getPosition() {
          return { lastSeq: held.length ? held[held.length - 1].seq : -1 };
        },

        async clear() {
          held.length = 0;
          return null;
        },
      },
    };
  }

  onShutdown() {
    if (listener) {
      Services.console.unregisterListener(listener);
      listener = null;
    }
    if (apiListener) {
      try {
        consoleApiStorage().removeLogEventListener(apiListener);
      } catch {
        // Shutting down is not the moment to care that it was already gone.
      }
      apiListener = null;
    }
    held.length = 0;
  }
};
