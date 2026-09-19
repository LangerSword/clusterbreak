import { chromium } from "playwright";

const base = process.argv[2] ?? "https://d1at2woaiwy2hz.cloudfront.net";
const CHROME =
  process.env.CHROME_PATH ??
  "/home/lakshaya/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const findings = [];
const note = (sev, msg) => {
  findings.push({ sev, msg });
  console.log(`${sev.toUpperCase().padEnd(7)} ${msg}`);
};

async function audit(path, width, height, label) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(2500);

  const data = await page.evaluate(() => {
    const out = { overflow: null, clipped: [], contrast: [], smallTargets: [], overlaps: [], spacing: [] };
    // 1. horizontal overflow
    const docW = document.documentElement.scrollWidth;
    const winW = window.innerWidth;
    if (docW > winW + 1) {
      out.overflow = { docW, winW };
      // find the widest offenders
      const offenders = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > winW + 1 || r.left < -1) {
          offenders.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} right=${Math.round(r.right)} left=${Math.round(r.left)}`);
        }
      });
      out.overflow.offenders = offenders.slice(0, 6);
    }
    // 2. clipped text (vertical)
    document.querySelectorAll("h1,h2,h3,p,span,a,td,th,li,label,button").forEach((el) => {
      const s = getComputedStyle(el);
      if (s.overflow === "hidden" && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) {
        out.clipped.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} "${(el.textContent || "").trim().slice(0, 40)}"`);
      }
    });
    // 3. contrast of text against its effective background
    const lum = (c) => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const parse = (str) => {
      const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [+m[1], +m[2], +m[3]] : null;
    };
    const effBg = (el) => {
      let cur = el;
      while (cur) {
        const bg = parse(getComputedStyle(cur).backgroundColor);
        const s = getComputedStyle(cur).backgroundColor;
        if (bg && !s.includes("rgba(0, 0, 0, 0)")) return bg;
        cur = cur.parentElement;
      }
      return [11, 13, 16];
    };
    document.querySelectorAll("p, span, a, td, th, li, .k, .v, .stat-label, .cell-tag, .eyebrow, .instrument-note").forEach((el) => {
      const t = (el.textContent || "").trim();
      if (!t || el.children.length > 0) return;
      const s = getComputedStyle(el);
      const fg = parse(s.color);
      if (!fg) return;
      const bg = effBg(el);
      const L1 = lum(fg), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(s.fontSize);
      const bold = parseInt(s.fontWeight) >= 600;
      const large = size >= 24 || (size >= 18.66 && bold);
      const min = large ? 3 : 4.5;
      if (ratio < min) {
        out.contrast.push(`"${t.slice(0, 36)}" ${ratio.toFixed(2)}:1 (need ${min}, ${size}px) cls=${(el.className || "").toString().split(" ")[0]}`);
      }
    });
    // 4. tap targets (mobile only)
    if (window.innerWidth <= 480) {
      document.querySelectorAll("a, button, select").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.height < 24 || r.width < 24)) {
          out.smallTargets.push(`${el.tagName.toLowerCase()} "${(el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      });
    }
    // 5. overlapping siblings in the hero and bento
    const groups = [".hero-inner", ".bento", ".steps", ".deploy-grid", ".hero-stats", ".instrument-controls"];
    groups.forEach((sel) => {
      const parent = document.querySelector(sel);
      if (!parent) return;
      const kids = Array.from(parent.children).map((el) => ({ el, r: el.getBoundingClientRect() }));
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].r, b = kids[j].r;
          const overlap = !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1);
          if (overlap && a.width > 0 && b.width > 0) {
            out.overlaps.push(`${sel}: ${kids[i].el.className} ∩ ${kids[j].el.className}`);
          }
        }
      }
    });
    return out;
  });

  if (data.overflow) {
    note("blocker", `${label}: horizontal overflow ${data.overflow.docW}>${data.overflow.winW} — offenders: ${data.overflow.offenders.join("; ")}`);
  } else {
    console.log(`OK      ${label}: no horizontal overflow`);
  }
  if (data.clipped.length) note("high", `${label}: clipped text — ${data.clipped.slice(0, 4).join("; ")}`);
  if (data.contrast.length) note("high", `${label}: contrast below floor — ${data.contrast.slice(0, 6).join("; ")}`);
  if (data.smallTargets.length) note("medium", `${label}: small tap targets — ${data.smallTargets.slice(0, 4).join("; ")}`);
  if (data.overlaps.length) note("blocker", `${label}: overlapping elements — ${data.overlaps.slice(0, 4).join("; ")}`);
  await page.close();
}

console.log("=== VISUAL QA AUDIT ===\n");
await audit("/", 1440, 900, "landing@1440");
await audit("/", 768, 1024, "landing@768");
await audit("/", 375, 812, "landing@375");
await audit("/docs.html", 1440, 900, "docs@1440");
await audit("/docs.html", 375, 812, "docs@375");

await browser.close();
console.log(`\nfindings: ${findings.length}`);
const blockers = findings.filter((f) => f.sev === "blocker");
console.log(`blockers: ${blockers.length}`);
process.exit(blockers.length ? 1 : 0);
