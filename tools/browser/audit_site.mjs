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
    const out = { overflow: null, clipped: [], contrast: [], smallTargets: [], overlaps: [], spacing: [], gradientText: [] };
    // 1. horizontal overflow — the user-facing defect is *scrollability*;
    //    scrollWidth alone false-positives on decorative layers clipped by
    //    an ancestor (aurora/hero-grid sit inside .hero{overflow:hidden})
    const docW = document.documentElement.scrollWidth;
    const winW = window.innerWidth;
    window.scrollTo(120, 0);
    const canScrollX = window.scrollX > 0;
    window.scrollTo(0, 0);
    if (canScrollX) {
      out.overflow = { docW, winW };
      const clippedByAncestor = (el) => {
        let cur = el.parentElement;
        while (cur) {
          if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(cur).overflowX)) return true;
          cur = cur.parentElement;
        }
        return false;
      };
      const offenders = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if ((r.right > winW + 1 || r.left < -1) && !clippedByAncestor(el)) {
          offenders.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} right=${Math.round(r.right)} left=${Math.round(r.left)}`);
        }
      });
      out.overflow.offenders = offenders.slice(0, 6);
    } else if (docW > winW + 1) {
      out.overflowNote = `scrollWidth ${docW} vs ${winW} but page cannot scroll (decorative layers clipped by ancestors) — not a defect`;
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
      const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
      return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : null;
    };
    // composite rgba layers down to an opaque colour (ignoring alpha was a
    // self-bug: rgba(255,255,255,0.02) read as pure white and faked failures)
    const effBg = (el) => {
      const layers = [];
      let cur = el;
      while (cur) {
        const s = getComputedStyle(cur);
        const c = parse(s.backgroundColor);
        if (c && c.a > 0) layers.push(c);
        if (c && c.a >= 0.999) break;
        cur = cur.parentElement;
      }
      let base = [11, 13, 16];
      for (let i = layers.length - 1; i >= 0; i--) {
        const { rgb, a } = layers[i];
        base = base.map((v, k) => Math.round(rgb[k] * a + v * (1 - a)));
      }
      return base;
    };
    document.querySelectorAll("p, span, a, td, th, li, .k, .v, .stat-label, .cell-tag, .eyebrow, .instrument-note").forEach((el) => {
      const t = (el.textContent || "").trim();
      if (!t || el.children.length > 0) return;
      const s = getComputedStyle(el);
      // gradient-clipped text (background-clip:text / transparent fill) is not
      // measurable this way — report separately instead of a false failure
      if (s.webkitTextFillColor === "rgba(0, 0, 0, 0)" || s.color === "rgba(0, 0, 0, 0)") {
        out.gradientText.push(`"${t.slice(0, 30)}"`);
        return;
      }
      const fg = parse(s.color);
      if (!fg || fg.a === 0) return;
      // element paints its own gradient/image background → skip (e.g. .btn.primary)
      if (s.backgroundImage && s.backgroundImage !== "none") {
        out.gradientText.push(`"${t.slice(0, 30)}" (on gradient)`);
        return;
      }
      const bg = effBg(el);
      const L1 = lum(fg.rgb), L2 = lum(bg);
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
    console.log(`OK      ${label}: no horizontal overflow${data.overflowNote ? " (" + data.overflowNote + ")" : ""}`);
  }
  if (data.clipped.length) note("high", `${label}: clipped text — ${data.clipped.slice(0, 4).join("; ")}`);
  if (data.contrast.length) note("high", `${label}: contrast below floor — ${data.contrast.slice(0, 6).join("; ")}`);
  if (data.smallTargets.length) note("medium", `${label}: small tap targets — ${data.smallTargets.slice(0, 4).join("; ")}`);
  if (data.overlaps.length) note("blocker", `${label}: overlapping elements — ${data.overlaps.slice(0, 4).join("; ")}`);
  if (data.gradientText.length) {
    console.log(`note    ${label}: gradient-clipped text (not auto-measurable, reviewed by eye): ${data.gradientText.slice(0, 5).join("; ")}`);
  }
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
