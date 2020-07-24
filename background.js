function handleUpdateAvailable(details) {
  console.log("Update available for TbSync");
}

async function main() {
  // just by registering this listener, updates will not install until next restart
  //messenger.runtime.onUpdateAvailable.addListener(handleUpdateAvailable);

  await messenger.BootstrapLoader.registerChromeUrl([ ["content", "tbsync", "content/"] ]);
  await messenger.BootstrapLoader.registerBootstrapScript("chrome://tbsync/content/scripts/bootstrap.js");  
}

main();
