import { chromium } from "playwright";

const base = process.argv[2] ?? "https://d1at2woaiwy2hz.cloudfront.net/";
const CHROME =
  process.env.CHROME_PATH ??
  "/home/lakshaya/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

const browser = await chromium.launch({
  executablePath: CHROME,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const log = (k, v) => console.log(k, "→", v);

// 1. deep link loads a preset rig
await page.goto(`${base}?preset=dual-3090`, { waitUntil: "load" });
await page.waitForTimeout(5000);
log("hasGL", await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2")));
log("deep-link node labels", await page.locator(".node-label").count());
log("model select value", await page.locator(".topbar select").first().inputValue());
const v1 = await page.locator(".verdict-card").innerText().catch(() => "");
log("verdict present", v1.length > 0);
for (const key of ["RIG", "MODEL", "SPEED", "FIT", "WALL", "BREAK", "DATA", "OPEN"]) {
  const line = v1.split("\n").find((l) => l.startsWith(key));
  console.log(`  ${key}: ${line ?? "(missing)"}`);
}

// 2. clicking a preset button rebuilds the board
await page.locator(".preset-btn", { hasText: "Two laptops" }).click();
await page.waitForTimeout(1500);
log("after preset — node labels", await page.locator(".node-label").count());
log("after preset — link rows", await page.locator(".link-row").count());
const v2 = await page.locator(".verdict-card").innerText();
console.log("  SPEED: " + (v2.split("\n").find((l) => l.startsWith("SPEED")) ?? "(missing)"));
console.log("  OPEN:  " + (v2.split("\n").find((l) => l.startsWith("OPEN")) ?? "(missing)"));
log("copy button count", await page.locator(".copy-verdict").count());

// 3. run it and confirm the run bar appears (preset → breakable run in two clicks)
await page.locator(".topbar button", { hasText: "RUN" }).first().click();
await page.waitForTimeout(2500);
log("run bar visible", await page.locator(".runbar").count());

await page.screenshot({ path: "/tmp/cb-shot5.png" });
log("console errors", errors.length ? errors.slice(0, 3) : 0);
await browser.close();
console.log(errors.length ? "CONSOLE ERRORS PRESENT" : "CLEAN CONSOLE");
