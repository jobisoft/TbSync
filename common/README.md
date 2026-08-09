# Shared code

Everything used by more than one add-on in the family. **This directory is
the single source of truth.** Nothing imports from it directly — every
consumer holds a copy, produced and verified by `vendor.sh`.

Two halves, because they are vendored to different places and only one of
them ships.

## `protocol/` → `src/vendor/tbsync/`, in every xpi

The contract between TbSync and its providers, and the code that implements
it. Copied into all three repos — **including TbSync itself**.

| file | what it is |
| --- | --- |
| `protocol.mjs` | wire vocabulary: version, port name, command and notification names, error codes, the row-shape contract |
| `status.mjs` | the StatusData result shape sync RPCs return |
| `provider.mjs` | the provider SDK base class (host-side code never imports it) |
| `changelog-core.mjs` | the changelog state machine, as pure `entries → entries` functions |
| `change-queue.mjs` | the session-keyed queue a provider records edits into, plus binding lookup and the sweep |
| `storage-queue.mjs` | `serialize()`, the read-modify-write mutex for extension storage |
| `address-book.mjs` | everything a provider does with a Thunderbird address book: the calls it makes, and the watching it does |
| `calendar.mjs` | the same for a calendar. Carries no provider identity — `createCalendar` is told the calling add-on's `type` and `url` |
| `changelog-core.test.mjs` | unit tests for the core — stay here, not vendored |

The rule for what belongs here: **vendor what the platform shapes, not what
a service shapes.** Address books and calendars are Thunderbird's, so their
wrappers are shared. OAuth is Microsoft's and Google's — two genuinely
different flows that happen to share a filename — so it is not.

A shared file may still need to know *which* add-on it is running in. That
is passed in, never baked in: `createCalendar` takes the `type` and `url`,
because a calendar's type is the id of the add-on supplying it.

`build.js` zips `src/` and nothing else, so anything outside it is invisible
to every xpi. A shared directory therefore cannot be imported directly by
anyone, the host included. Rather than give the host a privileged path that
providers cannot have, all three consume the same way — and the host's own
copy drifting is caught by the same check as a provider's.

**Purity rule for `changelog-core.mjs`:** nothing in it may touch storage,
the network, `browser.*`, or the clock — `now` is injected by the caller.
That is what lets the host run the state machine over `folder.changelog`
while a provider runs the identical machine over its own storage, and what
makes it testable with plain `node --test`.

## `test-harness/` → `test/vendor/`, and never ships

The two files every provider's bridge suite runs on, kept here because the
bridge itself is TbSync's.

| file | what it is |
| --- | --- |
| `bridge.py` | the loopback client for the bridge, plus the event-log audit that runs after every call |
| `harness.py` | the test registry, version gating, and the run/report loop |

Neither knows anything about a provider. What a section needs, how a
resource is bound and what a probe looks like belong in the provider's own
`test/session.py` and `test/probes.py`.

TbSync takes no copy: it runs no bridge suite of its own, and the providers'
suites are what exercise these.

## Changing anything here

1. Edit the file **in this directory**. Never edit a vendored copy —
   `vendor.sh` overwrites it and the change is gone.
2. Run `./vendor.sh` (from anywhere; it resolves its own location), or
   `npm run vendor` from the TbSync root.
3. Run `npm test` in TbSync for the core's unit tests.
4. Commit each repo separately — the copies are part of each repo's tree.

To confirm nothing has drifted without writing anything:

    common/vendor.sh --check

A change to `protocol.mjs` that peers cannot tolerate also needs
`PROTOCOL_VERSION` bumped, with a note in its history block: the host
refuses an announce whose version is not exactly its own, so a stale
provider fails loudly at connect instead of misbehaving quietly.
