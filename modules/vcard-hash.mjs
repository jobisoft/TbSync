/**
 * Self-stamped change detection for vCards. The watcher writes
 * `X-TBSYNC-HASH:<hex>` onto every contact it observes; on every
 * subsequent `onUpdated` it strips that line, recomputes the hash, and
 * compares to the carried value. Match means TB only mutated bytes we
 * don't put on the card (usage stats, etc.) and the event is a ghost.
 *
 * Canonicalisation before hashing matters: TB may re-fold long lines or
 * normalise CRLF on round-trip. Without canonicalisation a re-read would
 * differ in whitespace alone and every ghost would look like an edit.
 */

const HASH_PROP = "X-TBSYNC-HASH";
const HASH_LINE_RE = new RegExp(`^${HASH_PROP}:[^\\r\\n]*(?:\\r?\\n|$)`, "im");
const HASH_VALUE_RE = new RegExp(`^${HASH_PROP}:([^\\r\\n]*)`, "im");

/** Remove the `X-TBSYNC-HASH:...` line from a vCard string, if any. */
export function stripHashLine(vcard) {
  if (typeof vcard !== "string" || !vcard) return vcard ?? "";
  return vcard.replace(HASH_LINE_RE, "");
}

/** Extract the hash carried on the card, or null if absent. */
export function extractHash(vcard) {
  if (typeof vcard !== "string" || !vcard) return null;
  const m = vcard.match(HASH_VALUE_RE);
  return m ? m[1].trim() : null;
}

/**
 * Canonical form for hashing: unfold RFC 6350 continuations, normalise
 * line endings to LF, drop trailing blank lines. Operates on the vCard
 * with the X-TBSYNC-HASH line already removed by the caller.
 */
function canonicalise(vcard) {
  return vcard
    .replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, "")
    .replace(/\r\n|\r/g, "\n")
    .replace(/\n+$/, "\n");
}

async function sha1Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Compute the canonical hash of a vCard ignoring any carried marker. */
export async function computeHash(vcard) {
  return sha1Hex(canonicalise(stripHashLine(vcard)));
}

/**
 * Return a new vCard string with `X-TBSYNC-HASH:<hash>` stamped just
 * before `END:VCARD`. Any prior hash line is removed first so callers
 * can re-stamp without accumulating duplicates. Preserves the input's
 * line-ending style (CRLF if the original used CRLF, LF otherwise).
 */
export function stamp(vcard, hash) {
  const stripped = stripHashLine(vcard);
  const eol = /\r\n/.test(stripped) ? "\r\n" : "\n";
  const line = `${HASH_PROP}:${hash}${eol}`;
  const endRe = /(^|\r?\n)(END:VCARD\r?\n?)/i;
  if (endRe.test(stripped)) {
    return stripped.replace(endRe, (_m, pre, end) => `${pre}${line}${end}`);
  }
  // No END:VCARD - shouldn't happen for a real card, but stay graceful.
  return stripped + line;
}

/**
 * Verify a vCard against its carried hash. Returns:
 *   { stamped: false, valid: false } - no X-TBSYNC-HASH line; treat as real change.
 *   { stamped: true,  valid: true  } - carried hash matches recompute (ghost).
 *   { stamped: true,  valid: false } - mismatch; treat as a real change.
 */
export async function verify(vcard) {
  const carried = extractHash(vcard);
  if (carried === null) return { stamped: false, valid: false };
  const recomputed = await computeHash(vcard);
  return { stamped: true, valid: carried === recomputed };
}
