# Vendored Files

This file lists files that were not created by this project and are maintained upstream elsewhere.

---

## calendar Experiments API

- **Files** : `/experiments/calendar/**` (subset; `calendar.calendars`, `calendar.items`, `calendar.timezones`, `calendar.provider`)
- **Source** : https://github.com/thunderbird/webext-experiments/tree/main/calendar/experiments/calendar
- **Commit** : b7f7cb3e76807903a785a03784d6e7df7b213f21
- **License** : MPL 2.0
- **Note** : Mirror byte-for-byte with the EAS-4-TbSync provider copy at `eas-4-tbsync-new/experiments/calendar/`. Used here so the host's `changelog-watcher` can register `messenger.calendar.items.onCreated/onUpdated/onRemoved` listeners and queue user-initiated event/task edits into `folder.changelog`. We don't author a custom calendar type (no `calendar_provider` entry in the manifest's top-level), but the `calendar_provider` experiment is registered because its `onStartup` is what sets up the `resource://experiments-calendar-${uuid}/` substitution that the other parent scripts use to import `ext-calendar-utils.sys.mjs`. `calendarItemAction` / `calendarItemDetails` are intentionally not vendored.

---

## i18n.mjs

- **File** : `/vendor/i18n/i18n.mjs`
- **Source** : https://raw.githubusercontent.com/thunderbird/webext-support/6bbbf8ac2105d04c1b59083e8bd52e0046448ec7/modules/i18n/i18n.mjs
- **License** : MIT
