"use strict";

var EXPORTED_SYMBOLS = ["toxml", "writewbxml"];

//Write content of wbxml into a file in the profile directory (for debug purposes)
function writewbxml (wbxml) {
    Components.utils.import("resource://gre/modules/FileUtils.jsm");

    // create folder "wbxml" in profile directory
    FileUtils.getDir("ProfD", ["wbxml"], true);

    // get the "wbxml-output" file ind the "wbxml" directory
    let file = FileUtils.getFile("ProfD", ["wbxml"]);
    file.append("wbxml-output");

    //create the unique file, by adding a number to the end of the filename
    file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, FileUtils.PERMS_FILE);

    //create a strem to write to that file
    let foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
    foStream.init(file, 0x02 | 0x08 | 0x20, parseInt("0666", 8), 0); // write, create, truncate
    foStream.write(wbxml, wbxml.length);
    foStream.close();
}


// Convert a WAP Binary XML to plain XML
function toxml (wbxml) {
    let AirSyncBase = ({
        0x05: '<BodyPreference>',
        0x06: '<Type>',
        0x07: '<TruncationSize>',
        0x08: '<AllOrNone>',
        0x0A: '<Body>',
        0x0B: '<Data>',
        0x0C: '<EstimatedDataSize>',
        0x0D: '<Truncated>',
        0x0E: '<Attachments>',
        0x0F: '<Attachment>',
        0x10: '<DisplayName>',
        0x11: '<FileReference>',
        0x12: '<Method>',
        0x13: '<ContentId>',
        0x14: '<ContentLocation>',
        0x15: '<IsInline>',
        0x16: '<NativeBodyType>',
        0x17: '<ContentType>',
        0x18: '<Preview>',
        0x19: '<BodyPartPreference>',
        0x1A: '<BodyPart>',
        0x1B: '<Status>'
    });

    let AirSync = ({
        0x05: '<Sync>',
        0x06: '<Responses>',
        0x07: '<Add>',
        0x08: '<Change>',
        0x09: '<Delete>',
        0x0A: '<Fetch>',
        0x0B: '<SyncKey>',
        0x0C: '<ClientId>',
        0x0D: '<ServerId>',
        0x0E: '<Status>',
        0x0F: '<Collection>',
        0x10: '<Class>',
        0x12: '<CollectionId>',
        0x13: '<GetChanges>',
        0x14: '<MoreAvailable>',
        0x15: '<WindowSize>',
        0x16: '<Commands>',
        0x17: '<Options>',
        0x18: '<FilterType>',
        0x1B: '<Conflict>',
        0x1C: '<Collections>',
        0x1D: '<ApplicationData>',
        0x1E: '<DeletesAsMoves>',
        0x20: '<Supported>',
        0x21: '<SoftDelete>',
        0x22: '<MIMESupport>',
        0x23: '<MIMETruncation>',
        0x24: '<Wait>',
        0x25: '<Limit>',
        0x26: '<Partial>',
        0x27: '<ConversationMode>',
        0x28: '<MaxItems>',
        0x29: '<HeartbeatInterval>'
    });

    let Contacts = ({
        0x05: '<Anniversary>',
        0x06: '<AssistantName>',
        0x07: '<AssistantPhoneNumber>',
        0x08: '<Birthday>',
        0x09: '<body>',
        0x0A: '<BodySize>',
        0x0B: '<BodyTruncated>',
        0x0C: '<Business2PhoneNumber>',
        0x0D: '<BusinessAddressCity>',
        0x0E: '<BusinessAddressCountry>',
        0x0F: '<BusinessAddressPostalCode>',
        0x10: '<BusinessAddressState>',
        0x11: '<BusinessAddressStreet>',
        0x12: '<BusinessFaxNumber>',
        0x13: '<BusinessPhoneNumber>',
        0x14: '<CarPhoneNumber>',
        0x15: '<Categories>',
        0x16: '<Category>',
        0x17: '<Children>',
        0x18: '<Child>',
        0x19: '<CompanyName>',
        0x1A: '<Department>',
        0x1B: '<Email1Address>',
        0x1C: '<Email2Address>',
        0x1D: '<Email3Address>',
        0x1E: '<FileAs>',
        0x1F: '<FirstName>',
        0x20: '<Home2PhoneNumber>',
        0x21: '<HomeAddressCity>',
        0x22: '<HomeAddressCountry>',
        0x23: '<HomeAddressPostalCode>',
        0x24: '<HomeAddressState>',
        0x25: '<HomeAddressStreet>',
        0x26: '<HomeFaxNumber>',
        0x27: '<HomePhoneNumber>',
        0x28: '<JobTitle>',
        0x29: '<LastName>',
        0x2A: '<MiddleName>',
        0x2B: '<MobilePhoneNumber>',
        0x2C: '<OfficeLocation>',
        0x2D: '<OtherAddressCity>',
        0x2E: '<OtherAddressCountry>',
        0x2F: '<OtherAddressPostalCode>',
        0x30: '<OtherAddressState>',
        0x31: '<OtherAddressStreet>',
        0x32: '<PagerNumber>',
        0x33: '<RadioPhoneNumber>',
        0x34: '<Spouse>',
        0x35: '<Suffix>',
        0x36: '<Title>',
        0x37: '<WebPage>',
        0x38: '<YomiCompanyName>',
        0x39: '<YomiFirstName>',
        0x3A: '<YomiLastName>',
        0x3C: '<Picture>',
        0x3D: '<Alias>',
        0x3E: '<WeightedRank>',
    });

    let Settings = ({
        0x05: '<Settings>',
        0x06: '<Status>',
        0x07: '<Get>',
        0x08: '<Set>',
        0x09: '<Oof>',
        0x0A: '<OofState>',
        0x0B: '<StartTime>',
        0x0C: '<EndTime>',
        0x0D: '<OofMessage>',
        0x0E: '<AppliesToInternal>',
        0x0F: '<AppliesToExternalKnown>',
        0x10: '<AppliesToExternalUnknown>',
        0x11: '<Enabled>',
        0x12: '<ReplyMessage>',
        0x13: '<BodyType>',
        0x14: '<DevicePassword>',
        0x15: '<Password>',
        0x16: '<DeviceInformation>',
        0x17: '<Model>',
        0x18: '<IMEI>',
        0x19: '<FriendlyName>',
        0x1A: '<OS>',
        0x1B: '<OSLanguage>',
        0x1C: '<PhoneNumber>',
        0x1D: '<UserInformation>',
        0x1E: '<EmailAddresses>',
        0x1F: '<SMTPAddress>',
        0x20: '<UserAgent>',
        0x21: '<EnableOutboundSMS>',
        0x22: '<MobileOperator>',
        0x23: '<PrimarySmtpAddress>',
        0x24: '<Accounts>',
        0x25: '<Account>',
        0x26: '<AccountId>',
        0x27: '<AccountName>',
        0x28: '<UserDisplayName>',
        0x29: '<SendDisabled>',
        0x2B: '<RightsManagementInformation>'
    });

    let Provision = ({
        0x05: '<Provision>',
        0x06: '<Policies>',
        0x07: '<Policy>',
        0x08: '<PolicyType>',
        0x09: '<PolicyKey>',
        0x0A: '<Data>',
        0x0B: '<Status>',
        0x0C: '<RemoteWipe>',
        0x0D: '<EASProvisionDoc>',
        0x0E: '<DevicePasswordEnabled>',
        0x0F: '<AlphanumericDevicePasswordRequired>',
        0x10: '<DeviceEncryptionEnabled>',
        // 0x10:'<RequireStorageCardEncryption>',
        0x11: '<PasswordRecoveryEnabled>',
        0x13: '<AttachmentsEnabled>',
        0x14: '<MinDevicePasswordLength>',
        0x15: '<MaxInactivityTimeDeviceLock>',
        0x16: '<MaxDevicePasswordFailedAttempts>',
        0x17: '<MaxAttachmentSize>',
        0x18: '<AllowSimpleDevicePassword>',
        0x19: '<DevicePasswordExpiration>',
        0x1A: '<DevicePasswordHistory>',
        0x1B: '<AllowStorageCard>',
        0x1C: '<AllowCamera>',
        0x1D: '<RequireDeviceEncryption>',
        0x1E: '<AllowUnsignedApplications>',
        0x1F: '<AllowUnsignedInstallationPackages>',
        0x20: '<MinDevicePasswordComplexCharacters>',
        0x21: '<AllowWiFi>',
        0x22: '<AllowTextMessaging>',
        0x23: '<AllowPOPIMAPEmail>',
        0x24: '<AllowBluetooth>',
        0x25: '<AllowIrDA>',
        0x26: '<RequireManualSyncWhenRoaming>',
        0x27: '<AllowDesktopSync>',
        0x28: '<MaxCalendarAgeFilter>',
        0x29: '<AllowHTMLEmail>',
        0x2A: '<MaxEmailAgeFilter>',
        0x2B: '<MaxEmailBodyTruncationSize>',
        0x2C: '<MaxEmailHTMLBodyTruncationSize>',
        0x2D: '<RequireSignedSMIMEMessages>',
        0x2E: '<RequireEncryptedSMIMEMessages>',
        0x2F: '<RequireSignedSMIMEAlgorithm>',
        0x30: '<RequireEncryptionSMIMEAlgorithm>',
        0x31: '<AllowSMIMEEncryptionAlgorithmNegotiation>',
        0x32: '<AllowSMIMESoftCerts>',
        0x33: '<AllowBrowser>',
        0x34: '<AllowConsumerEmail>',
        0x35: '<AllowRemoteDesktop>',
        0x36: '<AllowInternetSharing>',
        0x37: '<UnapprovedInROMApplicationList>',
        0x38: '<ApplicationName>',
        0x39: '<ApprovedApplicationList>',
        0x3A: '<Hash>',
    });

    let FolderHierarchy = ({
        0x07: '<DisplayName>',
        0x08: '<ServerId>',
        0x09: '<ParentId>',
        0x0A: '<Type>',
        0x0C: '<Status>',
        0x0E: '<Changes>',
        0x0F: '<Add>',
        0x10: '<Delete>',
        0x11: '<Update>',
        0x12: '<SyncKey>',
        0x13: '<FolderCreate>',
        0x14: '<FolderDelete>',
        0x15: '<FolderUpdate>',
        0x16: '<FolderSync>',
        0x17: '<Count>'
    });

    let Contacts2 = ({
        0x05: '<CustomerId>',
        0x06: '<GovernmentId>',
        0x07: '<IMAddress>',
        0x08: '<IMAddress2>',
        0x09: '<IMAddress3>',
        0x0A: '<ManagerName>',
        0x0B: '<CompanyMainPhone>',
        0x0C: '<AccountName>',
        0x0D: '<NickName>',
        0x0E: '<MMS>'
    });

    let Search = ({
        0x05: '<Search>',
        0x07: '<Store>',
        0x08: '<Name>',
        0x09: '<Query>',
        0x0A: '<Options>',
        0x0B: '<Range>',
        0x0C: '<Status>',
        0x0D: '<Response>',
        0x0E: '<Result>',
        0x0F: '<Properties>',
        0x10: '<Total>',
        0x11: '<EqualTo>',
        0x12: '<Value>',
        0x13: '<And>',
        0x14: '<Or>',
        0x15: '<FreeText>',
        0x17: '<DeepTraversal>',
        0x18: '<LongId>',
        0x19: '<RebuildResults>',
        0x1A: '<LessThan>',
        0x1B: '<GreaterThan>',
        0x1E: '<UserName>',
        0x1F: '<Password>',
        0x20: '<ConversationId>',
        0x21: '<Picture>',
        0x22: '<MaxSize>',
        0x23: '<MaxPictures>'
    });

    let GAL = ({
        0x05: '<DisplayName>',
        0x06: '<Phone>',
        0x07: '<Office>',
        0x08: '<Title>',
        0x09: '<Company>',
        0x0A: '<Alias>',
        0x0B: '<FirstName>',
        0x0C: '<LastName>',
        0x0D: '<HomePhone>',
        0x0E: '<MobilePhone>',
        0x0F: '<EmailAddress>',
        0x10: '<Picture>',
        0x11: '<Status>',
        0x12: '<Data>'
    });

    let Code = ({
        0x07: FolderHierarchy,
        0x01: Contacts,
        0x00: AirSync,
        0x0E: Provision,
        0x11: AirSyncBase,
        0x12: Settings,
        0x0C: Contacts2,
        0x0F: Search,
        0x10: GAL
    });
    
    let Codestring = ({
        0x07: "FolderHierarchy",
        0x01: "Contacts",
        0x00: "AirSync",
        0x0E: "Provision",
        0x11: "AirSyncBase",
        0x12: "Settings",
        0x0C: "Contacts2",
        0x0F: "Search",
        0x10: "GAL"
    });

    let CodePage = Code[0];
    let stack = [];
    let num = 4;
    let xml = '<?xml version="1.0"?>';
    let x = '0';
    let firstxmlns = true;
    let firstx = '0';
    
    while (num < wbxml.length) {
        let token = wbxml.substr(num, 1);
        let tokencontent = token.charCodeAt(0) & 0xbf;
        if (token || tokencontent in Code) {
            if (token == String.fromCharCode(0x00)) {
                num = num + 1;
                x = (wbxml.substr(num, 1)).charCodeAt(0);
                CodePage = Code[x];
                if (firstxmlns) {
                    firstx = x;
                }
            } else if (token == String.fromCharCode(0x03)) {
                xml = xml + (wbxml.substring(num + 1, wbxml.indexOf(String.fromCharCode(0x00, 0x01), num)));
                num = wbxml.indexOf(String.fromCharCode(0x00, 0x01), num);
            } else if (token == String.fromCharCode(0x01)) {
                xml = xml + (stack.pop());
            } else if (token.charCodeAt(0) in CodePage) {
                xml = xml + (CodePage[token.charCodeAt(0)]).replace('>', '/>');
            } else if (tokencontent in CodePage) {
                if (firstxmlns || x !== firstx) {
                    xml = xml + (CodePage[tokencontent].replace('>', ' xmlns="' + Codestring[x] + ':">'));
                    firstxmlns = false;
                } else {
                    xml = xml + (CodePage[tokencontent]);
                }

                stack.push((CodePage[tokencontent]).replace('<', '</'));
            } else {

            }
        }

        num = num + 1;
    }
    
    return xml;
}
