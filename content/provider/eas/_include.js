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

            //load changelog from file
            try {
                let data = yield OS.File.read(tbSync.getAbsolutePath(db.changelogFile));
                db.changelog = JSON.parse(tbSync.decoder.decode(data));
            } catch (ex) {
                //if there is no file, there is no file...
            }
                        
            //load accounts from file
            try {
                let data = yield OS.File.read(tbSync.getAbsolutePath(db.accountsFile));
                db.accounts = JSON.parse(tbSync.decoder.decode(data));
            } catch (ex) {
                //if there is no file, there is no file...
            }

            //load folders from file
            try {
                let data = yield OS.File.read(tbSync.getAbsolutePath(db.foldersFile));
                db.folders = JSON.parse(tbSync.decoder.decode(data));
            } catch (ex) {
                //if there is no file, there is no file...
            }
	    	    
            //finish async init by calling main init()
            tbSync.init();
            
        }).then(null, Components.utils.reportError);

    }
};

eas.init();
