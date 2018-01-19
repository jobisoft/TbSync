/* Copyright (c) 2012 Mark Nethersole
   See the file LICENSE.txt for licensing information. */
"use strict";

eas.contactsync = {

    // CONTACT SYNC
    
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
        0x55: 'Categories',
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

    FromContacts2: {
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


    //these functions handle categories compatible to the Category Manager Add-On, which is compatible to lots of other sync tools (sogo, carddav-sync, roundcube)
    getCategoriesFromString: function (catString) {
        let catsArray = [];
        if (catString.trim().length>0) catsArray = catString.trim().split("\u001A").filter(String);
        return catsArray;
    },

    mergeCategories: function (oldCats, data) {
        let catsArray = this.getCategoriesFromString(oldCats);
        let newCat = data.trim();
        if (newCat != "" && catsArray.indexOf(newCat) == -1) catsArray.push(newCat);
        return catsArray.join("\u001A");
    },





    start: Task.async (function* (syncdata)  {
        //Check SyncTarget
        if (!tbSync.checkAddressbook(syncdata.account, syncdata.folderID)) {
            throw eas.finishSync("notargets", eas.flags.abortWithError);
        }
        
        //sync
        yield eas.contactsync.fromzpush (syncdata); 
        if (tbSync.db.getAccountSetting(syncdata.account, "downloadonly") != "1") {
            yield eas.contactsync.tozpush (syncdata);
            yield eas.contactsync.senddel (syncdata);
        }
        //if everything was OK, we still throw, to get into catch
        throw eas.finishSync();
        
    }),
	
    fromzpush: Task.async (function* (syncdata)  {
        
        var moreavilable = 0;
        do {
            tbSync.setSyncState("requestingchanges", syncdata.account, syncdata.folderID);
            var card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);

            var wbxmlsend = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x4B, 0x03, 0x53, 0x79, 0x6E, 0x63, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x1E, 0x13, 0x55, 0x03, 0x31, 0x30, 0x30, 0x00, 0x01, 0x57, 0x00, 0x11, 0x45, 0x46, 0x03, 0x31, 0x00, 0x01, 0x47, 0x03, 0x32, 0x30, 0x30, 0x30, 0x30, 0x30, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01);
            if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") {
                wbxmlsend = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x50, 0x03, 0x43, 0x6F, 0x6E, 0x74, 0x61, 0x63, 0x74, 0x73, 0x00, 0x01, 0x4B, 0x03, 0x53, 0x79, 0x6E, 0x63, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x1E, 0x13, 0x55, 0x03, 0x31, 0x30, 0x30, 0x00, 0x01, 0x57, 0x5B, 0x03, 0x31, 0x00, 0x01, 0x62, 0x03, 0x30, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01);
            }

            var wbxml = wbxmlsend.replace('SyncKeyReplace', syncdata.synckey);
            wbxml = wbxml.replace('Id2Replace', syncdata.folderID);

            let returnedwbxml = yield eas.sendRequest(wbxml, "Sync", syncdata);

            if (returnedwbxml.length === 0) return

            tbSync.setSyncState("recievingchanges", syncdata.account, syncdata.folderID);
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
                tbSync.dump("wbxml status", "wbxml reports " + wbxmlstatus + " should be 1, resyncing");
                throw eas.finishSync("wbxmlerror::" + wbxmlstatus, eas.flags.resyncFolder);
            } else if (wbxmlstatus !== '1') {
                tbSync.dump("wbxml status", "server error? " + wbxmlstatus);
                throw eas.finishSync("wbxmlerror::" + wbxmlstatus, eas.flags.abortWithError);
            }

            syncdata.synckey = wbxmltools.FindKey(wbxml);
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", syncdata.synckey);
            //this is contact sync, so we can simply request the target object
            var addressBook = tbSync.getAddressBookObject(tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));
            
            var stack = [];
            var num = 4;
            var data = '';
            var x = 0;
            var y;
            var popval = 2;
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
            var tmpProp;
            var modcard;
            var ServerId;
            var cardsToDelete;
            var seperator = String.fromCharCode(tbSync.db.getAccountSetting(syncdata.account, "seperator"));

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
                        filePath = tbSync.addphoto(card, data);
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
                    } else if (x === 0x01 && temptoken === 0x56) { //Zarafa sends Categories as Category 
                        // sogo-connector and other sync tools use the Categories field for categories
                        // add the new category to the existing one
                        card.setProperty("Categories", this.mergeCategories(card.getProperty("Categories", ""),data));
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
                        if (syncdata.folderResync) {
                            //during resync, we need to check, if the "new" card we are currenty receiving, is really new, or already exists
                            let tempsid;
                            try {
                                tempsid = card.getProperty("ServerId", "");
                            } catch (e) {}

                            if (!addressBook.getCardFromProperty("ServerId", tempsid, false)) {
                                //card DOES NOT exists, add new card from server to the addressbook
                                tbSync.addNewCardFromServer(card, addressBook, syncdata.account);
                            } else {
                                //card DOES exists, get the local card and replace all properties with those received from server - why not simply loop over all properties of the new card?
                                ServerId = card.getProperty("ServerId", "");
                                modcard = addressBook.getCardFromProperty("ServerId", ServerId, false);
                                for (y in this.FromContacts) {
                                    if (card.getProperty(y, "") !== '') {
                                        tmpProp = card.getProperty(y, "");
                                        modcard.setProperty(y, tmpProp);
                                    } else {
                                        modcard.setProperty(y, "");
                                    }
                                }
                                for (y in this.FromContacts2) {

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

                                if (tbSync.db.getAccountSetting(syncdata.account, "displayoverride") == "1" ) {
                                  modcard.setProperty("DisplayName", modcard.getProperty("FirstName", "") + " " + modcard.getProperty("LastName", ""));

                                  if (modcard.getProperty("DisplayName", "" ) == " " )
                                    modcard.setProperty("DisplayName", card.getProperty("Company", card.getProperty("PrimaryEmail", "")));
                                }

                                /* newCard = */ addressBook.modifyCard(modcard);
                                card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
                            }

                        } else {
                            //this is not a resync and thus a new card, add it
                            tbSync.addNewCardFromServer(card, addressBook, syncdata.account);
                        }

                        card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);

                    } else if (popval === 600) {

                        card = addressBook.getCardFromProperty("ServerId", data, false);
                        if (card !== null) {

                            cardsToDelete = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
                            cardsToDelete.appendElement(card, "");
                            tbSync.db.addItemToChangeLog(addressBook.URI, data, "deleted_by_server");
                            try {
                                addressBook.deleteCards(cardsToDelete);
                            } catch (e) {}
                            card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
                        } else {
                            card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
                        }
                    } else if (popval === 700) {
                        ServerId = card.getProperty("ServerId", "");
                        modcard = addressBook.getCardFromProperty("ServerId", ServerId, false);
                        if (modcard === null) {
                            break;
                        }

                        for (y in this.FromContacts) {
                            if (card.getProperty(y, "") !== '') {
                                tmpProp = card.getProperty(y, "");
                                modcard.setProperty(y, tmpProp);
                            } else {
                                modcard.setProperty(y, "");
                            }
                        }

                        for (y in this.FromContacts2) {
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
                        if (tbSync.db.getAccountSetting(syncdata.account, "displayoverride") == "1") {
                            modcard.setProperty("DisplayName", modcard.getProperty("FirstName", "") + " " + modcard.getProperty("LastName", ""));

                            if (modcard.getProperty("DisplayName", "" ) == " " )
                                modcard.setProperty("DisplayName", card.getProperty("Company", card.getProperty("PrimaryEmail", "")));
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

            if (moreavilable == 1) {
                tbSync.dump("Receiving cards", "Server told us, he has more cards. Requesting next set (would be a shame, if server sends them one by one).");
            }
        } while (moreavilable == 1)        

    }),

    tozpush: Task.async (function* (syncdata)  {
        do {
            tbSync.setSyncState("sendingchanges", syncdata.account, syncdata.folderID);

            var wbxmlouter = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x4B, 0x03, 0x53, 0x79, 0x6E, 0x63, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x57, 0x5B, 0x03, 0x31, 0x00, 0x01, 0x62, 0x03, 0x30, 0x00, 0x01, 0x01, 0x56, 0x72, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x68, 0x65, 0x72, 0x65, 0x01, 0x01, 0x01, 0x01);
            if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") {
                wbxmlouter = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x50, 0x03, 0x43, 0x6F, 0x6E, 0x74, 0x61, 0x63, 0x74, 0x73, 0x00, 0x01, 0x4B, 0x03, 0x53, 0x79, 0x6E, 0x63, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x57, 0x5B, 0x03, 0x31, 0x00, 0x01, 0x62, 0x03, 0x30, 0x00, 0x01, 0x01, 0x56, 0x72, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x68, 0x65, 0x72, 0x65, 0x01, 0x01, 0x01, 0x01);
            }

            var wbxml = '';
            var addressBook = tbSync.getAddressBookObject(tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));

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
            var numofcards = 0;
            var mbd = 0;
            var ambd = 0;
            var wbxmlinner;
            var card;
            var maxnumbertosend = tbSync.prefSettings.getIntPref("maxnumbertosend");
            var morecards = false;
            var seperator = String.fromCharCode(tbSync.db.getAccountSetting(syncdata.account,"seperator")); // options are 44 (,) or 10 (\n)
            var cards = addressBook.childCards;

            // this while loops over all cards but only works on new cards without serverid
            while (cards.hasMoreElements()) {
                card = cards.getNext();

                if (numofcards >= maxnumbertosend) {
                    morecards = true;
                    break;
                }

                if (card instanceof Components.interfaces.nsIAbCard) {
                    //cards without ServerId will be retried during each sync, not limited to time since last sync
                    if (card.getProperty("ServerId", "") === '' && card.getProperty("LastModifiedDate", "") < syncdata.timeOfThisSync && !card.isMailList) {
                        card.setProperty('localId', card.localId); //prepare clientID, which we can find later
                        addressBook.modifyCard(card);
                        numofcards = numofcards + 1;
                        wbxml = wbxml + String.fromCharCode(0x47, 0x4C, 0x03) + card.localId + String.fromCharCode(0x00, 0x01, 0x5D, 0x00, 0x01);
                        for (x in this.FromContacts) {
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
                                            wbxml = wbxml + String.fromCharCode(0x65) + String.fromCharCode(0x03) + tbSync.encode_utf8(haddressline) + String.fromCharCode(0x00, 0x01);
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
                                            wbxml = wbxml + String.fromCharCode(0x51) + String.fromCharCode(0x03) + tbSync.encode_utf8(waddressline) + String.fromCharCode(0x00, 0x01);
                                        }
                                        break;
                                }

                            } else if (card.getProperty(x, "") !== '') { // This means, we do not process empty properties of new cards being pushed to the server

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
                                        if (tbSync.db.getAccountSetting(syncdata.account, "birthday") == "1") {
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
                                        if (tbSync.db.getAccountSetting(syncdata.account, "birthday") == "1") {
                                            wbxml = wbxml + String.fromCharCode(0x45) + String.fromCharCode(0x03) + annymd + String.fromCharCode(0x00, 0x01);
                                        }
                                    }
                                } else if (x === 'Categories') { //Send Categories as Category to Zarafa
                                    let cat = String.fromCharCode(0x55, 0x56, 0x3, 0x72, 0x65, 0x70, 0x6c, 0x61, 0x63, 0x65, 0x6d, 0x65, 0x0, 0x1, 0x1);
                                    let catsArray = this.getCategoriesFromString(card.getProperty("Categories", ""));
                                    for (let i=0; i < catsArray.length; i++) {
                                        wbxml = wbxml + cat.replace("replaceme", tbSync.encode_utf8(catsArray[i]));
                                    }
                                } else if (x === 'Notes') {
                                    if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") {
                                        wbxml = wbxml + String.fromCharCode(0x49) + String.fromCharCode(0x03) + tbSync.encode_utf8(card.getProperty(x, "")) + String.fromCharCode(0x00, 0x01, 0x00, 0x01);
                                    } else {
                                        let body = String.fromCharCode(0x00, 0x11, 0x4a, 0x46, 0x03, 0x31, 0x00, 0x01, 0x4c, 0x03, 0x37, 0x00, 0x01, 0x4b, 0x03, 0x72, 0x65, 0x70, 0x6c, 0x61, 0x63, 0x65, 0x00, 0x01, 0x01, 0x00, 0x01);
                                        body = body.replace("replace", tbSync.encode_utf8(card.getProperty(x, '')));
                                        body = body.replace("7", card.getProperty(x, '').length);
                                        wbxml = wbxml + body;
                                    }
                                } else {
                                    wbxml = wbxml + String.fromCharCode(this.FromContacts[x]) + String.fromCharCode(0x03) + tbSync.encode_utf8(card.getProperty(x, '')) + String.fromCharCode(0x00, 0x01);
                                }
                            }
                        }

                        for (x in this.FromContacts2) {
                            if (card.getProperty(x, "") !== '') {
                                wbxml = wbxml + String.fromCharCode(0x00, 0x0C) + String.fromCharCode(this.FromContacts2[x]) + String.fromCharCode(0x03) + tbSync.encode_utf8(card.getProperty(x, '')) + String.fromCharCode(0x00, 0x01);
                            }
                        }
                        wbxml = wbxml + String.fromCharCode(0x01, 0x01, 0x00, 0x00);
                    }
                }
                newcards = numofcards;
            }
            tbSync.dump("Sending new cards", newcards);


            // this while loops over all cards but only works on old cards already having a serverid
            cards = addressBook.childCards;
            while (cards.hasMoreElements()) {
                card = cards.getNext();

                if (numofcards >= maxnumbertosend) {
                    morecards = true;
                    break;
                }

                if (card instanceof Components.interfaces.nsIAbCard) {

                    if (card.getProperty("LastModifiedDate", "") > syncdata.timeOfLastSync && card.getProperty("LastModifiedDate", "") < syncdata.timeOfThisSync && card.getProperty("ServerId", "") !== '' && !card.isMailList) {

                        numofcards = numofcards + 1;
                        if (card.getProperty("ServerId", "") === "CardWasDeniedByServerRetryNextTime") {
                            card.setProperty("ServerId", "");
                            addressBook.modifyCard(card);
                        } else {
                            addressBook.modifyCard(card);
                            wbxml = wbxml + String.fromCharCode(0x48, 0x4D, 0x03) + card.getProperty("ServerId", "") + String.fromCharCode(0x00, 0x01, 0x5D, 0x00, 0x01);
                            for (x in this.FromContacts) {
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
                                                wbxml = wbxml + String.fromCharCode(0x65) + String.fromCharCode(0x03) + tbSync.encode_utf8(haddressline) + String.fromCharCode(0x00, 0x01);
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
                                                wbxml = wbxml + String.fromCharCode(0x51) + String.fromCharCode(0x03) + tbSync.encode_utf8(waddressline) + String.fromCharCode(0x00, 0x01);
                                            }
                                            break;
                                    }

                                } else if (card.getProperty(x, "") !== "") {
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
                                            if (tbSync.db.getAccountSetting(syncdata.account, "birthday") == "1") {
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

                                            if (tbSync.db.getAccountSetting(syncdata.account, "birthday") == "1") {
                                                wbxml = wbxml + String.fromCharCode(0x45) + String.fromCharCode(0x03) + annymd + String.fromCharCode(0x00, 0x01);
                                            }
                                        }
                                    } else if (x === 'Categories') { //send categories as category to zarafa
                                        let cat = String.fromCharCode(0x55, 0x56, 0x3, 0x72, 0x65, 0x70, 0x6c, 0x61, 0x63, 0x65, 0x6d, 0x65, 0x0, 0x1, 0x1);
                                        let catsArray = this.getCategoriesFromString(card.getProperty("Categories", ""));
                                        for (let i=0; i < catsArray.length; i++) {
                                            wbxml = wbxml + cat.replace("replaceme", tbSync.encode_utf8(catsArray[i]));
                                        }
                                    } else if (x === 'Notes') {
                                        if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") {
                                            wbxml = wbxml + String.fromCharCode(0x49) + String.fromCharCode(0x03) + tbSync.encode_utf8(card.getProperty(x, "")) + String.fromCharCode(0x00, 0x01, 0x00, 0x01);
                                        } else {
                                            let body = String.fromCharCode(0x00, 0x11, 0x4a, 0x46, 0x03, 0x31, 0x00, 0x01, 0x4c, 0x03, 0x37, 0x00, 0x01, 0x4b, 0x03, 0x72, 0x65, 0x70, 0x6c, 0x61, 0x63, 0x65, 0x00, 0x01, 0x01, 0x00, 0x01);
                                            body = body.replace("replace", tbSync.encode_utf8(card.getProperty(x, '')));
                                            body = body.replace("7", card.getProperty(x, '').length);
                                            wbxml = wbxml + body;
                                        }
                                    } else {
                                        wbxml = wbxml + String.fromCharCode(this.FromContacts[x]) + String.fromCharCode(0x03) + tbSync.encode_utf8(card.getProperty(x, '')) + String.fromCharCode(0x00, 0x01);
                                    }
                                }

                            }
                            for (x in this.FromContacts2) {
                                if (card.getProperty(x, "") !== "") {
                                    wbxml = wbxml + String.fromCharCode(0x00, 0x0C) + String.fromCharCode(this.FromContacts2[x]) + String.fromCharCode(0x03) + tbSync.encode_utf8(card.getProperty(x, '')) + String.fromCharCode(0x00, 0x01);
                                } else {
                                    wbxml = wbxml + String.fromCharCode(0x00, 0x0C) + String.fromCharCode(this.FromContacts2[x] - 0x40) + String.fromCharCode(0x00, 0x01);
                                }
                            }
                            wbxml = wbxml + String.fromCharCode(0x01, 0x01, 0x00, 0x00);
                        }
                    }
                }
            } 
            tbSync.dump("Sending total cards", numofcards);

            if (numofcards == 0) return;
            
            wbxmlinner = wbxml;
            wbxml = wbxmlouter.replace('replacehere', wbxmlinner);
            wbxml = wbxml.replace('SyncKeyReplace', syncdata.synckey);
            wbxml = wbxml.replace('Id2Replace', syncdata.folderID);
            
            wbxml = yield eas.sendRequest(wbxml, "Sync", syncdata); 

            var firstcmd = wbxml.indexOf(String.fromCharCode(0x01, 0x46));

            var truncwbxml = wbxml;
            if (firstcmd !== -1) {
                truncwbxml = wbxml.substring(0, firstcmd);
            }

            var n = truncwbxml.lastIndexOf(String.fromCharCode(0x4E, 0x03));
            var n1 = truncwbxml.indexOf(String.fromCharCode(0x00), n);

            var wbxmlstatus = truncwbxml.substring(n + 2, n1);

            if (wbxmlstatus === '3' || wbxmlstatus === '12') {
                tbSync.dump("wbxml status", "wbxml reports " + wbxmlstatus + " should be 1, resyncing");
                throw eas.finishSync("wbxmlerror::" + wbxmlstatus, eas.flags.resyncFolder);
            } else if (wbxmlstatus !== '1') {
                tbSync.dump("wbxml status", "server error? " + wbxmlstatus);
                throw eas.finishSync("wbxmlerror::" + wbxmlstatus, eas.flags.abortWithError);
            }

            tbSync.setSyncState("serverid", syncdata.account, syncdata.folderID);

            syncdata.synckey = wbxmltools.FindKey(wbxml);
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", syncdata.synckey);

            var oParser = Components.classes["@mozilla.org/xmlextras/domparser;1"].createInstance(Components.interfaces.nsIDOMParser);
            let xml = wbxmltools.convert2xml(wbxml);
            if (xml === false) {
                throw eas.finishSync("wbxml-parse-error", eas.flags.abortWithError);
            }
            
            var oDOM = oParser.parseFromString(xml, "text/xml");
            var addressBook = tbSync.getAddressBookObject(tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));


            var add = oDOM.getElementsByTagName("Add");
            if (add.length !== 0) {
                for (let count = 0; count < add.length; count++) {
                    var inadd = add[count];

                    let tag = inadd.getElementsByTagName("ServerId");
                    let ServerId = "CardWasDeniedByServerRetryNextTime";
                    if (tag.length > 0) ServerId = tag[0].childNodes[0].nodeValue;

                    tag = inadd.getElementsByTagName("ClientId");
                    let ClientId = tag[0].childNodes[0].nodeValue;

                    try {
                        let addserverid = addressBook.getCardFromProperty("localId", ClientId, false);
                        addserverid.setProperty('ServerId', ServerId);
                        addressBook.modifyCard(addserverid);
                    } catch (e) {
                        tbSync.dump("unknown error", e);
                    }
                }
            }


            var change = oDOM.getElementsByTagName("Change");
            if (change.length !== 0) {
                for (let count = 0; count < change.length; count++) {
                    let inchange = change[count];
                    let tag = inchange.getElementsByTagName("Status");

                    let status = "1";
                    try {
                        status = tag[0].childNodes[0].nodeValue;
                    } catch (e) { }

                    if (status !== "1") { // a CHANGE we send was not acknowledged, but we should NOT remove the id, we must RESEND our change later (do not remove it from changelog) TODO
                            tbSync.dump("SendContactChange", "bad status: " + status);

                        /*                            try {
                            tag = inchange.getElementsByTagName("ServerId");
                            let ServerId = tag[0].childNodes[0].nodeValue;
                            let addserverid = addressBook.getCardFromProperty('ServerId', ServerId, false);
                            addserverid.setProperty('ServerId', '');
                            addressBook.modifyCard(addserverid);
                            morecards = true;
                        } catch (e) {
                            tbSync.dump("unknown error", e);
                        }*/
                    }
                }

            }
        } while (morecards);

    }),

    senddel: Task.async (function* (syncdata)  {
        do {
            tbSync.setSyncState("sendingdeleted", syncdata.account, syncdata.folderID);
            let addressbook = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target");
            
            // cardstodelete will not contain more cards than max
            let cardstodelete = tbSync.db.getItemsFromChangeLog(addressbook, tbSync.prefSettings.getIntPref("maxnumbertosend"), "deleted_by_user");
            let wbxmlinner = "";
            for (let i = 0; i < cardstodelete.length; i++) {
                wbxmlinner = wbxmlinner + String.fromCharCode(0x49, 0x4D, 0x03) + cardstodelete[i].id + String.fromCharCode(0x00, 0x01, 0x01);
            }

            if (cardstodelete.length == 0) return;
            
            // wbxml contains placholder Id2Replace, replacehere and SyncKeyReplace
            let wbxml = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x4B, 0x03, 0x53, 0x79, 0x6E, 0x63, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x57, 0x5B, 0x03, 0x31, 0x00, 0x01, 0x62, 0x03, 0x30, 0x00, 0x01, 0x01, 0x56, 0x72, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x68, 0x65, 0x72, 0x65, 0x01, 0x01, 0x01, 0x01);
            if (tbSync.db.getAccountSetting(syncdata.account, "asversion") == "2.5") {
                wbxml = String.fromCharCode(0x03, 0x01, 0x6A, 0x00, 0x45, 0x5C, 0x4F, 0x50, 0x03, 0x43, 0x6F, 0x6E, 0x74, 0x61, 0x63, 0x74, 0x73, 0x00, 0x01, 0x4B, 0x03, 0x53, 0x79, 0x6E, 0x63, 0x4B, 0x65, 0x79, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x52, 0x03, 0x49, 0x64, 0x32, 0x52, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x00, 0x01, 0x57, 0x5B, 0x03, 0x31, 0x00, 0x01, 0x62, 0x03, 0x30, 0x00, 0x01, 0x01, 0x56, 0x72, 0x65, 0x70, 0x6C, 0x61, 0x63, 0x65, 0x68, 0x65, 0x72, 0x65, 0x01, 0x01, 0x01, 0x01);
            }
            wbxml = wbxml.replace('replacehere', wbxmlinner);
            wbxml = wbxml.replace('SyncKeyReplace', syncdata.synckey);
            wbxml = wbxml.replace('Id2Replace', syncdata.folderID);
            // Send will send a request to the server, a responce will trigger callback, which will call senddel again.
            syncdata.cardstodelete = cardstodelete;
            
            let responseWbxml = yield eas.sendRequest(wbxml, "Sync", syncdata);

            let firstcmd = responseWbxml.indexOf(String.fromCharCode(0x01, 0x46));

            let truncwbxml = responseWbxml;
            if (firstcmd !== -1) truncwbxml = responseWbxml.substring(0, firstcmd);

            let n = truncwbxml.lastIndexOf(String.fromCharCode(0x4E, 0x03));
            let n1 = truncwbxml.indexOf(String.fromCharCode(0x00), n);
            let wbxmlstatus = truncwbxml.substring(n + 2, n1);

            if (wbxmlstatus === '3' || wbxmlstatus === '12') {
                tbSync.dump("wbxml status", "wbxml reports " + wbxmlstatus + " should be 1, resyncing");
                throw eas.finishSync("wbxmlerror::" + wbxmlstatus, eas.flags.resyncFolder);
            } else if (wbxmlstatus !== '1') {
                tbSync.dump("wbxml status", "server error? " + wbxmlstatus);
                throw eas.finishSync("wbxmlerror::" + wbxmlstatus, eas.flags.abortWithError);
            }

            syncdata.synckey = wbxmltools.FindKey(responseWbxml);
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "synckey", syncdata.synckey);
            for (let count in syncdata.cardstodelete) {
                tbSync.setSyncState("cleaningdeleted", syncdata.account, syncdata.folderID);
                tbSync.db.removeItemFromChangeLog(addressbook, syncdata.cardstodelete[count].id);
            }

            // The selected cards have been deleted from the server and from the changelog -> rerun senddel to look for more cards to delete        
        } while (true);
    }),
    

    //Create a reversed map of ToContacts
    initFromContactsArray: function() {
        this.FromContacts = [];
        for (let x in this.ToContacts) {
            this.FromContacts[this.ToContacts[x]] = x;
        }
    }
    
};

eas.contactsync.initFromContactsArray();
