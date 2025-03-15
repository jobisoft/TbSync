var { ExtensionParent } = ChromeUtils.importESModule(
    "resource://gre/modules/ExtensionParent.sys.mjs"
);

var tbsyncExtension = ExtensionParent.GlobalManager.getExtension(
    "tbsync@jobisoft.de"
);
var { TbSync } = ChromeUtils.importESModule(
    `chrome://tbsync/content/tbsync.sys.mjs?${tbsyncExtension.manifest.version}`
);

TbSync.localizeOnLoad(window);
