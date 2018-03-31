//no need to create namespace, we are in a sandbox

Components.utils.import("resource://gre/modules/Services.jsm");

let wait4startup = false;
let statuspanel = null;
let window = null;

//Observer to catch loading of thunderbird main window
let onLoadObserver = {
    observe: function(aSubject, aTopic, aData) {
        if (wait4startup) onLoadAction();          
  }
}

//Observer to catch changing syncstate and to update the status bar.
let syncstateObserver = {
    observe: function (aSubject, aTopic, aData) {
        //update status bar
        let status = window.document.getElementById("tbsync.status");
        if (status) {

            let label = "TbSync: ";

            //check if any account is syncing, if not switch to idle
            let accounts = tbSync.db.getAccounts();
            let idle = true;
            let err = false;
            for (let i=0; i<accounts.IDs.length && idle; i++) {
                //set idle to false, if at least one account is syncing
                if (tbSync.isSyncing(accounts.IDs[i])) idle = false;
        
                //check for errors
                switch (tbSync.db.getAccountSetting(accounts.IDs[i], "status")) {
                    case "OK":
                    case "disabled":
                    case "notsyncronized":
                    case "nolightning":
                    case "syncing":
                        break;
                    default:
                        err = true;
                }
            }

            if (idle) {
                if (err) label +=tbSync.getLocalizedMessage("info.error");   
                else label += tbSync.getLocalizedMessage("info.idle");   
            } else {
                label += tbSync.getLocalizedMessage("info.sync");
            }
            status.label = label;      
            
        }
    }
}

//Observer to open the account manager
let openManagerObserver = {
    observe: function (aSubject, aTopic, aData) {
        if (tbSync.enabled) {
            // check, if a window is already open and just put it in focus
            if (tbSync.prefWindowObj === null) tbSync.prefWindowObj = window.open("chrome://tbsync/content/manager/accountManager.xul", "TbSyncAccountManagerWindow", "chrome,centerscreen");
            tbSync.prefWindowObj.focus();
        } else {
            popupNotEnabled();
        }
    }
}

//function ligthningSyncRequest () {
//    if (tbSync.enabled) tbSync.syncAccount('sync'); else popupNotEnabled();
//}
    




let syncTimer = {
    timer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

    start: function () {
        this.timer.cancel();
        this.timer.initWithCallback(this.event, 60000, 3); //run timer every 60s
    },

    event: {
        notify: function (timer) {
            if (tbSync.enabled) {
                //get all accounts and check, which one needs sync (accounts array is without order, extract keys (ids) and loop over them)
                let accounts = tbSync.db.getAccounts();
                for (let i=0; i<accounts.IDs.length; i++) {
                    let syncInterval = accounts.data[accounts.IDs[i]].autosync * 60 * 1000;
                    let lastsynctime = accounts.data[accounts.IDs[i]].lastsynctime;
                    
                    if (tbSync.isEnabled(accounts.IDs[i]) && (syncInterval > 0) && ((Date.now() - lastsynctime) > syncInterval)) {
                    tbSync.syncAccount("sync",accounts.IDs[i]);
                    }
                }
            }
        }
    }
}






function install(data, reason) {
}

function uninstall(data, reason) {
}

function startup(data, reason) {
    //possible reasons: APP_STARTUP, ADDON_ENABLE, ADDON_INSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE.

    //set default prefs
    let branch = Services.prefs.getDefaultBranch("extensions.tbsync.");
    branch.setBoolPref("enable", true);
    branch.setBoolPref("delay", true);
    branch.setBoolPref("block", false);
    
    branch.setBoolPref("log.toconsole", false);
    branch.setBoolPref("log.tofile", false);
    branch.setBoolPref("log.easdata", true);

    branch.setIntPref("eas.timeout", 90000);
    branch.setIntPref("eas.synclimit", 7);
    branch.setIntPref("eas.maxitems", 50);

    branch.setBoolPref("eas.use_tzpush_contactsync_code", true);

    branch.setBoolPref("hidephones", false);
    branch.setBoolPref("showanniversary", false);
    branch.setCharPref("provider.eas", "Exchange Active Sync");
    branch.setCharPref("provider.dav", "CalDAV/CardDAV (sabre/dav, ownCloud, Nextcloud)");

    branch.setCharPref("clientID.type", "");
    branch.setCharPref("clientID.useragent", "");    

    Components.utils.import("chrome://tbsync/content/tbsync.jsm");

    if (reason == APP_STARTUP) {
        //enable observer to call onLoadAction after thunderbird startup finished
        wait4startup  = true;
    } else {
        //disable observer to call onLoadAction, call it directly
        wait4startup  = false;
        onLoadAction();
    }

    syncTimer.start();

    Services.obs.addObserver(onLoadObserver, "mail-startup-done", false);
    Services.obs.addObserver(openManagerObserver, "tbsync.openManager", false);
    Services.obs.addObserver(syncstateObserver, "tbsync.changedSyncstate", false);
}

function shutdown(data, reason) {
    //possible reasons: APP_SHUTDOWN, ADDON_DISABLE, ADDON_UNINSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE    

    //remove our observer
    Services.obs.removeObserver(onLoadObserver, "mail-startup-done");
    Services.obs.removeObserver(openManagerObserver, "tbsync.openManager");
    Services.obs.removeObserver(syncstateObserver, "tbsync.changedSyncstate");

    //remove UI elements
    if (statuspanel && window && window.document) window.document.getElementById("status-bar").removeChild(statuspanel);

    //finish pending jobs of tbSync
    tbSync.finish();

    //remove main jsm - needs to wait for tbSync.finish!!!
    //Components.utils.unload("chrome://tbsync/content/tbsync.jsm");
}

function onLoadAction() {
    window = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                              .getService(Components.interfaces.nsIWindowMediator)
                              .getMostRecentWindow("mail:3pane");
    if (window) {
        statuspanel = window.document.createElement('statusbarpanel');
        statuspanel.setAttribute("label","TbSync");
        statuspanel.setAttribute("id","tbsync.status");
        statuspanel.setAttribute("onclick","Services.obs.notifyObservers(null, 'tbsync.openManager', null);");
        window.document.getElementById("status-bar").appendChild(statuspanel);
        
        //if (window.document.getElementById("calendar-synchronize-button")) {
        //    window.document.getElementById("calendar-synchronize-button").addEventListener("command", ligthningSyncRequest, false);
        //}

        //init tbSync logic
        tbSync.init();
    } else {
        tbSync.dump("FAIL", "Could not init UI, because mail:3pane window not found.");
    }
}

function popupNotEnabled () {
    let msg = "Oops! TbSync was not able to start!\n\n";
    tbSync.dump("Oops", "Trying to open account manager, but init sequence not yet finished");
    
    if (!tbSync.prefSettings.getBoolPref("log.tofile")) {
        if (window.confirm(msg + "It is not possible to trace this error, because debug log is currently not enabled. Do you want to enable debug log now, to help fix this error?")) {
            tbSync.prefSettings.setBoolPref("log.tofile", true);
            window.alert("TbSync debug log has been enabled, please restart Thunderbird and again try to open TbSync.");
        }
    } else {
        if (window.confirm(msg + "To help fix this error, you could send a debug log to the TbSync developer. Do you want to open the debug log now?")) {
            tbSync.openFileTab("debug.log");
        }
    }
}
