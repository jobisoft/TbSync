/*
 * This file is provided by the webext-support repository at
 * https://github.com/thunderbird/webext-support
 *
 * For usage descriptions, please check:
 * https://github.com/thunderbird/webext-support/tree/master/modules/i18n
 *
 * Version 2.2
 *
 * Derived from:
 * * http://github.com/piroor/webextensions-lib-l10n
 *
 * Original license:
 * The MIT License, Copyright (c) 2016-2019 YUKI "Piro" Hiroshi
 *
 * Contributors:
 * * @piroor (YUKI Hiroshi)
 * * @jobisoft (John Bieling)
 * * @tmccoid-tech
 *
 * 
 * Usage:
 * 
 * Call localizeDocument() to perform localization insertions/replacements of the
 * loaded document. The function supports two optional parameters:
 * 
 * options:
 *   An object which can specify an "extension" member (to be used in Experiments),
 *   and/or an "keyPrefix" member, to override the default "__MSG_" prefix for
 *   localization keys.
 * document:
 *   If a different document instead of the currently loaded document is to be
 *   localized.
 * 
 * Assuming a localization entry with the key "someItem" and an escaped key of
 * __MSG_someItem__, the function needs to following markup:
 * 
 * 1) Use the "data-i18n-content" attribute of an element to set its content, such as:
 *      <span data-i18n-content="someItem"></span>                 // Assign span content
 *      <span data-i18n-content="__MSG_someItem__"></span>         // Assign span content
 *      <title data-i18n-content="someItem"></title>               // Assign document title via content
 * 
 * 2) To set other attributes of elements, use the form data-i18n-*, such as:
 *      <input type="text" data-i18n-placeholder="someItem" />     // Assigns the placeholder text for a textbox
 *      
 * 3) Use the __MSG_someItem__ notation anywhere in the documents markup content, such as:
 *      <span>__MSG_someItem__</span>
 *      <span> 1) __MSG_someItem__: __MSG_someItemDesc__ </span>
 *      <img alt="__MSG_someItem__"></img>
 *
 *    Note that keys placed in content can momentarily be displayed prior to
 *    substitution once the document has loaded. It is suggested to use the
 *    data-i18n-content attribute instead.
 */

const i18nAttrRegex = /^data-i18n-(?<target>.*)/;

let _extension = null;
let _keyPrefix = "__MSG_";

const getTranslationFromKey = (key) => {
    let rv = _extension
        ? _extension.localeData.localizeMessage(key)
        : messenger.i18n.getMessage(key);
    return rv || `__MSG_${key}__`;
}

const getTranslationFromEscapedKey = (placeholder) => {
    const prefixRegex = new RegExp(_keyPrefix + "(.+?)__", "g");
    return placeholder.replace(prefixRegex, (escapedKey) => {
        const key = escapedKey.slice(_keyPrefix.length, -2);
        return getTranslationFromKey(key);
    });
};

const updateSubtreeSet = (sourceDocument, node, selector, update) => {
    const items = sourceDocument.evaluate(
        `descendant::${selector}`,
        node,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
    );

    for (let i = 0, count = items.snapshotLength; i < count; i++) {
        update(items.snapshotItem(i));
    }
};

const updateSubtree = (sourceDocument, node) => {
    // Update element content (data-i18n-content) or attribute values based
    // on data-i18n-* attributes assigned to the element.
    updateSubtreeSet(sourceDocument, node,
        '*/@*[starts-with(name(), "data-i18n-")]',
        (attr) => {
            const key = attr.value;

            let value;

            // If using traditional i18n key placeholders of the form __MSG_*__.
            if (key.includes(_keyPrefix)) {
                value = getTranslationFromEscapedKey(key);
            }
            // If using the direct i18n keys.
            else {
                value = getTranslationFromKey(key);
            }

            const { ownerElement } = attr;
            let { target } = i18nAttrRegex.exec(attr.name).groups;

            if (target == "content") {
                ownerElement.textContent = value;
            } else {
                // Assume it is an attribute.
                ownerElement.setAttribute(target, value);
            }
        }
    );

    // Update text nodes containing __MSG_*__ placeholders
    updateSubtreeSet(sourceDocument, node,
        `text()[contains(self::text(), "${_keyPrefix}")]`,
        (text) => {
            if (text.nodeValue.includes(_keyPrefix))
                text.nodeValue = getTranslationFromEscapedKey(text.nodeValue);
        }
    );

    // Update element attributes (excluding data-i18n-*) containing __MSG_*__ placeholders
    updateSubtreeSet(sourceDocument, node,
        `*/@*[not(starts-with(name(), "data-i18n-"))][contains(., "${_keyPrefix}")]`,
        (attr) => {
            if (attr.value.includes(_keyPrefix))
                attr.value = getTranslationFromEscapedKey(attr.value);
        }
    );
};

const updateDocument = (options = {}, sourceDocument) => {
    if (options) {
        if (options.extension)
            _extension = options.extension;
        if (options.keyPrefix)
            _keyPrefix = options.keyPrefix;
    }
    updateSubtree(sourceDocument, sourceDocument);
};

export function localizeDocument(options = {}, sourceDocument = document) {
    updateDocument(options, sourceDocument);
}
