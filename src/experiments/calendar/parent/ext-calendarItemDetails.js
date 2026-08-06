/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { ExtensionCommon: { ExtensionAPI, makeWidgetId } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");

var { ExtensionUtils: { ExtensionError } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");

var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");

Cu.importGlobalProperties(["URL"]);

this.calendarItemDetails = class extends ExtensionAPI {
  onLoadCalendarItemPanel(window, origLoadCalendarItemPanel, iframeId, url) {
    const uuid = this.extension.uuid;
    const root = `experiments-calendar-${uuid}`;
    const query = this.extension.manifest.version;
    const { setupE10sBrowser } = ChromeUtils.importESModule(
      `resource://${root}/experiments/calendar/ext-calendar-utils.sys.mjs?${query}`
    );

    const res = origLoadCalendarItemPanel(iframeId, url);
    if (!this.extension.manifest.calendar_item_details) {
      return res;
    }
    let panelFrame;
    if (window.tabmail) {
      panelFrame = window.document.getElementById(iframeId || window.tabmail.currentTabInfo.iframe?.id);
    } else {
      panelFrame = window.document.getElementById("calendar-item-panel-iframe");
    }

    panelFrame.contentWindow.addEventListener("load", (event) => {
      const document = event.target.ownerGlobal.document;

      let areas = [];
      if (this.extension.manifest.calendar_item_details) {
        areas = this.extension.manifest.calendar_item_details.allowed_areas || ["secondary"]
        if (!Array.isArray(areas)) {
          areas = [areas];
        }
      }

      if (areas.includes("secondary")) {
        const widgetId = makeWidgetId(this.extension.id);

        const tabs = document.getElementById("event-grid-tabs");
        const tab = document.createXULElement("tab");
        tabs.appendChild(tab);
        tab.setAttribute("label", this.extension.manifest.calendar_item_details.default_title);
        tab.setAttribute("id", widgetId + "-calendarItemDetails-tab");
        tab.setAttribute("image", this.extension.manifest.calendar_item_details.default_icon);
        tab.querySelector(".tab-icon").style.maxHeight = "19px";

        const tabpanels = document.getElementById("event-grid-tabpanels");
        const tabpanel = document.createXULElement("tabpanel");
        tabpanels.appendChild(tabpanel);
        tabpanel.setAttribute("id", widgetId + "-calendarItemDetails-tabpanel");
        tabpanel.setAttribute("flex", "1");

        const browser = document.createXULElement("browser");
        browser.setAttribute("flex", "1");

        const options = { maxWidth: null, fixedWidth: true };
        setupE10sBrowser(this.extension, browser, tabpanel, options).then(() => {
          const target = new URL(this.extension.manifest.calendar_item_details.default_content);
          target.searchParams.set("area", "secondary");
          browser.fixupAndLoadURIString(target.href, { triggeringPrincipal: this.extension.principal });
        });
      } else if (areas.includes("inline")) {
        const tabbox = document.getElementById("event-grid");

        const browserRow = tabbox.appendChild(document.createElementNS("http://www.w3.org/1999/xhtml", "tr"));
        const browserCell = browserRow.appendChild(document.createElementNS("http://www.w3.org/1999/xhtml", "td"));
        browserRow.className = "event-grid-link-row";
        browserCell.setAttribute("colspan", "2");

        const separator = tabbox.appendChild(document.createElementNS("http://www.w3.org/1999/xhtml", "tr"));
        separator.className = "separator";
        const separatorCell = separator.appendChild(document.createElementNS("http://www.w3.org/1999/xhtml", "td"));
        separatorCell.setAttribute("colspan", "2");

        // Fix an annoying bug, this should be part of a different patch
        document.getElementById("url-link").style.maxWidth = "42em";

        const browser = document.createXULElement("browser");
        browser.setAttribute("flex", "1");

        browser.style.width = "100%";
        browser.style.display = "block";

        // Do this on the next tick so the column width is correctly calculated
        window.setTimeout(() => {
          const columnWidth = document.querySelector("#event-grid th")?.offsetWidth || 0;

          const options = { maxWidth: null, fixedWidth: true, maxHeight: 200 };
          setupE10sBrowser(this.extension, browser, browserCell, options).then(() => {
            browser.messageManager.addMessageListener("Extension:BrowserResized", function(message) {
              if (message.data.detail == "delayed") {
                browser.style.height = `${message.data.height}px`;
              }
            });
            const target = new URL(this.extension.manifest.calendar_item_details.default_content);
            target.searchParams.set("area", "inline");
            target.searchParams.set("columnWidth", columnWidth);
            browser.fixupAndLoadURIString(target.href, { triggeringPrincipal: this.extension.principal });
          });
        }, 0);
      }
    });

    return res;
  }

  onLoadSummary(window) {
    const uuid = this.extension.uuid;
    const root = `experiments-calendar-${uuid}`;
    const query = this.extension.manifest.version;
    const { setupE10sBrowser } = ChromeUtils.importESModule(
      `resource://${root}/experiments/calendar/ext-calendar-utils.sys.mjs?${query}`
    );

    const document = window.document;

    // Fix an annoying bug, this should be part of a different patch
    document.querySelector(".url-link").style.maxWidth = "42em";

    let areas = [];
    if (this.extension.manifest.calendar_item_details) {
      areas = this.extension.manifest.calendar_item_details.allowed_areas || ["secondary"]
      if (!Array.isArray(areas)) {
        areas = [areas];
      }
    }

    if (areas.includes("summary")) {
      const summaryBox = document.querySelector(".item-summary-box");

      const browser = document.createXULElement("browser");
      browser.id = "ext-calendar-item-details-" + this.extension.id;
      browser.style.minHeight = "150px";
      document.getElementById(browser.id)?.remove();

      const separator = document.createXULElement("separator");
      separator.id = "ext-calendar-item-details-separator-" + this.extension.id;
      separator.className = "groove";

      document.getElementById(separator.id)?.remove();
      summaryBox.appendChild(separator);

      const options = { maxWidth: null, fixedWidth: true };
      setupE10sBrowser(this.extension, browser, summaryBox, options).then(() => {
        const target = new URL(this.extension.manifest.calendar_item_details.default_content);
        target.searchParams.set("area", "summary");
        browser.fixupAndLoadURIString(target.href, { triggeringPrincipal: this.extension.principal });
      });
    }
  }

  onStartup() {
    const calendarItemDetails = this.extension.manifest?.calendar_item_details;
    if (calendarItemDetails) {
      const localize = this.extension.localize.bind(this.extension);

      if (calendarItemDetails.default_icon) {
        calendarItemDetails.default_icon = this.extension.getURL(localize(calendarItemDetails.default_icon));
      }

      if (calendarItemDetails.default_content) {
        calendarItemDetails.default_content = this.extension.getURL(localize(calendarItemDetails.default_content));
      }
      if (calendarItemDetails.default_title) {
        calendarItemDetails.default_title = localize(calendarItemDetails.default_title);
      }

      const areas = calendarItemDetails.allowed_areas;
      if (Array.isArray(areas) && areas.includes("inline") && areas.includes("secondary")) {
        throw new ExtensionError("Cannot show calendar_item_details both inline and secondary");
      }
    }
    ExtensionSupport.registerWindowListener("ext-calendarItemDetails-summary-" + this.extension.id, {
      chromeURLs: [
        "chrome://calendar/content/calendar-summary-dialog.xhtml"
      ],
      onLoadWindow: (window) => {
        this.onLoadSummary(window);
      }
    });

    ExtensionSupport.registerWindowListener("ext-calendarItemDetails-event-" + this.extension.id, {
      chromeURLs: [
        "chrome://messenger/content/messenger.xhtml",
        "chrome://calendar/content/calendar-event-dialog.xhtml"
      ],
      onLoadWindow: (window) => {
        if (window.location.href == "chrome://messenger/content/messenger.xhtml") {
          const orig = window.onLoadCalendarItemPanel;
          window.onLoadCalendarItemPanel = this.onLoadCalendarItemPanel.bind(this, window, orig.bind(window));
          window._onLoadCalendarItemPanelOrig = orig;
        } else {
          window.setTimeout(() => {
            this.onLoadCalendarItemPanel(window, () => {});
          }, 0);
        }
      }
    });
  }
  onShutdown() {
    ExtensionSupport.unregisterWindowListener("ext-calendarItemDetails-event-" + this.extension.id);
    ExtensionSupport.unregisterWindowListener("ext-calendarItemDetails-summary-" + this.extension.id);

    for (const wnd of ExtensionSupport.openWindows) {
      if (wnd.location.href == "chrome://messenger/content/messenger.xhtml") {
        if (wnd._onLoadCalendarItemPanelOrig) {
          wnd.onLoadCalendarItemPanel = wnd._onLoadCalendarItemPanelOrig;
          wnd._onLoadCalendarItemPanelOrig = null;
        }
      }
    }
  }
  getAPI(_context) {
    return { calendar: { itemDetails: {} } };
  }
};
