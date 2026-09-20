// verify_v3.mjs — hero dynamism + simulator->home navigation, observed only.
import { chromium } from "playwright";

const BASE = process.env.BASE || "https://clusterbreak.langersword.in";
const EXPECT = (process.env.EXPECT || "").split(",").filter(Boolean);
const ok = [];
const bad = [];
const t = (name, pass, detail = "") => (pass ? ok : bad).push(`${name}${detail ? ` — ${detail}` : ""}`);

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

// ---------- landing ----------
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(1800);

// 1. custom asset: the animated topology actually loads and is on screen
const topo = await page.evaluate(() => {
  const img = document.querySelector(".hero-topology");
  if (!img) return null;
  const r = img.getBoundingClientRect();
  const cs = getComputedStyle(img);
  return { loaded: img.complete && img.naturalWidth > 0, w: Math.round(r.width), h: Math.round(r.height), opacity: cs.opacity, mask: cs.maskImage !== "none" || cs.webkitMaskImage !== "none" };
});
t("hero topology asset loads", !!topo?.loaded, topo ? `${topo.w}x${topo.h}` : "missing");
t("topology is visible + masked", !!topo && topo.w > 300 && Number(topo.opacity) > 0.1 && topo.mask, topo ? `opacity ${topo.opacity}` : "");

// 2. the SVG really animates (its internal stylesheet defines the keyframes we shipped)
const svgAnimated = await page.evaluate(async () => {
  const img = document.querySelector(".hero-topology");
  if (!img) return { found: false };
  const res = await fetch(img.getAttribute("src"));
  const text = await res.text();
  return { found: true, bytes: text.length, keyframes: (text.match(/@keyframes/g) || []).length, flow: text.includes("stroke-dashoffset"), reduce: text.includes("prefers-reduced-motion") };
});
t("topology carries real animation + a reduced-motion guard", svgAnimated.found && svgAnimated.keyframes >= 4 && svgAnimated.flow && svgAnimated.reduce, `${svgAnimated.keyframes} keyframes, ${svgAnimated.bytes}B`);

// 3. hand-drawn icon set replaced the glyphs (no emoji left in the bento cards)
const icons = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".bento-card")];
  const svgs = document.querySelectorAll(".bento-icon svg").length;
  const glyphs = cards.filter((c) => /[⚡▤⌖◈↗☁▦]/.test(c.querySelector(".bento-icon")?.textContent || "")).length;
  return { cards: cards.length, svgs, glyphs };
});
t("bento icons are hand-authored SVG, no emoji glyphs", icons.svgs >= 7 && icons.glyphs === 0, `${icons.svgs} svg / ${icons.glyphs} glyph cards`);

// 4. count-up settles on the real values (never a decorative number)
const stats = await page.evaluate(() => [...document.querySelectorAll(".stat-num")].map((n) => n.textContent.trim()));
const settled = stats.length === EXPECT.length && stats.every((v, i) => v === EXPECT[i]);
t("hero stats settle on the data-derived values", settled, `showed [${stats.join(", ")}] vs expected [${EXPECT.join(", ")}]`);

// 5. the pointer spotlight is live (and harmless when there is no pointer)
const spot = await page.evaluate(async () => {
  const hero = document.querySelector(".hero");
  if (!hero) return null;
  const before = getComputedStyle(hero).getPropertyValue("--mx").trim();
  const r = hero.getBoundingClientRect();
  hero.dispatchEvent(new MouseEvent("mousemove", { clientX: r.left + r.width * 0.25, clientY: r.top + r.height * 0.3, bubbles: true }));
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const after = getComputedStyle(hero).getPropertyValue("--mx").trim();
  return { before, after, layer: !!document.querySelector(".hero-spot") };
});
t("hero spotlight tracks the pointer", !!spot?.layer && spot.after !== "" && spot.after !== spot.before, `--mx ${spot?.before || "∅"} -> ${spot?.after || "∅"}`);

// 6. decorative layers must never intercept a click (the real risk of adding them)
const layers = await page.evaluate(() => {
  const names = [".hero-topology", ".hero-spot", ".hero-grid", ".aurora"];
  return names.map((n) => {
    const el = document.querySelector(n);
    return { n, present: !!el, pe: el ? getComputedStyle(el).pointerEvents : "missing" };
  });
});
t("decorative hero layers are click-through", layers.every((l) => l.present && l.pe === "none"), JSON.stringify(layers));
const clickThrough = await page.evaluate(() => {
  const cta = document.querySelector('.hero-cta a[href="/app.html"], .hero a[href="/app.html"]');
  if (!cta) return { ok: false, why: "no CTA found" };
  const r = cta.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { ok: cta.contains(hit) || hit === cta, hit: hit?.className || hit?.tagName };
});
t("hero CTA is hit-testable at its centre", clickThrough.ok, JSON.stringify(clickThrough));

// ---------- simulator -> home ----------
await page.goto(BASE + "/app.html", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const navLinks = await page.evaluate(() =>
  [...document.querySelectorAll(".brand-nav a")].map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim() }))
);
t("simulator exposes a way home", navLinks.some((l) => l.href === "/"), JSON.stringify(navLinks));
const brandHref = await page.evaluate(() => document.querySelector("a.brand-name")?.getAttribute("href") || null);
t("simulator brand links home", brandHref === "/", String(brandHref));

// click it for real
await page.click('.brand-nav a[href="/"]');
await page.waitForLoadState("networkidle");
await page.waitForTimeout(600);
const back = await page.evaluate(() => ({ url: location.pathname, hero: !!document.querySelector(".hero"), h1: document.querySelector("h1")?.textContent?.slice(0, 40) || "" }));
t("clicking home from the simulator lands on the landing page", back.url === "/" && back.hero, `${back.url} · "${back.h1}"`);

// and back into the simulator from the landing nav
await page.click('a[href="/app.html"]');
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1200);
const into = await page.evaluate(() => ({ path: location.pathname, topbar: !!document.querySelector(".topbar") }));
t("landing links back into the simulator", into.path === "/app.html" && into.topbar, into.path);

// shared report page also offers the way home
await page.goto(BASE + "/app.html?report=1jyqtc3t1r", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const shared = await page.evaluate(() => {
  const home = document.querySelector(".shared-home");
  return { present: !!home, href: home?.getAttribute("href") || null, cta: !!document.querySelector(".shared-cta") };
});
t("shared report links home too", shared.present && shared.href === "/" && shared.cta, JSON.stringify(shared));

t("zero console errors across the run", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
console.log(ok.map((s) => "PASS  " + s).join("\n"));
if (bad.length) console.log(bad.map((s) => "FAIL  " + s).join("\n"));
console.log(`\n${ok.length}/${ok.length + bad.length} checks passed`);
process.exit(bad.length ? 1 : 0);
