#!/usr/bin/env bash
#
# Copy the shared code into every consumer and verify each copy is
# byte-identical. Run it after ANY change under common/ - including changes
# made for TbSync itself, which vendors these files exactly like a provider
# does (see README.md for why).
#
#     common/vendor.sh            # copy, then verify
#     common/vendor.sh --check    # verify only; non-zero exit on drift
#
# Repos that aren't checked out beside TbSync are skipped with a note, so a
# partial checkout still gets its own copies refreshed.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TBSYNC_DIR="$(dirname "$SCRIPT_DIR")"
SIBLINGS_DIR="$(dirname "$TBSYNC_DIR")"

# Two sets, because they are vendored to different places and only one of
# them ships. Each entry is "<source subdir>:<destination under the repo>",
# followed by the files.
#
# protocol/ ends up inside every xpi - build.js zips src/ and nothing else,
# which is why even the host consumes it through a copy under src/.
# test-harness/ is Python and never ships; it is the loopback client, the
# test registry the providers' bridge suites import, and the bridge's own
# guide - which rides along so a provider repo has it beside the client it
# imports, rather than in a sibling checkout the reader may not have.
PROTOCOL_FILES=(protocol.mjs provider.mjs status.mjs changelog-core.mjs
                storage-queue.mjs change-queue.mjs address-book.mjs)
# calendar.mjs goes only to the repos that use it. google-4-tbsync
# synchronises contacts and nothing else, so a copy there would ship in every
# xpi and have to be kept in step by hand for nothing. It is named as a stray
# if it turns up there.
CALENDAR_FILES=(calendar.mjs)
HARNESS_FILES=(bridge.py harness.py BRIDGE.md)

# The unit tests (*.test.mjs) deliberately stay here: they test the one
# authoritative copy, and shipping them inside an xpi would be dead weight.

PROTOCOL_REPOS=("$TBSYNC_DIR" "$SIBLINGS_DIR/EAS-4-TbSync" "$SIBLINGS_DIR/google-4-tbsync")
CALENDAR_REPOS=("$TBSYNC_DIR" "$SIBLINGS_DIR/EAS-4-TbSync")
NO_CALENDAR_REPOS=("$SIBLINGS_DIR/google-4-tbsync")
# TbSync runs no bridge suite of its own - the providers' suites are what
# exercise the harness - so it takes no copy.
HARNESS_REPOS=("$SIBLINGS_DIR/EAS-4-TbSync" "$SIBLINGS_DIR/google-4-tbsync")

check_only=0
[ "${1:-}" = "--check" ] && check_only=1
status=0

sync_set() {
  local subdir="$1" dest_rel="$2"
  shift 2
  local files=("$@")

  for repo in "${REPOS[@]}"; do
    if [ ! -d "$repo" ]; then
      echo "skip: ${repo#"$SIBLINGS_DIR"/} is not checked out"
      continue
    fi
    local target="$repo/$dest_rel"
    [ "$check_only" -eq 0 ] && mkdir -p "$target"
    for f in "${files[@]}"; do
      [ "$check_only" -eq 0 ] && cp "$SCRIPT_DIR/$subdir/$f" "$target/$f"
      if diff -q "$SCRIPT_DIR/$subdir/$f" "$target/$f" >/dev/null 2>&1; then
        echo "ok:    ${target#"$SIBLINGS_DIR"/}/$f"
      else
        echo "DRIFT: ${target#"$SIBLINGS_DIR"/}/$f"
        status=1
      fi
    done
  done
}

# A file sitting in a vendored directory that this script does not manage
# is the worst of both worlds: it looks vendored, so nobody edits it in
# common/, and --check passes while it silently drifts - or, as happened
# with contacts-observer.mjs, stays behind as dead weight in every xpi
# long after its logic moved elsewhere. Name them.
check_strays() {
  local subdir="$1"; shift
  local -a known=("$@")
  for repo in "${REPOS[@]}"; do
    # REPOS holds absolute paths, as sync_set uses them - prefixing
    # SIBLINGS_DIR again produced a path that never exists, so every repo was
    # skipped and no stray was ever reported.
    local dir="$repo/$subdir"
    [ -d "$dir" ] || continue
    for path in "$dir"/*; do
      [ -e "$path" ] || continue
      local base; base="$(basename "$path")"
      local found=0
      for f in "${known[@]}"; do
        [ "$base" = "$f" ] && found=1 && break
      done
      if [ "$found" -eq 0 ]; then
        echo "STRAY: ${path#"$SIBLINGS_DIR"/} is not vendored from common/"
        status=1
      fi
    done
  done
}

REPOS=("${PROTOCOL_REPOS[@]}")
sync_set protocol "src/vendor/tbsync" "${PROTOCOL_FILES[@]}"

REPOS=("${CALENDAR_REPOS[@]}")
sync_set protocol "src/vendor/tbsync" "${CALENDAR_FILES[@]}"
check_strays "src/vendor/tbsync" "${PROTOCOL_FILES[@]}" "${CALENDAR_FILES[@]}"

# Same directory, shorter list: a calendar file reappearing here is a stray
# rather than something --check would quietly accept.
REPOS=("${NO_CALENDAR_REPOS[@]}")
check_strays "src/vendor/tbsync" "${PROTOCOL_FILES[@]}"

REPOS=("${HARNESS_REPOS[@]}")
sync_set test-harness "test/vendor" "${HARNESS_FILES[@]}"
check_strays "test/vendor" "${HARNESS_FILES[@]}" README.md __pycache__

if [ "$status" -ne 0 ]; then
  echo
  echo "One or more copies differ from common/, or a file is sitting in a"
  echo "vendored directory without being vendored. Re-run without --check to"
  echo "refresh them - and if the difference came from editing a vendored"
  echo "copy, move that change into common/ first or it will be lost."
fi
exit "$status"
