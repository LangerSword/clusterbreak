import { chromium } from "playwright";

const base = process.argv[2] ?? "https://d1at2woaiwy2hz.cloudfront.net/";
const CHROME =
  process.env.CHROME_PATH ??
  "/home/lakshaya/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

const browser = await chromium.launch({
  executablePath: CHROME,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const log = (k, v) => console.log(k, "→", v);

await page.goto(`${base}?preset=dual-3090`, { waitUntil: "load" });
await page.waitForTimeout(5000);

const kit = await page.locator("section", { hasText: "DEPLOY KIT" }).first().innerText().catch(() => "");
log("deploy kit present", kit.length > 0);
log("g5.xlarge mentions", (kit.match(/g5\.xlarge/g) ?? []).length);
log("cost line", kit.split("\n").find((l) => l.includes("cost")) ?? "(missing)");
log("pricing snapshot line", kit.split("\n").find((l) => l.includes("snapshot")) ?? "(missing)");

// download the template
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  page.locator("button", { hasText: "DOWNLOAD CLOUDFORMATION TEMPLATE" }).click(),
]);
log("download filename", download.suggestedFilename());
const path = "/tmp/cb-template.yaml";
await download.saveAs(path);
const fs = await import("node:fs");
const yaml = fs.readFileSync(path, "utf8");
log("template bytes", yaml.length);
log("has VPC + 2 nodes", yaml.includes("AWS::EC2::VPC") && yaml.includes("Node1:") && yaml.includes("Node2:"));
log("model url", (yaml.match(/https:\/\/huggingface\.co\/[^\s"]+\.gguf/) ?? ["(none)"])[0]);
log("console errors", errors.length ? errors.slice(0, 3) : 0);
await browser.close();
console.log("DONE");
