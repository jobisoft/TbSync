/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { ExtensionCommon: { ExtensionAPI, EventManager } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { ExtensionUtils: { ExtensionError } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");

var { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");

this.calendar_calendars = class extends ExtensionAPI {
  getAPI(context) {
    const uuid = context.extension.uuid;
    const root = `experiments-calendar-${uuid}`;
    const query = context.extension.manifest.version;
    const {
      createCalendarObserver,
      unwrapCalendar,
      getResolvedCalendarById,
      isOwnCalendar,
      convertCalendar,
    } = ChromeUtils.importESModule(
      `resource://${root}/experiments/calendar/ext-calendar-utils.sys.mjs?${query}`
    );

    return {
      calendar: {
        calendars: {
          async query({ type, url, name, color, readOnly, enabled, visible }) {
            const calendars = cal.manager.getCalendars();

            let pattern = null;
            if (url) {
              try {
                pattern = new MatchPattern(url, { restrictSchemes: false });
              } catch {
                throw new ExtensionError(`Invalid url pattern: ${url}`);
              }
            }

            return calendars
              .filter(calendar => {
                let matches = true;

                if (type && calendar.type != type) {
                  matches = false;
                }

                if (url && !pattern.matches(calendar.uri)) {
                  matches = false;
                }

                if (name && !new MatchGlob(name).matches(calendar.name)) {
                  matches = false;
                }

                if (color && color != calendar.getProperty("color")) {
                  // TODO need to normalize the color, including null to default color
                  matches = false;
                }

                if (enabled != null && calendar.getProperty("disabled") == enabled) {
                  matches = false;
                }

                if (visible != null & calendar.getProperty("calendar-main-in-composite") != visible) {
                  matches = false;
                }

                if (readOnly != null && calendar.readOnly != readOnly) {
                  matches = false;
                }

                return matches;
              })
              .map(calendar => convertCalendar(context.extension, calendar));
          },
          async get(id) {
            if (id.endsWith("#cache")) {
              const calendar = unwrapCalendar(cal.manager.getCalendarById(id.substring(0, id.length - 6)));
              const own = calendar.offlineStorage && isOwnCalendar(calendar, context.extension);
              return own ? convertCalendar(context.extension, calendar.offlineStorage) : null;
            }
            const calendar = cal.manager.getCalendarById(id);
            return convertCalendar(context.extension, calendar);
          },
          async create(createProperties) {
            let calendar = cal.manager.createCalendar(
              createProperties.type,
              Services.io.newURI(createProperties.url)
            );
            if (!calendar) {
              throw new ExtensionError(`Calendar type ${createProperties.type} is unknown`);
            }

            calendar.name = createProperties.name;

            if (createProperties.color != null) {
              calendar.setProperty("color", createProperties.color);
            }
            if (createProperties.readOnly != null) {
              calendar.setProperty("readOnly", createProperties.readOnly);
            }
            if (createProperties.enabled != null) {
              calendar.setProperty("disabled", !createProperties.enabled);
            }
            if (createProperties.visible != null) {
              calendar.setProperty("calendar-main-in-composite", createProperties.visible);
            }
            if (createProperties.showReminders != null) {
              calendar.setProperty("suppressAlarms", !createProperties.showReminders);
            }
            if (createProperties.capabilities != null) {
              if (!isOwnCalendar(calendar, context.extension)) {
                throw new ExtensionError("Cannot set capabilities on foreign calendar types");
              }

              calendar.setProperty("overrideCapabilities", JSON.stringify(createProperties.capabilities));
            }

            cal.manager.registerCalendar(calendar);

            calendar = cal.manager.getCalendarById(calendar.id);
            return convertCalendar(context.extension, calendar);
          },
          async update(id, updateProperties) {
            const calendar = cal.manager.getCalendarById(id);
            if (!calendar) {
              throw new ExtensionError(`Invalid calendar id: ${id}`);
            }

            if (updateProperties.capabilities && !isOwnCalendar(calendar, context.extension)) {
              throw new ExtensionError("Cannot update capabilities for foreign calendars");
            }
            if (updateProperties.url && !isOwnCalendar(calendar, context.extension)) {
              throw new ExtensionError("Cannot update url for foreign calendars");
            }

            if (updateProperties.url) {
              calendar.uri = Services.io.newURI(updateProperties.url);
            }

            if (updateProperties.enabled != null) {
              calendar.setProperty("disabled", !updateProperties.enabled);
            }

            if (updateProperties.visible != null) {
              calendar.setProperty("calendar-main-in-composite", updateProperties.visible);
            }

            if (updateProperties.showReminders != null) {
              calendar.setProperty("suppressAlarms", !updateProperties.showReminders);
            }

            for (const prop of ["readOnly", "name", "color"]) {
              if (updateProperties[prop] != null) {
                calendar.setProperty(prop, updateProperties[prop]);
              }
            }

            if (updateProperties.capabilities) {
              // TODO validate capability names
              const unwrappedCalendar = calendar.wrappedJSObject.mUncachedCalendar.wrappedJSObject;
              let overrideCapabilities;
              try {
                overrideCapabilities = JSON.parse(calendar.getProperty("overrideCapabilities")) || {};
              } catch(e) {
                overrideCapabilities = {};
              }
              for (const [key, value] of Object.entries(updateProperties.capabilities)) {
                if (value === null) {
                  continue;
                }
                unwrappedCalendar.capabilities[key] = value;
                overrideCapabilities[key] = value;
              }

              calendar.setProperty("overrideCapabilities", JSON.stringify(overrideCapabilities));
            }

            if (updateProperties.lastError !== undefined) {
              if (updateProperties.lastError === null) {
                calendar.setProperty("currentStatus", Cr.NS_OK);
                calendar.setProperty("lastErrorMessage", "");
              } else {
                calendar.setProperty("currentStatus", Cr.NS_ERROR_FAILURE);
                calendar.setProperty("lastErrorMessage", updateProperties.lastError);
              }
            }
          },
          async remove(id) {
            const calendar = cal.manager.getCalendarById(id);
            if (!calendar) {
              throw new ExtensionError(`Invalid calendar id: ${id}`);
            }

            cal.manager.unregisterCalendar(calendar);
          },
          async clear(id) {
            if (!id.endsWith("#cache")) {
              throw new ExtensionError("Cannot clear non-cached calendar");
            }

            const offlineStorage = getResolvedCalendarById(context.extension, id);
            const calendar = cal.manager.getCalendarById(id.substring(0, id.length - 6));

            if (!isOwnCalendar(calendar, context.extension)) {
              throw new ExtensionError("Cannot clear foreign calendar");
            }

            await new Promise((resolve, reject) => {
              const listener = {
                onDeleteCalendar(aCalendar, aStatus, aDetail) {
                  if (Components.isSuccessCode(aStatus)) {
                    resolve();
                  } else {
                    reject(aDetail);
                  }
                },
              };
              offlineStorage
                .QueryInterface(Ci.calICalendarProvider)
                .deleteCalendar(offlineStorage, listener);
            });

            calendar.wrappedJSObject.mObservers.notify("onLoad", [calendar]);
          },

          synchronize(ids) {
            const calendars = [];
            if (ids) {
              if (!Array.isArray(ids)) {
                ids = [ids];
              }
              for (const id of ids) {
                const calendar = cal.manager.getCalendarById(id);
                if (!calendar) {
                  throw new ExtensionError(`Invalid calendar id: ${id}`);
                }
                calendars.push(calendar);
              }
            } else {
              for (const calendar of cal.manager.getCalendars()) {
                if (calendar.getProperty("calendar-main-in-composite")) {
                  calendars.push(calendar);
                }
              }
            }
            for (const calendar of calendars) {
              if (!calendar.getProperty("disabled") && calendar.canRefresh) {
                calendar.refresh();
              }
            }
          },

          onCreated: new EventManager({
            context,
            name: "calendar.calendars.onCreated",
            register: fire => {
              const observer = {
                QueryInterface: ChromeUtils.generateQI(["calICalendarManagerObserver"]),
                onCalendarRegistered(calendar) {
                  fire.sync(convertCalendar(context.extension, calendar));
                },
                onCalendarUnregistering() {},
                onCalendarDeleting() {},
              };

              cal.manager.addObserver(observer);
              return () => {
                cal.manager.removeObserver(observer);
              };
            },
          }).api(),

          onUpdated: new EventManager({
            context,
            name: "calendar.calendars.onUpdated",
            register: fire => {
              const observer = createCalendarObserver({
                onPropertyChanged(calendar, name, value, _oldValue) {
                  const converted = convertCalendar(context.extension, calendar);
                  switch (name) {
                    case "name":
                    case "color":
                    case "readOnly":
                      fire.sync(converted, { [name]: value });
                      break;
                    case "uri":
                      fire.sync(converted, { url: value?.spec });
                      break;
                    case "suppressAlarms":
                      fire.sync(converted, { showReminders: !value });
                      break;
                    case "calendar-main-in-composite":
                      fire.sync(converted, { visible: value });
                      break;
                    case "disabled":
                      fire.sync(converted, { enabled: !value });
                      break;
                  }
                },
              });

              cal.manager.addCalendarObserver(observer);
              return () => {
                cal.manager.removeCalendarObserver(observer);
              };
            },
          }).api(),

          onRemoved: new EventManager({
            context,
            name: "calendar.calendars.onRemoved",
            register: fire => {
              const observer = {
                QueryInterface: ChromeUtils.generateQI(["calICalendarManagerObserver"]),
                onCalendarRegistered() {},
                onCalendarUnregistering(calendar) {
                  fire.sync(calendar.id);
                },
                onCalendarDeleting() {},
              };

              cal.manager.addObserver(observer);
              return () => {
                cal.manager.removeObserver(observer);
              };
            },
          }).api(),
        },
      },
    };
  }
};
