# The protocol library

The contract between TbSync and its providers, and the shared code that
implements it. **This directory is the single source of truth.** Every
consumer - the providers _and TbSync itself_ - holds a vendored copy under
`src/vendor/tbsync/`.

| file                      | what it is                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `protocol.mjs`            | wire vocabulary: version, port name, command and notification names, error codes, the row-shape contract |
| `status.mjs`              | the StatusData result shape sync RPCs return                                                             |
| `provider.mjs`            | the provider SDK base class (host-side code never imports it)                                            |
| `changelog-core.mjs`      | the changelog state machine, as pure `entries → entries` functions                                       |
| `storage-queue.mjs`       | `serialize()`, the read-modify-write mutex for extension storage                                         |
| `changelog-core.test.mjs` | unit tests for the core - stay here, not vendored                                                        |

## Why TbSync vendors its own library

`build.js` zips `src/` and nothing else, so anything outside `src/` is
invisible to every xpi. A shared directory therefore cannot be imported
directly by anyone - the host included. Rather than give the host a
privileged path into `protocol/` that providers can't have, all three repos
consume the same way: copies under `src/vendor/tbsync/`, produced by
`vendor.sh`. One rule, no special case, and the host's own copy drifting is
caught by the same check as a provider's.

## Changing something here

1. Edit the file **in this directory**. Never edit a `src/vendor/tbsync/`
   copy - `vendor.sh` overwrites it and the change is gone.
2. Run `./vendor.sh` (from anywhere; it resolves its own location).
3. Run `npm test` in TbSync for the core's unit tests.
4. Commit each repo separately - the copies are part of each repo's tree.

To confirm nothing has drifted without writing anything:

    protocol/vendor.sh --check

A change to `protocol.mjs` that peers cannot tolerate also needs
`PROTOCOL_VERSION` bumped, with a note in its history block: the host
refuses an announce whose version is not exactly its own, so a stale
provider fails loudly at connect instead of misbehaving quietly.

## Purity rule for `changelog-core.mjs`

Nothing in it may touch storage, the network, `browser.*`, or the clock -
`now` is injected by the caller. That is what lets the host run the state
machine over `folder.changelog` while a provider runs the identical
machine over its own storage, and have the two stay in step. It is also
what makes the file testable with plain `node --test`, with no browser
environment to fake.
