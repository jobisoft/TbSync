async function main() {
  await messenger.LegacyBootstrap.registerChromeUrl([ ["content", "tbsync", "content/"] ]);
  await messenger.LegacyBootstrap.registerBootstrapScript("chrome://tbsync/content/scripts/bootstrap.js");  
}

main();
