"use strict";

tbSync.includeJS("chrome://tbsync/content/provider/eas/db.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/wbxmltools.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/xmltools.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/sync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/contactsync.js");
tbSync.includeJS("chrome://tbsync/content/provider/eas/calendarsync.js");

var eas = {
    init: function () {
        
        //DB Concept:
        //-- on application start, data is read async from json file into object
        //-- AddOn only works on object
        //-- each time data is changed, an async write job is initiated 2s in the future and is resceduled, if another request arrives within that time

        //A task is "serializing" async jobs
        Task.spawn(function* () {
            let decoder = new TextDecoder();
            let encoder = new TextEncoder();

            //load changelog from file
            try {
                let data = yield OS.File.read(db.changelogFile);
                this.changelog = JSON.parse(decoder.decode(data));
            } catch (ex) {
                //if there is no file, there is no file...
            }
            
            //load accounts from file
            try {
                let data = yield OS.File.read(db.changelogFile);
                tbSync.dump("ASYNC OK", decoder.decode(data));
            } catch (ex) {
                //if there is no file, there is no file...
            }
            
            //notify messenger, that this provider has finished its init sequence
            let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
            observerService.notifyObservers(null, "tbsync.init", "");
            
        }).then(null, Components.utils.reportError);

    }
};
