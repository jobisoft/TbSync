/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
var cardbook = {

  load: async function () {
    //check for cardbook
    this.cardbook = await AddonManager.getAddonByID("cardbook@vigneau.philippe") ;
  },

  unload: async function () {
  },

}
