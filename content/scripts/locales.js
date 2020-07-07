/*
 license: The MIT License, Copyright (c) 2016-2019 YUKI "Piro" Hiroshi
 original: http://github.com/piroor/webextensions-lib-l10n
 
  Modification by John Bieling:
   * Auto select ConversionHelper.i18n or browser.i18n
   * Removed logging
*/

// This file can be used in WX but also in legacy code, where it adds to the global
// scope. Therefore, it is encapsuled.
(function (addonId, keyPrefix, pathToConversionHelperJSM){

	let localization = {
		i18n: null,
		
		updateString(string) {
			let re = new RegExp(keyPrefix + "(.+?)__", "g");
			return string.replace(re, matched => {
				const key = matched.slice(keyPrefix.length, -2);
				return this.i18n.getMessage(key) || matched;
			});
		},
		
		updateSubtree(node) {
			const texts = document.evaluate(
				'descendant::text()[contains(self::text(), "' + keyPrefix + '")]',
				node,
				null,
				XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
				null
			);
			for (let i = 0, maxi = texts.snapshotLength; i < maxi; i++) {
				const text = texts.snapshotItem(i);
				if (text.nodeValue.includes(keyPrefix)) text.nodeValue = this.updateString(text.nodeValue);
			}
			
			const attributes = document.evaluate(
				'descendant::*/attribute::*[contains(., "' + keyPrefix + '")]',
				node,
				null,
				XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
				null
			);
			for (let i = 0, maxi = attributes.snapshotLength; i < maxi; i++) {
				const attribute = attributes.snapshotItem(i);
				if (attribute.value.includes(keyPrefix)) attribute.value = this.updateString(attribute.value);
			}
		},
		
		async updateDocument() {
			// do we need to load the ConversionHelper?
			try {
				if (browser) this.i18n = browser.i18n;
			} catch (e) {
				let { ConversionHelper } = ChromeUtils.import(pathToConversionHelperJSM);
				// Since the TB68 built in OverlayLoader could run/finish before background.js has finished,
				// and therefore run before the ConversionHelper has been initialized, we need to wait.
				// In TB78, this return immediately
				await ConversionHelper.webExtensionStartupCompleted();
				this.i18n = ConversionHelper.i18n;
			}
			this.updateSubtree(document);
		}
	};

	// standard event if loaded by a standard window
	document.addEventListener('DOMContentLoaded', () => {
		localization.updateDocument();
	}, { once: true });

	// custom event, fired by the overlay loader after it has finished loading
	document.addEventListener("DOMOverlayLoaded_" + addonId, () => {
		localization.updateDocument();
	}, { once: true });

})("tbsync@jobisoft.de", "__TBSYNCMSG_", "chrome://tbsync/content/api/ConversionHelper/ConversionHelper.jsm");
