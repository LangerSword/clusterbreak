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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 260)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector(".device-card", { timeout: 30000 });
await page.waitForTimeout(6000);

// two nodes: RTX 3060 + RTX 3090
await page.locator(".device-card").nth(1).click();
await page.locator(".device-card").nth(7).click();
await page.waitForTimeout(3500);

const rects1 = await page.evaluate(() =>
  [...document.querySelectorAll(".node-label")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }),
);
console.log("label centers:", JSON.stringify(rects1));

// --- LINK: enter link mode, click node A then node B (labels are pointer-events:none, clicks land on the canvas) ---
await page.locator(".topbar button", { hasText: "LINK MODE" }).click();
await page.waitForTimeout(400);
await page.mouse.click(rects1[0].x, rects1[0].y);
await page.waitForTimeout(600);
console.log("hint after first click:", await page.locator(".canvas-hint").innerText());
await page.mouse.click(rects1[1].x, rects1[1].y);
await page.waitForTimeout(1200);
console.log("hint after second click:", await page.locator(".canvas-hint").innerText());
const inspector = await page.locator(".inspector").innerText();
console.log("has link row:", /↔/.test(inspector));
console.log("pipeline shown:", /pipelined across 2 nodes/.test(inspector));
const pipelineLine = inspector.split("\n").filter((l) => /pipelined|tok\/s/.test(l));
console.log("pipeline lines:", JSON.stringify(pipelineLine));

// --- DRAG: grab first node, move 60px right, release; its label must move ---
await page.locator(".topbar button", { hasText: "LINK MODE" }).click(); // exit link mode
await page.waitForTimeout(300);
await page.mouse.move(rects1[0].x, rects1[0].y);
await page.mouse.down();
await page.mouse.move(rects1[0].x + 20, rects1[0].y + 12, { steps: 4 });
await page.mouse.move(rects1[0].x + 60, rects1[0].y + 30, { steps: 8 });
await page.waitForTimeout(300);
await page.mouse.up();
await page.waitForTimeout(900);
const rects2 = await page.evaluate(() =>
  [...document.querySelectorAll(".node-label")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }),
);
console.log("label centers after drag:", JSON.stringify(rects2));
const moved = rects2.length === rects1.length && Math.abs(rects2[0].x - rects1[0].x) > 20;
console.log("drag moved the node:", moved, "| delta x:", (rects2[0]?.x ?? 0) - rects1[0].x);

await page.screenshot({ path: "/tmp/cb-shot2.png" });
console.log("errors:", JSON.stringify(errors.slice(0, 6)));
await browser.close();
console.log("INTERACTION_VERIFY_DONE");
