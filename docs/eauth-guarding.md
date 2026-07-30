# Anything that reaches the server needs its own E:AUTH guard

**Repo: every provider (EAS-4-TbSync, google-4-tbsync).** The host cannot add
these guards for you.

## The rule

When the host stamps `error: "E:AUTH"` on an account, the server has rejected
its credentials. **Every provider code path that reaches the network must
decline to run** until that error is cleared — not just the sync path.

Presenting rejected credentials over and over is how a server decides to lock
an account out. That is the failure this whole area exists to prevent, and one
unguarded entry point is enough to cause it.

## Why the host cannot do it for you

An `E:AUTH` account stays **enabled**. It keeps its folders, sync keys and
local address books and calendars, and is only held back from syncing — see
`sync-coordinator.mjs::flagAccountForReauth`.

What the host guards is the sync path, at one choke point:

```js
// sync-coordinator.mjs::syncAccount
if (!acc || !acc.enabled) return;
if (acc.error === ERR.AUTH) return;
```

That covers all five callers of `syncAccount` — autosync, the manager's sync
button, the toolbar menu, `syncAllAccounts`, and the post-authentication sync.
It covers **nothing else**. A provider entry point the host does not invoke is
invisible to it, and `enabled` is not a proxy for "safe to talk to the server".

## The one live example

`onSearchRequest` in EAS's `gal.mjs` backs the per-account Global Address List
address book. It fires on **every keystroke** in a compose window, entirely
outside the sync path, and issues an authenticated EAS `Search`:

```js
if (fresh.error === ERR.AUTH) {
  return { results: [], isCompleteResult: true };
}
```

Two things about that guard are deliberate.

**It sits inside the callback, not around the registration.** Deregistering the
listener would also stop the traffic, but nothing would put it back — an
authentication failure raises no account-enabled event to hang re-registration
on. Guarding inside means searches resume by themselves the moment the account
authenticates again.

**It is `=== ERR.AUTH`, not "any error".** An account with a folder-level
failure should still answer autocomplete.

This is the only such path in either provider — verified by sweeping every
`addListener` call. google has no live-lookup equivalent: its OAuth consent runs
through `launchWebAuthFlow` and everything else is host-invoked.

## What to check when adding an entry point

Ask: *can this reach the server without the host having called me?* If yes it
needs the guard. Concretely, in a provider that means anything registered on:

- `addressBooks.provider.*` — live directory lookups
- `calendar.provider.*` — live calendar operations
- any `runtime` message from your own UI pages that performs network work
- timers, alarms, or observers you install yourself

`account.error` is on the account row the host returns from `getAccount`, so it
is always available; there is no need for a new signal.

## Related

- `docs/cancel-sync.md` — the other place where "the host drives everything"
  turns out not to hold.
