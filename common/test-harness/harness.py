"""Test registry, version gating, and the run/report loop.

Deliberately small: a decorator that records tests in declaration order, a
selector, and a loop that prints one line per test. No dependency, no
discovery magic beyond importing `test_*.py`.

Ids are the numbers from the test plan (`2.1`, `3.11`), kept because they are
shared vocabulary - the code cites them, and so do we when talking about a
failure. `npm test -- 3` runs a section, `npm test -- 3.4` one step.

Lives in TbSync because every provider's suite runs the same loop; providers
vendor this file into `test/vendor/`. Nothing here knows about a provider -
what a section needs, and how a resource is bound, belongs in the provider's
own `session.py`.
"""

import os
import time
import traceback

import bridge

# Breathing room between tests. Every test here talks to a real server over a
# real account, and Exchange starts answering 503 when a suite runs flat out -
# which looks exactly like a product failure until you read the transport
# error. Tunable for a local run where throttling is not a concern:
#   TBSYNC_TEST_PAUSE=0 npm test
PAUSE_S = float(os.environ.get("TBSYNC_TEST_PAUSE", "5"))

# [{id, section, description, versions, fn}] in declaration order.
REGISTRY = []


class Skip(Exception):
    """Raised by a test that cannot run here, carrying the reason. A skip is
    reported with its reason and never silently dropped: "0 failed" has to
    mean the same thing every run."""


def test(test_id, description, versions=None):
    """Register one test.

    `versions` gates by provider version family - EAS uses ("16",) or
    ("14", "16"); None means every version. The families are matched as
    prefixes of the normalised version (see session.version_family), so "16"
    covers 16.0 and 16.1.
    """

    def wrap(fn):
        REGISTRY.append(
            {
                "id": test_id,
                "section": test_id.split(".")[0],
                "description": description,
                "versions": versions,
                "fn": fn,
            }
        )
        return fn

    return wrap


def select(selectors):
    """Filter the registry by `["3"]` (section) or `["3.4"]` (exact id).

    An exact id wins over a section prefix, so `3.1` never also matches
    `3.11` - which plain string prefixing would get wrong.
    """
    if not selectors:
        return list(REGISTRY)
    picked = []
    for t in REGISTRY:
        for sel in selectors:
            if t["id"] == sel or t["section"] == sel:
                picked.append(t)
                break
    return picked


def applies(t, family):
    """Whether a test's version gate admits this account."""
    if not t["versions"]:
        return True
    return any(family.startswith(v) for v in t["versions"])


def run(tests, session, prepare=None, stop_on_error=True):
    """Run tests in order. Returns the exit code: 0 when nothing failed.

    Stops at the first failure by default. Once something has gone wrong the
    account is in an unknown state, and every later test is then reporting on
    that rather than on itself - a throttled sync produced thirteen cascading
    failures that all looked like product bugs, when only the first was real.
    A short truthful run beats a long misleading one.

    `prepare(section)` is called once before the first test of each section
    that will actually run - never for a section whose tests are all skipped,
    since preparing costs syncs. It is where a section states the account it
    needs rather than inheriting whatever the last one left behind.
    """
    passed = failed = skipped = 0
    started = time.time()
    failures = []
    first = True

    prepared = None
    for t in tests:
        # Only between tests, and only before ones that will actually do
        # something - a skipped test costs the server nothing.
        if not first and applies(t, session.family):
            time.sleep(PAUSE_S)
        first = False
        if applies(t, session.family) and t["section"] != prepared:
            prepared = t["section"]
            if prepare:
                try:
                    prepare(prepared)
                except Exception as e:
                    for i, line in enumerate(str(e).splitlines()):
                        head = f"  ERROR section {prepared} preflight: " if not i else "       "
                        print(f"{head}{line}")
                    failed += 1
                    failures.append(f"{prepared}.preflight")
                    if stop_on_error:
                        break
                    continue
        if not applies(t, session.family):
            print(f"  SKIP {t['id']:<5} {t['description']}")
            print(
                f"       needs {' or '.join(t['versions'])}.x; "
                f"this account is {session.version}"
            )
            skipped += 1
            continue
        try:
            t["fn"](session)
            print(f"  PASS {t['id']:<5} {t['description']}")
            passed += 1
        except Skip as e:
            print(f"  SKIP {t['id']:<5} {t['description']}")
            print(f"       {e}")
            skipped += 1
        except AssertionError as e:
            print(f"  FAIL {t['id']:<5} {t['description']}")
            for line in str(e).splitlines():
                print(f"       {line}")
            failures.append(t["id"])
            failed += 1
        except Exception:
            print(f"  ERROR {t['id']:<4} {t['description']}")
            for line in traceback.format_exc().strip().splitlines()[-4:]:
                print(f"       {line}")
            failures.append(t["id"])
            failed += 1
        if failed and stop_on_error:
            remaining = len(tests) - tests.index(t) - 1
            if remaining:
                print(f"\n  stopping: {remaining} later test(s) not run - the "
                      f"account is no longer in a known state")
            break

    # Nothing follows the last test to catch what it logged. An entry can
    # land after the call that caused it has already answered, so the run
    # takes one last look before calling itself green.
    if not failed:
        time.sleep(2)
        try:
            bridge.audit()
        except bridge.LoggedError as e:
            print("  ERROR after the last test")
            for line in str(e).splitlines():
                print(f"       {line}")
            failed += 1
            failures.append("post-run")

    print()
    print(
        f"  {passed} passed, {failed} failed, {skipped} skipped "
        f"in {time.time() - started:.0f}s"
    )
    if failures:
        print(f"  failed: {', '.join(failures)}")
    return 1 if failed else 0


# ── assertions ──────────────────────────────────────────────────────────
#
# Thin, but they put the observed value in the message. A bare `assert x ==
# y` in a suite that talks to a live server tells you nothing about which of
# the two moved.


def eq(actual, expected, what):
    if actual != expected:
        raise AssertionError(f"{what}: expected {expected!r}, got {actual!r}")


def true(cond, what):
    if not cond:
        raise AssertionError(what)


def contains(haystack, needle, what):
    if needle not in haystack:
        raise AssertionError(f"{what}: {needle!r} not found in {haystack!r}")
