import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH ?? "/home/lakshaya/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const EXT = process.env.CB_EXTERNAL_ID;
if (!EXT) { console.error("CB_EXTERNAL_ID not set"); process.exit(2); }

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160)));
await page.goto("https://clusterbreak.langersword.in/app.html", { waitUntil: "load" });
await page.waitForTimeout(4500);

await page.locator(".aws-head").click();
await page.waitForTimeout(400);
// the panel generates its own external id; override the session value to match our stack
await page.evaluate((ext) => sessionStorage.setItem("cb.aws.externalId", ext), EXT);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(4500);
await page.locator(".aws-head").click();
await page.waitForTimeout(400);
const shownExt = await page.locator(".aws-code").innerText();
console.log("panel external id matches stack:", shownExt === EXT ? "PASS" : `FAIL (${shownExt})`);

await page.fill(".aws-input", "arn:aws:iam::703651068111:role/ClusterbreakDeployRole");
await page.locator(".aws-cta").first().click();
await page.waitForTimeout(6000);

const body = await page.locator(".aws-body").innerText();
const connected = /703651068111/.test(body);
console.log("UI→API connect succeeded (session shows our account):", connected ? "PASS" : "FAIL");
console.log("--- panel text after connect ---");
console.log(body.split("\n").slice(0, 12).join(" | "));
console.log("console errors:", errs.length ? errs[0] : 0);

// leave it connected but do NOT provision — no cost. clean the session.
await page.evaluate(() => sessionStorage.removeItem("cb.aws.session"));
await browser.close();
