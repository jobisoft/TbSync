/* Copyright (c) 2012 Mark Nethersole
See the file LICENSE.txt for licensing information. */
"use strict";

Components.utils.import("chrome://tzpush/content/tzpush.jsm");

var tzprefs = {

    selectedAccount: null,
    init: false,
    boolSettings: ["https", "provision", "birthday", "displayoverride", "downloadonly"],
    protectedSettings: ["accountname", "asversion", "host", "https", "user", "provision", "birthday", "servertype", "displayoverride", "downloadonly"],
    protectedButtons: ["syncbtn", "resyncbtn"],
        
    onload: function () {
        //get the selected account from tzprefManager
        tzprefs.selectedAccount = parent.tzprefManager.selectedAccount;

        tzprefs.loadSettings();
        //tzprefs.updateFolderList();
        tzprefs.updateGui();
        tzprefs.addressbookListener.add();
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        observerService.addObserver(tzprefs.accountSyncStartedObserver, "tzpush.accountSyncStarted", false);
        observerService.addObserver(tzprefs.accountSyncFinishedObserver, "tzpush.accountSyncFinished", false);
        observerService.addObserver(tzprefs.setPrefInfoObserver, "tzpush.setPrefInfo", false);

        tzprefs.init = true;
    },

    onunload: function () {
        tzprefs.addressbookListener.remove();
        let observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
        if (tzprefs.init) {
            observerService.removeObserver(tzprefs.accountSyncStartedObserver, "tzpush.accountSyncStarted");
            observerService.removeObserver(tzprefs.accountSyncFinishedObserver, "tzpush.accountSyncFinished");
            observerService.removeObserver(tzprefs.setPrefInfoObserver, "tzpush.setPrefInfo");
        }
    },

    // manage sync via queue
    requestSync: function (job, account, disabled = false) {
        if (disabled == false && tzPush.sync.syncingNow != account) tzPush.sync.addAccountToSyncQueue(job, account);

    },


    /* * *
    * Run through all defined TzPush settings and if there is a corresponding
    * field in the settings dialog, fill it with the stored value.
    */
    loadSettings: function () {
        let settings = tzPush.db.getTableFields("accounts");
        
        for (let i=0; i<settings.length;i++) {
            if (document.getElementById("tzprefs." + settings[i])) {
                //bool fields need special treatment
                if (this.boolSettings.indexOf(settings[i]) == -1) {
                    //Not BOOL
                    document.getElementById("tzprefs." + settings[i]).value = tzPush.db.getAccountSetting(tzprefs.selectedAccount, settings[i]);
                } else {
                    //BOOL
                    if (tzPush.db.getAccountSetting(tzprefs.selectedAccount, settings[i])  == "1") document.getElementById("tzprefs." + settings[i]).checked = true;
                    else document.getElementById("tzprefs." + settings[i]).checked = false;
                }
            }
        }

        //Also load DeviceId
        document.getElementById('deviceId').value = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "deviceId");
    },


    /* * *
    * Run through all defined TzPush settings and if there is a corresponding
    * field in the settings dialog, store its current value.
    */
    saveSettings: function () {
        let settings = tzPush.db.getTableFields("accounts");

        let data = tzPush.db.getAccount(tzprefs.selectedAccount, true); //get a copy of the cache, which can be modified
        for (let i=0; i<settings.length;i++) {
            if (document.getElementById("tzprefs." + settings[i])) {
                //bool fields need special treatment
                if (this.boolSettings.indexOf(settings[i]) == -1) {
                    //Not BOOL
                    data[settings[i]] = document.getElementById("tzprefs." + settings[i]).value;
                } else {
                    //BOOL
                    if (document.getElementById("tzprefs." + settings[i]).checked) data[settings[i]] = "1";
                    else data[settings[i]] = "0";
                }
            }
        }
        
        tzPush.db.setAccount(data);
        parent.tzprefManager.updateAccountName(tzprefs.selectedAccount, data.accountname);
    },


    /* * *
    * Some fields are not protected and can be changed even if the account is connected. Since we
    * do not have (want) another save button for these, they are saved upon change.
    */
    instantSaveSetting: function (field) {
        let setting = field.id.replace("tzprefs.","");
        tzPush.db.setAccountSetting(tzprefs.selectedAccount, setting, field.value);
    },


    stripHost: function () {
        let host = document.getElementById('tzprefs.host').value;
        if (host.indexOf("https://") == 0) {
            host = host.replace("https://","");
            document.getElementById('tzprefs.https').checked = true;
        } else if (host.indexOf("http://") == 0) {
            host = host.replace("http://","");
            document.getElementById('tzprefs.https').checked = false;
        }
        document.getElementById('tzprefs.host').value = host.replace("/","");
    },

    
    /* * *
    * The settings dialog has some static info labels, which needs to be updated
    * from time to time.
    */
    updateFolderList: function () {
/* disable during transition
        //SyncTarget
        let target = tzPush.getSyncTarget(tzprefs.selectedAccount);
        if (target.name === null) {
            document.getElementById('abname').value = tzPush.getLocalizedMessage("not_syncronized");
        } else {
            document.getElementById('abname').value = target.name + " (" + target.uri + ")";
        }

        //LastSyncTime is stored as string for historic reasons
        let lastError = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "lastError");
        let LastSyncTime = parseInt(tzPush.db.getAccountSetting(tzprefs.selectedAccount, "LastSyncTime"));
        if (lastError) document.getElementById('LastSyncTime').value = tzPush.getLocalizedMessage("error." + lastError);
        else {
            if (isNaN(LastSyncTime) || LastSyncTime == 0) {
                document.getElementById('LastSyncTime').value = "-";
            } else {
                let d = new Date(parseInt(LastSyncTime));
                document.getElementById('LastSyncTime').value = d.toString();
            }
        } */
    },


    /* * *
    * Disable/Enable input fields and buttons according to the current connection state
    */
    updateGui: function () {
        let state = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "state"); //connecting, connected, disconnected
        let conBtn = document.getElementById('tzprefs.connectbtn');
        conBtn.label = tzPush.getLocalizedMessage("state."+state); 
        
        //disable connect/disconnect btn during state toggle
        document.getElementById('tzprefs.connectbtn').disabled = (state == "connecting");

        //disable all seetings field, if connected
        for (let i=0; i<this.protectedSettings.length;i++) {
            document.getElementById("tzprefs." + this.protectedSettings[i]).disabled = (state != "disconnected");
        }

        //disable all protected buttons, if not connected
        for (let i=0; i<this.protectedButtons.length;i++) {
            document.getElementById("tzprefs." + this.protectedButtons[i]).disabled = (state != "connected");
        }
        
        //get latest error
        let error = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "status");
        document.getElementById('syncstate').value = tzPush.getLocalizedMessage("error." + error);

    },


    /* * *
    * This function is executed, when the user hits the connect/disconnet button. On disconnect, all
    * sync targets are deleted and the settings can be changed again. On connect, the settings are
    * stored and a new sync is initiated.
    */
    toggleConnectionState: function () {
        //ignore cancel request, if button is disabled
        if (document.getElementById('tzprefs.connectbtn').disabled) return;

        let state = tzPush.db.getAccountSetting(tzprefs.selectedAccount, "state"); //connecting, connected, disconnected
        if (state == "connected") {
            //we are connected and want to disconnect
            tzPush.disconnectAccount(tzprefs.selectedAccount);
            tzprefs.updateGui();
            //tzprefs.updateFolderList();
            parent.tzprefManager.updateAccountStatus(tzprefs.selectedAccount);
        } else if (state == "disconnected") {
            //we are disconnected and want to connected
            tzPush.connectAccount(tzprefs.selectedAccount);
            tzprefs.updateGui();
            tzprefs.saveSettings();
            tzprefs.requestSync("sync", tzprefs.selectedAccount);
        }
    },


    /* * *
    * Observer to catch changing syncstate and to update the status info.
    */
    setPrefInfoObserver: {
        observe: function (aSubject, aTopic, aData) {
            //aData is <accountID>.<human readable msg>
            let data = aData.split(".");
            let account = data.shift();
            let msg = data.join(".");
            
            if (account == tzprefs.selectedAccount) {
                //update syncstate field
                document.getElementById('syncstate').value = msg;
            }
        }
    },



    /* * *
    * Observer to catch a started sync job
    */
    accountSyncStartedObserver: {
        observe: function (aSubject, aTopic, aData) {
            //Only observe actions for the active account
            if (aData == tzprefs.selectedAccount) {
                // Not used at the moment
            }
        }
    },


    /* * *
    * Observer to catch a finished sync job and do visual error handling (only if settings window is open)
    */
    accountSyncFinishedObserver: {
        observe: function (aSubject, aTopic, aData) {
            //aData is of the following type
            //[<accountID>,<status>]
            let data = aData.split(".");
            let account = data[0];
            let status = data[1];

            //Only observe actions for the active account
            if (account == tzprefs.selectedAccount) {

                switch (status) {
                    case "401":
                        window.openDialog("chrome://tzpush/content/password.xul", "passwordprompt", "centerscreen,chrome,resizable=no", "Set password for TzPush account " + account, account);
                        break;
                    case "OK":
                        break;
                    default:
                        alert(tzPush.getLocalizedMessage("error." + status));
                }
                //tzprefs.updateFolderList();
                tzprefs.updateGui();
                parent.tzprefManager.updateAccountStatus(tzprefs.selectedAccount);
            }
        }
    },


    /* * *
    * Address book listener to catch if the synced address book (sync target) has been renamed
    * or deleted, so the corresponding labels can be updated. For simplicity, we do not check,
    * if the modified book belongs to the current account - we update on any change.
    */
    addressbookListener: {

        onItemPropertyChanged: function addressbookListener_onItemPropertyChanged(aItem, aProperty, aOldValue, aNewValue) {
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                //tzprefs.updateFolderList();
            }
        },

        onItemRemoved: function addressbookListener_onItemRemoved (aParentDir, aItem) {
            if (aItem instanceof Components.interfaces.nsIAbDirectory) {
                //tzprefs.updateFolderList();
            }
        },

        add: function addressbookListener_add () {
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .addAddressBookListener(tzprefs.addressbookListener, Components.interfaces.nsIAbListener.all);
        },

        remove: function addressbookListener_remove () {
            Components.classes["@mozilla.org/abmanager;1"]
                .getService(Components.interfaces.nsIAbManager)
                .removeAddressBookListener(tzprefs.addressbookListener);
        }
    }

};
