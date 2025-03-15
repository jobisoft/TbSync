await browser.LegacyHelper.registerGlobalUrls([
  ["content", "tbsync", "content/"],
]);

await browser.TbSync.load();

messenger.browserAction.onClicked.addListener(tab => {
  browser.TbSync.openManagerWindow();
});
