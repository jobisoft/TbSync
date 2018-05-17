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
    
    
    
    
    

    // --------------------------------------------------------------------------- //
    // Read WBXML and set Thunderbird item
    // --------------------------------------------------------------------------- //
    setThunderbirdItemFromWbxml: function (card, data, id, syncdata) {
        let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");

        card.setProperty("ServerId", id); //temp ID, see listeners

        card.setProperty("FirstName", xmltools.checkString(data.FirstName));
        card.setProperty("LastName", xmltools.checkString(data.LastName));
        card.setProperty("DisplayName", xmltools.checkString(data.FileAs));

        let receivedEmail = xmltools.checkString(data.Email1Address);
        let parsedInput = MailServices.headerParser.makeFromDisplayAddress(receivedEmail);
        let reducedEmail =  (parsedInput && parsedInput[0] && parsedInput[0].email) ? parsedInput[0].email : receivedEmail;
        if (reducedEmail != receivedEmail) tbSync.dump("Parsing email display string via RFC 2231 and RFC 2047 (Email1Address)", receivedEmail + " -> " + reducedEmail);
        card.setProperty("PrimaryEmail", reducedEmail);

        if (tbSync.db.getAccountSetting(syncdata.account, "displayoverride") == "1") {
           card.setProperty("DisplayName", card.getProperty("FirstName", "") + " " + card.getProperty("LastName", ""));

            if (card.getProperty("DisplayName", "" ) == " " )
                card.setProperty("DisplayName", card.getProperty("Company", card.getProperty("PrimaryEmail", "")));
        }
        
        /* 
<ServerId>7%3A1</ServerId>
<ApplicationData>
<BusinessPhoneNumber xmlns='Contacts'>%2B1%20(123)%20456789</BusinessPhoneNumber>
<Email1Address xmlns='Contacts'>demouser%40mail.com</Email1Address>
<FileAs xmlns='Contacts'>User%2C%20Demo</FileAs>
<FirstName xmlns='Contacts'>Demo</FirstName>
<LastName xmlns='Contacts'>User</LastName>
</ApplicationData>        
*/
    },









    // --------------------------------------------------------------------------- //
    //read TB event and return its data as WBXML
    // --------------------------------------------------------------------------- //
    getWbxmlFromThunderbirdItem: function (item, syncdata, isException = false) {
        let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");
        let wbxml = tbSync.wbxmltools.createWBXML("", syncdata.type); //init wbxml with "" and not with precodes, and set initial codepage
        let nowDate = new Date();

        wbxml.atag("FirstName", item.card.getProperty("FirstName",""));
        wbxml.atag("LastName", item.card.getProperty("LastName",""));
        wbxml.atag("FileAs", item.card.getProperty("DisplayName",""));
        wbxml.atag("Email1Address", item.card.getProperty("PrimaryEmail",""));

        return wbxml.getBytes();
    }

}
