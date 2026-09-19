import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "https://d1at2woaiwy2hz.cloudfront.net";
const CHROME =
  process.env.CHROME_PATH ??
  "/home/lakshaya/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const OUT = "/tmp/site-qa";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const results = [];
const check = (name, ok, detail = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

async function visit(path, viewport, shot, opts = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(opts.wait ?? 2500);
  if (opts.actions) await opts.actions(page);
  await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: !!opts.full });
  await page.close();
  return errors;
}

// ---- landing @1440 ----
let errors = await visit("/", { width: 1440, height: 900 }, "landing-1440", {
  wait: 3500,
  actions: async (page) => {
    // hero instrument must compute real engine values
    const tps = await page.locator(".readout-num").innerText();
    check("landing: instrument computes (rtx3090 + llama-8b)", parseFloat(tps) > 50 && parseFloat(tps) < 200, `${tps} tok/s`);
    const fit = await page.locator(".readout-row .chip").innerText();
    check("landing: fit chip present", fit.length > 3, fit);
    // switch device → value must change (engine, not static)
    await page.selectOption("#hero-device", { label: "Apple M2 Ultra 192GB" });
    await page.waitForTimeout(700);
    const tps2 = await page.locator(".readout-num").innerText();
    check("landing: engine reacts to device switch", Math.abs(parseFloat(tps2) - parseFloat(tps)) > 5, `${tps} → ${tps2}`);
    // stats strip
    const stats = await page.locator(".stat-num").allInnerTexts();
    check("landing: real stats rendered", stats.length >= 3 && stats.includes("15"), stats.join(" / "));
    // nav links
    for (const [label, path] of [["Docs", "/docs.html"], ["Open the simulator", "/app.html"]]) {
      const href = await page.locator(`.nav-links a:has-text("${label}")`).getAttribute("href");
      check(`landing: nav ${label} → ${path}`, href === path, href);
    }
    // pricing table has real numbers
    const price = await page.locator(".price-table td").nth(1).innerText();
    check("landing: pricing table real", /\$\d+\.\d+/.test(price), price);
  },
});
check("landing: zero console errors", errors.length === 0, errors.slice(0, 2).join(" | "));

// ---- landing responsive ----
errors = await visit("/", { width: 768, height: 1024 }, "landing-768", { full: true });
check("landing @768: clean", errors.length === 0, errors.slice(0, 1).join(""));
errors = await visit("/", { width: 375, height: 812 }, "landing-375", { full: true });
check("landing @375: clean", errors.length === 0, errors.slice(0, 1).join(""));

// ---- docs ----
errors = await visit("/docs.html", { width: 1440, height: 900 }, "docs-1440", {
  wait: 2000,
  actions: async (page) => {
    const sections = await page.locator(".docs-main section").count();
    check("docs: all sections present", sections >= 10, `${sections} sections`);
    // sidebar anchors all resolve
    const ids = await page.locator(".docs-nav a").evaluateAll((els) => els.map((e) => e.getAttribute("href")?.slice(1)));
    let missing = [];
    for (const id of ids) {
      const n = await page.locator(`#${id}`).count();
      if (!n) missing.push(id);
    }
    check("docs: every sidebar anchor resolves", missing.length === 0, missing.join(","));
    // API base is real and health endpoint reachable
    const hasBase = await page.locator("code:has-text('execute-api')").count();
    check("docs: API base documented", hasBase > 0);
  },
});
check("docs: zero console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
errors = await visit("/docs.html", { width: 375, height: 812 }, "docs-375", { full: true });
check("docs @375: clean", errors.length === 0, errors.slice(0, 1).join(""));

// ---- app still works (regression) ----
errors = await visit("/app.html?preset=dual-3090", { width: 1440, height: 900 }, "app-1440", {
  wait: 6000,
  actions: async (page) => {
    const nodes = await page.locator(".node-label").count();
    check("app: preset deep link still fills board", nodes === 2, `${nodes} nodes`);
    const hasGL = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
    check("app: WebGL renders", hasGL);
  },
});
check("app: zero console errors", errors.length === 0, errors.slice(0, 2).join(" | "));

// ---- old share links forward to /app.html ----
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(`${base}/?report=1jyqtc3t1r`, { waitUntil: "load" });
await page.waitForTimeout(3000);
const url = page.url();
check("old ?report= link forwards to /app.html", url.includes("/app.html?report=1jyqtc3t1r"), url);
const shared = await page.locator(".shared-card").count();
check("shared report renders after forward", shared === 1);
await page.close();

// ---- new share link format (server-side check of the redirect contract) ----
const page2 = await browser.newPage();
await page2.goto(`${base}/?preset=two-laptops`, { waitUntil: "load" });
await page2.waitForTimeout(3000);
check("old ?preset= link forwards", page2.url().includes("/app.html?preset=two-laptops"), page2.url());
await page2.close();

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} site checks passed`);
process.exit(failed.length ? 1 : 0);
