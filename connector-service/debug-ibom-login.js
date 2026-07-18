// Standalone debug script — runs the EXACT SAME login sequence our
// connector uses, but with a visible browser window and screenshots saved
// at each step, so we can see directly what happens instead of inferring
// it from text logs.
//
// Run from inside the connector-service folder (needs its installed
// playwright package):
//
//   cd connector-service
//   node debug-ibom-login.js

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

// Fill in your real credentials here — this file is for local debugging
// only, never commit it.
const USERNAME = "OLATDIS";
const PASSWORD = "Tdis996";

const OUT_DIR = path.join(__dirname, "debug-screenshots");

async function shot(page, name) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch((e) => console.log(`  (screenshot failed: ${e.message})`));
  console.log(`  📸 saved ${file}`);
}

async function main() {
  console.log("Launching a VISIBLE browser — watch it as it runs...\n");

  const browser = await chromium.launch({ headless: false, slowMo: 400 });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });

  context.on("dialog", (dialog) => {
    console.log(`  🔔 Dialog appeared: "${dialog.message()}" — dismissing it`);
    dialog.dismiss().catch(() => {});
  });

  const page = await context.newPage();

  console.log("STEP 1: Navigating to login page...");
  await page.goto("https://book-ibomair.crane.aero/", { waitUntil: "domcontentloaded" });
  await shot(page, "01-login-page");

  console.log("STEP 2: Clicking + filling username...");
  await page.locator('role=textbox[name="User Name:"]').click();
  await page.waitForTimeout(300);
  await page.fill('role=textbox[name="User Name:"]', USERNAME);
  await page.waitForTimeout(400);
  await page.locator('role=textbox[name="User Name:"]').press("Tab").catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, "02-username-filled");

  console.log("STEP 3: Clicking + filling password...");
  await page.locator('role=textbox[name="Password:"]').click();
  await page.waitForTimeout(300);
  await page.fill('role=textbox[name="Password:"]', PASSWORD);
  await page.waitForTimeout(500);
  await shot(page, "03-password-filled");

  console.log("STEP 4: Clicking Login and waiting for popup...");
  const popupPromise = page.waitForEvent("popup", { timeout: 15_000 }).catch(() => null);
  await page.click('text="Login"');
  const popup = await popupPromise;

  if (!popup) {
    console.log("  ❌ No popup opened within 15s.");
    await shot(page, "04-no-popup-original-page");
  } else {
    console.log(`  ✓ Popup opened, initial url: ${popup.url()}`);
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    console.log(`  Popup after domcontentloaded: ${popup.url()}`);
    await shot(popup, "04-popup-domcontentloaded");

    await popup.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await popup.waitForTimeout(3000);
    console.log(`  Popup after settling: ${popup.url()}`);
    await shot(popup, "05-popup-settled");

    const text = await popup.locator("body").innerText().catch(() => "<failed>");
    console.log("\n  Visible page text:\n  " + text.slice(0, 500).replace(/\n/g, "\n  "));
  }

  console.log("\n\nDone with the automated steps. Browser stays open — go look around manually,");
  console.log("check DevTools (F12) → Network tab if you want to dig further, then just");
  console.log("close the browser window when you're done.\n");

  await new Promise(() => {});
}

main().catch((err) => {
  console.error("Script error:", err);
});
