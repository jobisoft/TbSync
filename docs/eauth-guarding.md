# Anything that reaches the server needs its own E:AUTH guard

Written 29 Jul 2026, after an audit found the rule broken within days of the
behaviour that created it.

## The rule

When the host stamps `error: "E:AUTH"` on an account, the server has rejected
its credentials. **Every provider code path that reaches the network must
decline to run** until that error is cleared — not just the sync path.

Presenting rejected credentials over and over is how a server decides to lock
an account out. That is the failure this whole area exists to prevent, and one
unguarded entry point is enough to cause it.

## Why the host cannot do this for you

Before v5.0.12, an authentication failure disabled the account and tore down the
provider's resources, so provider code simply stopped being called. That is
gone: an `E:AUTH` account now stays **enabled**, keeps its folders, sync keys
and local address books and calendars, and is only held back from syncing. See
`sync-coordinator.mjs::flagAccountForReauth`.

What the host guards is the sync path, at one choke point:

```js
// sync-coordinator.mjs::syncAccount
if (!acc || !acc.enabled) return;
if (acc.error === ERR.AUTH) return;
```

That covers all five callers of `syncAccount` — autosync, the manager's sync
button, the toolbar menu, `syncAllAccounts`, and the post-authentication sync.
It covers **nothing else**. A provider entry point that the host does not
invoke is invisible to it, and `enabled` is no longer a proxy for "safe to talk
to the server".

## The one that got away

`onSearchRequest` in EAS's `gal.mjs` backs the per-account Global Address List
address book. It fires on **every keystroke** in a compose window, entirely
outside the sync path, and issues an authenticated EAS `Search`.

It checked that the account existed and that the server advertised `Search` —
never `account.error`. And because `enableGalForAllAccounts` skips only
accounts that are *disabled*, the listener was also re-registered on every host
connect. So a user whose password had expired fired authenticated requests with
rejected credentials every time they typed a recipient.

Fixed in EAS-4-TbSync `6b8ed07`:

```js
if (fresh.error === ERR.AUTH) {
  return { results: [], isCompleteResult: true };
}
```

Note where the guard sits. Deregistering the listener would also stop the
traffic, but nothing would put it back — an authentication failure no longer
raises an account-enabled event to hang re-registration on. Guarding inside the
callback means searches resume by themselves the moment the account
authenticates again.

Note also that it is `=== ERR.AUTH`, not "any error". An account with a
folder-level failure should still answer autocomplete.

## What to check when adding an entry point

Ask: *can this reach the server without the host having called me?* If yes it
needs the guard. Concretely, in a provider that means anything registered on:

- `addressBooks.provider.*` — live directory lookups
- `calendar.provider.*` — live calendar operations
- any `runtime` message from your own UI pages that performs network work
- timers, alarms, or observers you install yourself

`account.error` is on the account row the host returns from `getAccount`, so it
is always available; there is no need for a new signal.

As of v5.0.12 the EAS GAL listener is the only such path in either provider —
verified by sweeping every `addListener` call. google has no live-lookup
equivalent: its OAuth consent runs through `launchWebAuthFlow` and everything
else is host-invoked.

## Related

- `docs/cancel-sync.md` — the other place where "the host drives everything"
  turns out not to hold.
