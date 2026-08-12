// Providers that always appear in the manager's "Available Providers"
// list - even when the corresponding add-on is not installed. Matches
// the spirit of legacy TbSync's `defaultProviders` map.
//
// `background.mjs::getState` overlays this catalogue onto the live
// ProviderMeta list so the manager has a discoverable path to install
// the official providers.

import { isBetaBuild } from "./channel.mjs";

/** What a row in this catalogue offers, stated rather than inferred.
 *
 *   "install"     an add-on that exists and can be installed. Two urls,
 *                 because the release and beta channels are separate
 *                 add-ons - see `installUrlFor`.
 *   "fundraiser"  work that does not exist yet, and a campaign to fund it.
 *                 One url, and no install: the row is there to say the
 *                 provider is planned and to offer a way to support it.
 *
 * The distinction used to be read off `state` plus the presence of an
 * install url, which worked while every entry was installable. A row that
 * can never be installed needs to say so itself, or it inherits an
 * affordance that promises something impossible. */
export const KNOWN_PROVIDERS = {
  // `providerName` matches what each add-on announces, so the catalogue row
  // and the running provider are recognisably the same thing - and so a row
  // that has to name an add-on the user must go and replace names the one
  // they will actually find.
  google: {
    kind: "install",
    providerName: "Google Contacts",
    installUrl: "https://addons.thunderbird.net/addon/google-4-tbsync/",
    betaInstallUrl: "https://github.com/jobisoft/google-4-tbsync/releases",
  },
  eas: {
    kind: "install",
    providerName: "Exchange ActiveSync",
    installUrl: "https://addons.thunderbird.net/addon/eas-4-tbsync/",
    betaInstallUrl: "https://github.com/jobisoft/EAS-4-TbSync/releases",
  },
  // No add-on behind this one yet. The id is internal - it only has to not
  // collide with a real provider's - and if the add-on ever ships under it,
  // the live row wins and this entry stops being offered (see getState).
  "exchange-graph": {
    kind: "fundraiser",
    providerName: "Exchange Graph API",
    // One url for both channels. `installUrlFor`'s split exists to stop a
    // beta host pairing with a release provider; a campaign has no build
    // to be skewed against.
    url: "https://gofund.me/ff4f56354",
    // Paths inside *this* add-on, size-keyed like the icons a running
    // provider announces - so they flow into the row's `icons` with no
    // translation. A provider normally supplies its own, which is why the
    // other entries have none; there is no add-on here to supply any.
    icons: {
      16: "icons/exchange-graph_16.png",
      32: "icons/exchange-graph_32.png",
    },
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

/** Where a catalogue row's click should go, whatever kind it is. */
export function linkFor(known) {
  return known.kind === "fundraiser" ? known.url : installUrlFor(known);
}
