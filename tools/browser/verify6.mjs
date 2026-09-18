import { chromium } from "playwright";

const url = process.argv[2] ?? "https://d1at2woaiwy2hz.cloudfront.net/";
const RIG_JSON = JSON.stringify(
  {
    schema: "clusterbreak.rig/v1",
    detectedAt: "2026-09-18T05:58:36",
    host: "lakshaya",
    os: "Linux 7.2.2-arch1-1",
    cpu: { name: "AMD Ryzen 7 260 w/ Radeon 780M Graphics", cores: 16 },
    ramGb: 15.6,
    gpus: [{ kind: "gpu", name: "NVIDIA GeForce RTX 5060 Laptop GPU", memoryGb: 8.0, computeCap: "12.0" }],
  },
  null,
  2,
);

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
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 300)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector(".device-card", { timeout: 30000 });
await page.waitForTimeout(6000);

// 1. browser detect
await page.locator(".detect-btn").click();
await page.waitForTimeout(800);
const notice = await page.locator(".palette .note").first().innerText();
console.log("DETECT notice:", notice.replace(/\s+/g, " ").slice(0, 200));

// 2. custom device with owner measurement
const inputs = page.locator(".custom-form input");
await inputs.nth(0).fill("Test Rig GPU");
await inputs.nth(1).fill("16");
await inputs.nth(2).fill("500");
await inputs.nth(3).fill("90");
await page.locator(".custom-form button").click();
await page.waitForTimeout(600);
const customRows = await page.evaluate(() =>
  [...document.querySelectorAll(".custom-row")].map((r) => r.innerText.replace(/\s+/g, " ")),
);
console.log("CUSTOM DEVICES:", JSON.stringify(customRows));

// 3. import the real rig JSON from this machine
await page.locator(".importer summary").click();
await page.locator(".importer textarea").fill(RIG_JSON);
await page.locator(".importer button").click();
await page.waitForTimeout(1500);
const nodes = await page.evaluate(() =>
  [...document.querySelectorAll(".node-label .nl-name")].map((e) => e.textContent),
);
console.log("NODES after import:", JSON.stringify(nodes));
const notice2 = await page.locator(".palette .note").first().innerText();
console.log("IMPORT notice:", notice2.replace(/\s+/g, " ").slice(0, 220));

// 4. HF model library
await page.locator(".lib-search input").fill("llama 3.1 8b gguf");
await page.locator(".lib-search button").click();
await page.waitForTimeout(4000);
const hits = await page.locator(".lib-hit").count();
console.log("HF hits:", hits);
if (hits > 0) {
  const firstId = await page.locator(".lib-hit .lib-id").first().innerText();
  console.log("first hit:", firstId);
  await page.locator(".lib-hit button").first().click();
  await page.waitForTimeout(8000);
  const addMsg = await page.locator(".palette .note").first().innerText();
  console.log("ADD msg:", addMsg.replace(/\s+/g, " ").slice(0, 220));
  const stored = await page.evaluate(() => localStorage.getItem("clusterbreak.customModels.v1"));
  const parsed = stored ? JSON.parse(stored) : [];
  console.log(
    "stored custom models:",
    parsed.map((m) => `${m.id} arch_verified=${m.architectureVerified} q4=${m.quantSizesGb?.q4_k_m}`),
  );
  const options = await page.evaluate(
    () => [...document.querySelectorAll(".topbar select")][0].options.length,
  );
  console.log("model select options:", options);
}

await page.screenshot({ path: "/tmp/cb-shot6.png" });
console.log("errors:", JSON.stringify(errors.slice(0, 8)));
await browser.close();
console.log("CUSTOM_VERIFY_DONE");
