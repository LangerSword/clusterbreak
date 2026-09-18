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

const badgeCount = await page.evaluate(
  () => [...document.querySelectorAll(".dc-spec")].filter((e) => e.textContent.includes("measured")).length,
);
console.log("palette 'measured' badges:", badgeCount, "(expect 15)");

// add RTX 3090 (measured) then RTX 3060 (unverified)
await page.locator(".device-card").nth(12).click();
await page.locator(".device-card").nth(1).click();
await page.waitForTimeout(3000);
const labels = await page.evaluate(() =>
  [...document.querySelectorAll(".nl-tps")].map((e) => e.textContent),
);
console.log("tps labels:", JSON.stringify(labels), "(expect one plain, one prefixed ~)");

const centers = await page.evaluate(() =>
  [...document.querySelectorAll(".node-label")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }),
);
await page.mouse.click(centers[0].x, centers[0].y);
await page.waitForTimeout(700);
const insp = (await page.locator(".inspector").innerText()).replace(/\s+/g, " ");
console.log("selected shows fitted:", /\(fitted\)/.test(insp));
console.log("selected basis present:", /fitted from measured/.test(insp));
console.log("inspector:", insp.slice(0, 330));

await page.screenshot({ path: "/tmp/cb-shot5.png" });
console.log("errors:", JSON.stringify(errors.slice(0, 6)));
await browser.close();
console.log("DATA_VERIFY_DONE");
