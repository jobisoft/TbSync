/**
 * Drives the toolbar button badge from aggregated account state.
 *
 * Five states, evaluated in priority order (first match wins). The order is
 * the severity order the manager's account row uses, so a row and the badge
 * can never name different conditions for the same account:
 *   1. syncing       - any account is currently being driven by the sync
 *                      coordinator (transient.syncingAccounts).
 *   2. error         - some enabled account has account.error set, OR was set
 *                      up by an older version and so cannot sync until it is
 *                      reconnected, OR its provider isn't currently active
 *                      (uninstalled, disabled, not yet announced) - all three
 *                      render in the manager as a non-syncable account the
 *                      user has to act on, and the badge is the only place
 *                      that says so without opening the manager.
 *   3. warning       - some enabled account has a selected folder whose last
 *                      sync ended in a warning. Nothing is blocked and the
 *                      wording lives in the manager, but a folder that is
 *                      not carrying what it appears to be should not need
 *                      the manager to be open to be noticed.
 *   4. local-changes - some enabled account has at least one selected folder
 *                      reporting a non-zero `localChanges`.
 *   5. ok            - none of the above, and the badge is cleared.
 *
 * Disabled accounts never drive the badge: a stale error, warning or count
 * from before they were disconnected is not something the user is being
 * asked to act on.
 */

import * as accounts from "./accounts.mjs";
import * as folders from "./folders.mjs";
import * as providers from "./providers.mjs";
import * as ui from "./messaging-ui.mjs";
import { syncingAccounts } from "./transient.mjs";

const BADGES = {
  syncing: {
    text: "⟳",
    bg: "#1976d2",
    fg: "#ffffff",
    titleKey: "actionButton.title.syncing",
  },
  error: {
    text: "!",
    bg: "#d32f2f",
    fg: "#ffffff",
    titleKey: "actionButton.title.error",
  },
  // Black on yellow, where the other three are white on a colour: yellow is
  // too light to carry white text at badge size.
  warning: {
    text: "⚠",
    bg: "#f2c200",
    fg: "#000000",
    titleKey: "actionButton.title.warning",
  },
  "local-changes": {
    text: "✻",
    bg: "#2a7fd4",
    fg: "#ffffff",
    titleKey: "actionButton.title.localChanges",
  },
  ok: { text: "", bg: null, fg: null, titleKey: "actionButton.title.ok" },
};

let running = false;
let pending = false;

async function computeState() {
  if (syncingAccounts.size > 0) return "syncing";

  const list = await accounts.list();
  const enabled = list.filter((a) => a.enabled);
  const activeProviderIds = new Set(
    (await providers.list())
      .filter((p) => p.state === "active")
      .map((p) => p.providerId),
  );
  if (
    enabled.some(
      (a) => a.error || a.legacyImported || !activeProviderIds.has(a.provider),
    )
  ) {
    return "error";
  }

  const warnings = await folders.warningMap();
  if (enabled.some((a) => warnings[a.accountId])) return "warning";

  const needs = await folders.needsSyncMap();
  if (enabled.some((a) => needs[a.accountId])) return "local-changes";

  return "ok";
}

async function applyBadge(state) {
  const spec = BADGES[state] ?? BADGES.ok;
  await browser.browserAction.setBadgeText({ text: spec.text });
  if (spec.bg)
    await browser.browserAction.setBadgeBackgroundColor({ color: spec.bg });
  if (spec.fg)
    await browser.browserAction.setBadgeTextColor({ color: spec.fg });
  await browser.browserAction.setTitle({
    title: browser.i18n.getMessage(spec.titleKey),
  });
}

export async function refresh() {
  if (running) {
    pending = true;
    return;
  }
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
  ui.onInternalEvent((event) => {
    if (
      event?.type === "accounts-changed" ||
      event?.type === "folders-changed" ||
      event?.type === "providers-changed"
    ) {
      refresh();
    }
  });
}
