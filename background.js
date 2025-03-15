await browser.LegacyHelper.registerGlobalUrls([
  ["content", "tbsync", "content/"],
]);

// Overlay all already open normal windows.
let windows = await browser.windows.getAll({ windowTypes: ["normal"] })
for (let window of windows) {
    await browser.TbSync.load(window.id);
}

// Overlay any new normal window being opened.
browser.windows.onCreated.addListener(async window => {
  if (window.type == "normal") {
    await browser.TbSync.load(window.id);
  }
});

messenger.browserAction.onClicked.addListener(tab => {
  browser.TbSync.openManagerWindow();
});
