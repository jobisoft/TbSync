"use strict";

var wbxmltools = {

    // extract policy key from wbxml
    FindPolicykey: function (wbxml) {
        let x = String.fromCharCode(0x49, 0x03); //<PolicyKey> Code Page 14
        let start = wbxml.indexOf(x) + 2;
        let end = wbxml.indexOf(String.fromCharCode(0x00), start);
        return wbxml.substring(start, end);
    },

    // extract sync key from wbxml
    FindKey: function (wbxml) {
        let x = String.fromCharCode(0x4b, 0x03); //<SyncKey> Code Page 0
        if (wbxml.substr(5, 1) === String.fromCharCode(0x07)) {
            x = String.fromCharCode(0x52, 0x03); //<SyncKey> Code Page 7
        }

        let start = wbxml.indexOf(x) + 2;
        let end = wbxml.indexOf(String.fromCharCode(0x00), start);
        return wbxml.substring(start, end);
    },
    
    //extract first folderID of a given type from wbxml
/*    FindFolder: function (wbxml, type) {
        let start = 0;
        let end;
        let folderID;
        let Scontact = String.fromCharCode(0x4A, 0x03) + type + String.fromCharCode(0x00, 0x01);
        let contact = wbxml.indexOf(Scontact);
        while (wbxml.indexOf(String.fromCharCode(0x48, 0x03), start) < contact) {
            start = wbxml.indexOf(String.fromCharCode(0x48, 0x03), start) + 2;
            end = wbxml.indexOf(String.fromCharCode(0x00), start);
            if (start === 1) {
                break;
            }
            folderID = wbxml.substring(start, end); //we should be able to end the loop with return.
        }
        return folderID;
    }, */





    // Convert a WBXML (WAP Binary XML) to plain XML
    convert2xml: function (wbxml) {

        let num = 4; //skip the 4 first bytes which are mostly 0x03 (WBXML Version 1.3), 0x01 (unknown public identifier), 0x6A (utf-8), 0x00 (Length of string table)

        //the main code page will be set to the the first codepage used
        let mainCodePage = null;

        let tagStack = [];
        let xml = "";
        let codepage = 0;
        
        while (num < wbxml.length) {
            let data = wbxml.substr(num, 1).charCodeAt(0);
            let token = data & 0x3F; //removes content bit(6) and attribute bit(7)
            let tokenHasContent = ((data & 0x40) != 0); //checks if content bit is set
            let tokenHasAttributes = ((data & 0x80) != 0); //checks if attribute bit is set
        
            switch(token) {
                case 0x00: // switch of codepage (new codepage is next byte)
                    num = num + 1;
                    codepage = (wbxml.substr(num, 1)).charCodeAt(0);
                    break;
                    
                case 0x01: // Indicates the end of an attribute list or the end of an element
                        // tagStack contains a list of opened tags, which await to be closed
                        xml = xml + tagStack.pop();
                    break;
                    
                case 0x02: // A character entity. Followed by a mb_u_int32 encoding the character entity number.
                    break;
                
                case 0x03: // Inline string followed by a termstr. (0x00)
                    let termpos = wbxml.indexOf(String.fromCharCode(0x00), num);
                    xml = xml + (wbxml.substring(num + 1, termpos)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/'/g,"&apos;").replace(/"/g,"&quot;");
                    num = termpos;
                    break;
                
                case 0x04: // An unknown tag or attribute name. Followed by an mb_u_int32 that encodes an offset into the string table.
                case 0x40: // Inline string document-type-specific extension token. Token is followed by a termstr.
                case 0x41: // Inline string document-type-specific extension token. Token is followed by a termstr.
                case 0x42: // Inline string document-type-specific extension token. Token is followed by a termstr.
                case 0x43: // Processing instruction.
                case 0x44: // Unknown tag, with content.
                case 0x80: // Inline integer document-type-specific extension token. Token is followed by a mb_uint_32.
                case 0x81: // Inline integer document-type-specific extension token. Token is followed by a mb_uint_32.
                case 0x82: // Inline integer document-type-specific extension token. Token is followed by a mb_uint_32.
                case 0x83: // String table reference. Followed by a mb_u_int32 encoding a byte offset from the beginning of the string table.
                case 0x84: // Unknown tag, with attributes.
                case 0xC0: // Single-byte document-type-specific extension token.
                case 0xC1: // Single-byte document-type-specific extension token.
                case 0xC2: // Single-byte document-type-specific extension token.
                case 0xC3: // Opaque document-type-specific data.
                case 0xC4: // Unknown tag, with content and attributes.
                    break;
                    
                default:
                    if (token in this.codepages[codepage]) {
                        // if this code page is not the mainCodePage (or mainCodePage is not yet set =  very first tag), add codePageTag with current codepage
                        let codePageTag = (codepage != mainCodePage) ? " xmlns='" + this.namespaces[codepage] + "'" : "";

                        // if no mainCodePage has been defined yet, use the current codepage, which is either the initialized/default value of codepage or a value set by SWITCH_PAGE
                        if (mainCodePage === null) mainCodePage = codepage;

                        if (!tokenHasContent) {
                            xml = xml + "<" + this.codepages[codepage][token] + codePageTag + "/>";
                        } else {
                            xml = xml + "<" +this.codepages[codepage][token] + codePageTag +">";
                            //add the closing tag to the stack, so it can get properly closed later
                            tagStack.push("</" +this.codepages[codepage][token] + ">");
                        }
                    } else {
                        tbSync.dump("wbxml", "Unknown token <" + token + "> for codepage <"+codepage+">");
                        return  '<?xml version="1.0"?>'; //abort on error
                    }
            }
            num = num + 1;
        }
        return (xml == "") ? "" : '<?xml version="1.0"?>' + xml;
    },





    // This returns a wbxml object, which allows to add tags (using names), switch codepages, or open and close tags, it is also possible to append pure (binary) wbxml
    // If no wbxmlstring is present, default to the "init" string ( WBXML Version 1.3, unknown public identifier, UTF-8, Length of string table)
    createWBXML: function (wbxmlstring = String.fromCharCode(0x03, 0x01, 0x6A, 0x00)) {
        let wbxml = {
            _codepage : 0,
            _wbxml : wbxmlstring, 

            append : function (wbxmlstring) {
                this._wbxml = this._wbxml + wbxmlstring;
            },
            
            // adding a string content tag as <tagname>contentstring</tagname>
            atag : function (tokenname, content = "") {
                //check if tokenname is in current codepage
                if ((this._codepage in wbxmltools.codepages2) == false) throw "[wbxmltools] Unknown codepage <"+this._codepage+">";
                if ((tokenname in wbxmltools.codepages2[this._codepage]) == false) throw "[wbxmltools] Unknown tokenname <"+tokenname+"> for codepage <"+wbxmltools.namespaces[this._codepage]+">";  

                if (content == "") {
                    //empty, just add token
                    this._wbxml += String.fromCharCode(wbxmltools.codepages2[this._codepage][tokenname]);
                } else {
                    //not empty,add token with enabled content bit and also add inlinestringidentifier
                    this._wbxml += String.fromCharCode(wbxmltools.codepages2[this._codepage][tokenname] | 0x40, 0x03);
                    //add content
                    for (let i=0; i< content.length; i++) this._wbxml += String.fromCharCode(content.charCodeAt(i));
                    //add string termination and tag close
                    this._wbxml += String.fromCharCode(0x00, 0x01);
                }
            },

            switchpage : function (name) {
                let codepage = wbxmltools.namespaces.indexOf(name);
                if (codepage == -1) throw "[wbxmltools] Unknown codepage <"+ name +">";
                this._codepage = codepage;
                this._wbxml += String.fromCharCode(0x00, codepage);
            },

            ctag : function () {
                this._wbxml += String.fromCharCode(0x01);
            },

            //opentag is assumed to add a token with content, otherwise use addtag
            otag : function (tokenname) {
                this._wbxml += String.fromCharCode(wbxmltools.codepages2[this._codepage][tokenname] | 0x40);
            },

            getCharCodes : function () {
                let value = "";
                for (let i=0; i<this._wbxml.length; i++) value += ("00" + this._wbxml.charCodeAt(i).toString(16)).substr(-2) + " ";
                return value;
            },

            getBytes : function () {
                return this._wbxml;
            },
            
            getXML : function () {
                return wbxmltools.convert2xml(this._wbxml);
            },
            
            getData : function () {
                return xmltools.getDataFromXMLString(wbxmltools.convert2xml(this._wbxml));
            }
        };
        return wbxml;
    },





    codepages2 : [],

    buildCodepages2 : function () {
        for (let i=0; i<this.codepages.length; i++) {
            let inverted = {};
            for (let token in this.codepages[i]) {
                inverted[this.codepages[i][token]] = token;
            }
            this.codepages2.push(inverted);
        }
    },





    codepages : [
        // Code Page 0: AirSync
        {
            0x05: 'Sync',
            0x06: 'Responses',
            0x07: 'Add',
            0x08: 'Change',
            0x09: 'Delete',
            0x0A: 'Fetch',
            0x0B: 'SyncKey',
            0x0C: 'ClientId',
            0x0D: 'ServerId',
            0x0E: 'Status',
            0x0F: 'Collection',
            0x10: 'Class',
            0x12: 'CollectionId',
            0x13: 'GetChanges',
            0x14: 'MoreAvailable',
            0x15: 'WindowSize',
            0x16: 'Commands',
            0x17: 'Options',
            0x18: 'FilterType',
            0x1B: 'Conflict',
            0x1C: 'Collections',
            0x1D: 'ApplicationData',
            0x1E: 'DeletesAsMoves',
            0x20: 'Supported',
            0x21: 'SoftDelete',
            0x22: 'MIMESupport',
            0x23: 'MIMETruncation',
            0x24: 'Wait',
            0x25: 'Limit',
            0x26: 'Partial',
            0x27: 'ConversationMode',
            0x28: 'MaxItems',
            0x29: 'HeartbeatInterval'
        },
        // Code Page 1: Contacts
        {
            0x05: 'Anniversary',
            0x06: 'AssistantName',
            0x07: 'AssistantPhoneNumber',
            0x08: 'Birthday',
            0x09: 'Body',
            0x0A: 'BodySize',
            0x0B: 'BodyTruncated',
            0x0C: 'Business2PhoneNumber',
            0x0D: 'BusinessAddressCity',
            0x0E: 'BusinessAddressCountry',
            0x0F: 'BusinessAddressPostalCode',
            0x10: 'BusinessAddressState',
            0x11: 'BusinessAddressStreet',
            0x12: 'BusinessFaxNumber',
            0x13: 'BusinessPhoneNumber',
            0x14: 'CarPhoneNumber',
            0x15: 'Categories',
            0x16: 'Category',
            0x17: 'Children',
            0x18: 'Child',
            0x19: 'CompanyName',
            0x1A: 'Department',
            0x1B: 'Email1Address',
            0x1C: 'Email2Address',
            0x1D: 'Email3Address',
            0x1E: 'FileAs',
            0x1F: 'FirstName',
            0x20: 'Home2PhoneNumber',
            0x21: 'HomeAddressCity',
            0x22: 'HomeAddressCountry',
            0x23: 'HomeAddressPostalCode',
            0x24: 'HomeAddressState',
            0x25: 'HomeAddressStreet',
            0x26: 'HomeFaxNumber',
            0x27: 'HomePhoneNumber',
            0x28: 'JobTitle',
            0x29: 'LastName',
            0x2A: 'MiddleName',
            0x2B: 'MobilePhoneNumber',
            0x2C: 'OfficeLocation',
            0x2D: 'OtherAddressCity',
            0x2E: 'OtherAddressCountry',
            0x2F: 'OtherAddressPostalCode',
            0x30: 'OtherAddressState',
            0x31: 'OtherAddressStreet',
            0x32: 'PagerNumber',
            0x33: 'RadioPhoneNumber',
            0x34: 'Spouse',
            0x35: 'Suffix',
            0x36: 'Title',
            0x37: 'WebPage',
            0x38: 'YomiCompanyName',
            0x39: 'YomiFirstName',
            0x3A: 'YomiLastName',
            0x3B: 'CompressedRTF',
            0x3C: 'Picture',
            0x3D: 'Alias',
            0x3E: 'WeightedRank'
        },
        // Code Page 2: Email
        {
            0x05: 'Attachment',
            0x06: 'Attachments',
            0x07: 'AttName',
            0x08: 'AttSize',
            0x09: 'Att0Id',
            0x0a: 'AttMethod',
            0x0b: 'AttRemoved',
            0x0c: 'Body',
            0x0d: 'BodySize',
            0x0e: 'BodyTruncated',
            0x0f: 'DateReceived',
            0x10: 'DisplayName',
            0x11: 'DisplayTo',
            0x12: 'Importance',
            0x13: 'MessageClass',
            0x14: 'Subject',
            0x15: 'Read',
            0x16: 'To',
            0x17: 'Cc',
            0x18: 'From',
            0x19: 'ReplyTo',
            0x1a: 'AllDayEvent',
            0x1b: 'Categories',
            0x1c: 'Category',
            0x1d: 'DTStamp',
            0x1e: 'EndTime',
            0x1f: 'InstanceType',
            0x20: 'BusyStatus',
            0x21: 'Location',
            0x22: 'MeetingRequest',
            0x23: 'Organizer',
            0x24: 'RecurrenceId',
            0x25: 'Reminder',
            0x26: 'ResponseRequested',
            0x27: 'Recurrences',
            0x28: 'Recurrence',
            0x29: 'Recurrence_Type',
            0x2a: 'Recurrence_Until',
            0x2b: 'Recurrence_Occurrences',
            0x2c: 'Recurrence_Interval',
            0x2d: 'Recurrence_DayOfWeek',
            0x2e: 'Recurrence_DayOfMonth',
            0x2f: 'Recurrence_WeekOfMonth',
            0x30: 'Recurrence_MonthOfYear',
            0x31: 'StartTime',
            0x32: 'Sensitivity',
            0x33: 'TimeZone',
            0x34: 'GlobalObjId',
            0x35: 'ThreadTopic',
            0x36: 'MIMEData',
            0x37: 'MIMETruncated',
            0x38: 'MIMESize',
            0x39: 'InternetCPID',
            0x3a: 'Flag',
            0x3b: 'Status',
            0x3c: 'ContentClass',
            0x3d: 'FlagType',
            0x3e: 'CompleteTime',
            0x3f: 'DisallowNewTimeProposal'
        },
        // Code Page 3: AirNotify (WBXML code page 3 is no longer in use)
        {},
        // Code Page 4: Calendar
        {
            0x05: 'TimeZone',
            0x06: 'AllDayEvent',
            0x07: 'Attendees',
            0x08: 'Attendee',
            0x09: 'Email',
            0x0a: 'Name',
            0x0b: 'Body',
            0x0c: 'BodyTruncated',
            0x0d: 'BusyStatus',
            0x0e: 'Categories',
            0x0f: 'Category',
            0x10: 'CompressedRTF',
            0x11: 'DtStamp',
            0x12: 'EndTime',
            0x13: 'Exception',
            0x14: 'Exceptions',
            0x15: 'Deleted',
            0x16: 'ExceptionStartTime',
            0x17: 'Location',
            0x18: 'MeetingStatus',
            0x19: 'OrganizerEmail',
            0x1a: 'OrganizerName',
            0x1b: 'Recurrence',
            0x1c: 'Type',
            0x1d: 'Until',
            0x1e: 'Occurrences',
            0x1f: 'Interval',
            0x20: 'DayOfWeek',
            0x21: 'DayOfMonth',
            0x22: 'WeekOfMonth',
            0x23: 'MonthOfYear',
            0x24: 'Reminder',
            0x25: 'Sensitivity',
            0x26: 'Subject',
            0x27: 'StartTime',
            0x28: 'UID',
            0x29: 'AttendeeStatus',
            0x2a: 'AttendeeType',
            0x2b: 'Attachment',
            0x2c: 'Attachments',
            0x2d: 'AttName',
            0x2e: 'AttSize',
            0x2f: 'AttOid',
            0x30: 'AttMethod',
            0x31: 'AttRemoved',
            0x32: 'DisplayName',
            0x33: 'DisallowNewTimeProposal',
            0x34: 'ResponseRequested',
            0x35: 'AppointmentReplyTime',
            0x36: 'ResponseType',
            0x37: 'CalendarType',
            0x38: 'IsLeapMonth',
            0x39: 'FirstDayOfWeek',
            0x3a: 'OnlineMeetingConfLink',
            0x3b: 'OnlineMeetingExternalLink'
        },
        // Code Page 5: Move
        {
            0x05: 'MoveItems',
            0x06: 'Move',
            0x07: 'SrcMsgId',
            0x08: 'SrcFldId',
            0x09: 'DstFldId',
            0x0A: 'Response',
            0x0B: 'Status',
            0x0C: 'DstMsgId'
        },
        // Code Page 6: GetItemEstimate
        {
            0x05: 'GetItemEstimate',
            0x06: 'Version',
            0x07: 'Collections',
            0x08: 'Collection',
            0x09: 'Class',
            0x0A: 'CollectionId',
            0x0B: 'DateTime',
            0x0C: 'Estimate',
            0x0D: 'Response',
            0x0E: 'Status'
        },
        // Code Page 7: FolderHierarchy
        {
            0x07: 'DisplayName',
            0x08: 'ServerId',
            0x09: 'ParentId',
            0x0A: 'Type',
            0x0C: 'Status',
            0x0E: 'Changes',
            0x0F: 'Add',
            0x10: 'Delete',
            0x11: 'Update',
            0x12: 'SyncKey',
            0x13: 'FolderCreate',
            0x14: 'FolderDelete',
            0x15: 'FolderUpdate',
            0x16: 'FolderSync',
            0x17: 'Count'
        },
        // Code Page 8: MeetingResponse
        {
            0x05: 'CalendarId',
            0x06: 'CollectionId',
            0x07: 'MeetingResponse',
            0x08: 'RequestId',
            0x09: 'Request',
            0x0a: 'Result',
            0x0b: 'Status',
            0x0c: 'UserResponse',
            0x0e: 'InstanceId'
        },
        // Code Page 9: Tasks
        {
            0x08: 'Categories',
            0x09: 'Category',
            0x0A: 'Complete',
            0x0B: 'DateCompleted',
            0x0C: 'DueDate',
            0x0D: 'UtcDueDate',
            0x0E: 'Importance',
            0x0F: 'Recurrence',
            0x10: 'Type',
            0x11: 'Start',
            0x12: 'Until',
            0x13: 'Occurrences',
            0x14: 'Interval',
            0x15: 'DayOfMonth',
            0x16: 'DayOfWeek',
            0x17: 'WeekOfMonth',
            0x18: 'MonthOfYear',
            0x19: 'Regenerate',
            0x1A: 'DeadOccur',
            0x1B: 'ReminderSet',
            0x1C: 'ReminderTime',
            0x1D: 'Sensitivity',
            0x1E: 'StartDate',
            0x1F: 'UtcStartDate',
            0x20: 'Subject',
            0x22: 'OrdinalDate',
            0x23: 'SubOrdinalDate',
            0x24: 'CalendarType',
            0x25: 'IsLeapMonth',
            0x26: 'FirstDayOfWeek'
        },
        // Code Page 10: ResolveRecipients
        {
            0x05: 'ResolveRecipients',
            0x06: 'Response',
            0x07: 'Status',
            0x08: 'Type',
            0x09: 'Recipient',
            0x0a: 'DisplayName',
            0x0b: 'EmailAddress',
            0x0c: 'Certificates',
            0x0d: 'Certificate',
            0x0e: 'MiniCertificate',
            0x0f: 'Options',
            0x10: 'To',
            0x11: 'CertificateRetrieval',
            0x12: 'RecipientCount',
            0x13: 'MaxCertificates',
            0x14: 'MaxAmbiguousRecipients',
            0x15: 'CertificateCount',
            0x16: 'Availability',
            0x17: 'StartTime',
            0x18: 'EndTime',
            0x19: 'MergedFreeBusy',
            0x1a: 'Picture',
            0x1b: 'MaxSize',
            0x1c: 'Data',
            0x1d: 'MaxPictures'
        },
        // Code Page 11: ValidateCert
        {
            0x05: 'ValidateCert',
            0x06: 'Certificates',
            0x07: 'Certificate',
            0x08: 'CertificateChain',
            0x09: 'CheckCRL',
            0x0a: 'Status'
        },
        // Code Page 12: Contacts2
        {
            0x05: 'CustomerId',
            0x06: 'GovernmentId',
            0x07: 'IMAddress',
            0x08: 'IMAddress2',
            0x09: 'IMAddress3',
            0x0a: 'ManagerName',
            0x0b: 'CompanyMainPhone',
            0x0c: 'AccountName',
            0x0d: 'NickName',
            0x0e: 'MMS'
        },
        // Code Page 13: Ping
        {
            0x05: 'Ping',
            0x06: 'AutdState',
            //(Not used)
            0x07: 'Status',
            0x08: 'HeartbeatInterval',
            0x09: 'Folders',
            0x0A: 'Folder',
            0x0B: 'Id',
            0x0C: 'Class',
            0x0D: 'MaxFolders'
        },
        // Code Page 14: Provision
        {
            0x05: 'Provision',
            0x06: 'Policies',
            0x07: 'Policy',
            0x08: 'PolicyType',
            0x09: 'PolicyKey',
            0x0A: 'Data',
            0x0B: 'Status',
            0x0C: 'RemoteWipe',
            0x0D: 'EASProvisionDoc',
            0x0E: 'DevicePasswordEnabled',
            0x0F: 'AlphanumericDevicePasswordRequired',
            0x10: 'DeviceEncryptionEnabled',
            0x10: 'RequireStorageCardEncryption',
            0x11: 'PasswordRecoveryEnabled',
            0x13: 'AttachmentsEnabled',
            0x14: 'MinDevicePasswordLength',
            0x15: 'MaxInactivityTimeDeviceLock',
            0x16: 'MaxDevicePasswordFailedAttempts',
            0x17: 'MaxAttachmentSize',
            0x18: 'AllowSimpleDevicePassword',
            0x19: 'DevicePasswordExpiration',
            0x1A: 'DevicePasswordHistory',
            0x1B: 'AllowStorageCard',
            0x1C: 'AllowCamera',
            0x1D: 'RequireDeviceEncryption',
            0x1E: 'AllowUnsignedApplications',
            0x1F: 'AllowUnsignedInstallationPackages',
            0x20: 'MinDevicePasswordComplexCharacters',
            0x21: 'AllowWiFi',
            0x22: 'AllowTextMessaging',
            0x23: 'AllowPOPIMAPEmail',
            0x24: 'AllowBluetooth',
            0x25: 'AllowIrDA',
            0x26: 'RequireManualSyncWhenRoaming',
            0x27: 'AllowDesktopSync',
            0x28: 'MaxCalendarAgeFilter',
            0x29: 'AllowHTMLEmail',
            0x2A: 'MaxEmailAgeFilter',
            0x2B: 'MaxEmailBodyTruncationSize',
            0x2C: 'MaxEmailHTMLBodyTruncationSize',
            0x2D: 'RequireSignedSMIMEMessages',
            0x2E: 'RequireEncryptedSMIMEMessages',
            0x2F: 'RequireSignedSMIMEAlgorithm',
            0x30: 'RequireEncryptionSMIMEAlgorithm',
            0x31: 'AllowSMIMEEncryptionAlgorithmNegotiation',
            0x32: 'AllowSMIMESoftCerts',
            0x33: 'AllowBrowser',
            0x34: 'AllowConsumerEmail',
            0x35: 'AllowRemoteDesktop',
            0x36: 'AllowInternetSharing',
            0x37: 'UnapprovedInROMApplicationList',
            0x38: 'ApplicationName',
            0x39: 'ApprovedApplicationList',
            0x3A: 'Hash'
        },
        // Code Page 15: Search
        {
            0x05: 'Search',
            0x06: 'Stores',
            0x07: 'Store',
            0x08: 'Name',
            0x09: 'Query',
            0x0a: 'Options',
            0x0b: 'Range',
            0x0c: 'Status',
            0x0d: 'Response',
            0x0e: 'Result',
            0x0f: 'Properties',
            0x10: 'Total',
            0x11: 'EqualTo',
            0x12: 'Value',
            0x13: 'And',
            0x14: 'Or',
            0x15: 'FreeText',
            0x17: 'DeepTraversal',
            0x18: 'LongId',
            0x19: 'RebuildResults',
            0x1a: 'LessThan',
            0x1b: 'GreaterThan',
            0x1c: 'Schema',
            0x1d: 'Supported',
            0x1e: 'UserName',
            0x1f: 'Password',
            0x20: 'ConversationId',
            0x21: 'Picture',
            0x22: 'MaxSize',
            0x23: 'MaxPictures'
        },
        // Code Page 16: GAL
        {
            0x05: 'DisplayName',
            0x06: 'Phone',
            0x07: 'Office',
            0x08: 'Title',
            0x09: 'Company',
            0x0a: 'Alias',
            0x0b: 'FirstName',
            0x0c: 'LastName',
            0x0d: 'HomePhone',
            0x0e: 'MobilePhone',
            0x0f: 'EmailAddress',
            0x10: 'Picture',
            0x11: 'Status',
            0x12: 'Data'
        },
        // Code Page 17: AirSyncBase
        {
            0x05: 'BodyPreference',
            0x06: 'Type',
            0x07: 'TruncationSize',
            0x08: 'AllOrNone',
            0x0A: 'Body',
            0x0B: 'Data',
            0x0C: 'EstimatedDataSize',
            0x0D: 'Truncated',
            0x0E: 'Attachments',
            0x0F: 'Attachment',
            0x10: 'DisplayName',
            0x11: 'FileReference',
            0x12: 'Method',
            0x13: 'ContentId',
            0x14: 'ContentLocation',
            0x15: 'IsInline',
            0x16: 'NativeBodyType',
            0x17: 'ContentType',
            0x18: 'Preview',
            0x19: 'BodyPartPreference',
            0x1A: 'BodyPart',
            0x1B: 'Status'
        },
        // Code Page 18: Settings
        {
            0x05: 'Settings',
            0x06: 'Status',
            0x07: 'Get',
            0x08: 'Set',
            0x09: 'Oof',
            0x0A: 'OofState',
            0x0B: 'StartTime',
            0x0C: 'EndTime',
            0x0D: 'OofMessage',
            0x0E: 'AppliesToInternal',
            0x0F: 'AppliesToExternalKnown',
            0x10: 'AppliesToExternalUnknown',
            0x11: 'Enabled',
            0x12: 'ReplyMessage',
            0x13: 'BodyType',
            0x14: 'DevicePassword',
            0x15: 'Password',
            0x16: 'DeviceInformation',
            0x17: 'Model',
            0x18: 'IMEI',
            0x19: 'FriendlyName',
            0x1A: 'OS',
            0x1B: 'OSLanguage',
            0x1C: 'PhoneNumber',
            0x1D: 'UserInformation',
            0x1E: 'EmailAddresses',
            0x1F: 'SMTPAddress',
            0x20: 'UserAgent',
            0x21: 'EnableOutboundSMS',
            0x22: 'MobileOperator',
            0x23: 'PrimarySmtpAddress',
            0x24: 'Accounts',
            0x25: 'Account',
            0x26: 'AccountId',
            0x27: 'AccountName',
            0x28: 'UserDisplayName',
            0x29: 'SendDisabled',
            0x2B: 'RightsManagementInformation'
        },
        // Code Page 19: DocumentLibrary
        {
            0x05: 'LinkId',
            0x06: 'DisplayName',
            0x07: 'IsFolder',
            0x08: 'CreationDate',
            0x09: 'LastModifiedDate',
            0x0a: 'IsHidden',
            0x0b: 'ContentLength',
            0x0c: 'ContentType'
        },
        // Code Page 20: ItemOperations
        {
            0x05: 'ItemOperations',
            0x06: 'Fetch',
            0x07: 'Store',
            0x08: 'Options',
            0x09: 'Range',
            0x0A: 'Total',
            0x0B: 'Properties',
            0x0C: 'Data',
            0x0D: 'Status',
            0x0E: 'Response',
            0x0F: 'Version',
            0x10: 'Schema',
            0x11: 'Part',
            0x12: 'EmptyFolderContents',
            0x13: 'DeleteSubFolders',
            0x14: 'UserName',
            0x15: 'Password',
            0x16: 'Move',
            0x17: 'DstFldId',
            0x18: 'ConversationId',
            0x19: 'MoveAlways'
        },
        // Code Page 21: ComposeMail
        {
            0x05: 'SendMail',
            0x06: 'SmartForward',
            0x07: 'SmartReply',
            0x08: 'SaveInSentItems',
            0x09: 'ReplaceMime',
            0x0b: 'Source',
            0x0c: 'FolderId',
            0x0d: 'ItemId',
            0x0e: 'LongId',
            0x0f: 'InstanceId',
            0x10: 'Mime',
            0x11: 'ClientId',
            0x12: 'Status',
            0x13: 'AccountId',
            0x15: 'Forwardees',
            0x16: 'Forwardee',
            0x17: 'ForwardeeName',
            0x18: 'ForwardeeEmail'
        },
        // Code Page 22: Email2
        {
            0x05: 'UmCallerID',
            0x06: 'UmUserNotes',
            0x07: 'UmAttDuration',
            0x08: 'UmAttOrder',
            0x09: 'ConversationId',
            0x0a: 'ConversationIndex',
            0x0b: 'LastVerbExecuted',
            0x0c: 'LastVerbExecutionTime',
            0x0d: 'ReceivedAsBcc',
            0x0e: 'Sender',
            0x0f: 'CalendarType',
            0x10: 'IsLeapMonth',
            0x11: 'AccountId',
            0x12: 'FirstDayOfWeek',
            0x13: 'MeetingMessageType',
            0x15: 'IsDraft',
            0x16: 'Bcc',
            0x17: 'Send'
        },
        // Code Page 23: Notes
        {
            0x05: 'Subject',
            0x06: 'MessageClass',
            0x07: 'LastModifiedDate',
            0x08: 'Categories',
            0x09: 'Category'
        },
        // Code Page 24: RightsManagement
        {
            0x05: 'RightsManagementSupport',
            0x06: 'RightsManagementTemplates',
            0x07: 'RightsManagementTemplate',
            0x08: 'RightsManagementLicense',
            0x09: 'EditAllowed',
            0x0a: 'ReplyAllowed',
            0x0b: 'ReplyAllAllowed',
            0x0c: 'ForwardAllowed',
            0x0d: 'ModifyRecipientsAllowed',
            0x0e: 'ExtractAllowed',
            0x0f: 'PrintAllowed',
            0x10: 'ExportAllowed',
            0x11: 'ProgrammaticAccessAllowed',
            0x12: 'Owner',
            0x13: 'ContentExpiryDate',
            0x14: 'TemplateID',
            0x15: 'TemplateName',
            0x16: 'TemplateDescription',
            0x17: 'ContentOwner',
            0x18: 'RemoveRightsManagementDistribution'
        }
    ],

    namespaces : [
        'AirSync',
        'Contacts',
        'Email',
        'AirNotify',
        'Calendar',
        'Move',
        'GetItemEstimate',
        'FolderHierarchy',
        'MeetingResponse',
        'Tasks',
        'ResolveRecipients',
        'ValidateCert',
        'Contacts2',
        'Ping',
        'Provision',
        'Search',
        'Gal',
        'AirSyncBase',
        'Settings',
        'DocumentLibrary',
        'ItemOperations',
        'ComposeMail',
        'Email2',
        'Notes',
        'RightsManagement'
    ]
    
};

wbxmltools.buildCodepages2();
