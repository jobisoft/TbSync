/*
 * This file is provided by the addon-developer-support repository at
 * https://github.com/thundernest/addon-developer-support
 *
 * For usage descriptions, please check:
 * https://github.com/thundernest/addon-developer-support/tree/master/scripts/preferences/backgroundHandler
 *
 * Version: 1.0
 *
 * Author: John Bieling (john@thunderbird.net)
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
 
 var prefBranchHandler = {
  _defaults: {},
  _branch: null,

  init: async function (defaults, branch) {
    this._defaults = defaults;
    this._branch = branch;

    // Setup defaults.
    for (const [name, value] of Object.entries(defaults)) {
      await this.setDefault(name, value);
    }
  },

  getAllDefaults: async function () {
    return this._defaults;
  },

  getAllUserPrefs: async function () {
    let preferences = {};
    for (let pref of Object.keys(this._defaults)) {
      let rv = await messenger.LegacyPrefs.getPref(`${this._branch}${pref}`);
      if (rv != null) preferences[pref] = rv;
    }
    return preferences;
  },

  setPref: async function (name, value) {
    return messenger.LegacyPrefs.setPref(`${this._branch}${name}`, value);
  },

  getPref: async function (name, fallback) {
    let rv = await messenger.LegacyPrefs.getPref(`${this._branch}${name}`);
    if (rv != null) return rv;
    else return fallback;
  },

  clearPref: async function (name) {
    return messenger.LegacyPrefs.clearPref(`${this._branch}${name}`);
  },

  setDefault: async function (name, value) {
    return messenger.LegacyPrefs.setDefaultPref(
      `${this._branch}${name}`,
      value
    );
  },

  enableListeners: async function () {
    // Listener for notifications from Legacy scripts
    await messenger.WindowListener.onNotifyBackground.addListener(this.handler);
    // Listener for messages from WebExtension scripts
    await messenger.runtime.onMessage.addListener(this.handler);
    // Add storage change listener.
    await messenger.LegacyPrefs.setObservingBranch(this._branch);  	  
    await messenger.LegacyPrefs.onChanged.addListener(this.storageChanged);  	  
  },

  disableListeners: async function () {
    await messenger.LegacyPrefs.onChanged.removeListener(this.storageChanged);  
    await messenger.WindowListener.onNotifyBackground.removeListener(this.handler);
    await messenger.runtime.onMessage.removeListener(this.handler);
  },

	// Listener for storage changes to inform pref caches of changes.
  storageChanged: function (name, value) {
    let command = value == null ? "clearPref" : "setPref";
    messenger.runtime.sendMessage({ command, name, value }).catch(() => {
      /* hide error if no listener defined */
    });
    if (messenger.WindowListener) {
      messenger.WindowListener.notifyExperiment({ command, name, value });
    }
  },
  
  // Global preference handler, called by WebExtension scripts and Legacy scripts.
  handler: function (info) {
    if (info && info.command) {
      switch (info.command) {
        case "getAllUserPrefs":
          return prefBranchHandler.getAllUserPrefs();

        case "getAllDefaults":
          return prefBranchHandler.getAllDefaults();

        case "getPref":
          return prefBranchHandler.getPref(info.name, info.fallback);

        case "clearPref":
          return prefBranchHandler.clearPref(info.name);

        case "setPref":
          return prefBranchHandler.setPref(info.name, info.value);

        case "setDefault":
          return prefBranchHandler.setDefault(info.name, info.value);
      }
    }
  },
};
