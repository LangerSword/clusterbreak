import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH ?? "/home/lakshaya/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const EXT = process.env.CB_EXTERNAL_ID;
const DEAD = "clusterbreak-deadtest2"; // CREATE_FAILED, holding its own name
const b = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-angle=swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();
const errs = [];
p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 150)));
await p.goto("https://clusterbreak.langersword.in/app.html", { waitUntil: "load" });
await p.waitForTimeout(5000);
await p.evaluate((ext) => localStorage.setItem("cb.aws.externalId", ext), EXT);
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(5000);
await p.locator('.device-card:has-text("RTX 3090")').first().click();
await p.waitForTimeout(1200);
await p.locator(".aws-head").click();
await p.waitForTimeout(400);
await p.fill(".aws-input", "arn:aws:iam::703651068111:role/ClusterbreakDeployRole");
await p.locator(".aws-cta").first().click();
for (let i = 0; i < 20; i++) { await p.waitForTimeout(2000); if (/703651068111/.test(await p.locator(".aws-body").innerText())) break; }
await p.waitForTimeout(2000);
const keySel = p.locator('label:has-text("key pair") select');
if ((await keySel.count()) === 0) await p.locator('label:has-text("key pair") input').fill("clusterbreak-test");
const nameInput = p.locator('label:has-text("stack name") input');
await nameInput.fill(DEAD);
await p.waitForTimeout(500);
console.log("passing the dead stack's own name to provision:", DEAD);
await p.locator('button:has-text("PROVISION IN MY ACCOUNT")').click();
let seen = [];
for (let i = 0; i < 14; i++) {
  await p.waitForTimeout(2500);
  const body = await p.locator(".aws-body").innerText();
  const m = body.match(/(cleaned up a failed stack[^\n]*|retrying automatically[^\n]*|provisioning \S+…)/);
  if (m && !seen.includes(m[0])) { seen.push(m[0]); console.log("  notice:", m[0].slice(0, 130)); }
}
const card = p.locator(`.rig:has-text("${DEAD}")`);
let status = "";
for (let i = 0; i < 44; i++) {
  await p.waitForTimeout(15000);
  status = (await card.locator(".rig-status").innerText().catch(() => "")).trim();
  if (i % 4 === 0) console.log(`  [${i * 15}s] ${status || "…"}`);
  if (status === "CREATE_COMPLETE") break;
  if (/FAILED|ROLLBACK/.test(status)) break;
}
console.log(status === "CREATE_COMPLETE" ? "PASS  dead name recovered automatically -> CREATE_COMPLETE" : `FAIL  ended as ${status}`);
console.log("console errors:", errs.length ? errs.slice(0, 2) : 0);
await p.screenshot({ path: "/tmp/site-qa/deadname-recovered.png" });
await b.close();
process.exit(status === "CREATE_COMPLETE" ? 0 : 1);
