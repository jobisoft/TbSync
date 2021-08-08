## Objective

* delegate the actual preference handling to the WebExtension background page to be independent of the used preference storage back-end

* provide an automated preference load/save mechanism, similar to the former preferencesBindings.js script

* universal design to be used in WebExtension HTML pages as well as in privileged scripts loaded by the WindowListener API

The script will use either [`runtime.sendMessage()`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage)
(if loaded in a WebExtension page) or [notifyTools.js](https://github.com/thundernest/addon-developer-support/tree/master/scripts/notifyTools)
(if loaded in a privileged script) to delegate the preference handling to the WebExtension background page.
 
The WebExtension background page needs to load a preference handler, which answers the requests from preference.js. The currently available background handlers are [prefBranchHandler.js](https://github.com/thundernest/addon-developer-support/tree/master/scripts/preferences/backgroundHandler) and [localStorageHandler.js](https://github.com/thundernest/addon-developer-support/tree/master/scripts/preferences/backgroundHandler).

## Usage

This script provides the following public methods:

### async preferences.initCache();

Use this function during page load to asynchronously request all preferences from the
WebExtension background page to set up a local cache. It will also set up a listener to
be notified by the background page, after a preference has been changed elsewhere so it
can update the local cache.

After the cache has been set up, the `getPref()`, `setPref()` and `clearPref()` functions
will interact synchronously with the local cache instead of making asynchronous calls to
the WebExtention background page.



### preferences.getPref(aName, [aFallback]);

Gets the value for preference `aName`. Returns either a Promise for a value received
from the WebExtension background page or a direct value from the local cache (if used).

If no user value and also no default value has been defined, the fallback value will be
returned (or `null`).


### preferences.setPref(aName, aValue);

Sends an update request for the preference `aName` to the WebExtension background page and
updates the local cache (if used).

### preferences.clearPref(aName);

Sends a request to delete the user value for the preference `aName` to the WebExtension
background page and updates the local cache (if used). Subsequent calls to `getPref` will return
the default value.

### async preferences.load(window);

This will search the given `window` for elements with a `preference` attribute (containing the name of a preference) and will load the appropriate values. Any user changes to these elements values will instantly update the linked preferences. This behavior can be changed by adding the `instantApply` attribute to the element and setting it to `false`.

If a linked preference is modified elsewhere, the element's value in the given window will be automatically updated to new new value.

**Note:** _Also supported is the `delayprefsave` attribute, which causes to defer the preference updates by 1s. This requires to add the `alarms` permission to the `manifest.json` file._

### async preferences.save();

This will search the `window` provided by a previous call to `preferences.loadPreferences()` for elements with a `preference` attribute (containing the name of a preference) and will update those preferences with the current values of the linked elements.

