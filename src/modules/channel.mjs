// Which distribution channel this copy was built for.
//
// `build.js` packages the same tree twice: the ATN variant ships
// `src/manifest.json` as-is, the beta variant merges `manifest_beta.json`
// over it. That overlay's only addition under `gecko` is `update_url`, which
// Thunderbird needs to find self-hosted updates on GitHub - nothing else in
// the tree sets it, and ATN forbids it. So its presence is the channel
// marker, and it needs no separate flag to go stale.

export function isBetaBuild() {
  const { gecko } = browser.runtime.getManifest().browser_specific_settings ?? {};
  return !!gecko?.update_url;
}
