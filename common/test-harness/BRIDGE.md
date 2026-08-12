# The TbSync Bridge

Drive TbSync from a script instead of clicking through the UI: import a
fixture, sync, read the wire log back, assert — without a
rebuild-install-paste cycle per step.

```
your script --HTTP--> native helper --native messaging--> TbSync
```

**There is no list of verbs in this file, on purpose.** Ask the bridge:

```python
from vendor import bridge
bridge.rpc("help")              # every verb, its scope and its arguments
bridge.rpc("help", verb="items.create")
bridge.rpc("status")            # what the bridge is currently pointed at
```

`help` is generated from the same table the dispatcher uses, so it cannot be
out of date. Anything written down here by hand could be, which is why this
file sticks to the parts that don't change.

## The reply envelope

Every call answers `{ok, result}` or `{ok: false, error, errorCode}`. The
payload is under `result` — `bridge.rpc("getState")["result"]`, not the
return value itself. `bridge.rpc` raises `BridgeDown` when the port is not
answering at all, which is a different thing from a call that was refused.

## The target, and why calls get refused

The bridge is not a general remote control. It holds **one grant**: one
account, and one resource per kind (contacts, events, tasks), chosen by a
human in TbSync's Bridge tab.

Every verb that changes something, or that reads a *resource's data* rather
than TbSync's own configuration, is held to that grant and refused
otherwise — including when nothing has been chosen at all, so an
unconfigured bridge answers "no" rather than "anything". Verbs that only
describe configuration, such as `getState` and `getFolders`, are unscoped:
they are how a caller discovers what the target could be.

So a refusal usually means the grant, not a bug. `status` answers it in one
call: which account, which resources, and whether each still exists, is
still selected, and is still bound to a local calendar or book. A stored
grant goes stale on its own — a rebuilt profile mints new account ids, and
a folder can be deselected between runs.

## Unrestricted mode

`setTarget` lets a script move the grant itself, which would make the whole
scope system decorative if it were always available. It is therefore behind
a toggle in the Bridge tab, alongside the other verbs that can reach into a
provider's storage. `status` reports whether it is on.

## Two habits worth having

**Snapshot before you destroy.** `storage.clear` returns what it removed and
`storage.restore` puts it back, but only if you kept it — write the snapshot
to a file, not to a variable, and restore in a `finally`.

**Don't edit an item around a reload.** In the seconds after a provider
restarts, its calendar is a placeholder and no listener of ours exists yet,
so an edit made then reaches no queue at all. That window belongs to
Thunderbird's add-on lifecycle and cannot be closed from here.

## Where the pieces live

- `test/vendor/bridge.py` — the client, vendored; this file sits beside it.
- `test/vendor/harness.py` — the test decorator and runner.
- TbSync's `beta/modules/bridge.mjs` — the command table and the dispatcher.
  Beta builds only: the release xpi does not contain the file, and the port
  stays closed until someone switches the bridge on.
- The native helper is installed outside any repo, because Thunderbird
  launches it by path. `status` reports the helper version this build
  expects; if the tab says they disagree, reinstall the helper.
