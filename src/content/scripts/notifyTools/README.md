## Objective

This script is intened to be used together with the WindowListener API (WL API v1.46 or later) or
BootstrapLoader API (BL API v 1.12).

The WL API and the BL API provide a `notifyExperiment()` method, which allows to send data from your
WebExtension's background page to any privileged script running in any of your Experiments.
The recieving script must include `notifyTools.js` and register a listener. The value returned by
the registered listener is passed back as the return value of `notifyExperiment(data)` (as a Promise).

This script also allows to send data from any privileged script running in any of your Experiments
to your WebExtension background page and await a return value.

![messaging](https://user-images.githubusercontent.com/5830621/111921572-90db8d80-8a95-11eb-8673-4e1370d49e4b.png)

More details can be found in the [update tutorial introducing this script](https://github.com/thundernest/addon-developer-support/wiki/Tutorial:-Convert-add-on-parts-individually-by-using-a-messaging-system).

## Usage

This script provides the following public methods:

### registerListener(callback);

This registers a function in a privileged script to be called, when `messenger.WindowListener.notifyExperiment(data)` is
called from the WebExtension's background script. It returns an `id` which can be used to remove the listener again.

Example:

```
function doSomething(data) {
  console.log(data);
  return true;
}
let id = notifyTools.registerListener(doSomething);
```

### removeListener(id)

Removes the listener with the given `id`.

Example:

```
notifyTools.removeListener(id);
```

### async notifyBackground(data)

This function can be called from any privileged script in an Experiment to send data to the
WebExtension's background page. The function will return a Promise for whatever the listener
registered in the WebExtension's background script is returning. 

**Note**: If multiple listeners are registered and more than one is returning data, the value
from the first one used. This may lead to inconsistent behavior, so make sure that for each
request only one listener is returning data.

Example:

```
notifyTools.notifyBackground({command: "doSomething"}).then((data) => {
  console.log(data);
});
```

The WebExtension background script needs to register a listener:

```
messenger.WindowListener.onNotifyBackground.addListener(async (info) => {
  switch (info.command) {
    case "doSomething":
      //do something
      let rv = await doSomething();
      return rv;
      break;
  }
});
```

This allows to work on the add-on uprade in smaller steps, as single calls (like `window.openDialog()`)
in the middle of legacy code can be replaced by WebExtension calls, by stepping out of the Experiment
and back in when the task has been finished.

### enable()

The script attaches its `enable()` method to the `load` event of the current window. If the script is
loaded into a window-less environment, `enable()` needs to be called manually.

### disable()

The script attaches its `disable()` method to the `unload` event of the current window. If the script is
loaded into a window-less environment, `disable()` needs to be called manually.

