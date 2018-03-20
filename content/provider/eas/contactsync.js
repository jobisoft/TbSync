"use strict";

eas.sync.Contacts = {

    createItem : function () {
        return Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
    },
    
    promisifyAddressbook: function (addressBook) {
    /* 
        Needed API: 
            adoptItem(card);                    - add card to addressbook
            modifyItem(newcard, existingcard)   - modify card
            deleteItem(card);                   - remove card from addressBook
            getItem(id)                         - return array of items matching; each item must support
                                                    get id
                                                    get title
                                                    get icalString
                                                    set id
                                                    clone()

        Avail API:
            addressBook.modifyCard(card);
            addressBook.getCardFromProperty("localId", ClientId, false);
            addressBook.deleteCards(cardsToDelete);
            addressbook.addCard(card);
            card.setProperty('ServerId', ServerId);
    */
    },
    
    
    
    
    

    // --------------------------------------------------------------------------- //
    // Read WBXML and set Thunderbird item
    // --------------------------------------------------------------------------- //
    setThunderbirdItemFromWbxml: function (item, data, id, syncdata) {
                let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");

    },









    // --------------------------------------------------------------------------- //
    //read TB event and return its data as WBXML
    // --------------------------------------------------------------------------- //
    getWbxmlFromThunderbirdItem: function (item, syncdata, isException = false) {
        let asversion = tbSync.db.getAccountSetting(syncdata.account, "asversion");
        let wbxml = tbSync.wbxmltools.createWBXML("", syncdata.type); //init wbxml with "" and not with precodes, and set initial codepage
        let nowDate = new Date();

        return wbxml.getBytes();
    }

}
