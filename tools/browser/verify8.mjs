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

// 1. load the preset rig and start a run
await page.goto(`${base}?preset=dual-3090`, { waitUntil: "load" });
await page.waitForTimeout(5000);
log("nodes", await page.locator(".node-label").count());
await page.locator(".topbar button", { hasText: "RUN" }).first().click();
await page.waitForTimeout(2500);
log("run bar", await page.locator(".runbar").count());

// 2. break it: select a node, unplug it
const box = await page.locator(".node-label").first().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(600);
await page.locator(".node-actions .danger").click();
await page.waitForTimeout(1200);
log("postmortem visible", await page.locator(".postmortem").count());
log("share button text", await page.locator(".pm-share").first().innerText().catch(() => "(none)"));

// 3. share it — wait for the stored link
await page.locator(".pm-share").first().click();
let link = "";
for (let i = 0; i < 30 && !link; i++) {
  await page.waitForTimeout(800);
  const el = page.locator(".pm-link").first();
  if (await el.count()) {
    const t = await el.innerText().catch(() => "");
    if (t.startsWith("http")) link = t.trim();
  }
}
log("share link", link || "(never appeared)");
await page.screenshot({ path: "/tmp/cb-shot6.png" });

// 4. open the shared report in a new page
if (link) {
  const p2 = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs2 = [];
  p2.on("console", (m) => m.type() === "error" && errs2.push(m.text()));
  p2.on("pageerror", (e) => errs2.push(String(e)));
  await p2.goto(link, { waitUntil: "load" });
  await p2.waitForTimeout(3500);
  log("shared view brand", await p2.locator(".shared-brand").innerText().catch(() => "(missing)"));
  const sharedText = await p2.locator(".shared-card").innerText().catch(() => "");
  log("shared has verdict", sharedText.includes("WALL"));
  log("shared has death line", /model no longer fits|removed|survived/i.test(sharedText));
  log("shared console errors", errs2.length ? errs2.slice(0, 2) : 0);
  await p2.screenshot({ path: "/tmp/cb-shot7.png" });
}
log("console errors (app)", errors.length ? errors.slice(0, 3) : 0);
await browser.close();
console.log(errors.length === 0 && link ? "CLEAN" : "CHECK OUTPUT");
