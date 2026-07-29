# CANCEL_SYNC is declared but dead

Research note, 29 Jul 2026. **No code changed.** Written up so it can be picked
up later.

## Where this came from

A cross-repo audit before the v5.0.12 release. One of the mechanical sweeps
cross-checked every `HOST_CMD` against two questions — is it dispatched by the
provider base class, and is it ever sent by the host? Everything paired up
except:

```
CANCEL_SYNC    dispatch=True   sentByHost=False
```

## How dead is it

Completely, end to end:

| layer | state |
|---|---|
| `protocol.mjs:53` | `CANCEL_SYNC: "cancelSync"` — declared |
| `provider.mjs:633` | `case HOST_CMD.CANCEL_SYNC: return this.onCancelSync(args)` — dispatched |
| `provider.mjs:306` | base-class hook exists |
| EAS `eas-provider.mjs:228` | `async onCancelSync(_args) { return null; }` |
| google `google-provider.mjs:132` | `async onCancelSync(_args) { return null; }` |
| **host** | **never sends it** |

So there is no sender, and both receivers are no-ops. There is currently no way
to cancel a running sync.

## The enabling fact, if we want to fix it

`#onPortMessage` calls `this.#dispatchHostCmd(msg)` **without `await`**
(`provider.mjs:596`). Incoming commands are dispatched concurrently, so a
`CANCEL_SYNC` sent while a `SYNC_FOLDER` is still outstanding reaches the
provider immediately rather than queueing behind it. The host side is equally
concurrent — `sendCmd` is a `postMessage` against a requestId map.

Cancellation was designed for. It was simply never wired up.

## Who should be able to cancel

**The user, from the manager — and nobody else.**

Everything that resembles an internal cancel is already handled: a provider
that dies mid-sync causes the outstanding RPC to reject, and `syncAccount`'s
`finally` clears `syncingAccounts` (`sync-coordinator.mjs:157`), so that path
self-heals. The provider is the callee and has nothing of its own to cancel;
another provider has no business cancelling anything.

## Why bother — it is an escape hatch, not a convenience

The argument is not that users want to stop syncs. It is that **a sync in
progress locks the account out of the UI entirely**:

```js
transientLocked = upgrading || syncing || busy
canRemove       = !transientLocked
// canSync / canConnect / canDisconnect are gated the same way
```

Combined with `SYNC_ACCOUNT` and `SYNC_FOLDER` sitting in `NO_TIMEOUT_CMDS`, a
provider that is alive but not returning leaves the account reading
"Synchronizing…" with every action greyed out — **including Remove**. The only
way out is restarting Thunderbird.

How likely is that? Less than it first appears: EAS wraps each request in its
own `AbortController` with a connection timeout, so no single fetch hangs
forever. The realistic cases are a genuinely long sync (large mailbox, many
folders, retries) or a provider hanging for a non-network reason. Rare — but
the UI offers no exit at all today.

## How — two separable layers

### Layer 1: host-side stop, no protocol involvement

- A `cancelledAccounts` set in `transient.mjs`.
- `syncAccount` checks it in the per-folder loop and in the `do/while` rerun
  loop, and breaks.
- A `cancelSync` manager RPC sets it; the manager's Sync button becomes Stop
  while the account is syncing.
- The existing `finally` already downgrades pending folders to `"aborted"`,
  which is the correct end state.

This stops at the next folder boundary rather than interrupting the folder in
flight — which is a feature: you only ever stop between whole folder syncs, so
the provider is never left mid-write. For a multi-folder account it recovers
most of the value, and it needs no provider changes at all.

### Layer 2: give CANCEL_SYNC a real implementation

- The host sends it so the provider can abort the request actually in flight.
- EAS would hold a per-account `AbortController` and abort it in the hook.
  `fetchWithTimeout` already threads a signal, so it would need to combine its
  own timeout signal with an external one (`AbortSignal.any`).
- This is the layer that rescues a genuinely hung provider, and the only one
  that justifies the protocol entry existing.

### Order

**Layer 1 first.** It is small, host-only, and delivers the escape hatch for
the common case. Layer 2 then replaces `return null` with something real, at
which point the protocol entry stops being a lie.

Doing Layer 2 alone would be worse than either: it would abort the current
request while the loop marched on to the next folder.

## A second dead command: DISCOVERY.PROBE

Found while checking whether updating the add-ons needs a Thunderbird restart.
`DISCOVERY.PROBE` has the same shape of problem, and appears in exactly two
places across all three repositories:

- `protocol.mjs:45` — `PROBE: "tbsync-probe"`, the constant
- `provider.mjs:562` — the provider's listener, whose comment reads *"Re-announce
  when the host probes us (after its own restart)"*

Nothing sends it. Searched for both the constant and the `"tbsync-probe"`
literal across the host, both providers and the vendored copies.

Unlike `CANCEL_SYNC` this one is **superseded rather than missing**, so there is
nothing to fix. The case it was designed for — the host restarting and losing
its in-memory provider registry — is covered by the host-availability flag:

- `init()` calls `#primeHostAvailability()`, which does a `management.getAll()`
  and writes `storage.session["host-available"]`.
- `storage.session` is cleared on restart, so that write is a *change* from
  absent to `true`, which fires the `storage.onChanged` listener installed by
  `#watchHostAvailability` and runs `#announceWithRetry()`.
- The same listener also covers the host being installed, updated, enabled or
  disabled mid-session, via `management.onInstalled` / `onEnabled` /
  `onDisabled` filtered on TbSync's id.

So providers re-announce after a restart without being asked. The options are
to delete `PROBE` and its listener, or to leave them as a documented no-op.
Either way it is cosmetic — worth noting only so the next person who greps for
"which commands are never sent" finds the answer already written down.

## Priority

Post-release. This is a longstanding gap rather than a regression, and it does
not block v5.0.12.
