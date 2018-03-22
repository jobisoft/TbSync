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
                addressbook.addCard(card);
            }

            modifyItem: function (newcard, existingcard) {
                /* modify card */
                addressbook.modifyCard(newcard);
            }

            deleteItem: function (card) {
                /* remove card from addressBook */
                let cardsToDelete = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
                cardsToDelete.appendElement(card);
                addressbook.deleteCards(cardsToDelete);
            }

            getItem: function (searchId) {
                /* return array of items matching */
                let items = [];
                let card = addressbook.getCardFromProperty("X-EAS-ID", searchId, true); //3rd param enables case sensitivity
                
                if (card) {
                    let item = {
                        get id() {return searchId};
                        get title() {return null};
                        get icalString() {return null};
                        set id(setId) {};
                        clone: function () { return this; } //no real clone
                    };
                    
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
