document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("intro").textContent =
    browser.i18n.getMessage("options.intro");
  const btn = document.getElementById("open-manager");
  btn.textContent = browser.i18n.getMessage("options.openManager");
  btn.addEventListener("click", () => {
    browser.runtime.sendMessage({ kind: "open-manager" });
  });
});
