# Vendored Files

This file lists files that were not created by this project and are maintained upstream elsewhere.

---

## calendar Experiments API

- **Files** : `/experiments/calendar/*`
- **Source** : https://github.com/thunderbird/webext-experiments, path
  `calendar/experiments/calendar`, from pull request #75
  (https://github.com/thunderbird/webext-experiments/pull/75, not merged yet),
  branch `compatibility-for-160-and-other-fixes` at commit
  `78b584e4250d294f1554f5b27e524a583763c57b` (26 commits on top of upstream
  `b7f7cb3e76807903a785a03784d6e7df7b213f21`). Once that pull request is
  merged, this is the merged upstream commit.
- **Updating** : never edit these copies. They are an exact 1:1 copy of the
  `webext-experiments` checkout beside the TbSync repository, written by
  `TbSync/common/vendor.sh` (`vendor.sh --check` verifies only). See
  `TbSync/common/README.md`.
- **License** : MPL 2.0
- **Note** : lived in the beta overlay until the host took over target
  deletion; promoted to `src/` so the release build can delete provider
  calendars. The host does not declare the `calendar_provider` manifest key, so hosting
  the provider namespace registers nothing.

---

## i18n.mjs

- **File** : `/vendor/i18n/i18n.mjs`
- **Source** : https://raw.githubusercontent.com/thunderbird/webext-support/6bbbf8ac2105d04c1b59083e8bd52e0046448ec7/modules/i18n/i18n.mjs
- **License** : MIT

---

## tbsync protocol library

- **Files** : `/vendor/tbsync/*`
- **Source** : `../common/protocol/` — this repository's own directory
- **Note** : not third-party, but vendored all the same. `build.js` zips `src/`
  and nothing else, so the host can only import the library through a copy
  inside `src/` — exactly as a provider does. Never edit these copies: change
  the file in `common/protocol/` and run `common/vendor.sh` (or `npm run vendor`),
  which refreshes every consumer and verifies each copy is byte-identical.
  See `common/README.md`.
