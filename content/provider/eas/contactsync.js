"use strict";

eas.sync.Contacts = {

    createItem : function (card = null) {
        let item = {
            get id() {return this.card.getProperty("EASID", "")},
            set id(newId) {this.card.setProperty("EASID", newId)},
            get icalString() {return "CardData"},
            clone: function () { return this; } //no real clone
        };
        
        //actually add the card
        item.card = card ? card : Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);;
                    
        return item;
    },
    
    promisifyAddressbook: function (addressbook) {
    /* 
        Return obj with identical interface to promisifyCalendar. But we currently do not need a promise. 
            adoptItem(card)
            modifyItem(newcard, existingcard)
            deleteItem(card)
            getItem(id)

        Avail API:
            addressBook.modifyCard(card);
            addressBook.getCardFromProperty("localId", ClientId, false);
            addressBook.deleteCards(cardsToDelete);
            card.setProperty('ServerId', ServerId);
    */
        let apiWrapper = {
            adoptItem: function (item) { 
                /* add card to addressbook */
                addressbook.addCard(item.card);
            },

            modifyItem: function (newitem, existingitem) {
                /* modify card */
                addressbook.modifyCard(newitem.card);
            },

            deleteItem: function (item) {
                /* remove card from addressBook */
                let cardsToDelete = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
                cardsToDelete.appendElement(item.card, "");
                addressbook.deleteCards(cardsToDelete);
            },

            getItem: function (searchId) {
                /* return array of items matching */
                let items = [];
                let card = addressbook.getCardFromProperty("EASID", searchId, true); //3rd param enables case sensitivity
                
                if (card) {
                    items.push(eas.sync.Contacts.createItem(card));
                }
                
                return items;
            }
        };
    
        return apiWrapper;
    },
    

/*

These need special treatment
        0x05: 'Anniversary',
        0x08: 'Birthday',

        0x09: 'Body',
        0x0A: 'BodySize',
        0x0B: 'BodyTruncated',
        0x15: 'Categories',
        0x16: 'Category',
        0x17: 'Children',
        0x18: 'Child',
        0x1D: 'Email3Address',
    
The following are the core properties that are used by TB:
 * - Names:
 *   - PhoneticFirstName, PhoneticLastName
 *   - SpouseName, FamilyName
 * - Home Contact:
 *   - HomeAddress, HomeAddress2, 
 *   - HomePhone, HomePhoneType
 * - Work contact. Same as home, but with `Work' instead of `Home'
 * - Other Contact:
 *   - FaxNumber, FaxNumberType
 *   - PagerNumber, PagerNumberType
 *   - CellularNumber, CellularNumberType
 * - _AimScreenName
 * - Dates:
 * - WebPage1 (work), WebPage2 (home)
 * - Custom1, Custom2, Custom3, Custom4
    
*/
    
    //includes all properties, which can be mapped 1-to-1
    map_TB_properties_to_EAS_properties : {
        DisplayName: 'FileAs',
        FirstName: 'FirstName',
        LastName: 'LastName',
        //NickName: 'NickName',
        PrimaryEmail: 'Email1Address',
        SecondEmail: 'Email2Address',

/*        0x06: 'AssistantName',
        0x07: 'AssistantPhoneNumber',
        0x08: 'Business2PhoneNumber',
        0x11: 'BusinessAddressStreet',
        0x12: 'BusinessFaxNumber',
        0x14: 'CarPhoneNumber',
        0x20: 'Home2PhoneNumber',
        0x25: 'HomeAddressStreet',
        0x26: 'HomeFaxNumber',
        0x2A: 'MiddleName',
        0x2B: 'MobilePhoneNumber',
        0x2C: 'OfficeLocation',
        0x2D: 'OtherAddressCity',
        0x2E: 'OtherAddressCountry',
        0x2F: 'OtherAddressPostalCode',
        0x30: 'OtherAddressState',
        0x31: 'OtherAddressStreet',
        0x32: 'PagerNumber',
        0x33: 'RadioPhoneNumber',
        0x34: 'Spouse',
        0x35: 'Suffix',
        0x36: 'Title',
        0x37: 'WebPage',
        0x38: 'YomiCompanyName',
        0x39: 'YomiFirstName',
        0x3A: 'YomiLastName',
        0x3B: 'CompressedRTF',
        0x3C: 'Picture',
        0x3D: 'Alias',
        0x3E: 'WeightedRank',
        
        0x05: 'CustomerId',
        0x06: 'GovernmentId',
        0x07: 'IMAddress',
        0x08: 'IMAddress2',
        0x09: 'IMAddress3',
        0x0a: 'ManagerName',
        0x0b: 'CompanyMainPhone',
        0x0c: 'AccountName',
        0x0e: 'MMS',
        */
        HomeCity: 'HomeAddressCity',
        HomeCountry: 'HomeAddressCountry',
        HomeZipCode: 'HomeAddressPostalCode',
        HomeState: 'HomeAddressState',
        HomePhone: 'HomePhoneNumber',

        Company: 'CompanyName',
        Department: 'Department',
        JobTitle: 'JobTitle',
        WorkCity: 'BusinessAddressCity',
        WorkCountry: 'BusinessAddressCountry',
        WorkZipCode: 'BusinessAddressPostalCode',
        WorkState: 'BusinessAddressState',
        WorkPhone: 'BusinessPhoneNumber'        
    },

    
    

    // --------------------------------------------------------------------------- //
    // Read WBXML and set Thunderbird item
    // --------------------------------------------------------------------------- //
    setThunderbirdItemFromWbxml: function (item, data, id, syncdata) {
        let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");

        item.card.setProperty("EASID", id);

        //loop over all known TB properties which map 1-to-1
        for (let p=0; p < this.TB_properties.length; p++) {            
            let TB_property = this.TB_properties[p];
            let EAS_property = this.map_TB_properties_to_EAS_properties[TB_property];            
            let value = xmltools.checkString(data[EAS_property]);
            
            //is this property part of the send data?
            if (value) {
                //do we need to manipulate the value?
                switch (EAS_property) {
                    case "Email1Address":
                    case "Email2Address":
                    case "Email3Address":
                        let parsedInput = MailServices.headerParser.makeFromDisplayAddress(value);
                        let fixedValue =  (parsedInput && parsedInput[0] && parsedInput[0].email) ? parsedInput[0].email : value;
                        if (fixedValue != value) {
                            tbSync.dump("Parsing email display string via RFC 2231 and RFC 2047 ("+EAS_property+")", value + " -> " + fixedValue);
                            value = fixedValue;
                        }
                        break;
                }
                
                item.card.setProperty(TB_property, value);
            } else {
                //clear
                item.card.deleteProperty(TB_property);
            }
        }


        //take care of birthday and anniversary
        let dates = [];
        dates.push(["Birthday", "BirthDay", "BirthMonth", "BirthYear"]);
        dates.push(["Anniversary", "AnniversaryDay", "AnniversaryMonth", "AnniversaryYear"]);
        
        for (let p=0; p < dates.length; p++) {
            let value = xmltools.checkString(data[dates[p][0]]);
            if (value == "") {
                //clear
                item.card.deleteProperty(dates[p][1]);
                item.card.deleteProperty(dates[p][2]);
                item.card.deleteProperty(dates[p][3]);
            } else {
                //set
                let dateObj = new Date(value);
                item.card.setProperty(dates[p][3], dateObj.getFullYear().toString());
                item.card.setProperty(dates[p][2], (dateObj.getMonth()+1).toString());
                item.card.setProperty(dates[p][1], dateObj.getDate().toString());
            }
        }
        
        //further manipulations
        if (tbSync.db.getAccountSetting(syncdata.account, "displayoverride") == "1") {
           item.card.setProperty("DisplayName", item.card.getProperty("FirstName", "") + " " + item.card.getProperty("LastName", ""));

            if (item.card.getProperty("DisplayName", "" ) == " " )
                item.card.setProperty("DisplayName", item.card.getProperty("Company", item.card.getProperty("PrimaryEmail", "")));
        }
        
    },









    // --------------------------------------------------------------------------- //
    //read TB event and return its data as WBXML
    // --------------------------------------------------------------------------- //
    getWbxmlFromThunderbirdItem: function (item, syncdata, isException = false) {
        let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");
        let wbxml = tbSync.wbxmltools.createWBXML("", syncdata.type); //init wbxml with "" and not with precodes, and set initial codepage
        let nowDate = new Date();

        //loop over all known TB properties which map 1-to-1 (send empty value if not set)
        for (let p=0; p < this.TB_properties.length; p++) {            
            let TB_property = this.TB_properties[p];
            let EAS_property = this.map_TB_properties_to_EAS_properties[TB_property];            
            wbxml.atag(EAS_property, item.card.getProperty(TB_property,""));
        }

        //take care of birthday and anniversary
        let dates = [];
        dates.push(["Birthday", "BirthDay", "BirthMonth", "BirthYear"]);
        dates.push(["Anniversary", "AnniversaryDay", "AnniversaryMonth", "AnniversaryYear"]);
        
        for (let p=0; p < dates.length; p++) {
            let year = item.card.getProperty(dates[p][3], "");
            let month = item.card.getProperty(dates[p][2], "");
            let day = item.card.getProperty(dates[p][1], "");
            if (year && month && day) {
                //set
                if (month.length<2) month="0"+month;
                if (day.length<2) day="0"+day;
                wbxml.atag(dates[p][0], year + "-" + month + "-" + day + "T00:00:00.000Z");
            } else {
                //clear ??? outlook does not like empty value
                //wbxml.atag(dates[p][0], "");
            }
        }

        return wbxml.getBytes();
    }
    
}

eas.sync.Contacts.TB_properties = Object.keys(eas.sync.Contacts.map_TB_properties_to_EAS_properties);
