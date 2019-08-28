/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

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
  Result : function (aValues, aComments, aStyles, aIcons) {
    this.values = aValues;
    this.comments = aComments;
    this.styles = aStyles;
    this.icons = aIcons;
   
    if (this.values.length > 0)
    this.searchResult = Components.interfaces.nsIAutoCompleteResult.RESULT_SUCCESS;
    else
    this.searchResult = Components.interfaces.nsIAutoCompleteResult.NOMATCH;
  },

  
  
  
  Request: async function(accountData, aSearchString) {
    let entries = await TbSync.providers[accountData.getAccountProperty("provider")].Base.abAutoComplete(accountData, aSearchString);
    return entries.map(entry => ({ ...entry, id: accountData.accountID }));
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
  QueryInterface: ChromeUtils.generateQI(["nsIFactory", "nsIAutoCompleteSearch"]),

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
    let accounts = TbSync.db.getAccounts();
    let requests = [];
    let values = [];
    let comments = [];
    let styles = [];
    let icons = [];
     
    for (let i=0; i<accounts.IDs.length; i++) {
      let accountID = accounts.IDs[i];
     
      let accountData = new TbSync.AccountData(accountID);
      let provider = accountData.getAccountProperty("provider");
      let status = accountData.getAccountProperty("status");
      
      if (status == "disabled") continue;
      //start all requests parallel (do not wait till done here, push the promise)
      if (TbSync.providers[provider].Base.abAutoComplete) {
        try {
          requests.push(TbSync.abAutoComplete.Request(accountData, aSearchString));
        } catch (e) {}
      }
    }
    
    //wait for all requests to finish (only have to wait for the slowest, all others are done)
    for (let r=0; r < requests.length; r++) {
      try {
        let result = await requests[r];
        for (let count=0; count < result.length; count++) {
          values.push(result[count].value);
          comments.push(result[count].comment);
          styles.push(result[count].style);
          icons.push(result[count].icon);
        }
      } catch (e) {};
    }
    
    return new abAutoComplete.Result(values, comments, styles, icons);
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
   * Get the comment of the result at the given index
   */
  getCommentAt(aIndex) {
    return " " + this.comments[aIndex];
  },

  /**
   * Get the style hint for the result at the given index
   */
  getStyleAt(aIndex) {
    return this.styles[aIndex] ? this.styles[aIndex] : null;
  },

  /**
   * Get the image of the result at the given index
   */
  getImageAt(aIndex) {
    return this.icons[aIndex] ?  this.icons[aIndex] : null;
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
  QueryInterface: ChromeUtils.generateQI(["nsIAutoCompleteResult"]),

  // Data
  values: null,
  comments: null,
  styles: null,
  icons: null,
}
