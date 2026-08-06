# Vendored Files

This file lists files that were not created by this project and are maintained upstream elsewhere.

---

## calendar Experiments API

- **Files** : `/experiments/calendar/*`
- **Source** : https://download-directory.github.io/?url=https%3A%2F%2Fgithub.com%2Fthunderbird%2Fwebext-experiments%2Ftree%2Fb7f7cb3e76807903a785a03784d6e7df7b213f21%2Fcalendar%2Fexperiments%2Fcalendar
- **License** : MPL 2.0
- **Note** : lived in the beta overlay until the host took over target
  deletion; promoted to `src/` so the release build can delete provider
  calendars. The two `ext-calendar-timezones.js` files follow EAS-4-TbSync's
  copies, which carry the Thunderbird 154 timezone-service fix (Bug 2022873).
  The host does not declare the `calendar_provider` manifest key, so hosting
  the provider namespace registers nothing.

---

## i18n.mjs

- **File** : `/vendor/i18n/i18n.mjs`
- **Source** : https://raw.githubusercontent.com/thunderbird/webext-support/6bbbf8ac2105d04c1b59083e8bd52e0046448ec7/modules/i18n/i18n.mjs
- **License** : MIT
