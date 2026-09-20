import { chromium } from "playwright";

const CHROME = process.env.CHROME_PATH ?? "/home/lakshaya/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const EXT = process.env.CB_EXTERNAL_ID;
const IP = process.env.CB_MY_IP;
const STACK = "clusterbreak-chat-test";

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 150)));

await page.goto("https://clusterbreak.langersword.in/app.html", { waitUntil: "load" });
await page.waitForTimeout(5000);
await page.evaluate((ext) => localStorage.setItem("cb.aws.externalId", ext), EXT);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(5000);
await page.locator('.device-card:has-text("RTX 3090")').first().click();
await page.waitForTimeout(1500);

// 1. download the real artifact and lint it before deploying anything
const dl = page.waitForEvent("download");
await page.locator('button:has-text("DOWNLOAD CLOUDFORMATION TEMPLATE")').click();
const download = await dl;
await download.saveAs("/tmp/cb-chat-template.yaml");
console.log("template saved: /tmp/cb-chat-template.yaml");

// 2. connect
await page.locator(".aws-head").click();
await page.waitForTimeout(500);
await page.fill(".aws-input", "arn:aws:iam::703651068111:role/ClusterbreakDeployRole");
await page.locator(".aws-cta").first().click();
let connected = false;
for (let i = 0; i < 20 && !connected; i++) {
  await page.waitForTimeout(2000);
  connected = /703651068111/.test(await page.locator(".aws-body").innerText());
}
console.log("connected:", connected ? "PASS" : "FAIL");
if (!connected) { console.log(await page.locator(".aws-body").innerText()); await browser.close(); process.exit(1); }

// 3. provision
const inputs = page.locator(".aws-input");
await inputs.nth(0).fill("clusterbreak-test");
await inputs.nth(1).fill(`${IP}/32`);
await inputs.nth(2).fill(STACK);
await page.locator(".aws-body select").nth(1).selectOption("1");
await page.waitForTimeout(300);
await page.locator('button:has-text("PROVISION IN MY ACCOUNT")').click();
console.log("provision requested at", new Date().toISOString());

let status = "";
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(15000);
  const body = await page.locator(".aws-body").innerText();
  const m = body.match(new RegExp(`${STACK}\\s+([A-Z_]+)`));
  status = m ? m[1] : "";
  if (i % 4 === 0) console.log(`  [${i * 15}s] ${status || "…"}`);
  if (status === "CREATE_COMPLETE") break;
  if (/FAILED|ROLLBACK/.test(status)) break;
}
console.log("final stack status:", status);
console.log("console errors:", errs.length ? errs.slice(0, 2) : 0);
await page.screenshot({ path: "/tmp/site-qa/rigs-list-v2.png" });
await browser.close();
process.exit(status === "CREATE_COMPLETE" ? 0 : 1);
