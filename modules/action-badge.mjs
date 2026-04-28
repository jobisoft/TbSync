/**
 * Drives the toolbar button badge from aggregated account state.
 *
 * Four states, evaluated in priority order (first match wins):
 *   1. syncing       - any account is currently being driven by the sync
 *                      coordinator (transient.syncingAccounts).
 *   2. error         - some enabled account has account.error set.
 *   3. local-changes - some enabled account has at least one selected folder
 *                      whose changelog carries _by_user entries.
 *   4. ok            - none of the above; the badge is cleared.
 *
 * Disabled accounts never drive the badge: their stale error or changelog is
 * not something the user is currently being asked to act on.
 */

import * as accounts from "./accounts.mjs";
import * as folders from "./folders.mjs";
import * as ui from "./messaging-ui.mjs";
import { syncingAccounts } from "./transient.mjs";

const BADGES = {
  syncing:         { text: "⟳", bg: "#1976d2", fg: "#ffffff", titleKey: "actionButton.title.syncing" },
  error:           { text: "!",      bg: "#d32f2f", fg: "#ffffff", titleKey: "actionButton.title.error" },
  "local-changes": { text: "✻", bg: "#fbc02d", fg: "#000000", titleKey: "actionButton.title.localChanges" },
  ok:              { text: "",       bg: null,      fg: null,      titleKey: "actionButton.title.ok" },
};

let running = false;
let pending = false;

async function computeState() {
  if (syncingAccounts.size > 0) return "syncing";

  const list = await accounts.list();
  const enabled = list.filter(a => a.enabled);
  if (enabled.some(a => a.error)) return "error";

  const needs = await folders.needsSyncMap();
  if (enabled.some(a => needs[a.accountId])) return "local-changes";

  return "ok";
}

async function applyBadge(state) {
  const spec = BADGES[state] ?? BADGES.ok;
  await browser.browserAction.setBadgeText({ text: spec.text });
  if (spec.bg) await browser.browserAction.setBadgeBackgroundColor({ color: spec.bg });
  if (spec.fg) await browser.browserAction.setBadgeTextColor({ color: spec.fg });
  await browser.browserAction.setTitle({ title: browser.i18n.getMessage(spec.titleKey) });
}

export async function refresh() {
  if (running) { pending = true; return; }
  running = true;
  try {
    do {
      pending = false;
      const state = await computeState();
      await applyBadge(state);
    } while (pending);
  } catch (err) {
    console.warn("[tbsync] action-badge refresh failed:", err);
  } finally {
    running = false;
  }
}

export function init() {
  ui.onInternalEvent(event => {
    if (event?.type === "accounts-changed" || event?.type === "folders-changed") {
      refresh();
    }
  });
}
