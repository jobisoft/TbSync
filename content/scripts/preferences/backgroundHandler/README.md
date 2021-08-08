## Objective

* handle preference requests send from [preferences.js](https://github.com/thundernest/addon-developer-support/tree/master/scripts/preferences) to the WebExtension background page

* provide methods for the WebExtension background page to access preferences (directly, not via messaging)

&nbsp;

## prefBranchHandler

The prefBranchHandler provides the following public methods:

### async prefBranchHandler.init(defaults, branch)

Initialize the prefBranch and define defaults. Example:

```
  prefBranchHandler.init(
    {
      seperator: "\u001A",
      to_address: "",
      disable_global_book: true,
      max_number_of_categories: 100
    },
    "extensions.sendtocategory."
  );
```

### async prefBranchHandler.enableListeners()

Enable listeners for the messages send from [preferences.js](https://github.com/thundernest/addon-developer-support/tree/master/scripts/preferences).

### async prefBranchHandler.disableListeners()

Disable listeners for the messages send from [preferences.js](https://github.com/thundernest/addon-developer-support/tree/master/scripts/preferences).

&nbsp;

## localStorageHandler

The localStorageHandler provides the following public methods:

### async localStorageHandler.init(defaults)

Initialize the WebExtension local storage and define defaults. Example:

```
  localStorageHandler.init(
    {
      seperator: "\u001A",
      to_address: "",
      disable_global_book: true,
      max_number_of_categories: 100
    }
  );
```

### async localStorageHandler.enableListeners()

Enable listeners for the messages send from [preferences.js](https://github.com/thundernest/addon-developer-support/tree/master/scripts/preferences).

### async localStorageHandler.disableListeners()

Disable listeners for the messages send from [preferences.js](https://github.com/thundernest/addon-developer-support/tree/master/scripts/preferences).

&nbsp;

## Basic preference functions

All background handler provide the following public preference functions:

### async getPref(aName, [aFallback]);

Gets a Promise for the value of preference `aName`. If no user value and also no default value
has been defined, the fallback value will be returned (or `null`).

### async setPref(aName, aValue);

Update preference `aName`. The returned Promise resolves once the preference has been updated.

### clearPref(aName);

Deletes the user value for the preference `aName`. The returned Promise resolves once the preference has been cleared. Subsequent calls to `getPref` will return
the default value.
