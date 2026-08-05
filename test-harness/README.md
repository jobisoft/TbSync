# Shared bridge test harness

The two files every provider's bridge suite runs on, kept here because the
bridge itself is TbSync's:

- `bridge.py` — the loopback client for the bridge, plus the event-log audit
  that runs after every call.
- `harness.py` — the test registry, version gating, and the run/report loop.

Neither knows anything about a provider. What a section needs, how a resource
is bound and what a probe looks like belong in the provider's own
`test/session.py` and `test/probes.py`.

## Vendoring

Providers copy both files into `test/vendor/`, verbatim:

    cp test-harness/bridge.py  ../EAS-4-TbSync/test/vendor/bridge.py
    cp test-harness/harness.py ../EAS-4-TbSync/test/vendor/harness.py
    cp test-harness/bridge.py  ../google-4-tbsync/test/vendor/bridge.py
    cp test-harness/harness.py ../google-4-tbsync/test/vendor/harness.py

Change them here, then re-vendor. They were duplicated per repo before, and
the copies drifted the first time one of them gained a feature: `harness.py`
was patched in both and `bridge.py` in one, so google's suite called an audit
API that only EAS had.

To confirm nothing has drifted:

    diff -q test-harness/bridge.py ../EAS-4-TbSync/test/vendor/bridge.py

## Running

TbSync has no suite of its own yet; these files are exercised by the
providers'. Each has `npm test`, which needs Thunderbird running with the
bridge switched on and granted to an account that suite can test.
