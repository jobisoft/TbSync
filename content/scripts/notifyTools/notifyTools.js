// Set this to the ID of your add-on.
var ADDON_ID = "tbsync@jobisoft.de";

/*
 * This file is provided by the addon-developer-support repository at
 * https://github.com/thundernest/addon-developer-support
 *
 * For usage descriptions, please check:
 * https://github.com/thundernest/addon-developer-support/tree/master/scripts/notifyTools
 *
 * This is a modified version for TbSync.
 *
 * Author: John Bieling (john@thunderbird.net)
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

var notifyTools = {
  registeredCallbacks: {},
  registeredCallbacksNextId: 1,

  onNotifyExperimentObserver: {
    observe: async function (aSubject, aTopic, aData) {
      if (ADDON_ID == "") {
        throw new Error("notifyTools: ADDON_ID is empty!");
      }
      if (aData != ADDON_ID) {
        return;
      }
      // The data has been stuffed in an array so simple strings can be used as
      // payload without the observerService complaining.
      let [data] = aSubject.wrappedJSObject;
      for (let registeredCallback of Object.values(
        notifyTools.registeredCallbacks
      )) {
        registeredCallback(data);
      }
    },
  },

  registerListener: function (listener) {
    let id = this.registeredCallbacksNextId++;
    this.registeredCallbacks[id] = listener;
    return id;
  },

  removeListener: function (id) {
    delete this.registeredCallbacks[id];
  },

  notifyBackground: function (data) {
    if (ADDON_ID == "") {
      throw new Error("notifyTools: ADDON_ID is empty!");
    }
    return new Promise((resolve) => {
      Services.obs.notifyObservers(
        { data, resolve },
        "WindowListenerNotifyBackgroundObserver",
        ADDON_ID
      );
    });
  },
};
