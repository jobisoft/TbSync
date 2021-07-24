/*
 * This file is provided by the addon-developer-support repository at
 * https://github.com/thundernest/addon-developer-support
 *
 * For usage descriptions, please check:
 * https://github.com/thundernest/addon-developer-support/tree/master/scripts/preferences/backgroundHandler
 *
 * Version: 1.1
 *  - fixed hardcoded dependenvy on the WL API
 *
 * Author: John Bieling (john@thunderbird.net)
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
 
 var localStorageHandler = {
  _defaults: {},

  init: async function (defaults) {
    this._defaults = defaults;
  },

  getAllDefaults: async function () {
    return this._defaults;
  },

  getAllUserPrefs: async function () {
    let preferences = {};
    for (let pref of Object.keys(this._defaults)) {
      const key = `pref.${name}`;
      let rv = (await messenger.storage.local.get(key))[key];
      if (rv != null) preferences[pref] = rv;
    }
    return preferences;
  },

  setPref: async function (name, value) {
    const key = `pref.${name}`;
    return messenger.storage.local.set({ [key]: value });
  },

  getPref: async function (name, fallback) {
    const key = `pref.${name}`;
    let rv = (await messenger.storage.local.get(key))[key];
    if (rv) return rv;

    if (this._defaults.hasOwnProperty(name)) {
      return this._defaults[name];
    }
    return fallback;
  },

  clearPref: async function (name) {
    const key = `pref.${name}`;
    return messenger.storage.local.remove(key);
  },

  setDefault: async function (name, value) {
    this._defaults[name] = value;
    // Also update defaults in all caches (if any).
    messenger.runtime
      .sendMessage({ command: "setDefault", name, value })
      .catch(() => {
        /* hide error if no listener defined */
      });
    if (messenger.WindowListener) {
      messenger.WindowListener.notifyExperiment({
        command: "setDefault",
        name,
        value,
      });
    }
  },

  enableListeners: async function () {
    if (messenger.WindowListener) {
      // Listener for notifications from Legacy scripts
      await messenger.WindowListener.onNotifyBackground.addListener(this.handler);
    }
    // Listener for messages from WebExtension scripts
    await messenger.runtime.onMessage.addListener(this.handler);
    // Add storage change listener.
    await messenger.storage.onChanged.addListener(this.storageChanged);
  },

  disableListeners: async function () {
    await messenger.storage.onChanged.removeListener(this.storageChanged);
    await messenger.WindowListener.onNotifyBackground.removeListener(this.handler);
    await messenger.runtime.onMessage.removeListener(this.handler);
  },

  // Listener for storage changes to inform pref caches of changes.
  storageChanged: function (changes, area) {
    if (area != "local") return;

    let changedItems = Object.keys(changes);
    for (let item of changedItems) {
      if (item.startsWith("pref.")) {
        let name = item.substr(5);
        let value = changes[item].newValue;
        let command = value == undefined ? "clearPref" : "setPref";
        messenger.runtime.sendMessage({ command, name, value }).catch(() => {
          /* hide error if no listener defined */
        });
        if (messenger.WindowListener) {
          messenger.WindowListener.notifyExperiment({ command, name, value });
        }
      }
    }
  },

  // Global preference handler, called by WebExtension scripts and Legacy scripts.
  handler: function (info) {
    if (info && info.command) {
      switch (info.command) {
        case "getAllUserPrefs":
          return localStorageHandler.getAllUserPrefs();

        case "getAllDefaults":
          return localStorageHandler.getAllDefaults();

        case "getPref":
          return localStorageHandler.getPref(info.name, info.fallback);

        case "clearPref":
          return localStorageHandler.clearPref(info.name);

        case "setPref":
          return localStorageHandler.setPref(info.name, info.value);

        case "setDefault":
          return localStorageHandler.setDefault(info.name, info.value);
      }
    }
  },
};
