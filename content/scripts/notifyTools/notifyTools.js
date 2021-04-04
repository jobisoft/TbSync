// Set this to the ID of your add-on.
var ADDON_ID = "tbsync@jobisoft.de";

/*
 * This file is provided by the addon-developer-support repository at
 * https://github.com/thundernest/addon-developer-support
 *
 * For usage descriptions, please check:
 * https://github.com/thundernest/addon-developer-support/tree/master/scripts/notifyTools
 *
 * Version: 1.3
 * - registered listeners for notifyExperiment can return a value
 * - remove WindowListener from name of observer
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
      let payload = aSubject.wrappedJSObject;
      if (payload.resolve) {
        let observerTrackerPromises = [];
        // Push listener into promise array, so they can run in parallel
        for (let registeredCallback of Object.values(
          notifyTools.registeredCallbacks
        )) {
          observerTrackerPromises.push(registeredCallback(payload.data));
        }
        // We still have to await all of them but wait time is just the time needed
        // for the slowest one.
        let results = [];
        for (let observerTrackerPromise of observerTrackerPromises) {
          let rv = await observerTrackerPromise;
          if (rv != null) results.push(rv);
        }
        if (results.length == 0) {
          payload.resolve();
        } else {
          if (results.length > 1) {
            console.warn(
              "Received multiple results from onNotifyExperiment listeners. Using the first one, which can lead to inconsistent behavior.",
              results
            );
          }
          payload.resolve(results[0]);
        }
      } else {
        // Just call the listener.
        for (let registeredCallback of Object.values(
          notifyTools.registeredCallbacks
        )) {
          registeredCallback(payload.data);
        }
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
        "NotifyBackgroundObserver",
        ADDON_ID
      );
    });
  },
  
  enable: function() {
    Services.obs.addObserver(
      this.onNotifyExperimentObserver,
      "NotifyExperimentObserver",
      false
    );
  },

  disable: function() {
    Services.obs.removeObserver(
      this.onNotifyExperimentObserver,
      "NotifyExperimentObserver"
    );
  },
};


if (window) {
  window.addEventListener(
    "load",
    function (event) {
      notifyTools.enable();
      window.addEventListener(
        "unload",
        function (event) {
          notifyTools.disable();
        },
        false
      );
    },
    false
  );
}
