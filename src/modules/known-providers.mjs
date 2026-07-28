// Providers that always appear in the manager's "Available Providers"
// list - even when the corresponding add-on is not installed. Matches
// the spirit of legacy TbSync's `defaultProviders` map.
//
// `background.mjs::getState` overlays this catalogue onto the live
// ProviderMeta list so the manager has a discoverable path to install
// the official providers from addons.thunderbird.net.

// Keyed by the provider's shortName.
export const KNOWN_PROVIDERS = {
  google: {
    providerName: "Google's People API",
    installUrl: "https://addons.thunderbird.net/addon/google-4-tbsync/",
  },
  eas: {
    providerName: "Exchange ActiveSync",
    installUrl: "https://addons.thunderbird.net/addon/eas-4-tbsync/",
  },
};
