/*
 * This file is part of TbSync.
 *
 * TbSync is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * TbSync is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with TbSync. If not, see <https://www.gnu.org/licenses/>.
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncPassword = {
    
    onload: function () {
        this.accountdata = window.arguments[0];
        this.callbackOK = window.arguments[1];
        this.callbackCANCEL = window.arguments[2];
        document.title = tbSync.getLocalizedMessage("account").replace("##accountname##", this.accountdata.accountname)

        document.getElementById("tbsync.password.description").textContent = tbSync.getLocalizedMessage("prompt.Password").replace("##user##", this.accountdata.user);
    },

    doOK: function () {
        //call set password function of accounts provider
        tbSync.setPassword(this.accountdata, document.getElementById("tbsync.password").value);
        if (this.callbackOK) this.callbackOK();
    },

    doCANCEL: function () {
        if (this.callbackCANCEL) this.callbackCANCEL();
    }
    
};
