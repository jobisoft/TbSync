Components.utils.import("resource://gre/modules/Task.jsm");

var busy = false;
var nextQuery = "";
var observer = null;

tbSync.eas.onInjectIntoContactPanel = function (window) {
    // target for the MutationObserver
    let target = window.document.getElementById("sidebar");
    // configuration for the MutationObserver
    let config = { attributes: true, childList: false, characterData: false };

    // inject into already open window (will do nothing, if not open)
    tbSync.eas.onInjectIntoAddressbook(target.contentWindow.wrappedJSObject, true);
    
    // create the MutationObserver: try to inject after the src attribute has been changed, thus the URL has been loaded
    observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
          tbSync.eas.abUItimer = window.setInterval(function(){    
                let targetWindow = window.document.getElementById("sidebar").contentWindow.wrappedJSObject;
                if (targetWindow) {
                    window.clearInterval(tbSync.eas.abUItimer);
                    tbSync.eas.onInjectIntoAddressbook(targetWindow, true);
                }
            }, 1000);  
      });    
    });     
     
    observer.observe(target, config);
}

tbSync.eas.onRemoveFromContactPanel = function (window) {
    let targetWindow = window.document.getElementById("sidebar").contentWindow.wrappedJSObject;
    if (targetWindow) tbSync.eas.onRemoveFromAddressbook(targetWindow, true);
    observer.disconnect();
}





// functions called by addressbookoverlay.xul (indirect also by abContactPanelOverlay.xul)
tbSync.eas.onBeforeInjectIntoAddressbook = function (window) {
    return true;
}

tbSync.eas.onInjectIntoAddressbook = function (target, sidebar = false) {
    let searchbox =  target.document.getElementById("peopleSearchInput");
    if (searchbox) {
        searchbox.addEventListener("input", tbSync.eas.onSearchInputChanged, false);
        //let clearIcon = target.document.getAnonymousElementByAttribute(searchbox, "class", "textbox-search-clear");
        //if (clearIcon) clearIcon.addEventListener("click", tbSync.eas.clearServerSearchResults, false);

        //https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/watch
	searchbox.watch("value", function (id, oldv, newv) {if (newv == "") tbSync.eas.clearServerSearchResults(); return newv;});
    }
         
    if (!sidebar) {
        if (target.document.getElementById("abResultsTree")) target.document.getElementById("abResultsTree").addEventListener("select", tbSync.eas.onResultsPaneSelectionChanged, false);
        tbSync.eas.onResultsPaneSelectionChanged();
    }
    
}

tbSync.eas.onRemoveFromAddressbook = function (target, sidebar = false) {
    let searchbox =  target.document.getElementById("peopleSearchInput");
    if (searchbox) {
        searchbox.removeEventListener("input", tbSync.eas.onSearchInputChanged, false);
        //let clearIcon = target.document.getAnonymousElementByAttribute(searchbox, "class", "textbox-search-clear");
        //if (clearIcon) clearIcon.removeEventListener("click", tbSync.eas.clearServerSearchResults, false);
	searchbox.unwatch("value");
    }

    if (!sidebar) {
        if (target.document.getElementById("abResultsTree")) target.document.getElementById("abResultsTree").removeEventListener("select", tbSync.eas.onResultsPaneSelectionChanged, false);
    }
}





tbSync.eas.onResultsPaneSelectionChanged = function () {
    let cards = window.GetSelectedAbCards();
    let email3Box = window.document.getElementById("cvEmail3Box");
    let email3Element = window.document.getElementById("cvEmail3");
    if (email3Box && cards.length == 1) {
        //is this an EAS card?
        let aParentDirURI = tbSync.getUriFromPrefId(cards[0].directoryId.split("&")[0]);
        if (aParentDirURI) { //could be undefined
            let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
            if (folders.length > 0) {
                email3Box.hidden = false;
                let email3Value = cards[0].getProperty("Email3Address","");
                window.HandleLink(email3Element, window.zSecondaryEmail, email3Value, email3Box, "mailto:" + email3Value);
                return;
            }
        }
    }
    email3Box.hidden = true;
}

tbSync.eas.clearServerSearchResultsIfNeeded = function () {
    let targetWindow = window.document.getElementById("sidebar") ? window.document.getElementById("sidebar").contentWindow.wrappedJSObject : window;    
    let searchbox =  targetWindow.document.getElementById("peopleSearchInput");
    tbSync.window.console.log('* CHANGE TO : '+searchbox.value+' **************************************************************');
    if (searchbox && searchbox.value == "") tbSync.eas.clearServerSearchResults();
}

tbSync.eas.clearServerSearchResults = function () {
    tbSync.window.console.log('* CLEARING **************************************************************');
    let targetWindow = window.document.getElementById("sidebar") ? window.document.getElementById("sidebar").contentWindow.wrappedJSObject : window;
    let target = targetWindow.GetSelectedDirectory();
    let addressbook = tbSync.getAddressBookObject(target);
    let oldresults = addressbook.getCardsFromProperty("X-Server-Searchresult", "EAS", true);
    let cardsToDelete = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
    while (oldresults.hasMoreElements()) {
        cardsToDelete.appendElement(oldresults.getNext(), "");
    }
    addressbook.deleteCards(cardsToDelete);    
}

tbSync.eas.onSearchInputChanged = Task.async (function* () {
    let targetWindow = window.document.getElementById("sidebar") ? window.document.getElementById("sidebar").contentWindow.wrappedJSObject : window;
    let searchbox =  targetWindow.document.getElementById("peopleSearchInput");
    let query = searchbox.value;
        
    let target = targetWindow.GetSelectedDirectory();
    let addressbook = tbSync.getAddressBookObject(target);
    
    let folders = tbSync.db.findFoldersWithSetting("target", target);
    if (folders.length>0) {
        let account = folders[0].account;
        if (tbSync.db.getAccountSetting(account, "allowedEasCommands").split(",").includes("Search")) {

            if (query.length<3) {
                //delete all old results
                tbSync.eas.clearServerSearchResults();
                targetWindow.onEnterInSearchBar();
            } else {
                nextQuery = query;                
                if (!busy) {
                    busy = true;
                    while (busy) {

                        yield tbSync.sleep(1000);
                        let currentQuery = nextQuery;
                        nextQuery = "";
                        let results = yield tbSync.eas.searchGAL (account, currentQuery);

                        //delete all old results
                        tbSync.eas.clearServerSearchResults();

                        tbSync.window.console.log('* ADDING **************************************************************');
                        for (let count = 0; count < results.length; count++) {
                            if (results[count].Properties) {
                                tbSync.window.console.log('Found contact:' + results[count].Properties.DisplayName);
                                let newItem = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
                                newItem.setProperty("X-Server-Searchresult", "EAS");
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
                        targetWindow.onEnterInSearchBar();
                        if (nextQuery == "") busy = false;
                    }
                }
            }            
        }
    }
})
