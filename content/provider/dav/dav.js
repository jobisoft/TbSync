"use strict";

var dav = {
    bundle: Services.strings.createBundle("chrome://tbsync/locale/dav.strings"),

    init: Task.async (function* (lightningIsAvail)  {        
    }),
    
};

/*

Retrieve calendards and addressbooks from server

curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/.well-known/carddav/
#get correct endpoint
curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/remote.php/carddav/
#get principals and addressbooks -- append username
curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/remote.php/carddav/addressbooks/USER/
curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/remote.php/carddav/principals/USER/

curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/.well-known/caldav/
#get correct endpoint
curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/remote.php/caldav/
#get principals and addressbooks -- append username
curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/remote.php/caldav/calendars/USER/
curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/remote.php/carddav/principals/USER/

*/