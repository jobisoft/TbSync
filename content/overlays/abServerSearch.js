/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

var tbSyncAbServerSearch = {

    onInject: function (window) {
        this._eventHandler = tbSyncAbServerSearch.eventHandlerWindowReference(window);
        
        let searchbox =  window.document.getElementById("peopleSearchInput");
        if (searchbox) {
            this._searchValue = searchbox.value;
            this._searchValuePollHandler = window.setInterval(function(){tbSyncAbServerSearch.searchValuePoll(window, searchbox)}, 200);
            this._eventHandler.addEventListener(searchbox, "input", false);
        }
        
        let dirtree = window.document.getElementById("dirTree");
        if (dirtree) {
            this._eventHandler.addEventListener(dirtree, "select", false);        
        }
    },
    
    onRemove: function (window) {
        let searchbox =  window.document.getElementById("peopleSearchInput");
        if (searchbox) {
            this._eventHandler.removeEventListener(searchbox, "input", false);
            window.clearInterval(this._searchValuePollHandler);
        }

        let dirtree = window.document.getElementById("dirTree");
        if (dirtree) {
            this._eventHandler.removeEventListener(dirtree, "select", false);        
        }
    },    

    eventHandlerWindowReference: function (window) {
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
                    tbSyncAbServerSearch.onSearchInputChanged(this.window);
                    break;
                case "select":
                    {
                        tbSyncAbServerSearch.clearServerSearchResults(this.window);
                        let searchbox =  window.document.getElementById("peopleSearchInput");
                        let target = window.GetSelectedDirectory();
                        if (searchbox && target) {
                            let folders = tbSync.db.findFolders({"target": target});
                            if (folders.length == 1 && tbSync.providers[tbSync.db.getAccountProperty(folders[0].accountID, "provider")].api.abServerSearch) {
                                searchbox.setAttribute("placeholder", tbSync.getString("addressbook.searchgal::" + tbSync.db.getAccountProperty(folders[0].accountID, "accountname")));
                            } else {
                                searchbox.setAttribute("placeholder", tbSync.getString((target == "moz-abdirectory://?") ? "addressbook.searchall" : "addressbook.searchthis"));
                            }
                        }
                    }
                    break;
            }
        };
        return this;
    },

    searchValuePoll: function (window, searchbox) {
        let value = searchbox.value;
        if (this._searchValue != "" && value == "") {
            tbSyncAbServerSearch.clearServerSearchResults(window);
        }
        this._searchValue = value;
    },

    clearServerSearchResults: function (window) {
        let target = window.GetSelectedDirectory();
        if (target == "moz-abdirectory://?") return; //global search not yet(?) supported
        
        let addressbook = tbSync.addressbook.getAddressBookObject(target);
        if (addressbook) {
            try {
                let oldresults = addressbook.getCardsFromProperty("X-Server-Searchresult", "TbSync", true);
                let cardsToDelete = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
                while (oldresults.hasMoreElements()) {
                    cardsToDelete.appendElement(oldresults.getNext(), false);
                }
                addressbook.deleteCards(cardsToDelete);
            } catch (e) {
                //if  getCardsFromProperty is not implemented, do nothing
            }
        }
    },

    onSearchInputChanged: async function (window) {
        let target = window.GetSelectedDirectory();
        if (target == "moz-abdirectory://?") return; //global search not yet(?) supported
        
        let folders = tbSync.db.findFolders({"target": target});
        if (folders.length == 1) {
            let searchbox = window.document.getElementById("peopleSearchInput");
            let query = searchbox.value;        
            let addressbook = tbSync.addressbook.getAddressBookObject(target);

            let accountID = folders[0].accountID;
            let provider = tbSync.db.getAccountProperty(accountID, "provider");
            let accountname = tbSync.db.getAccountProperty(accountID, "accountname");
            if (tbSync.providers[provider].api.abServerSearch) {

                if (query.length<3) {
                    //delete all old results
                    tbSyncAbServerSearch.clearServerSearchResults(window);
                    window.onEnterInSearchBar();
                } else {
                    this._serverSearchNextQuery = query;                
                    if (this._serverSearchBusy) {
                        //NOOP
                    } else {
                        this._serverSearchBusy = true;
                        while (this._serverSearchBusy) {

                            await tbSync.tools.sleep(1000);
                            let currentQuery = this._serverSearchNextQuery;
                            this._serverSearchNextQuery = "";
                            let results = await tbSync.providers[provider].api.abServerSearch (accountID, currentQuery, "search");

                            //delete all old results
                            tbSyncAbServerSearch.clearServerSearchResults(window);

                            for (let count = 0; count < results.length; count++) {
                                let newItem = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
                                for (var prop in results[count].properties) {
                                    if (results[count].properties.hasOwnProperty(prop)) {
                                        newItem.setProperty(prop, results[count].properties[prop]);
                                    }
                                }
                                newItem.setProperty("X-Server-Searchresult", "TbSync");
                                addressbook.addCard(newItem);
                            }   
                            window.onEnterInSearchBar();
                            if (this._serverSearchNextQuery == "") this._serverSearchBusy = false;
                        }
                    }
                }            
            }
        }
    }
}