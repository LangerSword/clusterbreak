import { chromium } from "playwright";

const CHROME = process.env.CHROME_PATH ?? "/home/lakshaya/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const EXT = process.env.CB_EXTERNAL_ID;
const STACK = "clusterbreak-chat-test";
const TEARDOWN = process.env.TEARDOWN === "1";
if (!EXT) { console.error("need CB_EXTERNAL_ID"); process.exit(2); }

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 150)));

await page.goto("https://clusterbreak.langersword.in/app.html", { waitUntil: "load" });
await page.waitForTimeout(5000);
await page.evaluate((ext) => localStorage.setItem("cb.aws.externalId", ext), EXT);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(5000);

// connect (once) — then the rig list must come from the account
await page.locator(".aws-head").click();
await page.waitForTimeout(500);
await page.fill(".aws-input", "arn:aws:iam::703651068111:role/ClusterbreakDeployRole");
await page.locator(".aws-cta").first().click();
let connected = false;
for (let i = 0; i < 20 && !connected; i++) {
  await page.waitForTimeout(2000);
  connected = /703651068111/.test(await page.locator(".aws-body").innerText());
}
console.log(connected ? "PASS  connected" : "FAIL  connect");
if (!connected) { console.log((await page.locator(".aws-body").innerText()).slice(0, 300)); await browser.close(); process.exit(1); }

// PERSISTENCE: reload → session survives AND the rig list is re-read from AWS
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(7000);
await page.locator(".aws-head").click();
await page.waitForTimeout(2500);
const card = page.locator(`.rig:has-text("${STACK}")`);
const cards = await card.count();
console.log(cards ? "PASS  rig card present after reload (session + account readback)" : "FAIL  rig card missing after reload");
if (!cards) { console.log((await page.locator(".aws-body").innerText()).slice(0, 400)); await browser.close(); process.exit(1); }
console.log("      " + (await card.locator(".rig-meta").innerText()));

// chat in the UI
await card.locator('button:has-text("CHAT")').click();
await page.waitForTimeout(1500);
console.log((await page.locator(".drawer").count()) === 1 ? "PASS  chat drawer opened" : "FAIL  drawer");

let reply = "";
for (let attempt = 1; attempt <= 6 && !reply; attempt++) {
  await page.fill(".drawer-input textarea", "In one short sentence: what hardware are you running on?");
  await page.locator('.drawer-actions button:has-text("SEND")').click();
  for (let i = 0; i < 14 && !reply; i++) {
    await page.waitForTimeout(2500);
    const bodies = await page.locator(".msg.assistant .msg-body").allInnerTexts();
    const err = await page.locator(".msg.error .msg-body").allInnerTexts();
    if (bodies.length && !bodies[bodies.length - 1].includes("generating")) reply = bodies[bodies.length - 1].trim();
    else if (err.length) { console.log(`      [try ${attempt}] ${err[err.length - 1].slice(0, 110)}`); break; }
  }
}
console.log(reply ? `PASS  UI chat reply: "${reply.slice(0, 160)}"` : "FAIL  no reply");
await page.screenshot({ path: "/tmp/site-qa/chat-live.png" });

// harness section
await page.locator(".drawer-harness summary").click();
await page.waitForTimeout(400);
const env0 = await page.locator(".drawer-harness pre").innerText();
console.log(/OPENAI_BASE_URL=http:\/\/[\d.]+:8080\/v1/.test(env0) ? "PASS  harness env shows the real endpoint" : `FAIL  harness: ${env0}`);
await page.locator('button:has-text("REVEAL KEY")').click();
await page.waitForTimeout(400);
const env1 = await page.locator(".drawer-harness pre").innerText();
console.log(/OPENAI_API_KEY=cbk-[A-Za-z0-9]{16,}/.test(env1) ? "PASS  per-stack key revealed for harness use" : "FAIL  key not revealed");
console.log("console errors:", errs.length ? errs.slice(0, 2) : 0);

if (TEARDOWN) {
  await page.locator(".drawer-close").click();
  await page.waitForTimeout(800);
  await card.locator('button:has-text("tear down")').click();
  let gone = false;
  for (let i = 0; i < 45 && !gone; i++) {
    await page.waitForTimeout(10000);
    if ((await page.locator(`.rig:has-text("${STACK}")`).count()) === 0) gone = true;
  }
  console.log(gone ? "PASS  torn down from the UI (gone from the list)" : "FAIL  still listed after teardown");
}
await browser.close();
