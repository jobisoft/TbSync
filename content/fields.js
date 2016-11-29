kVcardFields.push(["BusinessFaxNumber","BusinessFaxNumber"])
kVcardFields.push(["Business2PhoneNumber","Business2PhoneNumber"])
kVcardFields.push(["AssistantPhoneNumber","AssistantPhoneNumber"])
kVcardFields.push(["CarPhoneNumber","CarPhoneNumber"])
kVcardFields.push(["RadioPhoneNumber","RadioPhoneNumber"])
kVcardFields.push(["Email3Address","Email3Address"])
kVcardFields.push(["Home2PhoneNumber","Home2PhoneNumber"])
kVcardFields.push(["CompanyMainPhone","CompanyMainPhone"])
kVcardFields.push(["ManagerName","ManagerName"])
kVcardFields.push(["AssistantName","AssistantName"])
kVcardFields.push(["Spouse","Spouse"])
kVcardFields.push(["IMAddress","IMAddress"])
kVcardFields.push(["IMAddress2","IMAddress2"])
kVcardFields.push(["IMAddress3","IMAddress3"])
kVcardFields.push(["MMS","MMS"])
kVcardFields.push(["eBusinessFaxNumber","BusinessFaxNumber"])
kVcardFields.push(["eBusiness2PhoneNumber","Business2PhoneNumber"])
kVcardFields.push(["eAssistantPhoneNumber","AssistantPhoneNumber"])
kVcardFields.push(["eCarPhoneNumber","CarPhoneNumber"])
kVcardFields.push(["eRadioPhoneNumber","RadioPhoneNumber"])
kVcardFields.push(["eWorkPhone", "WorkPhone"])
kVcardFields.push(["eCompanyMainPhone","CompanyMainPhone"])
kVcardFields.push(["eHome2PhoneNumber","Home2PhoneNumber"])
kVcardFields.push(["eFaxNumber", "FaxNumber"])
kVcardFields.push(["eHomePhone", "HomePhone"])
kVcardFields.push(["ePagerNumber", "PagerNumber"])
kVcardFields.push(["eCellularNumber", "CellularNumber"])
kVcardFields.push(["MiddleName", "MiddleName"])
kVcardFields.push(["OtherAddressStreet", "OtherAddressStreet"])
kVcardFields.push(["OtherAddressCity", "OtherAddressCity"])
kVcardFields.push(["OtherAddressCountry", "OtherAddressCountry"])
kVcardFields.push(["OtherAddressState", "OtherAddressState"])
kVcardFields.push(["OtherAddressPostalCode", "OtherAddressPostalCode"])

function updateann() {
    prefs = Components.classes["@mozilla.org/preferences-service;1"]
    .getService(Components.interfaces.nsIPrefService).getBranch("extensions.tzpush.")
    var show = prefs.getBoolPref("showanniversary")	
var AnniversaryElem = document.getElementById("tzAnniversary");
var AnniversaryMonth = AnniversaryElem.monthField.value;
var AnniversaryDay = AnniversaryElem.dateField.value;
var AnniversaryYear = AnniversaryElem.yearField.value
var eAnniversaryxul = document.getElementById("eAnniversary")
eAnniversaryxul.monthField.value = AnniversaryMonth 
eAnniversaryxul.dateField.value = AnniversaryDay 
eAnniversaryxul.yearField.value = AnniversaryYear 

gEditCard.card.setProperty("AnniversaryDay", AnniversaryDay);
gEditCard.card.setProperty("AnniversaryMonth", AnniversaryMonth);

}
function updateannyear() {
var AnniversaryYear = document.getElementById("tzAnniversaryYear").value;
gEditCard.card.setProperty("AnniversaryYear", AnniversaryYear);
document.getElementById("eAnniversary").yearField.value = AnniversaryYear
 
	}
	
function updatecard(id,value) {
document.getElementById(id).value = value
//gEditCard.card.setProperty(id,value)

}
function updatefromeann() {
var eAnniversaryElem = document.getElementById("eAnniversary");
var eAnniversaryMonth = eAnniversaryElem.monthField.value;
var eAnniversaryDay = eAnniversaryElem.dateField.value;	
var eAnniversaryYear = eAnniversaryElem.yearField.value;	
var AnniversaryElem = document.getElementById("tzAnniversary");
AnniversaryElem.monthField.value = eAnniversaryMonth
AnniversaryElem.dateField.value = eAnniversaryDay
AnniversaryElem.yearField.value = eAnniversaryYear	
try { document.getElementById("tzAnniversaryYear").value = eAnniversaryYear }
catch(e) {}	
	}
	
	
	

 
  
	

