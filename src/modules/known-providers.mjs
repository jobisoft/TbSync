// Providers that always appear in the manager's "Available Providers"
// list - even when the corresponding add-on is not installed. Matches
// the spirit of legacy TbSync's `defaultProviders` map.
//
// `background.mjs::getState` overlays this catalogue onto the live
// ProviderMeta list so the manager has a discoverable path to install
// the official providers.

import { isBetaBuild } from "./channel.mjs";

// Keyed by the provider's shortName. `installUrl` is the ATN listing,
// `betaInstallUrl` the GitHub releases page carrying the beta XPIs.
export const KNOWN_PROVIDERS = {
  google: {
    providerName: "Google's People API",
    installUrl: "https://addons.thunderbird.net/addon/google-4-tbsync/",
    betaInstallUrl: "https://github.com/jobisoft/google-4-tbsync/releases",
  },
  eas: {
    providerName: "Exchange ActiveSync",
    installUrl: "https://addons.thunderbird.net/addon/eas-4-tbsync/",
    betaInstallUrl: "https://github.com/jobisoft/EAS-4-TbSync/releases",
  },
};

// A beta manager must send people to the matching beta provider. The two
// channels are separate add-ons with separate update feeds, and the ATN
// listing only ever carries the release build - offering it here would pair
// a beta host with a release provider, which is exactly the version skew
// PROTOCOL_VERSION refuses to run.
export function installUrlFor(known) {
  return isBetaBuild() ? known.betaInstallUrl : known.installUrl;
}
