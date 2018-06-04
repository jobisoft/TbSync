Components.utils.import("resource://gre/modules/Task.jsm");

var serverSearch = {};

serverSearch.eventHandlerWindowReference = function (window) {
	this.window = window;
    
    this.removeEventListener = function (element, type, bubble) {
        element.removeEventListener(type, this, bubble);
    };

    this.addEventListener = function (element, type, bubble) {
        element.addEventListener(type, this, bubble);
    };
    
    this.handleEvent = function(event) {
        switch(event.type) {
            case 'input':
                serverSearch.onSearchInputChanged(this.window);
            break;
        }
    };
    return this;
}

//this is used in multiple places (addressbook + contactsidebar) so we cannot use objects of tbSync to store states, but need to store distinct variables
//in the window scope -> window.tbSync_XY

serverSearch.onInjectIntoAddressbook = function (window) {
    let searchbox =  window.document.getElementById("peopleSearchInput");
    if (searchbox) {
        window.tbSync_eventHandler = serverSearch.eventHandlerWindowReference(window);
        window.tbSync_eventHandler.addEventListener(searchbox, "input",false);
        
        //https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/watch
        searchbox.watch("value", function (id, oldv, newv) {if (newv == "") serverSearch.clearServerSearchResults(window); return newv;});
    }
}

serverSearch.onRemoveFromAddressbook = function (window) {
    let searchbox =  window.document.getElementById("peopleSearchInput");
    if (searchbox) {
        window.tbSync_eventHandler.removeEventListener(searchbox, "input",false);
        searchbox.unwatch("value");
    }
}

serverSearch.clearServerSearchResults = function (window) {
    let target = window.GetSelectedDirectory();
    let addressbook = tbSync.getAddressBookObject(target);
    let oldresults = addressbook.getCardsFromProperty("X-Server-Searchresult", "TbSync", true);
    let cardsToDelete = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
    while (oldresults.hasMoreElements()) {
        cardsToDelete.appendElement(oldresults.getNext(), "");
    }
    addressbook.deleteCards(cardsToDelete);    
}

serverSearch.onSearchInputChanged = Task.async (function* (window) {
    let searchbox =  window.document.getElementById("peopleSearchInput");
    let query = searchbox.value;
        
    let target = window.GetSelectedDirectory();
    let addressbook = tbSync.getAddressBookObject(target);
    
    let folders = tbSync.db.findFoldersWithSetting("target", target);
    if (folders.length>0) {
        let account = folders[0].account;
        let provider = tbSync.db.getAccountSetting(account, "provider");
        if (tbSync.db.getAccountSetting(account, "allowedEasCommands").split(",").includes("Search") && tbSync[provider].abServerSearch) {

            if (query.length<3) {
                //delete all old results
                serverSearch.clearServerSearchResults(window);
                window.onEnterInSearchBar();
            } else {
                window.tbSync_serverSearchNextQuery = query;                
                if (window.tbSync_serverSearchBusy) {
                } else {
                    window.tbSync_serverSearchBusy = true;
                    while (window.tbSync_serverSearchBusy) {

                        yield tbSync.sleep(1000);
                        let currentQuery = window.tbSync_serverSearchNextQuery;
                        window.tbSync_serverSearchNextQuery = "";
                        let results = yield tbSync[provider].abServerSearch (account, currentQuery);

                        //delete all old results
                        serverSearch.clearServerSearchResults(window);

                        for (let count = 0; count < results.length; count++) {
                            if (results[count].Properties) {
                                //tbSync.window.console.log('Found contact:' + results[count].Properties.DisplayName);
                                let newItem = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
                                newItem.setProperty("X-Server-Searchresult", "TbSync");
                                newItem.setProperty("FirstName", results[count].Properties.FirstName);
                                newItem.setProperty("LastName", results[count].Properties.LastName);
                                newItem.setProperty("DisplayName", results[count].Properties.DisplayName + " (Result)");
                                newItem.setProperty("PrimaryEmail", results[count].Properties.EmailAddress);

                                newItem.setProperty("CellularNumber", results[count].Properties.MobilePhone);
                                newItem.setProperty("HomePhone", results[count].Properties.HomePhone);
                                newItem.setProperty("WorkPhone", results[count].Properties.Phone);
                                newItem.setProperty("Company", results[count].Properties.Company);
                                newItem.setProperty("Department", results[count].Properties.Title);
                                newItem.setProperty("JobTitle", results[count].Properties.Office);

                                /* unmapped:
                                                        gal:
                                                        gal:Office
                                                        gal:Title
                                                        gal:Company
                                                        gal:Picture
                                                        gal:Data
                                            */

                                addressbook.addCard(newItem);
                            }
                        }   
                        window.onEnterInSearchBar();
                        if (window.tbSync_serverSearchNextQuery == "") window.tbSync_serverSearchBusy = false;
                    }
                }
            }            
        }
    }
})
