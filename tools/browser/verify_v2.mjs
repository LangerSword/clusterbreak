import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://clusterbreak.langersword.in";
const CHROME = process.env.CHROME_PATH ?? "/home/lakshaya/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const results = [];
const log = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

/* ---------------- landing v2 ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 140)));
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  log("landing: aurora present", (await page.locator(".aurora i").count()) === 3);
  log("landing: marquee has real chips", (await page.locator(".dev-chip").count()) >= 20, `${await page.locator(".dev-chip").count()} chips`);
  log("landing: bento cards", (await page.locator(".bento-card").count()) >= 6);
  log("landing: instrument readout", /tok\/s/.test(await page.locator(".readout").innerText()));
  log("landing: vendor chip bound", (await page.locator(".chip-vendor").count()) >= 1);
  const statTxt = await page.locator(".hero-stats").innerText();
  log("landing: stats are numbers", /\d/.test(statTxt), statTxt.replace(/\n/g, " ").slice(0, 80));
  log("landing: zero console errors", errs.length === 0, errs[0] ?? "");
  await page.close();
}

/* ---------------- app: overlay bug + new UI ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 140)));
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
  await page.goto(`${BASE}/app.html?preset=dual-3090`, { waitUntil: "load" });
  await page.waitForTimeout(5000);

  // start a run, then unplug a node → postmortem
  await page.locator(".topbar button", { hasText: "RUN" }).first().click();
  await page.waitForTimeout(2500);
  const box = await page.locator(".node-label").first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  await page.locator(".node-actions .danger").click();
  await page.waitForTimeout(1500);

  const pmCount = await page.locator(".postmortem").count();
  log("app: postmortem appears", pmCount === 1);

  if (pmCount) {
    // THE BUG: node labels used to paint over the report. Assert stacking.
    const check = await page.evaluate(() => {
      const card = document.querySelector(".postmortem");
      const backdrop = document.querySelector(".postmortem-backdrop");
      const portal = document.querySelector(".node-html"); // drei's Html portal — carries the z-index
      const r = card.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      // also probe a point where a node label actually overlaps the card, if any
      let overlapHit = null;
      let overlapLabel = null;
      for (const label of document.querySelectorAll(".node-label")) {
        const lr = label.getBoundingClientRect();
        const ix = Math.max(r.left, lr.left);
        const iy = Math.max(r.top, lr.top);
        const ix2 = Math.min(r.right, lr.right);
        const iy2 = Math.min(r.bottom, lr.bottom);
        if (ix2 > ix && iy2 > iy) {
          overlapLabel = label.textContent?.slice(0, 24) ?? "?";
          overlapHit = document.elementFromPoint((ix + ix2) / 2, (iy + iy2) / 2);
          break;
        }
      }
      return {
        backdropZ: getComputedStyle(backdrop).zIndex,
        portalZ: portal
          ? [portal, ...portal.querySelectorAll("*")]
              .map((el) => Number(getComputedStyle(el).zIndex) || 0)
              .reduce((a, b) => Math.max(a, b), 0)
          : 0,
        hitInsideCard: card.contains(hit),
        hitClass: hit ? hit.className.toString().slice(0, 60) : "none",
        overlapLabel,
        overlapInsideCard: overlapHit ? card.contains(overlapHit) : null,
        overlapHitClass: overlapHit ? overlapHit.className.toString().slice(0, 50) : "none",
      };
    });
    log(
      "app: postmortem backdrop stacks above node labels",
      Number(check.backdropZ) > Number(check.portalZ),
      `backdrop z=${check.backdropZ} vs max node-portal z=${check.portalZ}`,
    );
    log("app: click lands on the report, not a node", check.hitInsideCard, `hit: ${check.hitClass}`);
    log(
      "app: overlapping node label is covered by the report",
      check.overlapInsideCard === null || check.overlapInsideCard === true,
      check.overlapLabel
        ? `label "${check.overlapLabel}" overlap point hits: ${check.overlapHitClass}`
        : "no node label overlapped the card in this layout",
    );
    // screenshot the fixed state
    await page.screenshot({ path: "/tmp/site-qa/app-postmortem-fixed.png" });
  }

  // new AWS connect panel
  const awsHead = page.locator(".aws-head");
  log("app: AWS panel present", (await awsHead.count()) === 1);
  await awsHead.click();
  await page.waitForTimeout(500);
  const ext = await page.locator(".aws-code").innerText();
  log("app: external id generated", /^cb-[a-z0-9]{24}$/.test(ext), ext);
  const launch = await page.locator(".aws-launch").getAttribute("href");
  log(
    "app: console deep link well-formed",
    /console\.aws\.amazon\.com\/cloudformation\/home\?region=ap-south-1#\/stacks\/quickcreate\?/.test(launch ?? "") &&
      (launch ?? "").includes(encodeURIComponent(ext)),
    (launch ?? "").slice(0, 110),
  );
  const connectBtn = page.locator(".aws-cta").first();
  log("app: connect disabled until valid ARN", await connectBtn.isDisabled());
  await page.fill(".aws-input", "arn:aws:iam::123456789012:role/ClusterbreakDeployRole");
  await page.waitForTimeout(300);
  log("app: connect enables on valid ARN", !(await connectBtn.isDisabled()));
  log("app: zero console errors", errs.length === 0, errs[0] ?? "");
  await page.close();
}

/* ---------------- docs ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 120)));
  await page.goto(`${BASE}/docs.html#connect`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const body = await page.locator(".docs-main").innerText();
  log("docs: connect section present", /Connect your account/.test(body));
  log("docs: callouts render", (await page.locator(".callout").count()) >= 3);
  log("docs: nav active state works", (await page.locator(".docs-nav a.active").count()) === 1);
  log("docs: zero console errors", errs.length === 0, errs[0] ?? "");
  await page.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
