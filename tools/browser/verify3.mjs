import { chromium } from "playwright";

const url = process.argv[2] ?? "https://d1at2woaiwy2hz.cloudfront.net/";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/home/lakshaya/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 260)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector(".device-card", { timeout: 30000 });
await page.waitForTimeout(6500);

// two RTX 3090s
await page.locator(".device-card").nth(7).click();
await page.locator(".device-card").nth(7).click();
await page.waitForTimeout(2500);
const rects = await page.evaluate(() =>
  [...document.querySelectorAll(".node-label")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }),
);
console.log("nodes placed:", rects.length);

// wire them
await page.locator(".topbar button", { hasText: "LINK MODE" }).click();
await page.waitForTimeout(300);
await page.mouse.click(rects[0].x, rects[0].y);
await page.waitForTimeout(500);
await page.mouse.click(rects[1].x, rects[1].y);
await page.waitForTimeout(800);
console.log("link rows:", await page.locator(".link-row").count());

// 70B model — runs tight on 2x3090, and dies when one node is unplugged
await page.selectOption(".topbar select", "llama3.3_70b");
await page.waitForTimeout(800);

// RUN
await page.locator(".topbar button", { hasText: "RUN" }).click();
await page.waitForTimeout(3500);
console.log("RUNBAR:", (await page.locator(".runbar").innerText()).replace(/\s+/g, " ").slice(0, 320));
console.log("event lines:", await page.locator(".event-line").count());

// exit link mode FIRST, otherwise clicking a node is treated as a link click
await page.locator(".topbar button", { hasText: "LINK MODE" }).click();
await page.waitForTimeout(300);

// the run bar just shifted the canvas down — re-capture label positions
const rects2 = await page.evaluate(() =>
  [...document.querySelectorAll(".node-label")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }),
);
console.log("post-runbar rects:", JSON.stringify(rects2));

// select the second node, then inject the unplug fault
await page.mouse.click(rects2[1].x, rects2[1].y);
await page.waitForTimeout(700);
console.log("selected:", (await page.locator(".inspector h2").first().innerText()).slice(0, 60));
const unplug = page.locator(".inspector button", { hasText: "INJECT" });
console.log("unplug button:", await unplug.count());
await unplug.first().click();
await page.waitForTimeout(1400);
const pm = await page.locator(".postmortem").innerText().catch(() => "NO POSTMORTEM");
console.log("POSTMORTEM:", pm.replace(/\s+/g, " ").slice(0, 460));
await page.screenshot({ path: "/tmp/cb-shot3.png" });

// clear and do a throttle run
await page.locator(".runbar button", { hasText: "CLEAR" }).click();
await page.waitForTimeout(500);
await page.locator(".topbar button", { hasText: "RUN" }).click();
await page.waitForTimeout(2500);
const before = await page.locator(".runbar .run-transfer b").innerText().catch(() => "?");
await page.selectOption(".inspector .link-controls select", "0.01");
await page.waitForTimeout(1200);
const after = await page.locator(".runbar .run-transfer b").innerText().catch(() => "?");
console.log("transfer ms/token  before:", before, "| after throttle to 0.01 GbE:", after);
await page.screenshot({ path: "/tmp/cb-shot4.png" });

console.log("errors:", JSON.stringify(errors.slice(0, 8)));
await browser.close();
console.log("RUN_VERIFY_DONE");
