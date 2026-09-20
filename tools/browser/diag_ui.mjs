import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH ?? "/home/lakshaya/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const EXT = process.env.CB_EXTERNAL_ID;
const b = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-angle=swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();
const errs = [];
p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
p.on("response", async (r) => {
  if (r.url().includes("/aws/stacks/")) {
    let body = "";
    try { body = (await r.text()).slice(0, 200); } catch {}
    console.log(`NET ${r.status()} ${r.url().split("/aws/")[1]} → ${body}`);
  }
});
await p.goto("https://clusterbreak.langersword.in/app.html", { waitUntil: "load" });
await p.waitForTimeout(4000);
await p.evaluate((ext) => localStorage.setItem("cb.aws.externalId", ext), EXT);
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(4000);
await p.locator(".aws-head").click();
await p.waitForTimeout(500);
await p.fill(".aws-input", "arn:aws:iam::703651068111:role/ClusterbreakDeployRole");
await p.locator(".aws-cta").first().click();
await p.waitForTimeout(8000);
console.log("--- after connect ---");
console.log((await p.locator(".aws-body").innerText()).slice(0, 200).replace(/\n+/g, " | "));
console.log("--- reloading ---");
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(9000);
await p.locator(".aws-head").click();
await p.waitForTimeout(3000);
console.log("--- after reload ---");
console.log((await p.locator(".aws-body").innerText()).slice(0, 260).replace(/\n+/g, " | "));
console.log("rigs:", await p.locator(".rig").count());
console.log("console errors:", errs.length ? errs.slice(0, 3) : 0);
await b.close();
