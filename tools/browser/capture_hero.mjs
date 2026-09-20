// capture_hero.mjs — fresh landing shots (hero + full page) into the repo's shots dir.
import { chromium } from "playwright";

const BASE = process.env.BASE || "https://clusterbreak.langersword.in";
const OUT = process.env.OUT || "/home/lakshaya/clusterbreak/frontend/public/shots";

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(2500); // let the count-up settle and the topology animate
await page.screenshot({ path: `${OUT}/landing-hero.png` });
await page.screenshot({ path: `${OUT}/landing-full.png`, fullPage: true });
// the break-it section, where the topology figure lives
await page.evaluate(() => document.querySelector(".topo-figure")?.scrollIntoView({ block: "center" }));
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/landing-topology.png` });
console.log("captured: landing-hero.png, landing-full.png, landing-topology.png");
await browser.close();
