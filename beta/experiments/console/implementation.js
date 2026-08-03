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
 * Everything is captured, unfiltered: the caller decides what matters, and a
 * filter here would be one more thing to be wrong about at the moment
 * something unexpected happens. Be aware that "everything" includes other
 * add-ons' output and whatever they put in it.
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
        // Microseconds since the epoch, unlike everything else here.
        at: Math.round((message.timeStamp ?? 0) / 1000) || Date.now(),
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
    };
  }
  entry.seq = nextSeq++;
  held.push(entry);
  if (held.length > MAX_MESSAGES) held.splice(0, held.length - MAX_MESSAGES);
}

/** Take the platform's existing backlog, once, so a caller sees what
 *  happened before it thought to ask - which is usually the interesting
 *  part. */
function seedFromBacklog() {
  for (const message of Services.console.getMessageArray() ?? []) {
    capture(message);
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
    held.length = 0;
  }
};
