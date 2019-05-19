/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
 
var tools = {

    load: async function () {
    },

    unload: async function () {
    },

    // get localized string from core or provider (if possible)
    getLocalizedMessage: function (msg, provider = "") {
        let localized = msg;
        let parts = msg.split("::");

        let bundle = (provider == "") ? tbSync.bundle : tbSync.providers.loadedProviders[provider].bundle;
            
        try {
            //spezial treatment of strings with :: like status.httperror::403
            localized = bundle.GetStringFromName(parts[0]);
            for (let i = 0; i<parts.length; i++) {
                let regex = new RegExp( "##replace\."+i+"##", "g");
                localized = localized.replace(regex, parts[i]);
            }
        } catch (e) {}

        return localized;
    }, 

    // TbSync uses the provider name as URI scheme
    getOrigin4PasswordManager: function (provider, url) {
        let uri = Services.io.newURI((!url.startsWith("http://") && !url.startsWith("https://")) ? "http://" + url : url);
        return provider + "://" + uri.host;
    },

    setLoginInfo: function(origin, realm, user, password) {
        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");

        //remove any existing entry
        let logins = Services.logins.findLogins({}, origin, null, realm);
        for (let i = 0; i < logins.length; i++) {
            if (logins[i].username == user) {
                let currentLoginInfo = new nsLoginInfo(origin, null, realm, user, logins[i].password, "", "");
                try {
                    Services.logins.removeLogin(currentLoginInfo);
                } catch (e) {
                    tbSync.dump("Error removing loginInfo", e);
                }
            }
        }
        
        let newLoginInfo = new nsLoginInfo(origin, null, realm, user, password, "", "");
        try {
            Services.logins.addLogin(newLoginInfo);
        } catch (e) {
            tbSync.dump("Error adding loginInfo", e);
        }
    },
    
    getLoginInfo: function(origin, realm, user) {
        let logins = Services.logins.findLogins({}, origin, null, realm);
        for (let i = 0; i < logins.length; i++) {
            if (logins[i].username == user) {
                return logins[i].password;
            }
        }
        return null;
    },

    // async sleep function using Promise to postpone actions to keep UI responsive
    sleep : function (_delay, useRequestIdleCallback = true) {
        let useIdleCallback = false;
        let delay = _delay;
        if (tbSync.window.requestIdleCallback && useRequestIdleCallback) {
            useIdleCallback = true;
            delay= 2;
        }
        let timer =  Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
        
        return new Promise(function(resolve, reject) {
            let event = {
                notify: function(timer) {
                    if (useIdleCallback) {
                        tbSync.window.requestIdleCallback(resolve);                        
                    } else {
                        resolve();
                    }
                }
            }            
            timer.initWithCallback(event, delay, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
        });
    },

    // this is derived from: http://jonisalonen.com/2012/from-utf-16-to-utf-8-in-javascript/
    // javascript strings are utf16, btoa needs utf8 , so we need to encode
    toUTF8: function (str) {
        var utf8 = "";
        for (var i=0; i < str.length; i++) {
            var charcode = str.charCodeAt(i);
            if (charcode < 0x80) utf8 += String.fromCharCode(charcode);
            else if (charcode < 0x800) {
                utf8 += String.fromCharCode(0xc0 | (charcode >> 6), 
                          0x80 | (charcode & 0x3f));
            }
            else if (charcode < 0xd800 || charcode >= 0xe000) {
                utf8 += String.fromCharCode(0xe0 | (charcode >> 12), 
                          0x80 | ((charcode>>6) & 0x3f), 
                          0x80 | (charcode & 0x3f));
            }

            // surrogate pair
            else {
                i++;
                // UTF-16 encodes 0x10000-0x10FFFF by
                // subtracting 0x10000 and splitting the
                // 20 bits of 0x0-0xFFFFF into two halves
                charcode = 0x10000 + (((charcode & 0x3ff)<<10)
                          | (str.charCodeAt(i) & 0x3ff))
                utf8 += String.fromCharCode(0xf0 | (charcode >>18), 
                          0x80 | ((charcode>>12) & 0x3f), 
                          0x80 | ((charcode>>6) & 0x3f), 
                          0x80 | (charcode & 0x3f));
            }
        }
        return utf8;
    },
    
    b64encode: function (str) {
        return btoa(this.toUTF8(str));
    }
}
