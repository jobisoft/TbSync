# Recurrence exceptions on EAS 16.x

**Repo: EAS-4-TbSync.** Nothing here is a TbSync defect — the host stores the
blob the provider hands it.

Two open defects, both in `src/modules/eas/calendar-codec.mjs`. Recorded here
rather than as issues because neither has a reporter yet.

## Where this lives

Inbound exceptions reach the codec in two shapes, both gated on the account's
`syncRecurrence` option (off by default, `syncrecurrence` read as `=== true`):

- **embedded** — an `<Exceptions>` block on the master item, parsed by
  `appendInboundExceptions`;
- **per-instance** — one `<Change>` per occurrence carrying `<InstanceId>`,
  handled by `applyInstanceChange` / `applyInstanceDelete`.

Both write the override's `RECURRENCE-ID` through `jsDateToIcalUtcTime`, so a
defect in that writer hits both.

If you are asked to verify anything in this area: **already-synced items need a
one-time calendar re-download** (uncheck → sync → re-check → sync) before a
codec change affects them, so a fix can look inert on existing data.

## Open 1: all-day exceptions cannot bind

**The most likely of the two to matter**, because it produces the same
user-visible symptom as #317 — an occurrence that will not move or disappear —
for an entire class of events.

`RECURRENCE-ID` and `EXDATE` are always written as DATE-TIME:

```js
function jsDateToIcalUtcTime(d) {
  const t = new ICAL.Time({ …, isDate: false });   // hardcoded
```

while an all-day master's `DTSTART` is written as a DATE (`writeDateProp`, the
`if (allDay)` branch). RFC 5545 §3.8.4.4 requires `RECURRENCE-ID` to have the
same value type as the master's `DTSTART`, so for an all-day recurring series
the override can never match the occurrence it is meant to replace, and the
`EXDATE` can never suppress it.

This is **not** specific to the identifier fix and predates it. It affects both
inbound exception paths equally, because `instanceUtcToIcalTime` — used by the
16.1 per-instance path — is a one-line wrapper around `jsDateToIcalUtcTime`.

v4 does not have this problem: `setItemRecurrence` sets `dateTime.isDate = true`
when `data.AllDayEvent == "1"`.

The fix is presumably to thread the master's all-day flag (already read at
`applicationDataToIcal` as `readPathFrom(adNode, ["AllDayEvent"]) === "1"`) into
both writers and build a date-only `ICAL.Time`. Care needed on the comparison
side too — `removeExdate` matches via `icalTimeToBasicUtc`, which would need to
agree on the same representation.

**Unverified.** Derived by reading the code; no reporter, no server trace.

**Reconcile with PR #324** before touching this. It is an open v5 PR against the
same file (+104/-28) reworking all-day handling — inbound reads the wall-clock
date in the resolved zone rather than the raw UTC date, outbound distinguishes
server families with a `fromBlob` flag. A different defect (all-day events
landing a day early or late), but it moves the ground under this one.

## Open 2: the "Canceled:" title prefix is never stripped

Cosmetic, and the second half of the same upstream PR.

Exchange prepends a localized `Canceled: ` to the Subject of a cancelled meeting
or occurrence. v5 computes `STATUS=CANCELLED` (from `BusyStatus` + `MeetingStatus`,
`ms & 0x4`) but never strips the word, so the item shows both the strike-through
*and* the redundant prefix — and because it is baked into the stored title it
lingers even after the occurrence is reactivated or moved.

Niel's v4 fix (`NielBuys/EAS-4-TbSync@36c2b916`) is a three-line strip in
`calendarsync.js`:

```js
if (tbStatus == "CANCELLED" && item.title) {
    item.title = item.title.replace(/^\s*cancell?ed:\s*/i, "");
}
```

Deliberately not ported, for two reasons worth deciding on before it is:

- **It is lossy.** The prefix is stripped from the stored title, so a subject a
  user genuinely started with "Cancelled:" would be silently rewritten.
- **It is English-only.** Exchange localizes the word to the *organizer's*
  mailbox language, not the Thunderbird UI language, so a regex over one locale
  fixes it for some users and not others. Niel notes the same limitation.

---

## Related, and deliberately separate

- **#334** — the outbound direction (local occurrence edits never reaching the
  server) runs through `appendInstanceChanges` and is untouched by any of this.
- **PR #324** — open, same file, reworks all-day date handling. See above.
- `docs/resync-duplicates.md` — how EAS matches a server item to a local one.
