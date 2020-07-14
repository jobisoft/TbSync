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

  // async sleep function using Promise to postpone actions to keep UI responsive
  sleep : function (_delay, useRequestIdleCallback = false) {
    let useIdleCallback = false;
    let delay = 5;//_delay;
    if (TbSync.window.requestIdleCallback && useRequestIdleCallback) {
      useIdleCallback = true;
      delay= 2;
    }
    let timer =  Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
    
    return new Promise(function(resolve, reject) {
      let event = {
        notify: function(timer) {
          if (useIdleCallback) {
            TbSync.window.requestIdleCallback(resolve);                        
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
