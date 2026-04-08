const status = document.getElementById("status");
const openAgainButton = document.getElementById("open-again");

async function openManager() {
  try {
    await browser.TbSync.openManagerWindow();
    status.textContent = "The TbSync account manager should now be open.";
  } catch (error) {
    console.error("Failed to open TbSync account manager", error);
    status.textContent =
      "Thunderbird could not open the TbSync account manager automatically.";
  }
}

openAgainButton.addEventListener("click", () => {
  void openManager();
});

void openManager();
