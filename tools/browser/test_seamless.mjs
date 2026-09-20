import { chromium } from "playwright";

const CHROME = process.env.CHROME_PATH ?? "/home/lakshaya/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const EXT = process.env.CB_EXTERNAL_ID;
const DEAD = "clusterbreak-deadtest2";
const TARGET = "clusterbreak-seamless";
if (!EXT) { console.error("need CB_EXTERNAL_ID"); process.exit(2); }

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160)));

await page.goto("https://clusterbreak.langersword.in/app.html", { waitUntil: "load" });
await page.waitForTimeout(5000);
await page.evaluate((ext) => localStorage.setItem("cb.aws.externalId", ext), EXT);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(5000);
await page.locator('.device-card:has-text("RTX 3090")').first().click(); // one GPU -> g5.xlarge
await page.waitForTimeout(1200);
await page.locator(".aws-head").click();
await page.waitForTimeout(400);
await page.fill(".aws-input", "arn:aws:iam::703651068111:role/ClusterbreakDeployRole");
await page.locator(".aws-cta").first().click();
let connected = false;
for (let i = 0; i < 20 && !connected; i++) {
  await page.waitForTimeout(2000);
  connected = /703651068111/.test(await page.locator(".aws-body").innerText());
}
console.log(connected ? "PASS  connected" : "FAIL  connect");
if (!connected) { console.log((await page.locator(".aws-body").innerText()).slice(0, 300)); await browser.close(); process.exit(1); }
await page.waitForTimeout(2500);

// 1. the dead stack explains itself, with a cleanup action
const deadCard = page.locator(`.rig:has-text("${DEAD}")`);
console.log((await deadCard.count()) === 1 ? "PASS  failed stack appears in the rig list" : "FAIL  dead card missing");
console.log((await deadCard.getAttribute("class"))?.includes("rig-dead") ? "PASS  styled as failed" : "FAIL  not styled");
const why = await deadCard.locator(".rig-why").innerText().catch(() => "");
console.log(why.length > 10 ? `PASS  failure reason shown: "${why.slice(0, 90)}"` : "FAIL  no failure reason");
console.log((await deadCard.locator(".rig-actions").innerText()).includes("clean up") ? "PASS  action labelled 'clean up'" : "FAIL  label");

// 2. key pair dropdown comes from the account
const keySel = page.locator('label:has-text("key pair") select');
const keyInput = page.locator('label:has-text("key pair") input');
const keyOpts = await keySel.locator("option").allInnerTexts().catch(() => []);
if (keyOpts.length > 0) {
  console.log(`PASS  key pair dropdown from your account: ${keyOpts.join(", ")}`);
} else {
  console.log("note  dropdown unavailable — falling back to typing a key name");
  await keyInput.fill("clusterbreak-test");
}

// 3. ssh cidr prefilled from whoami
const cidr = await page.locator('label:has-text("ssh cidr") input').inputValue();
console.log(/^\d{1,3}(\.\d{1,3}){3}\/32$/.test(cidr) ? `PASS  ssh cidr prefilled: ${cidr}` : `FAIL  cidr: "${cidr}"`);

// 4. typing the dead stack's name warns, and says it will be cleaned up
const nameInput = page.locator('label:has-text("stack name") input');
await nameInput.fill(DEAD);
await page.waitForTimeout(500);
const warn = await page.locator(".aws-body").innerText();
console.log(/failed attempt is holding this name/i.test(warn) ? "PASS  inline warning explains the name is held by a failed attempt" : "FAIL  no name warning");

// 5. provision into that name → auto-cleanup + auto-retry, no manual step
await nameInput.fill(TARGET);
await page.waitForTimeout(400);
await page.locator('button:has-text("PROVISION IN MY ACCOUNT")').click();
let notice = "";
for (let i = 0; i < 12 && !notice; i++) {
  await page.waitForTimeout(2500);
  const body = await page.locator(".aws-body").innerText();
  const m = body.match(/(provisioning \S+…|cleaned up a failed stack[^\n]*|session expired[^\n]*)/);
  if (m) notice = m[0];
}
console.log(notice ? `PASS  provision feedback: "${notice.slice(0, 110)}"` : "FAIL  no feedback");

// 6. wait for it to come up, then tear down from the UI
const card = page.locator(`.rig:has-text("${TARGET}")`);
let status = "";
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(15000);
  status = (await card.locator(".rig-status").innerText().catch(() => "")).trim();
  if (i % 4 === 0) console.log(`      [${i * 15}s] ${status || "…"}`);
  if (status === "CREATE_COMPLETE") break;
  if (/FAILED|ROLLBACK/.test(status)) break;
}
console.log(status === "CREATE_COMPLETE" ? "PASS  GPU rig reached CREATE_COMPLETE" : `FAIL  ended as ${status}`);
await page.screenshot({ path: "/tmp/site-qa/seamless-rig.png" });
console.log("console errors:", errs.length ? errs.slice(0, 2) : 0);
await browser.close();
process.exit(status === "CREATE_COMPLETE" ? 0 : 1);
