/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");


function startup(addon, extension, browser) {
  let defaults = Services.prefs.getDefaultBranch("extensions.tbsync.");
  defaults.setBoolPref("debug.testoptions", false);
  defaults.setBoolPref("log.toconsole", false);
  defaults.setIntPref("log.userdatalevel", 0); //0 - off   1 - userdata only on errors   2 - including full userdata,  3 - extra infos

  if (!TbSync.enabled) TbSync.load(addon, extension);
}

function shutdown(addon, extension, browser) {
  var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

  TbSync.enabled = false;

  //unload TbSync module
  TbSync.dump("TbSync shutdown","Unloading TbSync modules.");
  TbSync.unload().then(function() {
    Cu.unload("chrome://tbsync/content/tbsync.jsm");
    Cu.unload("chrome://tbsync/content/HttpRequest.jsm");
    Cu.unload("chrome://tbsync/content/OverlayManager.jsm");
  });
}