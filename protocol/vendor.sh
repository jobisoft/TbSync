#!/usr/bin/env bash
#
# Copy the protocol library into every consumer's `src/vendor/tbsync/` and
# verify each copy is byte-identical. Run it after ANY change in this
# directory - including changes made for TbSync itself, which vendors these
# files exactly like a provider does (see README.md for why).
#
#     protocol/vendor.sh            # copy, then verify
#     protocol/vendor.sh --check    # verify only; non-zero exit on drift
#
# Repos that aren't checked out beside TbSync are skipped with a note, so a
# partial checkout still gets its own copies refreshed.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TBSYNC_DIR="$(dirname "$SCRIPT_DIR")"
SIBLINGS_DIR="$(dirname "$TBSYNC_DIR")"

# Every file the consumers vendor. The unit tests (*.test.mjs) deliberately
# stay here: they test the one authoritative copy, and shipping them inside
# an xpi would be dead weight.
FILES=(
  protocol.mjs
  provider.mjs
  status.mjs
  changelog-core.mjs
  storage-queue.mjs
)

TARGETS=(
  "$TBSYNC_DIR/src/vendor/tbsync"
  "$SIBLINGS_DIR/EAS-4-TbSync/src/vendor/tbsync"
  "$SIBLINGS_DIR/google-4-tbsync/src/vendor/tbsync"
)

check_only=0
[ "${1:-}" = "--check" ] && check_only=1

status=0
for target in "${TARGETS[@]}"; do
  repo_root="$(dirname "$(dirname "$(dirname "$target")")")"
  if [ ! -d "$repo_root" ]; then
    echo "skip: $repo_root is not checked out"
    continue
  fi
  [ "$check_only" -eq 0 ] && mkdir -p "$target"
  for f in "${FILES[@]}"; do
    if [ "$check_only" -eq 0 ]; then
      cp "$SCRIPT_DIR/$f" "$target/$f"
    fi
    if diff -q "$SCRIPT_DIR/$f" "$target/$f" >/dev/null 2>&1; then
      echo "ok:   ${target#"$SIBLINGS_DIR"/}/$f"
    else
      echo "DRIFT: ${target#"$SIBLINGS_DIR"/}/$f"
      status=1
    fi
  done
done

if [ "$status" -ne 0 ]; then
  echo
  echo "One or more copies differ from protocol/. Re-run without --check to"
  echo "refresh them - and if the difference came from editing a vendored"
  echo "copy, move that change into protocol/ first or it will be lost."
fi
exit "$status"
