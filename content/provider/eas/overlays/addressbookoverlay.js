tbSync.eas.onInjectIntoAddressbook = function (window) {
    if (window.document.getElementById("cvEmail3Box") && window.document.getElementById("abResultsTree")) {
	window.document.getElementById("abResultsTree").addEventListener("select", tbSync.eas.onResultsPaneSelectionChanged, false);
        tbSync.eas.onResultsPaneSelectionChanged();
    }    
}

tbSync.eas.onRemoveFromAddressbook = function (window) {
    if (window.document.getElementById("cvEmail3Box") && window.document.getElementById("abResultsTree")) {
	window.document.getElementById("abResultsTree").removeEventListener("select", tbSync.eas.onResultsPaneSelectionChanged, false);
    }
}

tbSync.eas.onResultsPaneSelectionChanged = function () {
    let cards = window.GetSelectedAbCards();
    let email3Box = window.document.getElementById("cvEmail3Box");
    let email3Element = window.document.getElementById("cvEmail3");
    if (email3Box && cards.length == 1) {
        //is this an EAS card?
        let aParentDirURI = tbSync.getUriFromPrefId(cards[0].directoryId.split("&")[0]);
        if (aParentDirURI) { //could be undefined
            let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
            if (folders.length > 0) {
                email3Box.hidden = false;
                let email3Value = cards[0].getProperty("Email3Address","");
                window.HandleLink(email3Element, window.zSecondaryEmail, email3Value, email3Box, "mailto:" + email3Value);
                return;
            }
        }
    }
    email3Box.hidden = true;
}
