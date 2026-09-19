import { chromium } from "playwright";

const url = process.argv[2] ?? "https://clusterbreak.langersword.in/";
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
  if (m.type() === "error") errors.push(m.text().slice(0, 220));
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 320)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector(".device-card", { timeout: 30000 });
await page.waitForTimeout(7000); // let WebGL + three.js initialize

console.log("cards:", await page.locator(".device-card").count());
console.log("canvas:", await page.locator("canvas").count());
const glInfo = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const gl = c && (c.getContext("webgl2") || c.getContext("webgl"));
  return { hasGL: !!gl, size: c ? [c.clientWidth, c.clientHeight] : null };
});
console.log("gl:", JSON.stringify(glInfo));

// place three devices: RTX 3060, A100 80GB, RTX 3090
await page.locator(".device-card").nth(1).click();
await page.locator(".device-card").nth(9).click();
await page.locator(".device-card").nth(7).click();
await page.waitForTimeout(4000);
console.log("labels:", await page.locator(".node-label").count());
console.log("tps:", JSON.stringify(await page.locator(".nl-tps").allTextContents()));

// switch model via the select (React-compatible)
await page.selectOption(".topbar select", "llama3.3_70b");
await page.waitForTimeout(2500);
console.log("tps@70B:", JSON.stringify(await page.locator(".nl-tps").allTextContents()));
const summary = await page.locator(".inspector").innerText();
console.log("summary:", summary.replace(/\s+/g, " ").slice(0, 460));

await page.screenshot({ path: "/tmp/cb-shot.png" });
console.log("errors:", JSON.stringify(errors.slice(0, 6)));
await browser.close();
console.log("VERIFY_DONE");
