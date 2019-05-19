/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

//derived from https://dxr.mozilla.org/comm-central/source/mozilla/accessible/tests/mochitest/autocomplete.js
var abAutoComplete = {

    tbSyncAutoCompleteSearch : null,

    /**
     * Register 'tbSyncAutoCompleteSearch' AutoCompleteSearch.
     */
    load : function () {
      abAutoComplete.tbSyncAutoCompleteSearch = new abAutoComplete.Search("tbSyncAutoCompleteSearch");
      abAutoComplete.register(abAutoComplete.tbSyncAutoCompleteSearch, "AutoCompleteSearch");
    },

    /**
     * Unregister 'tbSyncAutoCompleteSearch' AutoCompleteSearch.
     */
    unload : function () {
      abAutoComplete.unregister(abAutoComplete.tbSyncAutoCompleteSearch);
      abAutoComplete.tbSyncAutoCompleteSearch.cid = null;
      abAutoComplete.tbSyncAutoCompleteSearch = null;
    },


    /**
     * Register the given AutoCompleteSearch.
     *
     * @param aSearch       [in] AutoCompleteSearch object
     * @param aDescription  [in] description of the search object
     */
    register : function (aSearch, aDescription) {
      var name = "@mozilla.org/autocomplete/search;1?name=" + aSearch.name;

      var uuidGenerator = Components.classes["@mozilla.org/uuid-generator;1"].getService(Components.interfaces.nsIUUIDGenerator);
      var cid = uuidGenerator.generateUUID();

      var componentManager = Components.manager.QueryInterface(Components.interfaces.nsIComponentRegistrar);
      componentManager.registerFactory(cid, aDescription, name, aSearch);

      // Keep the id on the object so we can unregister later.
      aSearch.cid = cid;
    },

    /**
     * Unregister the given AutoCompleteSearch.
     */
    unregister : function (aSearch) {
      var componentManager = Components.manager.QueryInterface(Components.interfaces.nsIComponentRegistrar);
      componentManager.unregisterFactory(aSearch.cid, aSearch);
    },


    /**
     * nsIAutoCompleteSearch implementation.
     *
     * @param aName       [in] the name of autocomplete search
     */
    Search : function (aName) {
      this.name = aName;
    },




    /**
     * nsIAutoCompleteResult implementation.
     */
    Result : function (aValues, aComments) {
      this.values = aValues;
      this.comments = aComments;

      if (this.values.length > 0)
        this.searchResult = Components.interfaces.nsIAutoCompleteResult.RESULT_SUCCESS;
      else
        this.searchResult = Components.interfaces.nsIAutoCompleteResult.NOMATCH;
    },

}





abAutoComplete.Search.prototype = {
      constructor: abAutoComplete.Search,

      // nsIAutoCompleteSearch implementation
      startSearch : function (aSearchString, aSearchParam, aPreviousResult, aListener) {
        this.getAutoCompleteResultFor(aSearchString).then(result => aListener.onSearchResult(this, result));
      },

      stopSearch() {},

      // nsISupports implementation
      QueryInterface: XPCOMUtils.generateQI(["nsIFactory", "nsIAutoCompleteSearch"]), //ChromeUtils

      // nsIFactory implementation
      createInstance(outer, iid) {
        return this.QueryInterface(iid);
      },

      // Search name. Used by AutoCompleteController.
      name: null,

      /**
       * Return AutoCompleteResult for the given search string.
       */
      getAutoCompleteResultFor : async function (aSearchString) {
        //check each account and init server request
        let accounts = tbSync.db.getAccounts();
        let requests = [];
        let values = [];
        let comments = [];
          
        if (aSearchString.length > 3) {
            for (let i=0; i<accounts.IDs.length; i++) {
                let account = accounts.IDs[i];
                let provider = accounts.data[account].provider;
                let status = accounts.data[account].status;
                
                if (status == "disabled") continue;
                
                //start all requests parallel (do not wait till done here, no await, push the promise)
                if (tbSync.providers[provider].api.abServerSearch) {
                    try {
                        requests.push(tbSync.providers[provider].api.abServerSearch (account, aSearchString, "autocomplete"));
                    } catch (e) {}
                }
            }
            
            //wait for all requests to finish (only have to wait for the slowest, all others are done)
            for (let r=0; r < requests.length; r++) {
                try {
                    let results = await requests[r];
                    for (let count=0; count < results.length; count++) {
                        if (results[count].autocomplete) {
                            values.push(results[count].autocomplete.value);
                            comments.push(results[count].autocomplete.account);
                        }
                    }
                } catch (e) {};
            }
        }
        
        return new abAutoComplete.Result(values, comments);
      }
}

abAutoComplete.Result.prototype = {
      constructor: abAutoComplete.Result,

      searchString: "",
      searchResult: null,

      defaultIndex: 0,

      get matchCount() {
        return this.values.length;
      },

      getValueAt(aIndex) {
        return this.values[aIndex];
      },

    /**
     * This returns the string that is displayed in the dropdown
     */
      getLabelAt(aIndex) {
        return "  " + this.getValueAt(aIndex);
      },

    /**
     * Get the comment of the result at the given index (holds the account this search result belongs to)
     */
      getCommentAt(aIndex) {
        return tbSync.db.getAccountSetting(this.comments[aIndex], "accountname");
      },

    /**
     * Get the style hint for the result at the given index
     */
      getStyleAt(aIndex) {
        return null;
      },

    /**
     * Get the image of the result at the given index
     */
      getImageAt(aIndex) {
        let accountObject = new tbSync.AccountObject(this.comments[aIndex]);
        return tbSync.providers[accountObject.getAccountSetting("provider")].api.getProviderIcon(16, accountObject);
      },

    /**
     * Get the final value that should be completed when the user confirms
     * the match at the given index.
     */
      getFinalCompleteValueAt(aIndex) {
        return this.getValueAt(aIndex);
      },

      removeValueAt(aRowIndex, aRemoveFromDb) {},

      // nsISupports implementation
      QueryInterface: XPCOMUtils.generateQI(["nsIAutoCompleteResult"]), //ChromeUtils

      // Data
      values: null,
      comments: null
}
