## Objective

This API is a temporary helper while converting legacy extensions to modern WebExtensions. It allows to register `resource://` URLs, which are needed to load custom system modules (*.sys.mjs), and `chrome://` URLs, which are needed to open legacy XUL dialogs.

## Usage

Add the [LegacyHelper API](https://github.com/thunderbird/webext-support/tree/master/experiments/LegacyHelper) to your add-on. Your `manifest.json` needs an entry like this:

```json
  "experiment_apis": {
    "LegacyHelper": {
      "schema": "api/LegacyHelper/schema.json",
      "parent": {
        "scopes": ["addon_parent"],
        "paths": [["LegacyHelper"]],
        "script": "api/LegacyHelper/implementation.js"
      }
    }
  },
```

## API Functions

This API provides the following functions:

### async registerGlobalUrls(data)

Register `chrome://*/content/` and `resource://*/` URLs. The function accepts a `data` parameter, which is an array of URL definition items. For example:

```javascript
await browser.LegacyHelper.registerGlobalUrls([
  ["content", "myaddon", "chrome/content/"],
  ["resource", "myaddon", "modules/"],
]);
```

This registers the following URLs:
* `chrome://myaddon/content/` pointing to the `/chrome/content/` folder (the `/content/` part in the URL is fix and does not depend on the name of the folder it is pointing to)
* `resource://myaddon/` pointing to the `/modules/` folder. To register a `resource://` URL which points to the root folder, use `.` instead".

### async openDialog(name, path)

Open a XUL dialog. The `name` parameter is a unique name identifying the dialog. If the dialog with that name is already open, it will be focused instead of being re-opened. The `path` parameter is a `chrome://*/content/` URL pointing to the XUL dialog file (*.xul or *.xhtml).

```javascript
browser.LegacyHelper.openDialog(
  "XulAddonOptions",
  "chrome://myaddon/content/options.xhtml"
);
```
