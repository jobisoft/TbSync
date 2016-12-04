/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */

"use strict";

if (typeof tzpush === "undefined") {
    var tzpush = {};
}


var tzpush = {

    prefbranch: "tzpush.",
    prefs: Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush."),
    _bundle: Components.classes["@mozilla.org/intl/stringbundle;1"].getService(Components.interfaces.nsIStringBundleService).createBundle("chrome://tzpush/locale/statusstrings"),

    getLocalizedMessage: function(msg) {
        return this._bundle.GetStringFromName(msg);
    },

    myDump: function(what, aMessage) {
        var consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
        consoleService.logStringMessage(what + " : " + aMessage);
    },

    onMenuItemCommand: function() {
        window.open("chrome://tzpush/content/pref.xul", "", "chrome,centerscreen,resizable,toolbar", null, null);
    },

    reststatus: function() {
        this.prefs.setCharPref("syncstate", "alldone");
    },

    checkgo: function() {
        if (this.prefs.getCharPref("syncstate") === "alldone")
            this.go();
    },

    go: function() {
        var syncing = this.getLocalizedMessage("syncingString");
        this.prefs.setCharPref("syncstate", syncing);
        this.time = this.prefs.getCharPref("LastSyncTime") / 1000;
        this.time2 = (Date.now() / 1000) - 1;

        if (this.prefs.getBoolPref("prov")) {
            this.Polkey();
        } else {
            if (this.prefs.getCharPref("synckey") === '') {
                this.GetFolderId();
            } else {
                this.fromzpush();
            }
        }
    },

/*    changesep: function show() {
        var state = this.prefs.getBoolPref("selectseperator");
        if (state) {
            this.prefs.setCharPref("seperator", ", ");
        } else {
            this.prefs.setCharPref("seperator", "\n");
        }
    }, */


    ToContacts: ({
        //0x89:'Anniversary',
        0x46: 'AssistantName',
        0x47: 'AssistantPhoneNumber',
        //0x94:'Birthday',
        0x97: 'BirthYear',
        0x96: 'BirthMonth',
        0x95: 'BirthDay',
        //0x93:'Anniversaryday',
        0x92: 'AnniversaryYear',
        0x91: 'AnniversaryMonth',
        0x90: 'AnniversaryDay',
        //0x0A:'<BodySize>',
        //0x0B:'<BodyTruncated>',
        0x4C: 'Business2PhoneNumber',
        0x4D: 'WorkCity',
        0x4E: 'WorkCountry',
        0x4F: 'WorkZipCode',
        0x50: 'WorkState',
        0x51: 'WorkAddress',
        0x98: 'WorkAddress2',
        0x52: 'BusinessFaxNumber',
        0x53: 'WorkPhone',
        0x54: 'CarPhoneNumber',
        //0x55:'<Categories>',
        0x56: 'Category',
        0x57: 'Children',
        0x58: 'Child',
        0x59: 'Company',
        0x5A: 'Department',
        0x5B: 'PrimaryEmail',
        0x5C: 'SecondEmail',
        0x5D: 'Email3Address',
        0x5E: 'DisplayName',
        0x5F: 'FirstName',
        0x60: 'Home2PhoneNumber',
        0x61: 'HomeCity',
        0x62: 'HomeCountry',
        0x63: 'HomeZipCode',
        0x64: 'HomeState',
        0x65: 'HomeAddress',
        0x99: 'HomeAddress2',
        0x66: 'FaxNumber',
        0x67: 'HomePhone',
        0x68: 'JobTitle',
        0x69: 'LastName',
        0x6A: 'MiddleName',
        0x6B: 'CellularNumber',
        0x6C: 'OfficeLocation',
        0x6D: 'OtherAddressCity',
        0x6E: 'OtherAddressCountry',
        0x6F: 'OtherAddressPostalCode',
        0x70: 'OtherAddressState',
        0x71: 'OtherAddressStreet',
        0x72: 'PagerNumber',
        0x73: 'RadioPhoneNumber',
        0x74: 'Spouse',
        0x75: 'Suffix',
        0x76: 'Title',
        0x77: 'WebPage1',
        0x78: 'YomiCompanyName',
        0x79: 'YomiFirstName',
        0x7A: 'YomiLastName',
        //0x7C:'<Picture>',
        0x7D: 'Alias',
        0x7E: '<WeightedRank>',
        0x49: 'Notes'
    }),


    ToContacts2: {
        0x45: 'CustomerId',
        0x46: 'GovernmentId',
        0x47: 'IMAddress',
        0x48: 'IMAddress2',
        0x49: 'IMAddress3',
        0x4A: 'ManagerName',
        0x4B: 'CompanyMainPhone',
        0x4C: 'AccountName',
        0x4D: 'NickName',
        0x4E: 'MMS'
    },

    Contacts22: {
        'CustomerId': 0x45,
        'GovernmentId': 0x46,
        'IMAddress': 0x47,
        'IMAddress2': 0x48,
        'IMAddress3': 0x49,
        'ManagerName': 0x4A,
        'CompanyMainPhone': 0x4B,
        'AccountName': 0x4C,
        'NickName': 0x4D,
        'MMS': 0x4E
    },

    Polkey: function() {
        var polkey = this.prefs.getCharPref("polkey");
        if (isNaN(polkey)) {
            polkey = 0;
        }
        if (polkey === "0") {

            var wbxml = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x00, 0x0E, 0x45, 0x46, 0x47, 0x48, 0x03, 0x4D, 0x53, 0x2D, 0x57, 0x41, 0x50, 0x2D, 0x50, 0x72, 0x6F, 0x76, 0x69, 0x73, 0x69, 0x6F, 0x6E, 0x69, 0x6E, 0x67, 0x2D, 0x58, 0x4D, 0x4C, 0x00, 0x01, 0x01, 0x01, 0x01);
            if (this.prefs.getCharPref("asversion") !== "2.5") {
                wbxml = wbxml.replace("MS-WAP-Provisioning-XML", "MS-EAS-Provisioning-WBXML");
            }
            var command = "Provision";
            wbxml = this.Send(wbxml, polcallback.bind(this), command);

        } else {
            if (this.prefs.getCharPref("synckey") === '') {
                this.GetFolderId();
            } else {
                this.fromzpush();
            }
        }


        function polcallback(returnedwbxml) {
            wbxml = returnedwbxml;
            polkey = FindPolkey(wbxml);
            this.prefs.setCharPref("polkey", polkey);
            wbxml = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x00, 0x0E, 0x45, 0x46, 0x47, 0x48, 0x03, 0x4D, 0x53, 0x2D, 0x57, 0x41, 0x50, 0x2D, 0x50, 0x72, 0x6F, 0x76, 0x69, 0x73, 0x69, 0x6F, 0x6E, 0x69, 0x6E, 0x67, 0x2D, 0x58, 0x4D, 0x4C, 0x00, 0x01, 0x49, 0x03, 0x50, 0x6F, 0x6C, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x4B, 0x03, 0x31, 0x00, 0x01, 0x01, 0x01, 0x01);
            wbxml = wbxml.replace('PolKeyReplace', polkey);
            command = "Provision";
            wbxml = this.Send(wbxml, polcallback1.bind(this), command);
        }

        function polcallback1(returnedwbxml) {
            wbxml = returnedwbxml;
            polkey = FindPolkey(wbxml);
            this.prefs.setCharPref("polkey", polkey);
            wbxml = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x00, 0x0E, 0x45, 0x46, 0x47, 0x48, 0x03, 0x4D, 0x53, 0x2D, 0x57, 0x41, 0x50, 0x2D, 0x50, 0x72, 0x6F, 0x76, 0x69, 0x73, 0x69, 0x6F, 0x6E, 0x69, 0x6E, 0x67, 0x2D, 0x58, 0x4D, 0x4C, 0x00, 0x01, 0x49, 0x03, 0x50, 0x6F, 0x6C, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x4B, 0x03, 0x31, 0x00, 0x01, 0x01, 0x01, 0x01);
            wbxml = wbxml.replace('PolKeyReplace', polkey);
            command = "Provision";
            wbxml = this.Send(wbxml, polcallback2.bind(this), command);
        }

        function polcallback2(returnedwbxml) {
            wbxml = returnedwbxml;
            polkey = FindPolkey(wbxml);
            this.prefs.setCharPref("polkey", polkey);
            this.GetFolderId();
        }

        function FindPolkey(wbxml) {
            var x = String.fromCharCode(0x49, 0x03); //<PolicyKey> Code Page 14
            var start = wbxml.indexOf(x) + 2;
            var end = wbxml.indexOf(String.fromCharCode(0x00), start);
            polkey = wbxml.substring(start, end);
            return polkey;
        }
    },

    GetFolderId: function() {
        var synckey;
        var folderID;
        var command = 'FolderSync';
        var wbxml = String.fromCharCode(0x03, 0x01, 0x6a, 0x00, 0x00, 0x07, 0x56, 0x52, 0x03, 0x30, 0x00, 0x01, 0x01);

        wbxml = this.Send(wbxml, callback1.bind(this), command);

        function callback1(returnedwbxml) {
            wbxml = returnedwbxml;
            synckey = this.FindKey(wbxml);
            this.prefs.setCharPref("folderSynckey", synckey);
            folderID = this.FindFolder(wbxml, 9);
            if (this.prefs.getCharPref("asversion") === "2.5") {
                wbxml = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x50, 0x03, 0x43, 0x6F, 0x6E, 0x74, 0x61, 0x63, 0x74, 0x73, 0x00, 0x01, 0x4B, 0x03, 0x30, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x01, 0x01, 0x01);
            } else {
                wbxml = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x4B, 0x03, 0x30, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x01, 0x01, 0x01);
            }
            wbxml = wbxml.replace('Id2Replace', folderID);
            command = 'Sync';
            wbxml = this.Send(wbxml, callback2.bind(this), command);
        }

        function callback2(returnedwbxml) {
            wbxml = returnedwbxml;
            synckey = this.FindKey(wbxml);
            this.prefs.setCharPref("synckey", synckey);
            this.prefs.setCharPref("folderID", folderID);
            this.fromzpush();
        }
    },

    fromzpush: function() {
        this.prefs.setCharPref("syncstate", "Requesting Changes");
        var card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
        var moreavilable = 1;
        var folderID = this.prefs.getCharPref("folderID");

        var wbxmlsend = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x4B, 0x03, 0x53, 0x79, 0x6E, 0x63, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x1E, 0x13, 0x55, 0x03, 0x31, 0x30, 0x30, 0x00, 0x01, 0x57, 0x00, 0x11, 0x45, 0x46, 0x03, 0x31, 0x00, 0x01, 0x47, 0x03, 0x32, 0x30, 0x30, 0x30, 0x30, 0x30, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01);
        if (this.prefs.getCharPref("asversion") === "2.5") {
            wbxmlsend = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x50, 0x03, 0x43, 0x6F, 0x6E, 0x74, 0x61, 0x63, 0x74, 0x73, 0x00, 0x01, 0x4B, 0x03, 0x53, 0x79, 0x6E, 0x63, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x1E, 0x13, 0x55, 0x03, 0x31, 0x30, 0x30, 0x00, 0x01, 0x57, 0x5B, 0x03, 0x31, 0x00, 0x01, 0x62, 0x03, 0x30, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01);
        }

        var synckey = this.prefs.getCharPref("synckey");
        var wbxml = wbxmlsend.replace('SyncKeyReplace', synckey);
        wbxml = wbxml.replace('Id2Replace', folderID);

        var command = "Sync";
        this.Send(wbxml, callback.bind(this), command);


        function addphoto(data) {
            var photo = card.getProperty("PhotoName", "");

            Components.utils.import("resource://gre/modules/FileUtils.jsm");
            var dir = FileUtils.getDir("ProfD", ["Photos"], true);

            photo = card.getProperty("ServerId", "") + '.jpg';
            card.setProperty("PhotoName", photo);

            var foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
            var file = Components.classes["@mozilla.org/file/directory_service;1"].getService(Components.interfaces.nsIProperties).get("ProfD", Components.interfaces.nsIFile);
            file.append("Photos");
            file.append(photo);
            foStream.init(file, 0x02 | 0x08 | 0x20, 0x180, 0); // write, create, truncate
            var binary = atob(data);
            foStream.write(binary, binary.length);
            foStream.close();
            card.setProperty("PhotoType", "file");
            var filePath = 'file:///' + file.path.replace(/\\/g, '\/').replace(/^\s*\/?/, '').replace(/\ /g, '%20');
            card.setProperty("PhotoURI", filePath);

            return filePath;
        }

        function callback(returnedwbxml) {
            if (returnedwbxml.length === 0) {
                tzpush.tozpush();
            } else {
                this.prefs.setCharPref("syncstate", "Recieving changes");
                wbxml = returnedwbxml;
                var firstcmd = wbxml.indexOf(String.fromCharCode(0x56));

                var truncwbxml = wbxml;
                if (firstcmd !== -1) {
                    truncwbxml = wbxml.substring(0, firstcmd);
                }

                var n = truncwbxml.lastIndexOf(String.fromCharCode(0x4E, 0x03));
                var n1 = truncwbxml.indexOf(String.fromCharCode(0x00), n);

                var wbxmlstatus = truncwbxml.substring(n + 2, n1);

                if (wbxmlstatus === '3' || wbxmlstatus === '12') {
                    this.myDump("tzpush wbxml status", "wbxml reports " + wbxmlstatus + " should be 1, resyncing");
                    this.prefs.setCharPref("syncstate", "alldone");
                    this.prefs.setCharPref("go", "resync");
                } else if (wbxmlstatus !== '1') {
                    this.myDump("tzpush wbxml status", "server error? " + wbxmlstatus);
                    this.prefs.setCharPref("syncstate", "alldone");
                    this.prefs.setCharPref("go", "alldone");
                } else {
                    synckey = this.FindKey(wbxml);
                    this.prefs.setCharPref("synckey", synckey);
                    var abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
                    var addressBook = abManager.getDirectory(this.prefs.getCharPref("abname"));

                    var stack = [];
                    var num = 4;
                    var data = '';
                    var x = 0;
                    var y;
                    var popval = 2;
                    var moreavilable = 0;
                    var photo;
                    var token;
                    var tokencontent;
                    var temptoken;
                    var year;
                    var month;
                    var day;
                    var Ayear;
                    var Amonth;
                    var Aday;
                    var filePath;
                    var propname;
                    var file1;
                    var file;
                    /* var newCard; */
                    var tmpProp;
                    var modcard;
                    var ServerId;
                    var cardsToDelete;
                    var seperator = this.prefs.getCharPref("seperator");

                    while (num < wbxml.length) {
                        token = wbxml.substr(num, 1);
                        tokencontent = token.charCodeAt(0) & 0xbf;
                        if (token === String.fromCharCode(0x00)) {
                            num = num + 1;
                            x = (wbxml.substr(num, 1)).charCodeAt();
                        } else if (token == String.fromCharCode(0x03)) {
                            temptoken = (wbxml.substr(num - 1, 1)).charCodeAt(0); // & 0xbf

                            data = (wbxml.substring(num + 1, wbxml.indexOf(String.fromCharCode(0x00, 0x01), num)));
                            num = wbxml.indexOf(String.fromCharCode(0x00), num);

                            if (x === 0x01 && temptoken === 0x7C) {
                                filePath = addphoto(data);
                                photo = card.getProperty("ServerId", "") + '.jpg';
                            } else if (x === 0x01 && temptoken === 0x48) {
                                card.setProperty("Birthday", data);
                                if (data.substr(12, 1) !== "00") {
                                    let bd = new Date(data);
                                    bd.setHours(bd.getHours() + 12);
                                    data = bd.toISOString();
                                }
                                year = data.substr(0, 4);
                                month = data.substr(5, 2);
                                day = data.substr(8, 2);
                                card.setProperty("BirthYear", year);
                                card.setProperty("BirthMonth", month);
                                card.setProperty("BirthDay", day);
                            } else if (x === 0x01 && temptoken === 0x45) {
                                card.setProperty("Anniversary", data);
                                if (data.substr(12, 1) !== "00") {
                                    let bd = new Date(data);
                                    bd.setHours(bd.getHours() + 12);
                                    data = bd.toISOString();
                                }
                                Ayear = data.substr(0, 4);
                                Amonth = data.substr(5, 2);
                                Aday = data.substr(8, 2);

                                card.setProperty("AnniversaryYear", Ayear);
                                card.setProperty("AnniversaryMonth", Amonth);
                                card.setProperty("AnniversaryDay", Aday);
                            } else if (x === 0x01 && temptoken === 0x65) {
                                let lines = data.split(seperator);

                                card.setProperty("HomeAddress", lines[0]);
                                if (lines[1] !== undefined) {
                                    card.setProperty("HomeAddress2", lines[1]);
                                }
                            } else if (x === 0x01 && temptoken === 0x51) {
                                let lines = data.split(seperator);

                                card.setProperty("WorkAddress", lines[0]);
                                if (lines[1] !== undefined) {
                                    card.setProperty("WorkAddress2", lines[1]);
                                }

                            } else if (x === 0x11 && temptoken === 0x4B) {
                                card.setProperty("Notes", data);
                            } else if (x === 0x01) {
                                propname = this.ToContacts[temptoken];
                                if (data !== " ") {
                                    card.setProperty(propname, data);
                                }
                            } else if (x === 0x0C) {
                                propname = this.ToContacts2[temptoken];
                                if (data !== " ") {
                                    card.setProperty(propname, data);
                                }
                            } else if (x === 0 && temptoken === 0x4D) {
                                card.setProperty('ServerId', data);
                            }
                        } else if (token === String.fromCharCode(0x01)) {
                            popval = stack.pop();

                            if (popval === 500) {
                                if (photo) {
                                    card.setProperty("PhotoName", photo);
                                    card.setProperty("PhotoType", "file");
                                    card.setProperty("PhotoURI", filePath);
                                    photo = '';
                                }
                                if (this.prefs.getCharPref("go", "") === "firstsync") {
                                    let tempsid;
                                    try {
                                        tempsid = card.getProperty("ServerId", "");
                                    } catch (e) {}

                                    if (!addressBook.getCardFromProperty("ServerId", tempsid, false)) {
                                        if (this.prefs.getBoolPref("displayoverride")) {
                                            card.setProperty("DisplayName", card.getProperty("FirstName", "") + " " + card.getProperty("LastName", ""));
                                        }
                                        /* newCard = */ addressBook.addCard(card);
                                    } else {
                                        ServerId = card.getProperty("ServerId", "");
                                        modcard = addressBook.getCardFromProperty("ServerId", ServerId, false);
                                        for (y in this.Contacts2) {
                                            if (card.getProperty(y, "") !== '') {
                                                tmpProp = card.getProperty(y, "");
                                                modcard.setProperty(y, tmpProp);
                                            } else {
                                                modcard.setProperty(y, "");
                                            }
                                        }
                                        for (y in this.Contacts22) {

                                            if (card.getProperty(y, "") !== '') {
                                                tmpProp = card.getProperty(y, "");
                                                modcard.setProperty(y, tmpProp);
                                            } else {
                                                modcard.setProperty(y, "");
                                            }
                                        }

                                        if (photo) {
                                            modcard.setProperty("PhotoName", photo);
                                            modcard.setProperty("PhotoType", "file");
                                            modcard.setProperty("PhotoURI", filePath);
                                            photo = '';
                                        }
                                        if (this.prefs.getBoolPref("displayoverride")) {
                                            modcard.setProperty("DisplayName", modcard.getProperty("FirstName", "") + " " + modcard.getProperty("LastName", ""));
                                        }

                                        /* newCard = */ addressBook.modifyCard(modcard);
                                        card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
                                    }

                                } else {
                                    if (this.prefs.getBoolPref("displayoverride")) {
                                        card.setProperty("DisplayName", card.getProperty("FirstName", "") + " " + card.getProperty("LastName", ""));
                                    }
                                    /* newCard = */ addressBook.addCard(card);
                                }

                                card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);

                            } else if (popval === 600) {

                                card = addressBook.getCardFromProperty("ServerId", data, false);
                                if (card !== null) {

                                    cardsToDelete = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
                                    cardsToDelete.appendElement(card, "");

                                    try {
                                        addressBook.deleteCards(cardsToDelete);
                                    } catch (e) {}
                                    card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
                                    Components.utils.import("resource://gre/modules/FileUtils.jsm");
                                    file1 = FileUtils.getFile("ProfD", ["DeletedCards"], true);
                                    file1.append(data);
                                    file1.QueryInterface(Components.interfaces.nsIFile);
                                    try {
                                        file1.remove("true");
                                    } catch (e) {}
                                } else {
                                    card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
                                }
                            } else if (popval === 700) {
                                ServerId = card.getProperty("ServerId", "");
                                modcard = addressBook.getCardFromProperty("ServerId", ServerId, false);
                                if (modcard === null) {
                                    break;
                                }

                                for (y in this.Contacts2) {
                                    if (card.getProperty(y, "") !== '') {
                                        tmpProp = card.getProperty(y, "");
                                        modcard.setProperty(y, tmpProp);
                                    } else {
                                        modcard.setProperty(y, "");
                                    }
                                }

                                for (y in this.Contacts22) {
                                    if (card.getProperty(y, "") !== '') {
                                        tmpProp = card.getProperty(y, "");
                                        modcard.setProperty(y, tmpProp);
                                    } else {
                                        modcard.setProperty(y, "");
                                    }
                                }

                                if (photo) {
                                    modcard.setProperty("PhotoName", photo);
                                    modcard.setProperty("PhotoType", "file");
                                    modcard.setProperty("PhotoURI", filePath);
                                    photo = '';
                                }
                                if (this.prefs.getBoolPref("displayoverride")) {
                                    modcard.setProperty("DisplayName", modcard.getProperty("FirstName", "") + " " + modcard.getProperty("LastName", ""));
                                }
                                /* newCard = */ addressBook.modifyCard(modcard);

                                card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
                            }

                        } else if (tokencontent === 7 & x === 0) {
                            stack.push(500);
                        } else if (tokencontent === 9 & x === 0) {
                            stack.push(600);
                        } else if (tokencontent === 8 & x === 0) {
                            stack.push(700);
                        } else if (token.charCodeAt(0) === 0x14 && x === 0) {
                            moreavilable = 1;
                        } else if (tokencontent) {
                            if (token.charCodeAt(0) > 64) {
                                stack.push(tokencontent);
                            }
                        }
                        num = num + 1;
                    }
                    if (moreavilable === 1) {
                        wbxml = wbxmlsend.replace('SyncKeyReplace', synckey);
                        wbxml = wbxml.replace('Id2Replace', folderID);
                        command = "Sync";
                        this.Send(wbxml, callback.bind(this), command);
                    } else if (this.prefs.getBoolPref("downloadonly")) {
                        this.prefs.setCharPref("LastSyncTime", Date.now());
                        this.prefs.setCharPref("syncstate", "alldone");
                        this.prefs.setCharPref("go", "alldone");
                    } else {
                        this.tozpush();
                    }
                }
            }
        }

    },

    tozpush: function() {
        this.prefs.setCharPref("syncstate", "Sending changes");
        var folderID = this.prefs.getCharPref("folderID");
        var synckey = this.prefs.getCharPref("synckey");

        var wbxmlouter = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x4B, 0x03, 0x53, 0x79, 0x6E, 0x63, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x57, 0x5B, 0x03, 0x31, 0x00, 0x01, 0x62, 0x03, 0x30, 0x00, 0x01, 0x01, 0x56, 0x72, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x68, 0x65, 0x72, 0x65, 0x01, 0x01, 0x01, 0x01);
        if (this.prefs.getCharPref("asversion") === "2.5") {
            wbxmlouter = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x50, 0x03, 0x43, 0x6F, 0x6E, 0x74, 0x61, 0x63, 0x74, 0x73, 0x00, 0x01, 0x4B, 0x03, 0x53, 0x79, 0x6E, 0x63, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x57, 0x5B, 0x03, 0x31, 0x00, 0x01, 0x62, 0x03, 0x30, 0x00, 0x01, 0x01, 0x56, 0x72, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x68, 0x65, 0x72, 0x65, 0x01, 0x01, 0x01, 0x01);
        }

        var wbxml = '';
        var abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        var addressBook = abManager.getDirectory(this.prefs.getCharPref("abname"));
        var x;
        var birthd;
        var birthm;
        var birthy;
        var birthymd;
        var annd;
        var annm;
        var anny;
        var annymd;
        var haddressline;
        var haddressline1;
        var haddressline2;
        var waddressline;
        var waddressline1;
        var waddressline2;
        var newcards;
        var count = 0;
        var numofcards = 0;
        var cardArr = [];
        var mbd = 0;
        var ambd = 0;
        var addresslinecount = 0;
        var wbxmlinner;
        var command;
        var card;
        var maxnumbertosend = parseInt(this.prefs.getCharPref("maxnumbertosend"));
        var morecards = false;
        var seperator = this.prefs.getCharPref("seperator"); // default is " ," can be changed to "/n"
        var cards = addressBook.childCards;

        while (cards.hasMoreElements()) {
            card = cards.getNext();

            if (numofcards === maxnumbertosend) {
                morecards = true;
                break;
            }

            if (card instanceof Components.interfaces.nsIAbCard) {
                if (card.getProperty('ServerId', '') === '' && !card.isMailList) {
                    card.setProperty('localId', card.localId);
                    /* var newCard = */ addressBook.modifyCard(card);
                    numofcards = numofcards + 1;
                    wbxml = wbxml + String.fromCharCode(0x47, 0x4C, 0x03) + card.localId + String.fromCharCode(0x00, 0x01, 0x5D, 0x00, 0x01);
                    for (x in this.Contacts2) {
                        if (x === 'HomeAddress' || x === 'HomeAddress2' || x === 'WorkAddress' || x === 'WorkAddress2') {


                            switch (x) {
                                // has to stuff to stop sending empty address
                                case "HomeAddress":
                                    haddressline1 = card.getProperty(x, "");
                                    break;
                                case "HomeAddress2":
                                    haddressline2 = card.getProperty(x, "");
                                    if (haddressline2 === '') {
                                        haddressline = haddressline1;
                                    } else {
                                        haddressline = haddressline1 + seperator + haddressline2;
                                    }

                                    if (haddressline.length !== 0) { //if address is empty do not send
                                        wbxml = wbxml + String.fromCharCode(0x65) + String.fromCharCode(0x03) + utf8Encode(haddressline) + String.fromCharCode(0x00, 0x01);
                                    }
                                    break;

                                case "WorkAddress":
                                    waddressline1 = card.getProperty(x, "");
                                    break;
                                case "WorkAddress2":
                                    waddressline2 = card.getProperty(x, "");
                                    if (waddressline2 === '') {
                                        waddressline = waddressline1;
                                    } else {
                                        waddressline = waddressline1 + seperator + waddressline2;
                                    }
                                    if (waddressline.length !== 0) { //if address is empty do not send
                                        wbxml = wbxml + String.fromCharCode(0x51) + String.fromCharCode(0x03) + utf8Encode(waddressline) + String.fromCharCode(0x00, 0x01);
                                    }
                                    break;
                            }

                        } else if (card.getProperty(x, "") !== '') {

                            if (x === 'BirthYear' || x === 'BirthMonth' || x === 'BirthDay') {

                                if (x === 'BirthYear') {
                                    birthy = card.getProperty(x, "");
                                    mbd = mbd + 1;
                                } else if (x === 'BirthMonth') {
                                    birthm = card.getProperty(x, "");
                                    mbd = mbd + 1;
                                } else if (x === 'BirthDay') {
                                    birthd = card.getProperty(x, "");
                                    mbd = mbd + 1;
                                }
                                if (mbd === 3) {
                                    birthymd = birthy + "-" + birthm + "-" + birthd + "T00:00:00.000Z";
                                    mbd = 0;
                                    if (this.prefs.getBoolPref("birthday") === true) {
                                        wbxml = wbxml + String.fromCharCode(0x48) + String.fromCharCode(0x03) + birthymd + String.fromCharCode(0x00, 0x01);
                                    }
                                }
                            } else if (x === 'AnniversaryYear' || x === 'AnniversaryMonth' || x === 'AnniversaryDay') {

                                if (x === 'AnniversaryYear') {
                                    anny = card.getProperty(x, "");
                                    ambd = ambd + 1;
                                } else if (x === 'AnniversaryMonth') {
                                    annm = card.getProperty(x, "");
                                    ambd = ambd + 1;
                                } else if (x === 'AnniversaryDay') {
                                    annd = card.getProperty(x, "");
                                    ambd = ambd + 1;
                                }
                                if (ambd === 3) {
                                    annymd = anny + "-" + annm + "-" + annd + "T00:00:00.000Z";
                                    ambd = 0;
                                    if (this.prefs.getBoolPref("birthday") === true) {
                                        wbxml = wbxml + String.fromCharCode(0x45) + String.fromCharCode(0x03) + annymd + String.fromCharCode(0x00, 0x01);
                                    }
                                }
                            } else if (x === 'Category') {
                                let cat = String.fromCharCode(0x55, 0x56, 0x3, 0x72, 0x65, 0x70, 0x6c, 0x61, 0x63, 0x65, 0x6d, 0x65, 0x0, 0x1, 0x1);
                                cat = cat.replace("replaceme", utf8Encode(card.getProperty(x, '')));
                                wbxml = wbxml + cat;
                            } else if (x === 'Notes') {
                                if (this.prefs.getCharPref("asversion") === "2.5") {
                                    wbxml = wbxml + String.fromCharCode(0x49) + String.fromCharCode(0x03) + utf8Encode(card.getProperty(x, "")) + String.fromCharCode(0x00, 0x01, 0x00, 0x01);
                                } else {
                                    let body = String.fromCharCode(0x00, 0x11, 0x4a, 0x46, 0x03, 0x31, 0x00, 0x01, 0x4c, 0x03, 0x37, 0x00, 0x01, 0x4b, 0x03, 0x72, 0x65, 0x70, 0x6c, 0x61, 0x63, 0x65, 0x00, 0x01, 0x01, 0x00, 0x01);
                                    body = body.replace("replace", utf8Encode(card.getProperty(x, '')));
                                    body = body.replace("7", card.getProperty(x, '').length);
                                    wbxml = wbxml + body;
                                }
                            } else {
                                wbxml = wbxml + String.fromCharCode(this.Contacts2[x]) + String.fromCharCode(0x03) + utf8Encode(card.getProperty(x, '')) + String.fromCharCode(0x00, 0x01);
                            }
                        }
                    }

                    cardArr.push(card);
                    for (x in this.Contacts22) {
                        if (card.getProperty(x, "") !== '') {
                            wbxml = wbxml + String.fromCharCode(0x00, 0x0C) + String.fromCharCode(this.Contacts22[x]) + String.fromCharCode(0x03) + utf8Encode(card.getProperty(x, '')) + String.fromCharCode(0x00, 0x01);
                        }
                    }
                    wbxml = wbxml + String.fromCharCode(0x01, 0x01, 0x00, 0x00);
                }
            }
            newcards = numofcards;
        }

        cards = addressBook.childCards;

        while (cards.hasMoreElements()) {

            if (numofcards === maxnumbertosend) {
                morecards = true;
                break;
            }
            card = cards.getNext();
            if (card instanceof Components.interfaces.nsIAbCard) {


                if (card.getProperty("LastModifiedDate", "") > this.time && card.getProperty("LastModifiedDate", "") < this.time2 && card.getProperty("ServerId", "") !== "") {

                    numofcards = numofcards + 1;
                    if (card.getProperty("ServerId", "") === "dontsend") {
                        card.setProperty("ServerId", "");
                        addressBook.modifyCard(card);
                        morecards = true;
                    } else {
                        addressBook.modifyCard(card);
                        wbxml = wbxml + String.fromCharCode(0x48, 0x4D, 0x03) + card.getProperty("ServerId", "") + String.fromCharCode(0x00, 0x01, 0x5D, 0x00, 0x01);
                        for (x in this.Contacts2) {
                            if (x === 'HomeAddress' || x === 'HomeAddress2' || x === 'WorkAddress' || x === 'WorkAddress2') {

                                switch (x) {
                                    // has to stuff to stop sending empty address
                                    case "HomeAddress":
                                        haddressline1 = card.getProperty(x, "");
                                        break;
                                    case "HomeAddress2":
                                        haddressline2 = card.getProperty(x, "");
                                        if (haddressline2 === '') {
                                            haddressline = haddressline1;
                                        } else {
                                            haddressline = haddressline1 + seperator + haddressline2;
                                        }
                                        if (haddressline.length !== 0) { //if address is empty do not send
                                            wbxml = wbxml + String.fromCharCode(0x65) + String.fromCharCode(0x03) + utf8Encode(haddressline) + String.fromCharCode(0x00, 0x01);
                                        }
                                        break;

                                    case "WorkAddress":
                                        waddressline1 = card.getProperty(x, "");
                                        break;
                                    case "WorkAddress2":
                                        waddressline2 = card.getProperty(x, "");
                                        if (waddressline2 === '') {
                                            waddressline = waddressline1;
                                        } else {
                                            waddressline = waddressline1 + seperator + waddressline2;
                                        }
                                        if (waddressline.length !== 0) { //if address is empty do not send
                                            wbxml = wbxml + String.fromCharCode(0x51) + String.fromCharCode(0x03) + utf8Encode(waddressline) + String.fromCharCode(0x00, 0x01);
                                        }
                                        break;
                                }

                            } else if (card.getProperty(x, "") !== '') {
                                if (x === 'BirthYear' || x === 'BirthMonth' || x === 'BirthDay') {

                                    if (x === 'BirthYear') {
                                        birthy = card.getProperty(x, "");
                                        mbd = mbd + 1;
                                    } else if (x === 'BirthMonth') {
                                        birthm = card.getProperty(x, "");
                                        mbd = mbd + 1;
                                    } else if (x === 'BirthDay') {
                                        birthd = card.getProperty(x, "");
                                        mbd = mbd + 1;
                                    }
                                    if (mbd === 3) {
                                        birthymd = birthy + "-" + birthm + "-" + birthd + "T00:00:00.000Z";
                                        mbd = 0;
                                        if (this.prefs.getBoolPref("birthday") === true) {
                                            wbxml = wbxml + String.fromCharCode(0x48) + String.fromCharCode(0x03) + birthymd + String.fromCharCode(0x00, 0x01);
                                        }
                                    }
                                } else if (x === 'AnniversaryYear' || x === 'AnniversaryMonth' || x === 'AnniversaryDay') {

                                    if (x === 'AnniversaryYear') {
                                        anny = card.getProperty(x, "");
                                        ambd = ambd + 1;
                                    } else if (x === 'AnniversaryMonth') {
                                        annm = card.getProperty(x, "");
                                        ambd = ambd + 1;
                                    } else if (x === 'AnniversaryDay') {
                                        annd = card.getProperty(x, "");
                                        ambd = ambd + 1;
                                    }
                                    if (ambd === 3) {
                                        annymd = anny + "-" + annm + "-" + annd + "T00:00:00.000Z";
                                        ambd = 0;

                                        if (this.prefs.getBoolPref("birthday") === true) {
                                            wbxml = wbxml + String.fromCharCode(0x45) + String.fromCharCode(0x03) + annymd + String.fromCharCode(0x00, 0x01);
                                        }
                                    }
                                } else if (x === 'Category') {
                                    let cat = String.fromCharCode(0x55, 0x56, 0x3, 0x72, 0x65, 0x70, 0x6c, 0x61, 0x63, 0x65, 0x6d, 0x65, 0x0, 0x1, 0x1);
                                    cat = cat.replace("replaceme", utf8Encode(card.getProperty(x, '')));
                                    wbxml = wbxml + cat;
                                } else if (x === 'Notes') {
                                    if (this.prefs.getCharPref("asversion") === "2.5") {
                                        wbxml = wbxml + String.fromCharCode(0x49) + String.fromCharCode(0x03) + utf8Encode(card.getProperty(x, "")) + String.fromCharCode(0x00, 0x01, 0x00, 0x01);
                                    } else {
                                        let body = String.fromCharCode(0x00, 0x11, 0x4a, 0x46, 0x03, 0x31, 0x00, 0x01, 0x4c, 0x03, 0x37, 0x00, 0x01, 0x4b, 0x03, 0x72, 0x65, 0x70, 0x6c, 0x61, 0x63, 0x65, 0x00, 0x01, 0x01, 0x00, 0x01);
                                        body = body.replace("replace", utf8Encode(card.getProperty(x, '')));
                                        body = body.replace("7", card.getProperty(x, '').length);
                                        wbxml = wbxml + body;
                                    }
                                } else {
                                    wbxml = wbxml + String.fromCharCode(this.Contacts2[x]) + String.fromCharCode(0x03) + utf8Encode(card.getProperty(x, '')) + String.fromCharCode(0x00, 0x01);
                                }
                            }

                        }
                        for (x in this.Contacts22) {
                            if (card.getProperty(x, "") !== '') {
                                wbxml = wbxml + String.fromCharCode(0x00, 0x0C) + String.fromCharCode(this.Contacts22[x]) + String.fromCharCode(0x03) + utf8Encode(card.getProperty(x, '')) + String.fromCharCode(0x00, 0x01);
                            }
                        }
                        wbxml = wbxml + String.fromCharCode(0x01, 0x01, 0x00, 0x00);
                    }
                }
            }
        }

        if (numofcards !== 0) {
            wbxmlinner = wbxml;
            wbxml = wbxmlouter.replace('replacehere', wbxmlinner);
            wbxml = wbxml.replace('SyncKeyReplace', synckey);
            wbxml = wbxml.replace('Id2Replace', folderID);
            command = "Sync";
            wbxml = this.Send(wbxml, callback.bind(this), command);
        } else {
            this.senddel();
        }


        function callback(returnedwbxml) {
            wbxml = returnedwbxml;
            var firstcmd = wbxml.indexOf(String.fromCharCode(0x01, 0x46));

            var truncwbxml = wbxml;
            if (firstcmd !== -1) {
                truncwbxml = wbxml.substring(0, firstcmd);
            }

            var n = truncwbxml.lastIndexOf(String.fromCharCode(0x4E, 0x03));
            var n1 = truncwbxml.indexOf(String.fromCharCode(0x00), n);

            var wbxmlstatus = truncwbxml.substring(n + 2, n1);

            if (wbxmlstatus === '3' || wbxmlstatus === '12') {
                this.myDump("tzpush wbxml status", "wbxml reports " + wbxmlstatus + " should be 1, resyncing");
                this.prefs.setCharPref("syncstate", "alldone");
                this.prefs.setCharPref("go", "resync");

            } else if (wbxmlstatus !== '1') {
                this.myDump("tzpush wbxml status", "server error? " + wbxmlstatus);
                this.prefs.setCharPref("syncstate", "alldone");
                this.prefs.setCharPref("go", "alldone");
            } else {
                this.prefs.setCharPref("syncstate", "Adding new serverid");

                var count = 0;
                synckey = this.FindKey(wbxml);
                this.prefs.setCharPref("synckey", synckey);

                var oParser = Components.classes["@mozilla.org/xmlextras/domparser;1"].createInstance(Components.interfaces.nsIDOMParser);
                var oDOM = oParser.parseFromString(tzpush.toxml(wbxml), "text/xml");
                addressBook = abManager.getDirectory(this.prefs.getCharPref("abname"));


                var add = oDOM.getElementsByTagName("Add");
                if (add.length !== 0) {
                    for (count = 0; count < add.length; count++) {
                        var inadd = add[count];

                        let tag = inadd.getElementsByTagName("ServerId");
                        let ServerId = "dontsend";
                        if (tag.length > 0) ServerId = tag[0].childNodes[0].nodeValue;

                        tag = inadd.getElementsByTagName("ClientId");
                        let ClientId = tag[0].childNodes[0].nodeValue;

                        try {
                            let addserverid = addressBook.getCardFromProperty("localId", ClientId, false);
                            addserverid.setProperty('ServerId', ServerId);
                            /* var newCard = */ addressBook.modifyCard(addserverid);
                        } catch (e) {
                            this.myDump("tzpush error", e);
                        }
                    }
                }


                var change = oDOM.getElementsByTagName("Change");
                if (change.length !== 0) {
                    for (count = 0; count < change.length; count++) {
                        let inchange = change[count];
                        let tag = inchange.getElementsByTagName("Status");

                        let status = "1";
                        try {
                            status = tag[0].childNodes[0].nodeValue;
                        } catch (e) { }

                        if (status !== "1") {
                            try {
                                tag = inchange.getElementsByTagName("ServerId");
                                let ServerId = tag[0].childNodes[0].nodeValue;
                                let addserverid = addressBook.getCardFromProperty('ServerId', ServerId, false);
                                addserverid.setProperty('ServerId', '');
                                /* newCard = */ addressBook.modifyCard(addserverid);
                                morecards = true;
                            } catch (e) {
                                this.myDump("tzpush error", e);
                            }
                        }
                    }

                }
                if (morecards) {
                    this.tozpush();
                } else {
                    this.senddel();
                }
            }
        }


        function utf8Encode(string) {
            var appInfo = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo);
            var platformVer = appInfo.platformVersion;
            if (platformVer >= 50) {
                return string;
            } else {
                string = string.replace(/\r\n/g, "\n");
                var utf8string = "";
                for (var n = 0; n < string.length; n++) {
                    var c = string.charCodeAt(n);
                    if (c < 128) {
                        utf8string += String.fromCharCode(c);
                    } else if ((c > 127) && (c < 2048)) {
                        utf8string += String.fromCharCode((c >> 6) | 192);
                        utf8string += String.fromCharCode((c & 63) | 128);
                    } else {
                        utf8string += String.fromCharCode((c >> 12) | 224);
                        utf8string += String.fromCharCode(((c >> 6) & 63) | 128);
                        utf8string += String.fromCharCode((c & 63) | 128);
                    }
                }
                return utf8string;

            }
        }



    },

    senddel: function() {
        this.prefs.setCharPref("syncstate", "Sending items to delete");
        var folderID = this.prefs.getCharPref("folderID");
        var synckey = this.prefs.getCharPref("synckey");

        var wbxmlouter = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x4B, 0x03, 0x53, 0x79, 0x6E, 0x63, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x57, 0x5B, 0x03, 0x31, 0x00, 0x01, 0x62, 0x03, 0x30, 0x00, 0x01, 0x01, 0x56, 0x72, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x68, 0x65, 0x72, 0x65, 0x01, 0x01, 0x01, 0x01);
        if (this.prefs.getCharPref("asversion") === "2.5") {
            wbxmlouter = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x50, 0x03, 0x43, 0x6F, 0x6E, 0x74, 0x61, 0x63, 0x74, 0x73, 0x00, 0x01, 0x4B, 0x03, 0x53, 0x79, 0x6E, 0x63, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x57, 0x5B, 0x03, 0x31, 0x00, 0x01, 0x62, 0x03, 0x30, 0x00, 0x01, 0x01, 0x56, 0x72, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x68, 0x65, 0x72, 0x65, 0x01, 0x01, 0x01, 0x01);
        }

        var wbxml = '';
        var numofdel = 0;
        var entry;
        var deletedcards;
        var wbxmlinner;
        var more = false;
        var command;
        var maxnumbertosend = parseInt(this.prefs.getCharPref("maxnumbertosend"));

        Components.utils.import("resource://gre/modules/FileUtils.jsm");
        var file = FileUtils.getFile("ProfD", ["DeletedCards"], true);
        var entries = file.directoryEntries;
        var cardstodelete = [];
        while (entries.hasMoreElements()) {
            if (numofdel === maxnumbertosend) {
                more = true;
                break;
            }
            numofdel = numofdel + 1;

            entry = entries.getNext();
            entry.QueryInterface(Components.interfaces.nsIFile);
            deletedcards = entry.leafName;

            cardstodelete.push(deletedcards);
            deletedcards = deletedcards.replace("COLON", ":");
            wbxml = wbxml + String.fromCharCode(0x49, 0x4D, 0x03) + deletedcards + String.fromCharCode(0x00, 0x01, 0x01);
        }
        wbxmlinner = wbxml;
        wbxml = wbxmlouter.replace('replacehere', wbxmlinner);
        wbxml = wbxml.replace('SyncKeyReplace', synckey);
        wbxml = wbxml.replace('Id2Replace', folderID);
        if (numofdel > 0) {
            command = "Sync";
            var returned = this.Send(wbxml, callback.bind(this), command);
        } else {
            this.prefs.setCharPref("LastSyncTime", Date.now());
            this.prefs.setCharPref("syncstate", "alldone");
            this.prefs.setCharPref("go", "alldone");
        }

        function callback(returnedwbxml) {
            wbxml = returnedwbxml;
            var firstcmd = wbxml.indexOf(String.fromCharCode(0x01, 0x46));

            var truncwbxml = wbxml;
            if (firstcmd !== -1) truncwbxml = wbxml.substring(0, firstcmd);

            var n = truncwbxml.lastIndexOf(String.fromCharCode(0x4E, 0x03));
            var n1 = truncwbxml.indexOf(String.fromCharCode(0x00), n);
            var wbxmlstatus = truncwbxml.substring(n + 2, n1);

            if (wbxmlstatus === '3' || wbxmlstatus === '12') {
                this.myDump("tzpush wbxml status", "wbxml reports " + wbxmlstatus + " should be 1, resyncing");
                this.prefs.setCharPref("syncstate", "alldone");
                this.prefs.setCharPref("go", "resync");
            } else if (wbxmlstatus !== '1') {
                this.myDump("tzpush wbxml status", "server error? " + wbxmlstatus);
                this.prefs.setCharPref("syncstate", "alldone");
                this.prefs.setCharPref("go", "alldone");
            } else {
                synckey = this.FindKey(wbxml);
                this.prefs.setCharPref("synckey", synckey);
                for (var count in cardstodelete) {
                    this.prefs.setCharPref("syncstate", "Cleaning up deleted items");
                    var file = FileUtils.getDir("ProfD", ["DeletedCards"], true);
                    file.append(cardstodelete[count]);
                    file.remove("true");
                }

                if (more) {
                    this.senddel();
                } else {
                    this.prefs.setCharPref("LastSyncTime", Date.now());
                    this.prefs.setCharPref("syncstate", "alldone");
                    this.prefs.setCharPref("go", "alldone");
                }
            }
        }
    },



    FindKey: function(wbxml) {
        var x = String.fromCharCode(0x4b, 0x03); //<SyncKey> Code Page 0
        if (wbxml.substr(5, 1) === String.fromCharCode(0x07)) {
            x = String.fromCharCode(0x52, 0x03); //<SyncKey> Code Page 7
        }

        var start = wbxml.indexOf(x) + 2;
        var end = wbxml.indexOf(String.fromCharCode(0x00), start);
        var synckey = wbxml.substring(start, end);
        return synckey;

    },

    FindFolder: function(wbxml, type) {
        var start = 0;
        var end;
        var folderID;
        var Scontact = String.fromCharCode(0x4A, 0x03) + type + String.fromCharCode(0x00, 0x01);
        var contact = wbxml.indexOf(Scontact);
        while (wbxml.indexOf(String.fromCharCode(0x48, 0x03), start) < contact) {
            start = wbxml.indexOf(String.fromCharCode(0x48, 0x03), start) + 2;
            end = wbxml.indexOf(String.fromCharCode(0x00), start);
            if (start === 1) {
                break;
            }
            folderID = wbxml.substring(start, end);
        }
        return folderID;
    },

    InitContact2: function() {
        tzpush.Contacts2 = [];
        for (var x in tzpush.ToContacts) {
            tzpush.Contacts2[tzpush.ToContacts[x]] = x;
        }
    }
};






tzpush.Send = function (wbxml, callback, command) {
    let platformVer = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo).platformVersion;   
    let prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush.");
    
    if (prefs.getCharPref("debugwbxml") === "1") {
        this.myDump("sending", decodeURIComponent(escape(toxml(wbxml).split('><').join('>\n<'))));
        appendToFile("wbxml-debug.log", wbxml);
    }


    let protocol = (prefs.getBoolPref("https")) ? "https://" : "http://";
    let host = protocol + prefs.getCharPref("host");
    let server = host + "/Microsoft-Server-ActiveSync";

    let user = prefs.getCharPref("user");
    let password = getpassword(host, user)
    let deviceType = 'Thunderbird';
    let deviceId = prefs.getCharPref("deviceId");
    
    // Create request handler
    let req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
    req.mozBackgroundRequest = true;
    if (prefs.getCharPref("debugwbxml") === "1") {
        myDump("sending", "POST " + server + '?Cmd=' + command + '&User=' + user + '&DeviceType=' +deviceType + '&DeviceId=' + deviceId, true);
    }
    req.open("POST", server + '?Cmd=' + command + '&User=' + user + '&DeviceType=' +deviceType + '&DeviceId=' + deviceId, true);
    req.overrideMimeType("text/plain");
    req.setRequestHeader("User-Agent", deviceType + ' ActiveSync');
    req.setRequestHeader("Content-Type", "application/vnd.ms-sync.wbxml");
    req.setRequestHeader("Authorization", 'Basic ' + btoa(user + ':' + password));
    if (prefs.getCharPref("asversion") === "2.5") {
        req.setRequestHeader("MS-ASProtocolVersion", "2.5");
    } else {
        req.setRequestHeader("MS-ASProtocolVersion", "14.0");
    }
    req.setRequestHeader("Content-Length", wbxml.length);
    if (prefs.getBoolPref("prov")) {
        req.setRequestHeader("X-MS-PolicyKey", prefs.getCharPref("polkey"));
    }

    // Define response handler for our request
    req.onreadystatechange = function() { 
        //this.myDump("header",req.getAllResponseHeaders().toLowerCase())
        if (req.readyState === 4 && req.status === 200) {

            wbxml = req.responseText;
            if (prefs.getCharPref("debugwbxml") === "1") {
                this.myDump("recieved", decode_utf8(toxml(wbxml).split('><').join('>\n<')));
                appendToFile("wbxml-debug.log", wbxml);
                //this.myDump("header",req.getAllResponseHeaders().toLowerCase())
            }
            if (wbxml.substr(0, 4) !== String.fromCharCode(0x03, 0x01, 0x6A, 0x00)) {
                if (wbxml.length !== 0) {
                    this.myDump("tzpush", "expecting wbxml but got - " + req.responseText + ", request status = " + req.status + ", ready state = " + req.readyState);
                }
            }
            callback(req.responseText);
        } else if (req.readyState === 4) {

            switch(req.status) {
                case 0:
                    this.myDump("tzpush request status", "0 -- No connection - check server address");
                    break;
                
                case 401: // AuthError
                    this.myDump("tzpush request status", "401 -- Auth error - check username and password");
                    break;
                
                case 449: // Request for new provision
                    if (prefs.getBoolPref("prov")) {
                        prefs.setCharPref("go", "resync");
                    } else {
                        this.myDump("tzpush request status", "449 -- Insufficient information - retry with provisioning");
                    }
                    break;
            
                case 451: // Redirect - update host and login manager 
                    let header = req.getResponseHeader("X-MS-Location");
                    let newurl = header.slice(header.indexOf("://") + 3, header.indexOf("/M"));
                    let password = getpassword();

                    this.myDump("Redirect (451)", "header: " + header + ", newurl: " + newurl + ", password: " + password);
                    prefs.setCharPref("host", newurl);

                    let protocol = (prefs.getBoolPref("https")) ? "http://" : "https://";
                    let host = protocol + newurl;
                    let server = host + "/Microsoft-Server-ActiveSync";
                    let user = prefs.getCharPref("user");

                    let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
                    let updateloginInfo = new nsLoginInfo(host, server, null, user, password, "USER", "PASSWORD");
                    let myLoginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);

                    // We are trying to update the LoginManager (because the host changed), but what about Polkey, GetFolderId and fromzpush?
                    try {
                        myLoginManager.addLogin(updateloginInfo);
                        if (prefs.getBoolPref("prov")) {
                            this.Polkey();
                        } else {
                            if (prefs.getCharPref("synckey") === '') {
                                this.GetFolderId();
                            } else {
                                this.fromzpush();
                            }
                        }
                    } catch (e) {
                        if (e.message.match("This login already exists")) {
                            this.myDump("login ", "Already exists");
                            if (prefs.getBoolPref("prov")) {
                                this.Polkey();
                            } else {
                                if (prefs.getCharPref("synckey") === '') {
                                    this.GetFolderId();
                                } else {
                                    this.fromzpush();
                                }
                            }
                        } else {
                            this.myDump("login error", e);
                        }
                    }
                    break;
                    
                default:
                    this.myDump("tzpush request status", "reported -- " + req.status);
            }
            prefs.setCharPref("syncstate", "alldone"); // Maybe inform user about errors?
        }

    }.bind(this);


    try {        
        if (platformVer >= 50) {
            /*nBytes = wbxml.length;
            ui8Data = new Uint8Array(nBytes);
            for (let nIdx = 0; nIdx < nBytes; nIdx++) {
                ui8Data[nIdx] = wbxml.charCodeAt(nIdx) & 0xff;
            }*/

            req.send(wbxml);
        } else {
            let nBytes = wbxml.length;
            let ui8Data = new Uint8Array(nBytes);
            for (let nIdx = 0; nIdx < nBytes; nIdx++) {
                ui8Data[nIdx] = wbxml.charCodeAt(nIdx) & 0xff;
            }
            //this.myDump("ui8Data",toxml(wbxml))	
            req.send(ui8Data);
        }
    } catch (e) {
        this.myDump("tzpush error", e);
    }

    return true;
}




// Convert a WAP Binary XML to plain XML
tzpush.toxml = function (wbxml) {
    let AirSyncBase = ({
        0x05: '<BodyPreference>',
        0x06: '<Type>',
        0x07: '<TruncationSize>',
        0x08: '<AllOrNone>',
        0x0A: '<Body>',
        0x0B: '<Data>',
        0x0C: '<EstimatedDataSize>',
        0x0D: '<Truncated>',
        0x0E: '<Attachments>',
        0x0F: '<Attachment>',
        0x10: '<DisplayName>',
        0x11: '<FileReference>',
        0x12: '<Method>',
        0x13: '<ContentId>',
        0x14: '<ContentLocation>',
        0x15: '<IsInline>',
        0x16: '<NativeBodyType>',
        0x17: '<ContentType>',
        0x18: '<Preview>',
        0x19: '<BodyPartPreference>',
        0x1A: '<BodyPart>',
        0x1B: '<Status>'
    });

    let AirSync = ({
        0x05: '<Sync>',
        0x06: '<Responses>',
        0x07: '<Add>',
        0x08: '<Change>',
        0x09: '<Delete>',
        0x0A: '<Fetch>',
        0x0B: '<SyncKey>',
        0x0C: '<ClientId>',
        0x0D: '<ServerId>',
        0x0E: '<Status>',
        0x0F: '<Collection>',
        0x10: '<Class>',
        0x12: '<CollectionId>',
        0x13: '<GetChanges>',
        0x14: '<MoreAvailable>',
        0x15: '<WindowSize>',
        0x16: '<Commands>',
        0x17: '<Options>',
        0x18: '<FilterType>',
        0x1B: '<Conflict>',
        0x1C: '<Collections>',
        0x1D: '<ApplicationData>',
        0x1E: '<DeletesAsMoves>',
        0x20: '<Supported>',
        0x21: '<SoftDelete>',
        0x22: '<MIMESupport>',
        0x23: '<MIMETruncation>',
        0x24: '<Wait>',
        0x25: '<Limit>',
        0x26: '<Partial>',
        0x27: '<ConversationMode>',
        0x28: '<MaxItems>',
        0x29: '<HeartbeatInterval>'
    });

    let Contacts = ({
        0x05: '<Anniversary>',
        0x06: '<AssistantName>',
        0x07: '<AssistantPhoneNumber>',
        0x08: '<Birthday>',
        0x09: '<body>',
        0x0A: '<BodySize>',
        0x0B: '<BodyTruncated>',
        0x0C: '<Business2PhoneNumber>',
        0x0D: '<BusinessAddressCity>',
        0x0E: '<BusinessAddressCountry>',
        0x0F: '<BusinessAddressPostalCode>',
        0x10: '<BusinessAddressState>',
        0x11: '<BusinessAddressStreet>',
        0x12: '<BusinessFaxNumber>',
        0x13: '<BusinessPhoneNumber>',
        0x14: '<CarPhoneNumber>',
        0x15: '<Categories>',
        0x16: '<Category>',
        0x17: '<Children>',
        0x18: '<Child>',
        0x19: '<CompanyName>',
        0x1A: '<Department>',
        0x1B: '<Email1Address>',
        0x1C: '<Email2Address>',
        0x1D: '<Email3Address>',
        0x1E: '<FileAs>',
        0x1F: '<FirstName>',
        0x20: '<Home2PhoneNumber>',
        0x21: '<HomeAddressCity>',
        0x22: '<HomeAddressCountry>',
        0x23: '<HomeAddressPostalCode>',
        0x24: '<HomeAddressState>',
        0x25: '<HomeAddressStreet>',
        0x26: '<HomeFaxNumber>',
        0x27: '<HomePhoneNumber>',
        0x28: '<JobTitle>',
        0x29: '<LastName>',
        0x2A: '<MiddleName>',
        0x2B: '<MobilePhoneNumber>',
        0x2C: '<OfficeLocation>',
        0x2D: '<OtherAddressCity>',
        0x2E: '<OtherAddressCountry>',
        0x2F: '<OtherAddressPostalCode>',
        0x30: '<OtherAddressState>',
        0x31: '<OtherAddressStreet>',
        0x32: '<PagerNumber>',
        0x33: '<RadioPhoneNumber>',
        0x34: '<Spouse>',
        0x35: '<Suffix>',
        0x36: '<Title>',
        0x37: '<WebPage>',
        0x38: '<YomiCompanyName>',
        0x39: '<YomiFirstName>',
        0x3A: '<YomiLastName>',
        0x3C: '<Picture>',
        0x3D: '<Alias>',
        0x3E: '<WeightedRank>',
    });

    let Settings = ({
        0x05: '<Settings>',
        0x06: '<Status>',
        0x07: '<Get>',
        0x08: '<Set>',
        0x09: '<Oof>',
        0x0A: '<OofState>',
        0x0B: '<StartTime>',
        0x0C: '<EndTime>',
        0x0D: '<OofMessage>',
        0x0E: '<AppliesToInternal>',
        0x0F: '<AppliesToExternalKnown>',
        0x10: '<AppliesToExternalUnknown>',
        0x11: '<Enabled>',
        0x12: '<ReplyMessage>',
        0x13: '<BodyType>',
        0x14: '<DevicePassword>',
        0x15: '<Password>',
        0x16: '<DeviceInformation>',
        0x17: '<Model>',
        0x18: '<IMEI>',
        0x19: '<FriendlyName>',
        0x1A: '<OS>',
        0x1B: '<OSLanguage>',
        0x1C: '<PhoneNumber>',
        0x1D: '<UserInformation>',
        0x1E: '<EmailAddresses>',
        0x1F: '<SMTPAddress>',
        0x20: '<UserAgent>',
        0x21: '<EnableOutboundSMS>',
        0x22: '<MobileOperator>',
        0x23: '<PrimarySmtpAddress>',
        0x24: '<Accounts>',
        0x25: '<Account>',
        0x26: '<AccountId>',
        0x27: '<AccountName>',
        0x28: '<UserDisplayName>',
        0x29: '<SendDisabled>',
        0x2B: '<RightsManagementInformation>'
    });

    let Provision = ({
        0x05: '<Provision>',
        0x06: '<Policies>',
        0x07: '<Policy>',
        0x08: '<PolicyType>',
        0x09: '<PolicyKey>',
        0x0A: '<Data>',
        0x0B: '<Status>',
        0x0C: '<RemoteWipe>',
        0x0D: '<EASProvisionDoc>',
        0x0E: '<DevicePasswordEnabled>',
        0x0F: '<AlphanumericDevicePasswordRequired>',
        0x10: '<DeviceEncryptionEnabled>',
        // 0x10:'<RequireStorageCardEncryption>',
        0x11: '<PasswordRecoveryEnabled>',
        0x13: '<AttachmentsEnabled>',
        0x14: '<MinDevicePasswordLength>',
        0x15: '<MaxInactivityTimeDeviceLock>',
        0x16: '<MaxDevicePasswordFailedAttempts>',
        0x17: '<MaxAttachmentSize>',
        0x18: '<AllowSimpleDevicePassword>',
        0x19: '<DevicePasswordExpiration>',
        0x1A: '<DevicePasswordHistory>',
        0x1B: '<AllowStorageCard>',
        0x1C: '<AllowCamera>',
        0x1D: '<RequireDeviceEncryption>',
        0x1E: '<AllowUnsignedApplications>',
        0x1F: '<AllowUnsignedInstallationPackages>',
        0x20: '<MinDevicePasswordComplexCharacters>',
        0x21: '<AllowWiFi>',
        0x22: '<AllowTextMessaging>',
        0x23: '<AllowPOPIMAPEmail>',
        0x24: '<AllowBluetooth>',
        0x25: '<AllowIrDA>',
        0x26: '<RequireManualSyncWhenRoaming>',
        0x27: '<AllowDesktopSync>',
        0x28: '<MaxCalendarAgeFilter>',
        0x29: '<AllowHTMLEmail>',
        0x2A: '<MaxEmailAgeFilter>',
        0x2B: '<MaxEmailBodyTruncationSize>',
        0x2C: '<MaxEmailHTMLBodyTruncationSize>',
        0x2D: '<RequireSignedSMIMEMessages>',
        0x2E: '<RequireEncryptedSMIMEMessages>',
        0x2F: '<RequireSignedSMIMEAlgorithm>',
        0x30: '<RequireEncryptionSMIMEAlgorithm>',
        0x31: '<AllowSMIMEEncryptionAlgorithmNegotiation>',
        0x32: '<AllowSMIMESoftCerts>',
        0x33: '<AllowBrowser>',
        0x34: '<AllowConsumerEmail>',
        0x35: '<AllowRemoteDesktop>',
        0x36: '<AllowInternetSharing>',
        0x37: '<UnapprovedInROMApplicationList>',
        0x38: '<ApplicationName>',
        0x39: '<ApprovedApplicationList>',
        0x3A: '<Hash>',
    });

    let FolderHierarchy = ({
        0x07: '<DisplayName>',
        0x08: '<ServerId>',
        0x09: '<ParentId>',
        0x0A: '<Type>',
        0x0C: '<Status>',
        0x0E: '<Changes>',
        0x0F: '<Add>',
        0x10: '<Delete>',
        0x11: '<Update>',
        0x12: '<SyncKey>',
        0x13: '<FolderCreate>',
        0x14: '<FolderDelete>',
        0x15: '<FolderUpdate>',
        0x16: '<FolderSync>',
        0x17: '<Count>'
    });

    let Contacts2 = ({
        0x05: '<CustomerId>',
        0x06: '<GovernmentId>',
        0x07: '<IMAddress>',
        0x08: '<IMAddress2>',
        0x09: '<IMAddress3>',
        0x0A: '<ManagerName>',
        0x0B: '<CompanyMainPhone>',
        0x0C: '<AccountName>',
        0x0D: '<NickName>',
        0x0E: '<MMS>'
    });

    let Search = ({
        0x05: '<Search>',
        0x07: '<Store>',
        0x08: '<Name>',
        0x09: '<Query>',
        0x0A: '<Options>',
        0x0B: '<Range>',
        0x0C: '<Status>',
        0x0D: '<Response>',
        0x0E: '<Result>',
        0x0F: '<Properties>',
        0x10: '<Total>',
        0x11: '<EqualTo>',
        0x12: '<Value>',
        0x13: '<And>',
        0x14: '<Or>',
        0x15: '<FreeText>',
        0x17: '<DeepTraversal>',
        0x18: '<LongId>',
        0x19: '<RebuildResults>',
        0x1A: '<LessThan>',
        0x1B: '<GreaterThan>',
        0x1E: '<UserName>',
        0x1F: '<Password>',
        0x20: '<ConversationId>',
        0x21: '<Picture>',
        0x22: '<MaxSize>',
        0x23: '<MaxPictures>'
    });

    let GAL = ({
        0x05: '<DisplayName>',
        0x06: '<Phone>',
        0x07: '<Office>',
        0x08: '<Title>',
        0x09: '<Company>',
        0x0A: '<Alias>',
        0x0B: '<FirstName>',
        0x0C: '<LastName>',
        0x0D: '<HomePhone>',
        0x0E: '<MobilePhone>',
        0x0F: '<EmailAddress>',
        0x10: '<Picture>',
        0x11: '<Status>',
        0x12: '<Data>'
    });

    let Code = ({
        0x07: FolderHierarchy,
        0x01: Contacts,
        0x00: AirSync,
        0x0E: Provision,
        0x11: AirSyncBase,
        0x12: Settings,
        0x0C: Contacts2,
        0x0F: Search,
        0x10: GAL
    });
    
    let Codestring = ({
        0x07: "FolderHierarchy",
        0x01: "Contacts",
        0x00: "AirSync",
        0x0E: "Provision",
        0x11: "AirSyncBase",
        0x12: "Settings",
        0x0C: "Contacts2",
        0x0F: "Search",
        0x10: "GAL"
    });

    let CodePage = Code[0];
    let stack = [];
    let num = 4;
    let xml = '<?xml version="1.0"?>';
    let x = '0';
    let firstxmlns = true;
    let firstx = '0';
    
    while (num < wbxml.length) {
        let token = wbxml.substr(num, 1);
        let tokencontent = token.charCodeAt(0) & 0xbf;
        if (token || tokencontent in Code) {
            if (token == String.fromCharCode(0x00)) {
                num = num + 1;
                x = (wbxml.substr(num, 1)).charCodeAt(0);
                CodePage = Code[x];
                if (firstxmlns) {
                    firstx = x;
                }
            } else if (token == String.fromCharCode(0x03)) {
                xml = xml + (wbxml.substring(num + 1, wbxml.indexOf(String.fromCharCode(0x00, 0x01), num)));
                num = wbxml.indexOf(String.fromCharCode(0x00, 0x01), num);
            } else if (token == String.fromCharCode(0x01)) {
                xml = xml + (stack.pop());
            } else if (token.charCodeAt(0) in CodePage) {
                xml = xml + (CodePage[token.charCodeAt(0)]).replace('>', '/>');
            } else if (tokencontent in CodePage) {
                if (firstxmlns || x !== firstx) {
                    xml = xml + (CodePage[tokencontent].replace('>', ' xmlns="' + Codestring[x] + ':">'));
                    firstxmlns = false;
                } else {
                    xml = xml + (CodePage[tokencontent]);
                }

                stack.push((CodePage[tokencontent]).replace('<', '</'));
            } else {

            }
        }

        num = num + 1;
    }
    
    return xml;
}

tzpush.InitContact2();
