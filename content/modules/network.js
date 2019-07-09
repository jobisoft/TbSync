/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";
 
var network = {

  load: async function () {
  },

  unload: async function () {
  },
  
  getContainerIdForUser: function(username) {
    //define the allowed range of container ids to be used
    let min = 10000;
    let max = 19999;
    
    //we need to store the container map in the main window, so it is persistent and survives a restart of this bootstrapped addon
    //TODO: is there a better way to store this container map globally? Can there be TWO main windows?
    let mainWindow = Services.wm.getMostRecentWindow("mail:3pane");

    //init
    if (!(mainWindow._containers)) {
      mainWindow._containers = [];
    }
    
    //reset if adding an entry will exceed allowed range
    if (mainWindow._containers.length > (max-min) && mainWindow._containers.indexOf(username) == -1) {
      for (let i=0; i < mainWindow._containers.length; i++) {
        //Services.clearData.deleteDataFromOriginAttributesPattern({ userContextId: i + min });
        Services.obs.notifyObservers(null, "clear-origin-attributes-data", JSON.stringify({ userContextId: i + min }));
      }
      mainWindow._containers = [];
    }
    
    let idx = mainWindow._containers.indexOf(username);
    return (idx == -1) ? mainWindow._containers.push(username) - 1 + min : (idx + min);
  },
  
  resetContainerForUser: function(username) {
    let id = this.getContainerIdForUser(username);
    Services.obs.notifyObservers(null, "clear-origin-attributes-data", JSON.stringify({ userContextId: id }));
  },

  createTCPErrorFromFailedXHR: function (xhr) {
    return this.createTCPErrorFromFailedRequest(xhr.channel.QueryInterface(Components.interfaces.nsIRequest));
  },
  
  createTCPErrorFromFailedRequest: function (request) {
    //adapted from :
    //https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/How_to_check_the_secruity_state_of_an_XMLHTTPRequest_over_SSL		
    let status = request.status;

    if ((status & 0xff0000) === 0x5a0000) { // Security module
      const nsINSSErrorsService = Components.interfaces.nsINSSErrorsService;
      let nssErrorsService = Components.classes['@mozilla.org/nss_errors_service;1'].getService(nsINSSErrorsService);
      
      // NSS_SEC errors (happen below the base value because of negative vals)
      if ((status & 0xffff) < Math.abs(nsINSSErrorsService.NSS_SEC_ERROR_BASE)) {

        // The bases are actually negative, so in our positive numeric space, we
        // need to subtract the base off our value.
        let nssErr = Math.abs(nsINSSErrorsService.NSS_SEC_ERROR_BASE) - (status & 0xffff);
        switch (nssErr) {
          case 11: return 'security::SEC_ERROR_EXPIRED_CERTIFICATE';
          case 12: return 'security::SEC_ERROR_REVOKED_CERTIFICATE';
          case 13: return 'security::SEC_ERROR_UNKNOWN_ISSUER';
          case 20: return 'security::SEC_ERROR_UNTRUSTED_ISSUER';
          case 21: return 'security::SEC_ERROR_UNTRUSTED_CERT';
          case 36: return 'security::SEC_ERROR_CA_CERT_INVALID';
          case 90: return 'security::SEC_ERROR_INADEQUATE_KEY_USAGE';
          case 176: return 'security::SEC_ERROR_CERT_SIGNATURE_ALGORITHM_DISABLED';
        }
        return 'security::UNKNOWN_SECURITY_ERROR';
        
      } else {

        // Calculating the difference 		  
        let sslErr = Math.abs(nsINSSErrorsService.NSS_SSL_ERROR_BASE) - (status & 0xffff);		
        switch (sslErr) {
          case 3: return 'security::SSL_ERROR_NO_CERTIFICATE';
          case 4: return 'security::SSL_ERROR_BAD_CERTIFICATE';
          case 8: return 'security::SSL_ERROR_UNSUPPORTED_CERTIFICATE_TYPE';
          case 9: return 'security::SSL_ERROR_UNSUPPORTED_VERSION';
          case 12: return 'security::SSL_ERROR_BAD_CERT_DOMAIN';
        }
        return 'security::UNKOWN_SSL_ERROR';
        
      }

    } else { //not the security module
      
      switch (status) {
        case 0x804B000C: return 'network::NS_ERROR_CONNECTION_REFUSED';
        case 0x804B000E: return 'network::NS_ERROR_NET_TIMEOUT';
        case 0x804B001E: return 'network::NS_ERROR_UNKNOWN_HOST';
        case 0x804B0047: return 'network::NS_ERROR_NET_INTERRUPT';
      }
      return 'network::UNKNOWN_NETWORK_ERROR';

    }
    return null;	 
  },
}
