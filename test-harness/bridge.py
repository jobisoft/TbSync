"""Loopback HTTP client for the TbSync Bridge.

The bridge is a beta-only automation surface: TbSync spawns a native helper
that listens on a loopback port and forwards `cmd`/`args` to the manager's
internal RPC table. Everything the suite does to Thunderbird goes through
here.

PORT and TOKEN are fixed by the helper, not negotiated. The source of truth
is `beta/native-messaging-app/tbsync_bridge_host.py`; if a future helper
changes them, change them here to match - they are duplicated rather than
discovered because the helper is installed outside any repo (Thunderbird
launches it by path) and there is nothing to read them from at test time.

Stdlib only, deliberately: no add-on in the family has a dependency and the
suite should not be the thing that introduces one.

Lives here because the bridge does. Providers vendor this file into
`test/vendor/`; see test-harness/README.md.
"""

import json
import urllib.error
import urllib.request

PORT = 47654
TOKEN = "tbsync"
URL = f"http://127.0.0.1:{PORT}/rpc"


class LoggedError(AssertionError):
    """The add-on logged an error while the suite was working.

    Raised from `rpc` itself, so it interrupts whatever the test was in the
    middle of rather than waiting for an assertion to notice. Nothing after
    an error means anything: the local store is unchanged, and "the item is
    still there" reads as a pass.
    """


class BridgeDown(Exception):
    """The port is not answering - the bridge is off, or Thunderbird is not
    running. Distinct from an RPC that answered with an error, which is a
    normal result and comes back in the reply."""


# Where the suite has read the event log up to. `None` until `arm()`, so
# discovery before a run starts cannot be blamed for what an earlier one
# left behind. The log is never cleared - a watermark scopes reading without
# throwing away anything worth looking at afterwards.
_watermark = None
_auditing = False


def arm():
    """Start watching the log, from wherever it now stands."""
    global _watermark
    _watermark = _last_seq()


def _last_seq():
    return ((rpc("getEventLog", timeout=10).get("result")) or {}).get("lastSeq", 0)


def audit():
    """Raise if anything was logged as an error since the last look.

    Called after every verb, which is the point: an error can be logged by a
    background sync between two of ours, and a check that only spanned our
    own syncs missed exactly that and let the run carry on for two more
    sections with a folder already broken.

    The watermark advances even when it raises, so one error stops the run
    once instead of failing everything after it.
    """
    global _watermark, _auditing
    if _watermark is None or _auditing:
        return
    _auditing = True
    try:
        reply = rpc("getEventLog", sinceSeq=_watermark, timeout=10)
        result = reply.get("result") or {}
        entries = result.get("entries") or []
        _watermark = result.get("lastSeq", _watermark)
    finally:
        _auditing = False
    errors = []
    for e in entries:
        if e.get("level") != "error":
            continue
        who = e.get("accountId")
        where = f" (account {who})" if who else ""
        errors.append(f"{e.get('message')}{where}")
    if errors:
        raise LoggedError(
            "the add-on logged an error, so nothing below this point means "
            "anything:\n  " + "\n  ".join(errors)
        )


def rpc(cmd, timeout=180, **args):
    """Call one bridge verb.

    Returns the decoded reply: `{"ok": True, "result": ...}` or
    `{"ok": False, "error": ..., "errorCode": ...}`. A refusal is data, not an
    exception - scope errors and "not bound yet" are things tests assert on.
    Only an unreachable port raises.

    The event log is read after every call, so an error surfaces at the next
    thing the suite does rather than at the next thing that happens to check.
    """
    body = json.dumps(
        {"cmd": cmd, "args": args, "timeoutMs": timeout * 1000}
    ).encode()
    req = urllib.request.Request(
        URL,
        data=body,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout + 15) as f:
            reply = json.loads(f.read())
    except urllib.error.HTTPError as e:
        # The helper answers 4xx/5xx with a JSON body for a refused call.
        reply = json.loads(e.read())
    except urllib.error.URLError as e:
        raise BridgeDown(
            f"no answer on 127.0.0.1:{PORT} ({e.reason}). Is Thunderbird "
            f"running, and is the bridge switched on in TbSync's Bridge tab?"
        ) from e
    audit()
    return reply


def ok(cmd, **args):
    """`rpc`, but a refusal is a failure rather than something to inspect.

    For calls a test only makes to get to the interesting part - selecting a
    folder, syncing - where carrying on after a silent refusal would test
    nothing. That failure mode is not hypothetical: a helper that answered
    `{"ok": False}` once cost three false passes before it was noticed.
    """
    reply = rpc(cmd, **args)
    if not reply.get("ok"):
        raise AssertionError(
            f"{cmd} refused: {reply.get('error') or reply.get('errorCode')}"
        )
    return reply.get("result")


def is_up():
    """True when the bridge answers at all. Used by preflight to give one
    clear message instead of a stack trace per test."""
    try:
        rpc("getState", timeout=10)
        return True
    except BridgeDown:
        return False
