"""Loopback HTTP client for the TbSync Bridge.

Start here:

    rpc("help")                     # every verb, its scope, its arguments
    rpc("help", verb="items.create")  # one of them
    rpc("status")                   # what the bridge is pointed at now

`help` is generated from the command table itself, so it cannot be out of
date. BRIDGE.md, beside this file, explains the model behind it: the reply
envelope, the target and why calls get refused, unrestricted mode.

The bridge is a beta-only automation surface: TbSync spawns a native helper
that listens on a loopback port and forwards `cmd`/`args` to the manager's
internal RPC table. Everything the suite does to Thunderbird goes through
here. Every call answers `{ok, result}` - the payload is under `result`.

PORT and TOKEN are fixed by the helper, not negotiated. The source of truth
is `beta/native-messaging-app/tbsync_bridge_host.py`; if a future helper
changes them, change them here to match - they are duplicated rather than
discovered because the helper is installed outside any repo (Thunderbird
launches it by path) and there is nothing to read them from at test time.

Stdlib only, deliberately: no add-on in the family has a dependency and the
suite should not be the thing that introduces one.

Lives here because the bridge does. Providers vendor this file into
`test/vendor/`; see TbSync's common/README.md.
"""

import json
import os
import time
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


# The helper clamps every call to its own ceiling, so this is the longest a
# verb can be given. Syncing is the one verb whose length is set by a server
# rather than by us: the protocol deliberately exempts SYNC_ACCOUNT from the
# host-to-provider timeout for that reason, and a flat 180s here contradicted
# it - the helper would stop waiting while the sync carried on inside
# Thunderbird, so a slow-but-healthy sync surfaced as a failure. What bounds
# a run is the runner's own per-section limit, which can say "too long for a
# section"; a per-call number cannot.
MAX_TIMEOUT_S = 600
LONG_CMDS = {"syncAccount": MAX_TIMEOUT_S}


def rpc(cmd, timeout=None, **args):
    """Call one bridge verb.

    Returns the decoded reply: `{"ok": True, "result": ...}` or
    `{"ok": False, "error": ..., "errorCode": ...}`. A refusal is data, not an
    exception - scope errors and "not bound yet" are things tests assert on.
    Only an unreachable port raises.

    The event log is read after every call, so an error surfaces at the next
    thing the suite does rather than at the next thing that happens to check.
    """
    if timeout is None:
        timeout = LONG_CMDS.get(cmd, 180)
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


def _repo_root():
    """The add-on repo, found from this file rather than from the working
    directory: a provider vendors it to `<repo>/test/vendor/bridge.py`."""
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(os.path.dirname(here))


def restart_provider(account_id, xpi="dist/dev.xpi", wait=60):
    """Put the built provider in front of Thunderbird again, whichever way
    this profile allows, and wait for it to answer.

    A temporarily installed add-on reloads: it re-reads its source, so the
    build on disk is what comes back. An ordinary one cannot - a reload would
    restart the same code - and for it the only route is installing the xpi
    over itself.

    So the reload is tried first and the install is the fallback, keyed on
    the refusal itself rather than on a guess about how this profile was set
    up. That also keeps the temporary case on the cheaper path, and honours
    the installer's own rule: it refuses a temporary add-on outright, because
    installing over one would turn it into a normal install and take its
    reload away.

    A relative `xpi` is resolved against the repo root - this file's own
    location says where that is, since a provider vendors it to
    `<repo>/test/vendor/`. Not against the working directory, which is
    `<repo>/test` when the suite runs and would send it looking in
    `test/dist/`. Every add-on in the family builds `dist/dev.xpi`.

    Returns "reload" or "install" so a caller can say which happened.
    """
    reply = rpc("reloadProvider", accountId=account_id)
    how = "reload"
    if not reply.get("ok"):
        if reply.get("errorCode") != "E:NOT_TEMPORARY":
            raise AssertionError(
                f"reloadProvider refused: "
                f"{reply.get('error') or reply.get('errorCode')}"
            )
        how = "install"
        path = xpi if os.path.isabs(xpi) else os.path.join(_repo_root(), xpi)
        if not os.path.isfile(path):
            raise AssertionError(
                f"this add-on is installed normally, so it can only be "
                f"restarted by installing it - but there is no build at "
                f"{path}. Run `npm run build` first."
            )
        # Not `ok`: the install takes the add-on down with it, so a lost
        # reply is the ordinary outcome rather than a failure. What follows
        # is the same wait either way.
        try:
            rpc("installAddon", path=path)
        except BridgeDown:
            pass

    deadline = time.time() + wait
    while time.time() < deadline:
        time.sleep(3)
        if is_up():
            # Answering is not the same as ready: the provider reconnects to
            # the host a moment after the bridge does.
            time.sleep(3)
            return how
    raise AssertionError(
        f"the provider did not come back within {wait}s after a {how}"
    )
