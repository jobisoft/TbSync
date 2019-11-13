/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var passwordManager = {

  load: async function () {
  },

  unload: async function () {
  },

  removeLoginInfos: function(origin, realm, users) {
    let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");

    let logins = Services.logins.findLogins(origin, null, realm);
    for (let i = 0; i < logins.length; i++) {
      if (users.includes(logins[i].username)) {
        let currentLoginInfo = new nsLoginInfo(origin, null, realm, logins[i].username, logins[i].password, "", "");
        try {
          Services.logins.removeLogin(currentLoginInfo);
        } catch (e) {
          TbSync.dump("Error removing loginInfo", e);
        }
      }
    }
  },

  updateLoginInfo: function(origin, realm, oldUser, newUser, newPassword) {
    let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
    
    this.removeLoginInfos(origin, realm, [oldUser, newUser]);
    
    let newLoginInfo = new nsLoginInfo(origin, null, realm, newUser, newPassword, "", "");
    try {
      Services.logins.addLogin(newLoginInfo);
    } catch (e) {
      TbSync.dump("Error adding loginInfo", e);
    }
  },
  
  getLoginInfo: function(origin, realm, user) {
    let logins = Services.logins.findLogins(origin, null, realm);
    for (let i = 0; i < logins.length; i++) {
      if (logins[i].username == user) {
        return logins[i].password;
      }
    }
    return null;
  },

  
  /** data obj
    windowID
    accountName
    userName
    userNameLocked
  
  reference is an object in which an entry with windowID will be placed to hold a reference to the prompt window (so it can be closed externaly)
  */
  asyncPasswordPrompt: async function(data, reference) {
    if (data.windowID) {
      let url = "chrome://tbsync/content/passwordPrompt/passwordPrompt.xul";
  
      return await new Promise(function(resolve, reject) {
       reference[data.windowID] = TbSync.window.openDialog(url, "TbSyncPasswordPrompt:" + data.windowID, "centerscreen,chrome,resizable=no", data, resolve);
      });
    }
    
    return false;
  },  
  
  asyncOAuthPrompt: async function(data, reference) {
    if (data.windowID) {
    
      let parameters = [];
      for (let key of Object.keys(data.auth_opt)) {
        parameters.push(key + "=" + encodeURIComponent(data.auth_opt[key])); 
      }
      let auth_url = data.auth_url + "?" + parameters.join("&");      
      reference[data.windowID] = TbSync.window.openDialog(auth_url, "TbSyncOAuthPrompt:" + data.windowID, "centerscreen,chrome,width=500,height=700");
      console.log("auth_url: " + auth_url);

      let timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);

      // Try to get an auth code
      let auth_rv = await new Promise(function(resolve, reject) {
        var loaded = false;
        var last_url = "";
        
        let event = { 
          notify: function(timer) {
            let done = false;
            let rv = {};

            try {
              let url = reference[data.windowID].location.href;
              if (last_url != url) console.log("current_url:" + url);
              last_url = url;
              
              // Must be set after accessing the location.href (which might fail).
              loaded = true;
              
              // Abort, if we hit the redirect_url.
              if (url.startsWith(data.auth_redirect_uri)) {

                let parts = url.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(m,key,value) {
                  rv[key] = value;
                });

                done = true;                
              }
            } catch (e) {
              // Did the window has been loaded, but the user closed it?
              if (loaded) done = true;
              //Components.utils.reportError(e);
            }
            
            if (done) {
              timer.cancel();
              resolve({code: rv[data.auth_codefield], error: decodeURIComponent(rv["error_description"])});
            }
            
          }
        }
        
        timer.initWithCallback(event, 200, Components.interfaces.nsITimer.TYPE_REPEATING_SLACK);          
      });

      try {
        reference[data.windowID].close();
        reference[data.windowID] = null;
      } catch (e) {
        //Components.utils.reportError(e);
      }
            
      console.log("authCode:" + auth_rv.code);
      if (!auth_rv.code)
        throw new Error(auth_rv.error);
      
      // Try to get an access token
      let accessToken = await new Promise(function(resolve, reject) {        
          let req = new XMLHttpRequest();
          req.mozBackgroundRequest = true;
          req.open("POST", data.access_url, true);
          req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded"); // POST data needs to be urlencoded!

          req.onerror = function () {
            reject("OAUTH Error");
          };

          let parameters = [];
          for (let key of Object.keys(data.access_opt)) {
            parameters.push(key + "=" + encodeURIComponent(data.access_opt[key])); 
          }
          parameters.push(data.access_codefield + "=" + auth_rv.code);
          
          req.onload = function() {              
              switch(req.status) {
                  case 200: //OK
                    {
                      console.log(req.responseText);
                      resolve(JSON.parse(req.responseText).access_token);
                    }                      
                    break;
                    
                  default:
                      reject("OAUTH Error ("+ req.status +")");
              }
          };

          req.send(parameters.join("&"));
      });      

      return accessToken;
      
    }    
    return false;
  },    
}
