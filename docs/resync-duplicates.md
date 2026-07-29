# TbSync resync issue

> Converted from `issues.odt` (27 Jul 2026). Content unchanged apart from
> formatting; see the status note at the end for what has happened since.

Agreed on the changelog — reimport it with everything else, no special
handling. The "already applied" concern is real but small, and it doesn't
justify a mechanism.

One thing that follows from the same reasoning and is worth deciding before we
call this closed: synckey and indexMap come back stale too, from
`folders68.json`, and the convergence story there has a hole.

A stale synckey gets rejected with Status 3, which triggers the RESYNC path —
and that resets `indexMap: []` along with `synckey: "0"`. But
`findExistingByServerId` (`sync-runner.mjs:1548-1554`) resolves only through
the indexMap:

```js
const entry = ctx.indexMap.find((e) => e.serverId === serverId);
if (!entry) return null;
```

So on the full re-pull that follows, every `applyAdd` misses, and each server
item is created fresh under a new `crypto.randomUUID()` — while the existing
local copies are still sitting in the address book or calendar, because those
are Thunderbird resources and nothing wiped them. That's a duplicate of every
item in the folder, which is a good deal worse than replaying a handful of
edits.

---

## Status: fixed

Fixed in EAS-4-TbSync `dc07202`, "Stop a server-initiated resync from
duplicating every item".

`findExistingByServerId` now falls back to a lazily-built `serverId → itemId`
map read from the server-id stamps already present in the stored blobs, and
repopulates the indexMap on a hit. The map is built at most once per pass and
only when something misses, so a healthy incremental sync never reads the store
in bulk.

The framing that came out of fixing it: the blob stamp is the **authority** for
item identity and the indexMap is a **cache** in front of it — which is what
the push side had always done. The indexMap is kept rather than removed,
because a locally-deleted item leaves no blob to read, so it is the only record
of that item's server id.

Verified against the real source with a harness; **not yet verified at runtime**
against a live server. Two things remain open: it stops *new* duplicates but
does not clean up duplicates a user already has, and the runtime proof is still
to do — sync a populated folder, corrupt that folder's `custom.synckey` in
TbSync's `storage.local`, sync again, and confirm the item count is unchanged
and `custom.indexMap` has been rebuilt.
