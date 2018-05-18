"use strict";

eas.sync.Contacts = {

    createItem : function () {
        return Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
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
            adoptItem: function (card) { 
                /* add card to addressbook */
                tbSync.addNewCardFromServer(card, addressbook);
            },

            modifyItem: function (newcard, existingcard) {
                /* modify card */
                addressbook.modifyCard(newcard);
            },

            deleteItem: function (card) {
                /* remove card from addressBook */
                let cardsToDelete = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
                cardsToDelete.appendElement(card);
                addressbook.deleteCards(cardsToDelete);
            },

            getItem: function (searchId) {
                /* return array of items matching */
                let items = [];
                let card = addressbook.getCardFromProperty("ServerId", searchId, true); //3rd param enables case sensitivity
                
                if (card) {
                    let item = {
                        get id() {return this.card.getProperty("ServerId", "")},
                        set id(newId) {this.card.setProperty("ServerId", newId)},
                        get icalString() {return "CardData"},
                        clone: function () { return this; } //no real clone
                    };
                    
                    //actually add the card
                    item.card = card;
                    items.push(item);
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
    setThunderbirdItemFromWbxml: function (card, data, id, syncdata) {
        let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");

        card.setProperty("ServerId", id);

        //we loop over all known TB properties
        for (let p=0; p < this.TB_properties.length; p++) {            
            let TB_property = this.TB_properties[p];
            let EAS_property = this.map_TB_properties_to_EAS_properties[TB_property];            
            let value = xmltools.checkString(data[EAS_property]);

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
            
            card.setProperty(TB_property, value);
        }
        
        //further manipulations
        if (tbSync.db.getAccountSetting(syncdata.account, "displayoverride") == "1") {
           card.setProperty("DisplayName", card.getProperty("FirstName", "") + " " + card.getProperty("LastName", ""));

            if (card.getProperty("DisplayName", "" ) == " " )
                card.setProperty("DisplayName", card.getProperty("Company", card.getProperty("PrimaryEmail", "")));
        }
        
    },









    // --------------------------------------------------------------------------- //
    //read TB event and return its data as WBXML
    // --------------------------------------------------------------------------- //
    getWbxmlFromThunderbirdItem: function (item, syncdata, isException = false) {
        let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");
        let wbxml = tbSync.wbxmltools.createWBXML("", syncdata.type); //init wbxml with "" and not with precodes, and set initial codepage
        let nowDate = new Date();

        //loop over all known TB properties
        for (let p=0; p < this.TB_properties.length; p++) {            
            let TB_property = this.TB_properties[p];
            let EAS_property = this.map_TB_properties_to_EAS_properties[TB_property];            
            wbxml.atag(EAS_property, item.card.getProperty(TB_property,""));
        }

        return wbxml.getBytes();
    }

}

eas.sync.Contacts.TB_properties = Object.keys(eas.sync.Contacts.map_TB_properties_to_EAS_properties);
