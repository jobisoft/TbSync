
    //What to do, if card is opened for edit in UI
tbSync.eas.onLoadCard = function (aCard, aDocument) {
        if (aCard.getProperty("EASID","")) {
            //aDocument.defaultView.console.log("read:" + aCard.getProperty("EAS-MiddleName", ""));
            let items = aDocument.getElementsByClassName("easProperty");
            for (let i=0; i < items.length; i++)
            {
                items[i].value = aCard.getProperty(items[i].id, "");
            }
        }
    };

    //What to do, if card is saved in UI
tbSync.eas.onSaveCard = function (aCard, aDocument) {
        if (aCard.getProperty("EASID","")) {
            let items = aDocument.getElementsByClassName("easProperty");
            for (let i=0; i < items.length; i++)
            {
                aCard.setProperty(items[i].id, items[i].value);
            }
        }
    };
    
window.RegisterLoadListener(tbSync.eas.onLoadCard);
window.RegisterSaveListener(tbSync.eas.onSaveCard);
