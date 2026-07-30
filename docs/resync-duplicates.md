# EAS item identity, and the duplicates still out there

**Repo: EAS-4-TbSync.** Item identity lives in the provider; the host only
stores the blob it is handed.

## How identity works

The server-id stamped inside each stored blob is the **authority** for which
local item a server item is. `custom.indexMap` is a **cache** in front of it.

`findExistingByServerId` (`modules/eas/sync-runner.mjs`) reads the indexMap
first and, on a miss, falls back to a lazily-built `serverId → itemId` map read
from the blob stamps, repopulating the indexMap on a hit. The map is built at
most once per pass and only when something misses, so a healthy incremental
sync never reads the store in bulk.

Both halves matter. The indexMap alone is not enough: a server-initiated RESYNC
(Sync Status 3) resets it to `[]` along with `synckey: "0"`, so every item then
arrives as an `<Add>` with nothing to match against. The blob stamps alone are
not enough either: a locally-deleted item leaves no blob to read, so the
indexMap is the only remaining record of that item's server id.

Anything that changes how items are matched has to keep both true.

## Open: existing duplicates are not cleaned up

Accounts that resynced before this design was in place still carry a duplicate
of every item in the affected folder. Nothing removes them. A cleanup needs a
matching heuristic and a destructive pass over the user's calendar and address
book, which was deliberately left out rather than guessed at.

## Open: no runtime proof

None of this has been exercised against a live server. To prove it: sync a
populated folder, corrupt that folder's `custom.synckey` in TbSync's
`storage.local`, sync again, then confirm the item count is unchanged and
`custom.indexMap` has been rebuilt.
