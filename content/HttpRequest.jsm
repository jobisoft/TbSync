/*
 * This file is part of TbSync, contributed by John Bieling.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 *
 * Limitations:
 * ============
 * - no real event support (cannot add eventlisteners)
 * - send only supports string body
 * - onprogress not supported
 * - readyState 2 & 3 not supported
 *
 * Note about HttpRequest.open(method, url, async, username, password):
 * ============================================================================
 * If an Authorization header is specified, HttpRequest will use the
 * given header.
 * 
 * If no Authorization header is specified, but a username, HttpRequest
 * will delegate the authentication process to nsIHttpChannel. If a password is
 * specified as well, it will be used for authentication. If no password is
 * specified, it will call the passwordCallback(username, realm, host) callback to 
 * request a password for the given username, host and realm send back from
 * the server (in the WWW-Authenticate header).
 * 
 */
 
 "use strict";
 
var EXPORTED_SYMBOLS = ["HttpRequest"];

var bug669675 = [];
var containers = [];
var sandboxes = {};


var HttpRequest = class {
    constructor() {
        // a private object to store xhr related properties
        this._xhr = {};
        
        // HttpRequest supports two methods to receive data, using the
        // streamLoader seems to be the more modern approach.
        // BUT in order to overide MimeType, we need to call onStartRequest
        this._xhr.useStreamLoader = false;

        this._xhr.loadFlags =  Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE;
        this._xhr.headers = {};
        this._xhr.readyState = 0;
        this._xhr.responseStatus = null;
        this._xhr.responseStatusText = null;
        this._xhr.responseText = null;
        this._xhr.httpchannel = null;
        this._xhr.method = null;
        this._xhr.uri = null;
        this._xhr.username = "";
        this._xhr.password = "";
        this._xhr.overrideMimeType = null;
        this._xhr.mozAnon = false;
        this._xhr.mozBackgroundRequest = false;
        this._xhr.timeout = 0;

        this.onreadystatechange = function () {};
        this.onerror = function () {};
        this.onload = function () {};
        this.ontimeout = function () {};
        
        // Redirects are handled internally, this callback is just called to
        // inform the caller about the redirect.
        // Flags: (https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIChannelEventSink)
        // - Ci.nsIChannelEventSink.REDIRECT_PERMANENT
        // - Ci.nsIChannelEventSink.REDIRECT_TEMPORARY
        // - Ci.nsIChannelEventSink.REDIRECT_INTERNAL
        this.onredirect = function(flags, newUri) {};

        // Whenever a WWW-Authenticate header has been parsed, this callback is
        // called to inform the caller about the found realm.
        this.realmCallback = function (username, realm, host) {};
        
        // Whenever a channel needs authentication, but the caller has only provided a username
        // this callback is called to request the password.
        this.passwordCallback = function (username, realm, host) {return null};

        var self = this;

        this.notificationCallbacks = {
            // nsIInterfaceRequestor
            getInterface : function(aIID) {
                if (aIID.equals(Components.interfaces.nsIAuthPrompt2)) {
                    // implement a custom nsIAuthPrompt2 - needed for auto authorization
                    if (!self._xhr.authPrompt) {
                        self._xhr.authPrompt = new HttpRequestPrompt(self._xhr.username,  self._xhr.password, self.passwordCallback, self.realmCallback);
                    }
                    return self._xhr.authPrompt;
                } else if (aIID.equals(Components.interfaces.nsIAuthPrompt)) {
                    // implement a custom nsIAuthPrompt
                } else if (aIID.equals(Components.interfaces.nsIAuthPromptProvider)) {
                    // implement a custom nsIAuthPromptProvider
                } else if (aIID.equals(Components.interfaces.nsIPrompt)) {
                    // implement a custom nsIPrompt
                } else if (aIID.equals(Components.interfaces.nsIProgressEventSink)) {
                    // implement a custom nsIProgressEventSink
                } else if (aIID.equals(Components.interfaces.nsIChannelEventSink)) {
                    // implement a custom nsIChannelEventSink
                    return self.redirect;
                }
                throw Components.results.NS_ERROR_NO_INTERFACE;
            },
        };
            
        this.redirect = {
            // nsIChannelEventSink implementation
            asyncOnChannelRedirect: function(aOldChannel, aNewChannel, aFlags, aCallback) {
                let uploadData;
                let uploadContent;
                if (aOldChannel instanceof Ci.nsIUploadChannel &&
                    aOldChannel instanceof Ci.nsIHttpChannel &&
                    aOldChannel.uploadStream) {
                    uploadData = aOldChannel.uploadStream;
                    uploadContent = aOldChannel.getRequestHeader("Content-Type");
                }

                aNewChannel.QueryInterface(Ci.nsIHttpChannel);
                aOldChannel.QueryInterface(Ci.nsIHttpChannel);
                            
                function copyHeader(aHdr) {
                    try {
                        let hdrValue = aOldChannel.getRequestHeader(aHdr);
                        if (hdrValue) {
                            aNewChannel.setRequestHeader(aHdr, hdrValue, false);
                        }
                    } catch (e) {
                        if (e.code != Components.results.NS_ERROR_NOT_AVAILIBLE) {
                            // The header could possibly not be available, ignore that
                            // case but throw otherwise
                            throw e;
                        }
                    }
                }

                // Copy manually added headers
                for (let header in self._xhr.headers) {
                    if (self._xhr.headers.hasOwnProperty(header)) {
                        copyHeader(header);
                    }
                }
                
                prepHttpChannelUploadData(
                    aNewChannel, 
                    aOldChannel.requestMethod, 
                    uploadData, 
                    uploadContent);
                
                self._xhr.httpchannel = aNewChannel;
                self.onredirect(aFlags, aNewChannel.URI);
                aCallback.onRedirectVerifyCallback(Components.results.NS_OK);
            }
        };
        
        this.listener = {
            _buffer: [],

            //nsIStreamListener (aUseStreamLoader = false)
            onStartRequest: function(aRequest) {
                //Services.console.logStringMessage("[onStartRequest] " +  aRequest.URI.spec);
                this._buffer = [];
                
                if (self._xhr.overrideMimeType) {
                    aRequest.contentType = self._xhr.overrideMimeType;
                }
            },
            onDataAvailable: function (aRequest, aInputStream, aOffset, aCount) {
                //Services.console.logStringMessage("[onDataAvailable] " +  aRequest.URI.spec + " : " + aCount);				
                let buffer = new ArrayBuffer(aCount);
                let stream = Components.classes["@mozilla.org/binaryinputstream;1"].createInstance(Components.interfaces.nsIBinaryInputStream);
                stream.setInputStream(aInputStream);
                stream.readArrayBuffer(aCount, buffer);
                
                // store the chunk
                this._buffer.push(Array.from(new Uint8Array(buffer)));
            },        
            onStopRequest: function(aRequest, aStatusCode) {
                //Services.console.logStringMessage("[onStopRequest] " +  aRequest.URI.spec + " : " + aStatusCode);
                // combine all binary chunks to create a flat byte array;				
                let combined = [].concat.apply([], this._buffer);
                let data = convertByteArray(combined);
                this.processResponse(aRequest.QueryInterface(Components.interfaces.nsIHttpChannel), aStatusCode, data);
            },
        


            //nsIStreamLoaderObserver (aUseStreamLoader = true)
            onStreamComplete: function(aLoader, aContext, aStatus, aResultLength, aResult) {
                let result = convertByteArray(aResult);  
                this.processResponse(aLoader.request.QueryInterface(Components.interfaces.nsIHttpChannel), aStatus, result);
            },
            
            processResponse: function(aChannel, aStatus, aResult) {                
                //Services.console.logStringMessage("[processResponse] " + aChannel.URI.spec + " : " + aStatus);
                // do not set any channal response data, before we know we failed
                // and before we know we do not have to rerun (due to bug 669675)
                
                let responseStatus = null;
                try {
                    responseStatus = aChannel.responseStatus;
                } catch (ex) {
                    switch (aStatus) {
                        case Components.results.NS_ERROR_NET_TIMEOUT:
                            self._xhr.httpchannel = aChannel;
                            self._xhr.responseText = aResult;
                            self._xhr.responseStatus = 0;
                            self._xhr.responseStatusText = "";
                            self._xhr.readyState = 4;
                            self.onreadystatechange();				
                            self.ontimeout();
                            break;
                        case Components.results.NS_BINDING_ABORTED:
                            self._xhr.httpchannel = aChannel;
                            self._xhr.responseText = aResult;
                            self._xhr.responseStatus = 0;
                            self._xhr.responseStatusText = "";
                            self._xhr.readyState = 0;
                            self.onreadystatechange();				
                            self.onerror();
                            break;
                        default:
                            self._xhr.httpchannel = aChannel;
                            self._xhr.responseText = aResult;
                            self._xhr.responseStatus = 0;
                            self._xhr.responseStatusText = "";
                            self._xhr.readyState = 4;
                            self.onreadystatechange();				
                            self.onerror();
                            break;
                    }
                    return;
                }
                
                // mitigation for bug https://bugzilla.mozilla.org/show_bug.cgi?id=669675
                // we need to check, if nsIHttpChannel was in charge of auth:
                // if there was no Authentication header provided by the user, but a username
                // nsIHttpChannel should have added one. Is there one?
                if (
                    (responseStatus == 401) &&
                    !self._xhr.mozAnon &&
                    !self.hasRequestHeader("Authorization") && // no user defined header, so nsIHttpChannel should have called the authPrompt
                    self._xhr.username && // we can only add basic auth header if user
                    self._xhr.password // and pass are present
                ) {
                    // check the actual Authorization headers send
                    let unauthenticated;
                    try {
                        let header = aChannel.getRequestHeader("Authorization");
                        unauthenticated = false;
                    } catch (e) {
                        unauthenticated = true;
                    }
                  
                    if (unauthenticated) {
                        if (!bug669675.includes(self._xhr.uri.spec)) {
                            bug669675.push(self._xhr.uri.spec)
                            console.log("Mitigation for bug 669675 for URL <"+self._xhr.uri.spec+"> (Once per URL per session)");
                            // rerun
                            self.send(self._xhr.data);
                            return;
                        } else {
                            console.log("Mitigation failed for URL <"+self._xhr.uri.spec+">");
                        }
                    }
                }

                self._xhr.httpchannel = aChannel;
                self._xhr.responseText = aResult;
                self._xhr.responseStatus =	responseStatus;
                self._xhr.responseStatusText = aChannel.responseStatusText;
                self._xhr.readyState = 4;
                self.onreadystatechange();				
                self.onload();
            }
        };
    }


    
    
    /** public **/
        
    open(method, url, async = true, username = "", password = "") {
        this._xhr.method = method;

        try {
            this._xhr.uri = Services.io.newURI(url);
        } catch (e) {
            Components.utils.reportError(e);
            throw new Error("HttpRequest: Invalid URL <"+url+">");
        }
        if (!async) throw new Error ("HttpRequest: Synchronous requests not implemented.");

        this._xhr.username = username;
        this._xhr.password = password;

        this._xhr.readyState = 1;
        this.onreadystatechange();
        
    }

    send(data) {
        let options = {};
        
        //store the data, so we can rerun
        this._xhr.data = data;
        
        // The sandbox will have a loadingNode
        let sandbox = getSandboxForOrigin(this._xhr.username, this._xhr.uri);
        
        // The XHR in the sandbox will have the correct loadInfo, which will allow us
        // to use cookies and a CodebasePrincipal for us to use userContextIds and to
        // contact nextcloud servers (error 503).
        // We will not use the XHR or the sandbox itself.
        let XHR = new sandbox.XMLHttpRequest();
        XHR.open(this._xhr.method, this._xhr.uri.spec);

        // Create the channel with the loadInfo from the sandboxed XHR
        let channel = Services.io.newChannelFromURIWithLoadInfo(this._xhr.uri, XHR.channel.loadInfo);

        /*
        // as of TB67 newChannelFromURI needs to specify a loading node to have access to the cookie jars
        // using the main window
        // another option would be workers
        let mainWindow = Services.wm.getMostRecentWindow("mail:3pane");
        
        let channel = Services.io.newChannelFromURI(
            this._xhr.uri,
            mainWindow.document,
            Services.scriptSecurityManager.createCodebasePrincipal(this._xhr.uri, options),
            null,
            Components.interfaces.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_DATA_IS_NULL,
            Components.interfaces.nsIContentPolicy.TYPE_OTHER);
        */

/*        
        // enforce anonymous access if requested (will not work with proxy, see MDN)
        if (this._xhr.mozAnon) {
            channel.loadFlag |= Components.interfaces.nsIRequest.LOAD_ANONYMOUS;
        }

        // set background request
        if (this._xhr.mozBackgroundRequest) {
            channel.loadFlag |= Components.interfaces.nsIRequest.LOAD_BACKGROUND;
        }
*/        
        this._xhr.httpchannel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);
        this._xhr.httpchannel.loadFlags |= this._xhr.loadFlags;
        this._xhr.httpchannel.notificationCallbacks = this.notificationCallbacks;
                
        // Set default content type.
        if (!this.hasRequestHeader("Content-Type")) {
            this.setRequestHeader("Content-Type", "application/xml; charset=utf-8")
        }
        
        // Set default accept value.
        if (!this.hasRequestHeader("Accept")) {
           this.setRequestHeader("Accept", "*/*");
        }

        // Set non-standard header to request authorization (https://github.com/jobisoft/DAV-4-TbSync/issues/106)
        if (this._xhr.username) {
            this.setRequestHeader("X-EnforceAuthentication", "True");
        }

        // calculate length of request and add header
        if (data) {
            let textEncoder = new TextEncoder();
            let encoded = textEncoder.encode(data);
            this.setRequestHeader("Content-Length", encoded.length);
        }

        // mitigation for bug 669675
        if (
            bug669675.includes(this._xhr.uri.spec) &&
            !this._xhr.mozAnon && 
            !this.hasRequestHeader("Authorization") &&
            this._xhr.username &&
            this._xhr.password
        ) {
            this.setRequestHeader("Authorization", "Basic " + b64EncodeUnicode(this._xhr.username + ':' + this._xhr.password));
        }
        
        // add all headers to the channel
        for (let header in this._xhr.headers) {
            if (this._xhr.headers.hasOwnProperty(header)) {
                this._xhr.httpchannel.setRequestHeader(header, this._xhr.headers[header], false);
            }
        }
        
        // Will overwrite the Content-Type, so it must be called after the headers have been set.
        prepHttpChannelUploadData(this._xhr.httpchannel, this._xhr.method, data, this.getRequestHeader("Content-Type"));

        if (this._xhr.useStreamLoader) {
            let loader =  Components.classes["@mozilla.org/network/stream-loader;1"].createInstance(Components.interfaces.nsIStreamLoader);
            loader.init(this.listener);
            this.listener = loader;
        }        

        this._startTimeout();
        this._xhr.httpchannel.asyncOpen(this.listener, this._xhr.httpchannel);
    }

    get readyState() {return this._xhr.readyState};
    get responseURI() {return this._xhr.httpchannel.URI; }
    get responseURL() {return this._xhr.httpchannel.URI.spec; }
    get responseText() {return this._xhr.responseText};
    get status() {return this._xhr.responseStatus};
    get statusText() {return this._xhr.responseStatusText};
    get channel() {return this._xhr.httpchannel};
    get loadFlags() {return this._xhr.loadFlags};
    get timeout() {return this._xhr.timeout};
    get mozBackgroundRequest() { return this._xhr.mozBackgroundRequest; };    
    get mozAnon() { return this._xhr.mozAnon; };    

    set loadFlags(v) {this._xhr.loadFlags = v};
    set timeout(v) {this._xhr.timeout = v};
    set mozBackgroundRequest(v) {  this._xhr.mozBackgroundRequest = (v === true); }
    set mozAnon(v) {  this._xhr.mozAnon = (v === true); }
    

    // case insensitive method to check for headers
    hasRequestHeader(header) {
        let lowHeaders = Object.keys(this._xhr.headers).map(x => x.toLowerCase());
        return lowHeaders.includes(header.toLowerCase());
    }
    
    // if a header exists (case insensitive), it will be replaced (keeping the original capitalization)
    setRequestHeader(header, value) {
        let useHeader = header;
        let lowHeader = header.toLowerCase();
        
        for (let h in this._xhr.headers) {
            if (this._xhr.headers.hasOwnProperty(h) && h.toLowerCase() == lowHeader) {
                useHeader = h;
                break;
            }
        }
        this._xhr.headers[useHeader] = value;
    }

    // checks if a header (case insensitive) has been set by setRequestHeader - that does not mean it has been added to the channel!
    getRequestHeader(header) {
        let lowHeader = header.toLowerCase();
        
        for (let h in this._xhr.headers) {
            if (this._xhr.headers.hasOwnProperty(h) && h.toLowerCase() == lowHeader) {
                return this._xhr.headers[h];
            }
        }
        return null;
    }

    getResponseHeader(header) {
        try {
            return this._xhr.httpchannel.getResponseHeader(header);
        } catch (e) {
            if (e.code != Components.results.NS_ERROR_NOT_AVAILIBLE) {
                // The header could possibly not be available, ignore that
                // case but throw otherwise
                throw e;
            }			
        }
        return null;
    }

    overrideMimeType(mime) {
         this._xhr.overrideMimeType = mime;
    }

    abort() {
        this._cancel(Components.results.NS_BINDING_ABORTED);
    }





    /* not used by cardbook */
    
    get responseXML() {throw new Error("HttpRequest: responseXML not implemented");};

    get response() {throw new Error("HttpRequest: response not implemented");};
    set response(v) {throw new Error("HttpRequest: response not implemented");};

    get responseType() {throw new Error("HttpRequest: response not implemented");};
    set responseType(v) {throw new Error("HttpRequest: response not implemented");};

    get upload() {throw new Error("HttpRequest: upload not implemented");};
    set upload(v) {throw new Error("HttpRequest: upload not implemented");};

    get withCredentials() {throw new Error("HttpRequest: withCredentials not implemented");};
    set withCredentials(v) {throw new Error("HttpRequest: withCredentials not implemented");};






    /** private helper methods **/
    
    _startTimeout() {
        let that = this;
        
        this._xhr.timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
        let event = {
            notify: function(timer) {
                that._cancel(Components.results.NS_ERROR_NET_TIMEOUT)
            }
        }
        this._xhr.timer.initWithCallback(
            event, 
            this._xhr.timeout, 
            Components.interfaces.nsITimer.TYPE_ONE_SHOT);
    }

    _cancel(error) {
        if (this._xhr.httpchannel && error) {
            this._xhr.httpchannel.cancel(error);
        }
    }
}





var HttpRequestPrompt = class {
    constructor(username, password, promptCallback, realmCallback) {
        this.mCounts = 0;
        this.mUsername = username;
        this.mPassword = password;
        this.mPromptCallback = promptCallback;
        this.mRealmCallback = realmCallback;
    }

    // boolean promptAuth(in nsIChannel aChannel,
    //                    in uint32_t level,
    //                    in nsIAuthInformation authInfo)
    promptAuth (aChannel, aLevel, aAuthInfo) {      
        this.mRealmCallback(this.mUsername, aAuthInfo.realm, aChannel.URI.host);
        if (this.mUsername && this.mPassword) {
            console.log("Passing provided credentials for user <"+this.mUsername+"> to nsIHttpChannel.");
            aAuthInfo.username = this.mUsername;
            aAuthInfo.password = this.mPassword;
        } else if (this.mUsername) {
            console.log("Using passwordCallback callback to get password for user <"+this.mUsername+"> and realm <"+aAuthInfo.realm+"> @ host <"+aChannel.URI.host+">");
            let password = this.mPromptCallback(this.mUsername, aAuthInfo.realm, aChannel.URI.host);
            if (password) {
                aAuthInfo.username = this.mUsername;
                aAuthInfo.password = password;
            } else {
                return false;
            }
        } else {
            return false;
        }
        
        // The provided password could be wrong, in whichcase
        //  we would be here more than once.
        this.mCounts++
        return (this.mCounts < 2);
    }
}
  



function getSandboxForOrigin(username, uri) {
    let options = {};
    let origin = uri.scheme + "://" + uri.hostPort;
    
    if (username) {		
        options.userContextId = getContainerIdForUser(username);
        origin = options.userContextId + "@" + origin;
    }
    
    if (!sandboxes.hasOwnProperty(origin)) {
        console.log("Creating sandbox for <"+origin+">");
        let principal = Services.scriptSecurityManager.createCodebasePrincipal(uri, options);    
        sandboxes[origin] = Components.utils.Sandbox(principal, {
            wantXrays: true,
            wantGlobalProperties: ["XMLHttpRequest"],
        });
    }
    
    return sandboxes[origin];
}

function getContainerIdForUser(username) {
    // Define the allowed range of container ids to be used
    // TbSync is using 10000 - 19999
    // Lightning is using 20000 - 29999
    // Cardbook is using 30000 - 39999
    let min = 10000;
    let max = 19999;
    
    //reset if adding an entry will exceed allowed range
    if (containers.length > (max-min) && containers.indexOf(username) == -1) {
        for (let i=0; i < containers.length; i++) {
            Services.clearData.deleteDataFromOriginAttributesPattern({ userContextId: i + min });
        }
        containers = [];
    }
    
    let idx = containers.indexOf(username);
    return (idx == -1) ? containers.push(username) - 1 + min : (idx + min);
}

// copied from cardbook
function b64EncodeUnicode (aString) {
    return btoa(encodeURIComponent(aString).replace(/%([0-9A-F]{2})/g, function(match, p1) {
        return String.fromCharCode('0x' + p1);
    }));
}

// copied from lightning
function prepHttpChannelUploadData(aHttpChannel, aMethod, aUploadData, aContentType) {
    if (aUploadData) {
        aHttpChannel.QueryInterface(Components.interfaces.nsIUploadChannel);
        let stream;
        if (aUploadData instanceof Components.interfaces.nsIInputStream) {
            // Make sure the stream is reset
            stream = aUploadData.QueryInterface(Components.interfaces.nsISeekableStream);
            stream.seek(Components.interfaces.nsISeekableStream.NS_SEEK_SET, 0);
        } else {
            // Otherwise its something that should be a string, convert it.
            let converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
            converter.charset = "UTF-8";
            stream = converter.convertToInputStream(aUploadData.toString());
        }

      // If aContentType is empty, the protocol will assume that no content headers are to be
      // added to the uploaded stream and that any required headers are already encoded in
      // the stream. In the case of HTTP, if this parameter is non-empty, then its value will
      // replace any existing Content-Type header on the HTTP request. In the case of FTP and
      // FILE, this parameter is ignored.
      aHttpChannel.setUploadStream(stream, aContentType, -1);
    }	

    //must be set after setUploadStream
    //https://developer.mozilla.org/en-US/docs/Mozilla/Creating_sandboxed_HTTP_connections
    aHttpChannel.QueryInterface(Ci.nsIHttpChannel);
    aHttpChannel.requestMethod = aMethod;
}
  
/**
 * Convert a byte array to a string - copied from lightning
 *
 * @param {octet[]} aResult         The bytes to convert
 * @param {String} aCharset         The character set of the bytes, defaults to utf-8
 * @param {Boolean} aThrow          If true, the function will raise an exception on error
 * @returns {?String}                The string result, or null on error
 */
function convertByteArray(aResult, aCharset="utf-8", aThrow) {
    try {
        return new TextDecoder(aCharset).decode(Uint8Array.from(aResult));
    } catch (e) {
        if (aThrow) {
            throw e;
        }
    }
    return null;
}

