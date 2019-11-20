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
  
  
  getOAuthToken: function(currentTokenString, type = "access") {
    try {
      let tokens = JSON.parse(currentTokenString);
      if (tokens.hasOwnProperty(type))
        return tokens[type];
    } catch (e) {
      //NOOP
    }
    return "";
  },
  
  // returns obj: {error, tokens}
  // https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow#refresh-the-access-token
  asyncOAuthPrompt: async function(data, reference, currentTokenString = "", refreshOnly = false) {
    if (data.windowID) {      
     
      // Before actually asking the user again, assume we have a refresh token, and can get a new token silently
      let step2Url = data.refresh.url;
      let step2RequestParameters = data.refresh.requestParameters;
      let step2ResponseFields = data.refresh.responseFields;
      let step2Token = this.getOAuthToken(currentTokenString, "refresh");

      if (!step2Token) {
        if (refreshOnly) {
          return {
            error: "RefreshOnlyButRefreshFailed", 
            tokens: JSON.stringify({access: "", refresh: ""})
          }
        }
        
        let parameters = [];
        for (let key of Object.keys(data.auth.requestParameters)) {
          parameters.push(key + "=" + encodeURIComponent(data.auth.requestParameters[key])); 
        }
        let authUrl = data.auth.url + "?" + parameters.join("&");      
        reference[data.windowID] = TbSync.window.openDialog(authUrl, "TbSyncOAuthPrompt:" + data.windowID, "centerscreen,chrome,width=500,height=700");
        let timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);

        // Try to get an auth token
        const {authToken, errorStep1} = await new Promise(function(resolve, reject) {
          var loaded = false;
          
          let event = { 
            notify: function(timer) {
              let done = false;
              let rv = {};

              try {
                let url = reference[data.windowID].location.href;
                
                // Must be set after accessing the location.href (which might fail).
                loaded = true;
                
                // Abort, if we hit the redirectUrl
                if (url.startsWith(data.auth.redirectUrl)) {
                  let parts = url.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(m,key,value) {
                    rv[key] = decodeURIComponent(value);
                  });
                  done = true;                
                }
              } catch (e) {
                // Did the window has been loaded, but the user closed it?
                if (loaded) {
                  done = "OAuthAbortError";
                }
                //Components.utils.reportError(e);
              }
              
              if (done) {
                timer.cancel();

                let errorStep1 = "";
                if (done !==true) errorStep1 = done;
                else if (rv.hasOwnProperty(data.auth.responseFields.error) && rv[data.auth.responseFields.error]) errorStep1 =  rv[data.auth.responseFields.error];
                resolve({authToken: rv[data.auth.responseFields.authToken], errorStep1});
              }
              
            }
          }
          
          timer.initWithCallback(event, 200, Components.interfaces.nsITimer.TYPE_REPEATING_SLACK);          
        });
        
        
        // Try to close the window.
        try {
          reference[data.windowID].close();
          reference[data.windowID] = null;
        } catch (e) {
          //Components.utils.reportError(e);
        }
       
        if (errorStep1) {
          return {
            error: errorStep1, 
            tokens: JSON.stringify({access: "", refresh: ""})
          }
        }
        
        // switch step2 from "refresh token" to "get access token"
        step2Url = data.access.url;
        step2RequestParameters = data.access.requestParameters;
        step2ResponseFields = data.access.responseFields;
        step2Token = authToken;
      }

      
      // Try to get new access and refresh token
      const {access , refresh, errorStep2} = await new Promise(function(resolve, reject) {
        let req = new XMLHttpRequest();
        req.mozBackgroundRequest = true;
        req.open("POST", data.access.url, true);
        req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded"); // POST data needs to be urlencoded!

        req.onerror = function () {
          resolve({access: "", refresh: "", errorStep2: "OAuthNetworkError"});
        };

        let parameters = [];
        for (let key of Object.keys(step2RequestParameters)) {
          // a parameter value of null indicates the token field
          parameters.push(key + "=" + (step2RequestParameters[key] === null ? encodeURIComponent(step2Token) : encodeURIComponent(step2RequestParameters[key]))); 
        }
        
        req.onload = function() {              
            switch(req.status) {
                case 200: //OK
                  {
                    let tokens = JSON.parse(req.responseText);
                    // the refresh-token may or may not be renewed
                    let _access = tokens[step2ResponseFields.accessToken];
                    let _refresh = (step2ResponseFields.hasOwnProperty("refreshToken") && tokens.hasOwnProperty(step2ResponseFields.refreshToken)) ? tokens[step2ResponseFields.refreshToken] : step2Token;
                    resolve({access: _access, refresh: _refresh, errorStep2: ""});
                  }                      
                  break;
                  
                default:
                  resolve({access: "", refresh: "", errorStep2: "OAuthHttpError::"+ req.status});
            }
        };

        req.send(parameters.join("&"));
      });

      return {
        error: errorStep2, 
        tokens: JSON.stringify({access, refresh})
      };

    }
    
    throw new Error ("TbSync::asyncOAuthPrompt() is missing a windowID");
  },    
}
