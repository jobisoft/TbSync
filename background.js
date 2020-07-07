async function main() {
  // setup ConversionHelper
  //await browser.ConversionHelper.registerChromeUrl([ ["content", "tbsync", "content/"] ]);
  await messenger.ConversionHelper.registerApiFolder("chrome://tbsync/content/api/ConversionHelper/");
  
  await messenger.ConversionHelper.notifyStartupCompleted();
}

main();
