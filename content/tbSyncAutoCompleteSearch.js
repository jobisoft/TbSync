"use strict";

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

//derived from https://dxr.mozilla.org/comm-central/source/mozilla/accessible/tests/mochitest/autocomplete.js
var autocomplete = {

    tbSyncAutoCompleteSearch : null,

    /**
     * Register 'tbSyncAutoCompleteSearch' AutoCompleteSearch.
     *
     * @param aValues [in] set of possible results values
     * @param aComments [in] set of possible results descriptions
     */
    init : function () {
      var allResults = new autocomplete.ResultsHeap();
      autocomplete.tbSyncAutoCompleteSearch = new autocomplete.Search("tbSyncAutoCompleteSearch", allResults);
      autocomplete.register(autocomplete.tbSyncAutoCompleteSearch, "AutoCompleteSearch");
    },

    /**
     * Unregister 'tbSyncAutoCompleteSearch' AutoCompleteSearch.
     */
    shutdown : function () {
      autocomplete.unregister(autocomplete.tbSyncAutoCompleteSearch);
      autocomplete.tbSyncAutoCompleteSearch.cid = null;
      autocomplete.tbSyncAutoCompleteSearch = null;
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
     * A container to keep all possible results of autocomplete search.
     */
    ResultsHeap : function () {
    },



    /**
     * nsIAutoCompleteSearch implementation.
     *
     * @param aName       [in] the name of autocomplete search
     * @param aAllResults [in] ResultsHeap object
     */
    Search : function (aName, aAllResults) {
      this.name = aName;
      this.allResults = aAllResults;
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





autocomplete.ResultsHeap.prototype = {
      constructor: autocomplete.ResultsHeap,

      /**
       * Return AutoCompleteResult for the given search string.
       */
      getAutoCompleteResultFor(aSearchString) {
        //fake dummy dataset
        var _v = [ "hello", "hi" ];
        var _c = [ "Beep beep'm beep beep yeah", "Baby you can drive my car" ];
          
        var values = [], comments = [];
        for (var idx = 0; idx < _v.length; idx++) {
          if (_v[idx].includes(aSearchString)) {
            values.push(_v[idx]);
            comments.push(_c[idx]);
          }
        }
        return new autocomplete.Result(values, comments);
      }
}

autocomplete.Search.prototype = {
      constructor: autocomplete.Search,

      // nsIAutoCompleteSearch implementation
      startSearch(aSearchString, aSearchParam, aPreviousResult, aListener) {
        var result = this.allResults.getAutoCompleteResultFor(aSearchString);
        aListener.onSearchResult(this, result);
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

      // Results heap.
      allResults: null
}

autocomplete.Result.prototype = {
      constructor: autocomplete.Result,

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
        return this.getValueAt(aIndex);
      },

    /**
     * Get the comment of the result at the given index
     */
      getCommentAt(aIndex) {
        return this.comments[aIndex];
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
        return "chrome://tbsync/skin/contacts16.png";
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
