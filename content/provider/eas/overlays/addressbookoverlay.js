tbSync.eas.DisplayCardViewPane_ORIG = window.DisplayCardViewPane;
window.DisplayCardViewPane = function(card) {
    tbSync.eas.DisplayCardViewPane_ORIG(card);
    let email3Value = card.getProperty("Email3Address","");
    let email3Box = window.document.getElementById("cvEmail3Box");
    let email3Element = window.document.getElementById("cvEmail3");
    
    window.HandleLink(email3Element, window.zSecondaryEmail, email3Value, email3Box, "mailto:" + email3Value);
}
