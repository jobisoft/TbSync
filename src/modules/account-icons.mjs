/**
 * Pure URL-composition helpers for account / provider icons. Used by
 * both the manager UI ([manager.mjs](TbSync/manager/manager.mjs)) and
 * the host-side toolbar action menu
 * ([action-menu.mjs](TbSync/modules/action-menu.mjs)).
 *
 * No I/O — callers pass a snapshot of `providers` (the result of
 * `providers.list()` or the manager's `state.providers`) and an
 * `account` record. Inactive / uninstalled providers always resolve
 * to the bundled default.
 */

const FALLBACK = "icons/provider16.png";

function fallbackUrl() {
  return browser.runtime.getURL(FALLBACK);
}

/** Derive the `moz-extension://UUID/` prefix from any of the provider's
 *  announced absolute icon URLs. Returns null if no usable URL exists. */
export function providerUrlPrefix(provider) {
  for (const url of Object.values(provider?.icons ?? {})) {
    try {
      return `${new URL(url).origin}/`;
    } catch {}
  }
  return null;
}

export function providerIconUrl(providerId, providers) {
  const hit = providers.find((p) => p.providerId === providerId);
  if (!hit || hit.state !== "active") return fallbackUrl();
  return hit.icons?.["16"] ?? hit.icons?.["32"] ?? fallbackUrl();
}

/** Icon URL for an account row. Resolves the per-account icon override
 *  (`account.icon`, a size-keyed map of relative paths) against the
 *  provider's announced URL prefix; falls through to `providerIconUrl`
 *  when there is no override or the prefix can't be derived. Inactive /
 *  uninstalled providers always render the bundled default. */
export function accountIconUrl(account, providers) {
  const provider = providers.find((p) => p.providerId === account.provider);
  if (!provider || provider.state !== "active") return fallbackUrl();
  const override = account?.icon;
  if (override && typeof override === "object") {
    const rel = override["16"] ?? override["32"] ?? Object.values(override)[0];
    const prefix = providerUrlPrefix(provider);
    if (prefix && rel) {
      try {
        return new URL(rel, prefix).href;
      } catch {}
    }
  }
  return provider.icons?.["16"] ?? provider.icons?.["32"] ?? fallbackUrl();
}
