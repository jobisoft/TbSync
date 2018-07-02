/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Thunderbirthday Provider code.
 *
 * The Initial Developer of the Original Code is
 *    Ingo Mueller (thunderbirthday at ingomueller dot net)
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *    Philipp Kewisch (mozilla@kewis.ch), developper of the Google
 *            Calender Provider this extension is (vaguely) based on
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://calendar/modules/calProviderUtils.jsm");
Components.utils.import("resource://calendar/modules/calUtils.jsm");

/**
 * calTbSyncCalendar
 * This implements the calICalendar interface adapted to the TbSync Provider.
 *
 * @class
 * @constructor
 */
function calTbSyncCalendar() {
    this.initProviderBase();
}

var calTbSyncCalendarClassID = Components.ID("{7eb8f992-3956-4607-95ac-b860ebd51f5a}");
var calTbSyncCalendarInterfaces = [
    Components.interfaces.calICalendar,
    Components.interfaces.calIChangeLog
];
calTbSyncCalendar.prototype = {
    // Inherit from calProviderBase for the the nice helpers
    __proto__: cal.ProviderBase.prototype,
    
    classID: calTbSyncCalendarClassID,
    QueryInterface: XPCOMUtils.generateQI(calTbSyncCalendarInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classDescription: "TbSync Calendar Provider",
        contractID: "@mozilla.org/calendar/calendar;1?type=TbSync",
        classID: calTbSyncCalendarClassID,
        interfaces: calTbSyncCalendarInterfaces
    }),

/*
 * Implement calICalendar
 *
 * The following code is heavily inspired by the google calendaer provider.
 * See http://mxr.mozilla.org/mozilla1.8/source/calendar/providers/gdata/
 */

    get type() {
        return "TbSync";
    },
    
    get providerID() { 
        return "{7eb8f992-3956-4607-95ac-b860ebd51f5a}"; 
    },

    getProperty: function cTBS_getProperty(aName) {
        
        switch (aName) {
            case "cache.enabled":
            case "cache.always":
                return true;
        };
        return this.__proto__.__proto__.getProperty.apply(this, arguments);
    },
    
    setProperty: function cTBS_setProperty(aName, aValue) {
        return this.__proto__.__proto__.setProperty.apply(this, arguments);
    },

    get canRefresh() {
        return true;
    },
    
    adoptItem: function cTBS_adoptItem(aItem, aListener) {
        this.mOfflineStorage.addItem.apply(this.mOfflineStorage, arguments);
    },
    
    addItem: function cTBS_addItem(aItem, aListener) {
        this.mOfflineStorage.adoptItem.apply(this.mOfflineStorage, arguments);
    },
    
    modifyItem: function cTBS_modifyItem(aNewItem, aOldItem, aListener) {
        this.mOfflineStorage.modifyItem.apply(this.mOfflineStorage, arguments);
    },
    
    deleteItem: function cTBS_deleteItem(aItem, aListener) {
        this.mOfflineStorage.deleteItem.apply(this.mOfflineStorage, arguments);
    },
    
    getItem: function cTBS_getItem(aId, aListener) {
        this.mOfflineStorage.getItem.apply(this.mOfflineStorage, arguments);
    },
    
    getItems: function cTBS_getItems(aItemFilter, aCount, aRangeStart, aRangeEnd, aListener) {
        this.mOfflineStorage.getItems.apply(this.mOfflineStorage, arguments);
    }, 
    
    refresh: function cTBS_refresh() {
        Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService).logStringMessage("[TbSync] REFRESH REQUEST");
        // tell observers to reload everything
        this.mObservers.notify("onLoad", [this]);
    },
    
    
    
/**
     * Implement calIChangeLog
     */
    get offlineStorage() { return this.mOfflineStorage; },
    set offlineStorage(val) {
        this.mOfflineStorage = val;
        return val;
    },
    
     replayChangesOn: function(aListener) {
     },
    
};


/**
 * Module Registration for Gecko 2 (Thunderbird 5)
 * TODO: Drop the condition when Thunderbird 3 support is dropped.
 */
if (XPCOMUtils.generateNSGetFactory) {
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([calTbSyncCalendar]);
}
