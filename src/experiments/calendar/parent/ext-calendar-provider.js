/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { ExtensionCommon: { ExtensionAPI, EventManager, EventEmitter } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { ExtensionUtils: { ExtensionError } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");

var { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");

var { CalItipEmailTransport } = ChromeUtils.importESModule("resource:///modules/CalItipEmailTransport.sys.mjs");

// TODO move me
// Have the server take care of scheduling. This can be de-duplicated in
// CalItipEmailTransport.sys.mjs
class CalItipNoEmailTransport extends CalItipEmailTransport {
  wrappedJSObject = this;
  QueryInterface = ChromeUtils.generateQI(["calIItipTransport"]);

  sendItems() {
    return true;
  }
}



// TODO move me
function getNewCalendarWindow() {
  // This window is missing a windowtype attribute
  for (const win of Services.wm.getEnumerator(null)) {
    if (win.location == "chrome://calendar/content/calendar-creation.xhtml") {
      return win;
    }
  }
  return null;
}

// TODO move me
class ItemError extends Error {
  static CONFLICT = "CONFLICT";
  static READ_FAILED = "READ_FAILED";
  static MODIFY_FAILED = "MODIFY_FAILED";

  constructor(reason) {
    super();
    this.reason = reason;
  }

  get xpcomReason() {
    switch (this.reason) {
      case ItemError.READ_FAILED:
        return Ci.calIErrors.READ_FAILED;
      case ItemError.MODIFY_FAILED:
        return Ci.calIErrors.MODIFICATION_FAILED;
      default:
        return Cr.NS_ERROR_FAILURE;
    }
  }
}

function convertProps(props, extension) {
  const calendar = new ExtCalendar(extension);
  calendar.setProperty("name", props.name);
  calendar.setProperty("readOnly", props.readOnly);
  calendar.setProperty("disabled", props.enabled === false);
  calendar.setProperty("color", props.color || "#A8C2E1");
  calendar.capabilities = props.capabilities; // TODO validation necessary?

  calendar.uri = Services.io.newURI(props.url);

  return calendar;
}

function stackContains(part) {
  return new Error().stack.includes(part);
}


class ExtCalendarProvider {
  QueryInterface = ChromeUtils.generateQI(["calICalendarProvider"]);

  static register(extension) {
    const type = "ext-" + extension.id;

    cal.manager.registerCalendarProvider(
      type,
      class extends ExtCalendar {
        constructor() {
          super(extension);
        }
      }
    );

    const provider = new ExtCalendarProvider(extension);
    cal.provider.register(provider);
  }

  static unregister(extension) {
    const type = "ext-" + extension.id;
    cal.manager.unregisterCalendarProvider(type, true);
    cal.provider.unregister(type);
  }

  constructor(extension) {
    this.extension = extension;
  }

  get type() {
    return "ext-" + this.extension.id;
  }

  get displayName() {
    // TODO the localize call is only necessary in the experiment
    return this.extension.localize(this.extension.manifest.calendar_provider.name);
  }

  createCalendar() {
    throw new Components.Exception("Not implemented", Cr.NS_ERROR_NOT_IMPLEMENTED);
  }
  deleteCalendar() {
    throw new Components.Exception("Not implemented", Cr.NS_ERROR_NOT_IMPLEMENTED);
  }

  getCalendar(url) {
    const calendar = new ExtCalendar(this.extension);
    calendar.uri = url;
    return calendar;
  }

  async detectCalendars(username, password, location=null, savePassword=null, extraProperties={}) {
    const detectionResponses = await this.extension.emit("calendar.provider.onDetectCalendars", username, password, location, savePassword, extraProperties);
    return detectionResponses.reduce((allCalendars, calendars) => allCalendars.concat(calendars)).map(props => convertProps(props, this.extension));
  }
}

class ExtCalendar extends cal.provider.BaseClass {
  QueryInterface = ChromeUtils.generateQI(["calICalendar", "calIChangeLog", "calISchedulingSupport"]);

  constructor(extension) {
    super();
    this.initProviderBase();
    this.extension = extension;
  }

  get type() {
    return "ext-" + this.extension.id;
  }

  get providerID() {
    return this.extension.id;
  }

  canRefresh = true;
  capabilities = {};

  get id() {
    return super.id;
  }
  set id(val) {
    super.id = val;
    if (this.id && this.uri) {
      let overrideCapabilities;
      try {
        overrideCapabilities = JSON.parse(super.getProperty("overrideCapabilities")) || {};
      } catch (e) {
        overrideCapabilities = {};
      }

      const manifestCapabilities = this.extension.manifest.calendar_provider.capabilities || {};
      this.capabilities = Object.assign({}, manifestCapabilities, overrideCapabilities);

      this.extension.emit("calendar.provider.onInit", this);
    }
  }
  get uri() {
    return super.uri;
  }
  set uri(val) {
    super.uri = val;
    if (this.id && this.uri) {
      this.extension.emit("calendar.provider.onInit", this);
    }
  }

  get supportsScheduling() {
    return this.capabilities.scheduling != "none";
  }

  getSchedulingSupport() {
    return this;
  }

  setProperty(name, value) {
    if (name === "readOnly" && this.capabilities.mutable === false) {
      return; // prevent change
    }
    super.setProperty(name, value);
  }

  getProperty(name) {
    switch (name) {
      case "cache.supported":
      case "cache.enabled":
      case "cache.always":
        return true;

      case "organizerId":
        if (this.capabilities.organizer) {
          return this.capabilities.organizer;
        }
        break;
      case "organizerCN":
        if (this.capabilities.organizerName) {
          return this.capabilities.organizerName;
        }
        break;
      case "imip.identity.disabled":
        return this.capabilities.scheduling == "none";
      case "itip.transport":
        if (this.capabilities.scheduling == "server") {
          return new CalItipNoEmailTransport();
        } else if (this.capabilities.scheduling == "none") {
          return null;
        }
        // Else fall through and have super return the client email transport
        break;

      case "readOnly":
        if (this.capabilities.mutable === false) {
          return true;
        }
        break;

      case "capabilities.timezones.floating.supported":
        return !(this.capabilities.timezones?.floating === false);
      case "capabilities.timezones.UTC.supported":
        return !(this.capabilities.timezones?.UTC === false);
      case "capabilities.attachments.supported":
        return !(this.capabilities.attachments === false);
      case "capabilities.priority.supported":
        return !(this.capabilities.priority === false);
      case "capabilities.privacy.supported":
        return !(this.capabilities.privacy === false);
      case "capabilities.privacy.values":
        return Array.isArray(this.capabilities.privacy)
          ? this.capabilities.privacy?.map(val => val.toUpperCase())
          : ["PUBLIC", "CONFIDENTIAL", "PRIVATE"];
      case "capabilities.categories.maxCount":
        return Number.isInteger(this.capabilities.categories?.count) &&
          this.capabilities.categories.count >= 0
          ? this.capabilities.categories?.count
          : null;
      case "capabilities.alarms.maxCount":
        return Number.isInteger(this.capabilities.alarms?.count)
          ? this.capabilities.alarms?.count
          : undefined;
      case "capabilities.alarms.actionValues":
        return this.capabilities.alarms?.actions?.map(val => val.toUpperCase()) || ["DISPLAY"];
      case "capabilities.tasks.supported":
        return !(this.capabilities.tasks === false);
      case "capabilities.events.supported":
        return !(this.capabilities.events === false);
      case "capabilities.removeModes":
        return Array.isArray(this.capabilities.removeModes)
          ? this.capabilities.removeModes
          : ["unsubscribe"];
      case "requiresNetwork":
        return !(this.capabilities.requiresNetwork === false);
    }

    return super.getProperty(name);
  }

  _cachedAdoptItemCallback = null;

  addItem(aItem) {
    return this.adoptItem(aItem.clone());
  }
  async adoptItem(aItem) {
    const adoptCallback = this._cachedAdoptItemCallback;
    try {
      // TODO There should be an easier way to determine this
      const options = {};
      if (stackContains("calItipUtils")) {
        options.invitation = true;
      } else if (stackContains("playbackOfflineItems")) {
        options.offline = true;
      }

      const items = await this.extension.emit("calendar.provider.onItemCreated", this, aItem, options);
      const { item, metadata } = items.find(props => props.item) || {};
      if (!item) {
        throw new Components.Exception("Did not receive item from extension", Cr.NS_ERROR_FAILURE);
      }

      if (metadata) {
        this.offlineStorage.setMetaData(item.id, JSON.stringify(metadata));
      }

      if (aItem.id && item.id != aItem.id) {
        // The ID of the item has changed. We'll have to make sure that whatever old item is in the
        // cache is removed.
        // TODO Test this well or risk data loss
        await this.offlineStorage.deleteItem(aItem);
      }

      item.calendar = this.superCalendar;

      this.observers.notify("onAddItem", [item]);

      if (adoptCallback) {
        await adoptCallback(item.calendar, Cr.NS_OK, Ci.calIOperationListener.ADD, item.id, item);
      }
      return item;
    } catch (e) {
      let code;
      if (e.message?.startsWith("NetworkError")) {
        code = Cr.NS_ERROR_NET_INTERRUPT;
      } else if (e instanceof ItemError) {
        code = e.xpcomReason;
      } else {
        code = e.result || Cr.NS_ERROR_FAILURE;
      }

      throw new Components.Exception(e.message || e, code);
    }
  }

  discoverItem(results) {
    let error, success;

    for (const result of results) {
      if (typeof result == "object" && result?.error) {
        success = null;
        error = result.error;
        break;
      }

      if (typeof result == "object" && result?.item) {
        success = result;
      }
      // TODO warn if two results?
    }

    if (error) {
      throw new ItemError(error);
    } else {
      return success;
    }
  }

  _cachedModifyItemCallback = null;

  async modifyItem(aNewItem, aOldItem, aOptions = {}) {
    const modifyCallback = this._cachedModifyItemCallback;

    // TODO There should be an easier way to determine this
    if (stackContains("calItipUtils")) {
      aOptions.invitation = true;
    } else if (stackContains("playbackOfflineItems")) {
      aOptions.offline = true;
    }

    try {
      const results = await this.extension.emit(
        "calendar.provider.onItemUpdated",
        this,
        aNewItem,
        aOldItem,
        aOptions
      );

      const { item, metadata } = this.discoverItem(results);

      if (!item) {
        throw new Components.Exception("Did not receive item from extension", Cr.NS_ERROR_FAILURE);
      }

      if (metadata) {
        this.offlineStorage.setMetaData(item.id, JSON.stringify(metadata));
      }

      if (!item.calendar) {
        item.calendar = this.superCalendar;
      }
      this.observers.notify("onModifyItem", [item, aOldItem]);
      if (modifyCallback) {
        await modifyCallback(item.calendar, Cr.NS_OK, Ci.calIOperationListener.MODIFY, item.id, item);
      }
      return item;
    } catch (e) {
      let code;
      if (e.message?.startsWith("NetworkError")) {
        code = Cr.NS_ERROR_NET_INTERRUPT;
      } else if (e instanceof ItemError) {
        if (e.reason == ItemError.CONFLICT) {
          const overwrite = cal.provider.promptOverwrite("modify", aOldItem);
          if (overwrite) {
            return this.modifyItem(aNewItem, aOldItem, { force: true });
          }
          code = Ci.calIErrors.OPERATION_CANCELLED;
          this.superCalendar.refresh();
        } else {
          code = e.xpcomReason;
        }
      } else {
        code = e.result || Cr.NS_ERROR_FAILURE;
      }
      throw new Components.Exception(e.message || e, code);
    }
  }

  async deleteItem(aItem, aOptions = {}) {
    // TODO There should be an easier way to determine this
    if (stackContains("calItipUtils")) {
      aOptions.invitation = true;
    } else if (stackContains("playbackOfflineItems")) {
      aOptions.offline = true;
    }

    try {
      const results = await this.extension.emit(
        "calendar.provider.onItemRemoved",
        this,
        aItem,
        aOptions
      );

      if (!results.length) {
        throw new Components.Exception(
          "Extension did not consume item deletion",
          Cr.NS_ERROR_FAILURE
        );
      }

      // This will discover errors and throw them
      this.discoverItem(results);

      this.observers.notify("onDeleteItem", [aItem]);
    } catch (e) {
      let code;
      if (e.message?.startsWith("NetworkError")) {
        code = Cr.NS_ERROR_NET_INTERRUPT;
      } else if (e instanceof ItemError) {
        if (e.reason == ItemError.CONFLICT) {
          const overwrite = cal.provider.promptOverwrite("delete", aItem);
          if (overwrite) {
            return this.deleteItem(aItem, { force: true });
          }
          code = Ci.calIErrors.OPERATION_CANCELLED;
          this.superCalendar.refresh();
        } else {
          code = e.xpcomReason;
        }
      } else {
        code = e.result || Cr.NS_ERROR_FAILURE;
      }

      throw new Components.Exception(e.message || e, code);
    }
    return aItem;
  }

  getItem(_aId) {
    return this.offlineStorage.getItem(...arguments);
  }

  getItems(_aFilter, _aCount, _aRangeStart, _aRangeEnd) {
    return this.offlineStorage.getItems(...arguments);
  }

  refresh() {
    this.mObservers.notify("onLoad", [this]);
  }

  resetLog() {
    // TODO may need to make this .finally()
    this.extension.emit("calendar.provider.onResetSync", this).then(() => {
      this.mObservers.notify("onLoad", [this]);
    });
  }

  async replayChangesOn(aListener) {
    this.offlineStorage.startBatch();
    try {
      let status = Cr.NS_OK
      let detail = null;
      try {
        await this.extension.emit("calendar.provider.onSync", this);
      } catch (e) {
        status = e.result || Cr.NS_ERROR_FAILURE;
        detail = e.message || e;
        console.error(e);
      }

      aListener.onResult({ status }, detail);
    } finally {
      this.offlineStorage.endBatch();
    }
  }
}

class ExtFreeBusyProvider {
  QueryInterface = ChromeUtils.generateQI(["calIFreeBusyProvider"]);

  constructor(fire) {
    this.fire = fire;
  }

  async getFreeBusyIntervals(aCalId, aRangeStart, aRangeEnd, aBusyTypes, aListener) {
    try {
      const TYPE_MAP = {
        unknown: Ci.calIFreeBusyInterval.UNKNOWN,
        free: Ci.calIFreeBusyInterval.FREE,
        busy: Ci.calIFreeBusyInterval.BUSY,
        unavailable: Ci.calIFreeBusyInterval.BUSY_UNAVAILABLE,
        tentative: Ci.calIFreeBusyInterval.BUSY_TENTATIVE,
      };
      const attendee = aCalId.replace(/^mailto:/, "");
      const start = cal.dtz.toRFC3339(aRangeStart);
      const end = cal.dtz.toRFC3339(aRangeEnd);
      const types = ["free", "busy", "unavailable", "tentative"].filter((type, index) => aBusyTypes & (1 << index));
      const results = await this.fire.async(attendee, start, end, types);
      aListener.onResult({ status: Cr.NS_OK }, results.map(interval =>
        new cal.provider.FreeBusyInterval(aCalId,
          TYPE_MAP[interval.type],
          cal.dtz.fromRFC3339(interval.start, cal.dtz.UTC),
          cal.dtz.fromRFC3339(interval.end, cal.dtz.UTC)
        )
      ));
    } catch (e) {
      console.error(e);
      aListener.onResult({ status: e.result || Cr.NS_ERROR_FAILURE }, e.message || e);
    }
  }
}

this.calendar_provider = class extends ExtensionAPI {
  onStartup() {
    if (this.extension.manifest.calendar_provider) {
      this.onManifestEntry("calendar_provider");
    }
    const uuid = this.extension.uuid;
    const root = `experiments-calendar-${uuid}`;
    const query = this.extension.manifest.version;
    Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler)
      .setSubstitution(root, this.extension.rootURI);

    const { setupE10sBrowser, unwrapCalendar } = ChromeUtils.importESModule(
      `resource://${root}/experiments/calendar/ext-calendar-utils.sys.mjs?${query}`
    );

    ChromeUtils.registerWindowActor(`CalendarProvider-${uuid}`, { child: { esModuleURI:
      `resource://${root}/experiments/calendar/child/ext-calendar-provider-actor.sys.mjs?${query}`
    }});

    ExtensionSupport.registerWindowListener("ext-calendar-provider-properties-" + this.extension.id, {
      chromeURLs: ["chrome://calendar/content/calendar-properties-dialog.xhtml"],
      onLoadWindow: (win) => {
        const calendar = unwrapCalendar(win.arguments[0].calendar);
        if (calendar.type != "ext-" + this.extension.id) {
          return;
        }

        // Work around a bug where the notification is shown when imip is disabled
        if (calendar.getProperty("imip.identity.disabled")) {
          win.gIdentityNotification.removeAllNotifications();
        }

        const minRefresh = calendar.capabilities?.minimumRefreshInterval;

        if (minRefresh) {
          const refInterval = win.document.getElementById("calendar-refreshInterval-menupopup");
          for (const node of [...refInterval.children]) {
            const nodeval = parseInt(node.getAttribute("value"), 10);
            if (nodeval < minRefresh && nodeval != 0) {
              node.remove();
            }
          }
        }

        const mutable = calendar.capabilities?.mutable;

        if (!mutable) {
          win.document.getElementById("read-only").disabled = true;
        }
      }
    });

    ExtensionSupport.registerWindowListener("ext-calendar-provider-creation-" + this.extension.id, {
      chromeURLs: ["chrome://calendar/content/calendar-creation.xhtml"],
      onLoadWindow: (win) => {
        const provider = this.extension.manifest.calendar_provider;
        if (provider.creation_panel) {
          // Do our own browser setup to avoid a bug
          win.setUpAddonCalendarSettingsPanel = (calendarType) => {
            const panel = win.document.getElementById("panel-addon-calendar-settings");
            panel.setAttribute("flex", "1");

            let browser = panel.lastElementChild;
            let loadPromise = Promise.resolve();
            if (!browser) {
              browser = win.document.createXULElement("browser");
              browser.setAttribute("transparent", "true");
              browser.setAttribute("flex", "1");
              loadPromise = setupE10sBrowser(this.extension, browser, panel, { maxWidth: undefined, maxHeight: undefined, allowScriptsToClose: false });
            }

            loadPromise.then(() => {
              browser.fixupAndLoadURIString(calendarType.panelSrc, { triggeringPrincipal: this.extension.principal });
            });

            win.gButtonHandlers.forNodeId["panel-addon-calendar-settings"].accept = (event) => {
              const addonPanel = win.document.getElementById("panel-addon-calendar-settings");
              if (addonPanel.dataset.addonForward) {
                event.preventDefault();
                event.target.getButton("accept").disabled = true;
                win.gAddonAdvance.emit("advance", "forward", addonPanel.dataset.addonForward).finally(() => {
                  event.target.getButton("accept").disabled = false;
                });
              } else if (calendarType.onCreated) {
                calendarType.onCreated();
              } else {
                win.close();
              }
            };
            win.gButtonHandlers.forNodeId["panel-addon-calendar-settings"].extra2 = (_event) => {
              const addonPanel = win.document.getElementById("panel-addon-calendar-settings");

              if (addonPanel.dataset.addonBackward) {
                win.gAddonAdvance.emit("advance", "back", addonPanel.dataset.addonBackward);
              } else {
                win.selectPanel("panel-select-calendar-type");

                // Reload the window, the add-on might expect to do some initial setup when going
                // back and forward again.
                win.setUpAddonCalendarSettingsPanel(extCalendarType);
              }
            };
          };

          const extCalendarType = {
            label: this.extension.localize(provider.name),
            panelSrc: this.extension.getURL(this.extension.localize(provider.creation_panel)),
          };
          win.registerCalendarType(extCalendarType);

          win.gAddonAdvance = new EventEmitter();
        }

        const origCheckRequired = win.checkRequired;
        win.checkRequired = () => {
          origCheckRequired();
          const addonPanel = win.document.getElementById("panel-addon-calendar-settings");
          if (addonPanel.hidden) {
            return;
          }

          const dialog = win.document.getElementById("calendar-creation-dialog");
          if (addonPanel.dataset.addonNoForward == "true") {
            dialog.setAttribute("buttondisabledaccept", "true");
          } else {
            dialog.removeAttribute("buttondisabledaccept");
          }
        };
      }
    });
  }
  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    const uuid = this.extension.uuid;
    const root = `experiments-calendar-${uuid}`;
    ExtensionSupport.unregisterWindowListener("ext-calendar-provider-creation-" + this.extension.id);
    ExtensionSupport.unregisterWindowListener("ext-calendar-provider-properties-" + this.extension.id);
    ChromeUtils.unregisterWindowActor(`CalendarProvider-${uuid}`);

    if (this.extension.manifest.calendar_provider) {
      ExtCalendarProvider.unregister(this.extension);
    }
    Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler)
      .setSubstitution(root, null);
    Services.obs.notifyObservers(null, "startupcache-invalidate");
  }

  onManifestEntry(entryName) {
    if (entryName != "calendar_provider") {
      return;
    }
    const manifest = this.extension.manifest;

    if (!manifest.browser_specific_settings?.gecko?.id && !manifest.applications?.gecko?.id) {
      console.warn(
        "Registering a calendar provider with a temporary id. Calendars created for this provider won't persist restarts"
      );
    }

    // Defer registering the provider until the background page has started. We want the first set
    // of listeners to be connected before we initialize.
    // TODO this works, but if there is an async IIFE then that doesn't have the provider registered
    // yet.
    this.extension.on("background-script-started", () => {
      ExtCalendarProvider.register(this.extension);
      const provider = new ExtCalendarProvider(this.extension);
      cal.provider.register(provider);
    });
  }

  getAPI(context) {
    const uuid = context.extension.uuid;
    const root = `experiments-calendar-${uuid}`;
    const query = context.extension.manifest.version;
    const {
      propsToItem,
      convertItem,
      convertCalendar,
    } = ChromeUtils.importESModule(
      `resource://${root}/experiments/calendar/ext-calendar-utils.sys.mjs?${query}`
    );

    return {
      calendar: {
        provider: {
          onItemCreated: new EventManager({
            context,
            name: "calendar.provider.onItemCreated",
            register: (fire, options) => {
              const listener = async (event, calendar, item, listenerOptions) => {
                const props = await fire.async(
                  convertCalendar(context.extension, calendar),
                  convertItem(item, options, context.extension),
                  listenerOptions
                );

                if (props?.error) {
                  return { error: props.error };
                }

                if (props?.type) {
                  item = propsToItem(props);
                }
                if (!item.id) {
                  item.id = cal.getUUID();
                }
                return { item, metadata: props?.metadata };
              };

              context.extension.on("calendar.provider.onItemCreated", listener);
              return () => {
                context.extension.off("calendar.provider.onItemCreated", listener);
              };
            },
          }).api(),

          onItemUpdated: new EventManager({
            context,
            name: "calendar.provider.onItemUpdated",
            register: (fire, options) => {
              const listener = async (event, calendar, item, oldItem, listenerOptions) => {
                const props = await fire.async(
                  convertCalendar(context.extension, calendar),
                  convertItem(item, options, context.extension),
                  convertItem(oldItem, options, context.extension),
                  listenerOptions
                );
                if (props?.error) {
                  return { error: props.error };
                }
                if (props?.type) {
                  item = propsToItem(props);
                }
                return { item, metadata: props?.metadata };
              };

              context.extension.on("calendar.provider.onItemUpdated", listener);
              return () => {
                context.extension.off("calendar.provider.onItemUpdated", listener);
              };
            },
          }).api(),

          onItemRemoved: new EventManager({
            context,
            name: "calendar.provider.onItemRemoved",
            register: (fire, options) => {
              const listener = async (event, calendar, item, listenerOptions) => {
                const res = await fire.async(
                  convertCalendar(context.extension, calendar),
                  convertItem(item, options, context.extension),
                  listenerOptions
                );
                return res;
              };

              context.extension.on("calendar.provider.onItemRemoved", listener);
              return () => {
                context.extension.off("calendar.provider.onItemRemoved", listener);
              };
            },
          }).api(),

          onInit: new EventManager({
            context,
            name: "calendar.provider.onInit",
            register: fire => {
              const listener = (event, calendar) => {
                return fire.async(convertCalendar(context.extension, calendar));
              };

              context.extension.on("calendar.provider.onInit", listener);
              return () => {
                context.extension.off("calendar.provider.onInit", listener);
              };
            },
          }).api(),

          onSync: new EventManager({
            context,
            name: "calendar.provider.onSync",
            register: fire => {
              const listener = (event, calendar) => {
                return fire.async(convertCalendar(context.extension, calendar));
              };

              context.extension.on("calendar.provider.onSync", listener);
              return () => {
                context.extension.off("calendar.provider.onSync", listener);
              };
            },
          }).api(),

          onResetSync: new EventManager({
            context,
            name: "calendar.provider.onResetSync",
            register: fire => {
              const listener = (event, calendar) => {
                return fire.async(convertCalendar(context.extension, calendar));
              };

              context.extension.on("calendar.provider.onResetSync", listener);
              return () => {
                context.extension.off("calendar.provider.onResetSync", listener);
              };
            },
          }).api(),

          onFreeBusy: new EventManager({
            context,
            name: "calendar.provider.onFreeBusy",
            register: fire => {
              const provider = new ExtFreeBusyProvider(fire);
              cal.freeBusyService.addProvider(provider);

              return () => {
                cal.freeBusyService.removeProvider(provider);
              };
            },
          }).api(),

          onDetectCalendars: new EventManager({
            context,
            name: "calendar.provider.onDetectCalendars",
            register: fire => {
              const listener = (event, username, password, location, savePassword, extraProperties) => {
                return fire.async(username, password, location, savePassword, extraProperties);
              };

              context.extension.on("calendar.provider.onDetectCalendars", listener);
              return () => {
                context.extension.off("calendar.provider.onDetectCalendars", listener);
              };
            }
          }).api(),


          // New calendar dialog
          async setAdvanceAction({ forward, back, label, canForward }) {
            const window = getNewCalendarWindow();
            if (!window) {
              throw new ExtensionError("New calendar wizard is not open");
            }
            const addonPanel = window.document.getElementById("panel-addon-calendar-settings");
            if (forward) {
              addonPanel.dataset.addonForward = forward;
            } else {
              delete addonPanel.dataset.addonForward;
            }

            if (back) {
              addonPanel.dataset.addonBackward = back;
            } else {
              delete addonPanel.dataset.addonBackward;
            }

            addonPanel.setAttribute("buttonlabelaccept", label);
            if (!addonPanel.hidden) {
              window.updateButton("accept", addonPanel);
            }

            if (typeof canForward === "boolean") {
              addonPanel.dataset.addonNoForward = !canForward
              window.checkRequired();
            }
          },
          onAdvanceNewCalendar: new EventManager({
            context,
            name: "calendar.provider.onAdvanceNewCalendar",
            register: fire => {
              const handler = async (event, direction, actionId) => {
                const result = await fire.async(actionId);

                if (direction == "forward" && result !== false) {
                  getNewCalendarWindow()?.close();
                }
              };

              const win = getNewCalendarWindow();
              if (!win) {
                throw new ExtensionError("New calendar wizard is not open");
              }

              win.gAddonAdvance.on("advance", handler);
              return () => {
                getNewCalendarWindow()?.gAddonAdvance.off("advance", handler);
              };
            },
          }).api()
        },
      },
    };
  }
};
