/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global ExtensionCommon */

var { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");
var { ToolbarButtonAPI } = ChromeUtils.importESModule("resource:///modules/ExtensionToolbarButtons.sys.mjs");

var { makeWidgetId } = ExtensionCommon;

const calendarItemActionMap = new WeakMap();

this.calendarItemAction = class extends ToolbarButtonAPI {
  #removeFromXulStoreSet(windowUrl, toolbarId, setName) {
    const set = Services.xulStore.getValue(
      windowUrl,
      toolbarId,
      setName
    ).split(",");
    const newSet = set.filter(e => e != this.id);
    if (newSet.length < set.length) {
      Services.xulStore.setValue(
        windowUrl,
        toolbarId,
        setName,
        newSet.join(",")
      );
    }
  }

  static for(extension) {
    return calendarItemActionMap.get(extension);
  }

  onStartup() {
    // TODO this is only necessary in the experiment, can drop this when moving to core.
    const calendarItemAction = this.extension.manifest?.calendar_item_action;
    if (calendarItemAction) {
      const localize = this.extension.localize.bind(this.extension);

      if (calendarItemAction.default_popup) {
        calendarItemAction.default_popup = this.extension.getURL(localize(calendarItemAction.default_popup));
      }
      if (calendarItemAction.default_label) {
        calendarItemAction.default_label = localize(calendarItemAction.default_label);
      }
      if (calendarItemAction.default_title) {
        calendarItemAction.default_title = localize(calendarItemAction.default_title);
      }

      this.onManifestEntry("calendar_item_action");
    }

    // TODO this is only necessary in the experiment, can refactor this when moving to core.
    ExtensionSupport.registerWindowListener("ext-calendar-itemAction-" + this.extension.id, {
      chromeURLs: ["chrome://calendar/content/calendar-event-dialog.xhtml"],
      onLoadWindow(win) {
        const { document } = win;

        if (!document.getElementById("mainPopupSet")) {
          const mainPopupSet = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "popupset");
          mainPopupSet.id = "mainPopupSet";
          const dialog = document.querySelector("dialog");
          dialog.insertBefore(mainPopupSet, dialog.firstElementChild);
        }
      }
    });
  }

  async onManifestEntry(entryName) {
    await super.onManifestEntry(entryName);
    calendarItemActionMap.set(this.extension, this);
  }

  close() {
    super.close();
    calendarItemActionMap.delete(this.extension);
  }

  constructor(extension) {
    super(extension, ExtensionParent.apiManager.global);

    this.manifest_name = "calendar_item_action";
    this.manifestName = "calendarItemAction";
    this.moduleName = this.manifestName;

    // TODO: This could be removed, as the new toolboxData has this info as well.
    this.windowURLs = [
      "chrome://messenger/content/messenger.xhtml",
      "chrome://calendar/content/calendar-event-dialog.xhtml"
    ];

    // For reference, the current core approach.
    //this.toolboxId = "event-toolbox";
    //this.toolbarId = "event-toolbar";

    this.toolboxData = [
      {
        windowUrl: "chrome://calendar/content/calendar-event-dialog.xhtml",
        toolboxId: "event-toolbox",
        toolbarId: "event-toolbar",
        allowedToolbarIds: ["event-toolbar"],
      },
      {
        windowUrl: "chrome://messenger/content/messenger.xhtml",
        toolboxId: "event-toolbox",
        toolbarId: "event-tab-toolbar",
        allowedToolbarIds: ["event-tab-toolbar"],
      }
    ];

    // Core code generates these only in onManifestEntry, which is too late for
    // the cleanup (it is async and paint may already be fired).
    this.widgetId = makeWidgetId(extension.id);
    this.id = `${this.widgetId}-${this.moduleName}-toolbarbutton`;

    // Core code can clean up extension buttons (most notably the XUL store
    // extensionset) in onUninstall(), but an Experiment cannot. Let's cleanup on
    // a fresh install (as early as possible). We might even stick with this
    // approach, as onUninstall() needs hardcoded values.
    if (this.extension.startupReason == "ADDON_INSTALL") {
      for (const { windowUrl, allowedToolbarIds } of this.toolboxData) {
        const defaultToolbarId = allowedToolbarIds[0];
        this.#removeFromXulStoreSet(windowUrl, defaultToolbarId, "extensionset");
        for (const toolbarId of allowedToolbarIds) {
          this.#removeFromXulStoreSet(windowUrl, toolbarId, "currentset");
        }
      }
    }
  }

  // This is a proposed implementation for toolbarbuttons on a customizable
  // toolbar, where buttons can be added to different toolbars in different pages
  // (see ToolbarButtonAPI::customizableToolbarPaint).
  paint(window) {
    const { document } = window;
    if (document.getElementById(this.id)) {
      return;
    }

    const windowURL = window.location.href;
    const toolboxData = this.toolboxData.find(t => t.windowUrl == windowURL);

    if (!toolboxData) {
      return;
    }

    const toolbox = document.getElementById(toolboxData.toolboxId);
    if (!toolbox) {
      return;
    }

    // Get all toolbars which link to or are children of toolboxData.toolboxId and
    // check if the button has been moved to the XUL store currentset of a non-default
    // toolbar.
    const toolbars = document.querySelectorAll(
      `#${toolboxData.toolboxId} toolbar, toolbar[toolboxid="${toolboxData.toolboxId}"]`
    );
    for (const toolbar of toolbars) {
      const currentSet = Services.xulStore
        .getValue(windowURL, toolbar.id, "currentset")
        .split(",")
        .filter(Boolean);
      if (currentSet.includes(this.id)) {
        toolboxData.toolbarId = toolbar.id;
        break;
      }
    }

    const toolbar = document.getElementById(toolboxData.toolbarId);
    const button = this.makeButton(window);
    if (toolbox.palette) {
      toolbox.palette.appendChild(button);
    } else {
      toolbar.appendChild(button);
    }

    // Handle the special case where this toolbar does not yet have a currentset
    // defined.
    if (!Services.xulStore.hasValue(windowURL, toolboxData.toolbarId, "currentset")) {
      const defaultSet = toolbar
        .getAttribute("defaultset")
        .split(",")
        .filter(Boolean);
      Services.xulStore.setValue(
        windowURL,
        toolboxData.toolbarId,
        "currentset",
        defaultSet.join(",")
      );
    }

    // Add new buttons to the XUL store currentset: If the extensionset of the
    // default toolbar does not include the button, it is a new one which needs
    // to be added.
    const defaultToolbarId = toolboxData.allowedToolbarIds[0];
    const extensionSet = Services.xulStore
      .getValue(windowURL, defaultToolbarId, "extensionset")
      .split(",")
      .filter(Boolean);
    if (!extensionSet.includes(this.id)) {
      extensionSet.push(this.id);
      Services.xulStore.setValue(
        windowURL,
        defaultToolbarId,
        "extensionset",
        extensionSet.join(",")
      );
      const currentSet = Services.xulStore
        .getValue(windowURL, toolboxData.toolbarId, "currentset")
        .split(",")
        .filter(Boolean);
      if (!currentSet.includes(this.id)) {
        currentSet.push(this.id);
        Services.xulStore.setValue(
          windowURL,
          toolboxData.toolbarId,
          "currentset",
          currentSet.join(",")
        );
      }
    }

    const currentSet = Services.xulStore.getValue(
      windowURL,
      toolboxData.toolbarId,
      "currentset"
    );

    toolbar.currentSet = currentSet;
    toolbar.setAttribute("currentset", toolbar.currentSet);

    if (this.extension.hasPermission("menus")) {
      document.addEventListener("popupshowing", this);
    }
  }

  unpaint(window) {
    const { document } = window;
    const windowURL = window.location.href;
    // We assume only one toolbox per window. Could have multiple toolbars, but
    // paint updates the associated toolbarId, if it was moved to a non-default
    // toolbar.
    const toolboxData = this.toolboxData.find(t => t.windowUrl == windowURL);

    if (this.extension.hasPermission("menus")) {
      document.removeEventListener("popupshowing", this);
    }

    if (!toolboxData) {
      return;
    }

    const toolbar = document.getElementById(toolboxData.toolbarId);
    if (toolbar.hasAttribute("customizable")) {
      // New code, Bug 2020584.
      //toolbar.removeButton(this.id);
      document.getElementById(this.id)?.remove();
      toolbar.toolbox?.palette?.querySelector(`#${this.id}`)?.remove();
    } else {
      document.getElementById(this.id)?.remove();
    }
  }

  handleEvent(event) {
    super.handleEvent(event);
    const window = event.target.ownerGlobal;

    switch (event.type) {
      case "popupshowing": {
        const menu = event.target;
        const trigger = menu.triggerNode;
        const node = window.document.getElementById(this.id);
        const contexts = [
          "event-dialog-toolbar-context-menu",
        ];

        if (contexts.includes(menu.id) && node && node.contains(trigger)) {
          global.actionContextMenu({
            tab: window,
            pageUrl: window.browser.currentURI.spec,
            extension: this.extension,
            onCalendarItemAction: true,
            menu,
          });
        }
        break;
      }
    }
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    const extensionId = this.extension.id;
    ExtensionSupport.unregisterWindowListener("ext-calendar-itemAction-" + extensionId);
  }
};

global.calendarItemActionFor = this.calendarItemAction.for;
