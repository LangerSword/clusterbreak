# DESIGN.md — Clusterbreak site

Contract for the public site (landing + docs) and the simulator app shell.
Amended before code when a token, primitive, state, or rule is introduced.

## 0. Research Log

- **`omh design data --kind palette --context dev-tool|landing`** — consulted.
  Taken: two-step dark surface separation ("log panes readable without borders
  on every element"), warm-terminal lesson (accent is not decoration, it is
  state). Rejected: Slate Console (`#38BDF8` is framework-blue-adjacent and not
  our brand), Terminal Amber (warm shell belongs to terminals, not to a
  GPU-instrument product).
- **`omh design data --kind font --context dev-tool`** — consulted. Taken:
  "Terminal Pair" — mono display over proportional body, with the CJK warning.
  Rejected: Inter Duo (a single default face does no typographic work here).
- **AWS Builder Center / builder pages** (vibe reference, not a copy target) —
  taken: dark technical shell, credential-forward tone, real numbers visible.
  Rejected: gradient hero blobs, centered marketing rhythm, badge soup.
- **The existing simulator app** — source of truth for brand continuity:
  palette tokens, mono data voice, the 3D grid motif.
- **Skipped:** CJK lane — audience is English-only developers; recorded as an
  explicit decision in §3, not an omission.

## 1. Atmosphere & Identity

Three adjectives: **instrumental, candid, kinetic.**

- Primary taste direction: **Bold / expressive** — the site is a statement
  surface: oversized mono display type, hard contrast, one grid rule broken
  deliberately (the hero instrument breaks the left-column rhythm).
- Borrowed element, with reason: **Operational density** — real numbers
  (tok/s, $/hr, GB) sit in the marketing copy because this product's pitch IS
  its numbers. The borrowed density is the honesty mechanism, not decoration.
- Signature element (a template would not have it): the **live verdict strip**
  — a working instrument in the hero that runs the actual sim engine against
  measured benchmark data and prints a real verdict for a chosen rig/model.
  Nothing on this page is a mock number.
- Audience: local-LLM builders — r/LocalLLaMA-class practitioners who own or
  rent GPUs, read tables for fun, and detect fake numbers instantly.

## 2. Color

Brand-continuous with the app (one product, one palette). Dark-only.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0b0d10` | page ground |
| `--panel` | `#0f1216` | raised surface (cards, nav on scroll) |
| `--panel-2` | `#12161b` | nested surface (code blocks, wells) |
| `--line` | `#1d242c` | hairline borders |
| `--line-2` | `#26303b` | stronger borders, focus rings' resting state |
| `--text` | `#e8e6e3` | primary text |
| `--dim` | `#98a0aa` | secondary text |
| `--dim-2` | `#7a838d` | tertiary/labels (amended from `#5e6670` — see §8) |
| `--accent` | `#9fd0ff` | CTAs, links, key numbers — **budget ≤10%** |
| `--cyan` | `#67e8f9` | gradient start (§9) |
| `--violet` | `#a78bfa` | gradient end (§9) |
| `--nv` | `#76b900` | NVIDIA — vendor colour, means silicon (§9) |
| `--apple` | `#c3ccd8` | Apple — vendor colour (§9) |
| `--amd` | `#f2545b` | AMD — vendor colour (§9) |
| `--ok` | `#57d38c` | measured/verified state |
| `--warn` | `#e0b341` | tight/unverified state |
| `--bad` | `#e05c5c` | does-not-fit / fault state |

Proportion discipline: 60% ground, 30% panel/line structure, 10% accent +
semantics. Contrast floor: WCAG AA (4.5:1 body, 3:1 large text/UI) — verified
pairings only; `--dim` is never used below 14px on `--bg`.

## 3. Typography

Pairing (max two families): **JetBrains Mono** (display + data) over
**Inter** (body).

- Stacks: display/data `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace`;
  body `Inter, system-ui, -apple-system, 'Segoe UI', sans-serif`. Loaded via
  Google Fonts with `display=swap` and full fallbacks — the site renders
  correctly if fonts never arrive.
- Scale (1.25 modular): 12 / 14 / 16 / 20 / 25 / 31 / 39 / 49 / 61 px; display
  steps clamp() for fluid hero (49→61).
- Weights: 400 body, 500 UI labels, 600 mono display; no 700+ anywhere.
- Line-height: 1.6 body, 1.1 display, 1.5 code.
- Letter-spacing: display −0.02em; mono labels +0.08em uppercase.
- CJK: **explicit decision — not supported.** Audience is English-only; no
  CJK font lane is loaded. Revisit if docs localization lands.

## 4. Spacing & Layout

- Base unit 4px. Scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128.
- Container: 1120px max (`.wrap`), 24px gutters, 16px on mobile.
- Landing rhythm: alternating full-bleed panels vs constrained content; the
  hero breaks the grid with a right-bleed instrument panel (the named break).
- Scroll ownership: body scrolls; docs sidebar is `position: sticky` (no
  nested scroll traps); code blocks scroll horizontally only.
- Breakpoints: 375 / 768 / 1120 / 1440.

## 5. Components

Primitives (all defined in `site.css` / app `index.css`):

- **Button**: variants `primary` (accent fill, on-accent text `#0b0d10`),
  `ghost` (line border, dim→text on hover), `danger`. States: default, hover
  (border/underline shift, no size change), focus-visible (2px `--accent`
  ring, 2px offset), active (translateY 1px), disabled (opacity .5, no
  pointer), loading (inline spinner, label unchanged), error (border `--bad`).
- **Card / panel**: `--panel` + 1px `--line`; raised variants only where
  elevation means something (hero instrument, deploy pricing table). No
  blanket shadows.
- **Nav**: sticky, transparent→`--panel` + border after 24px scroll.
- **Instrument readout**: label (`--dim-2`, mono, uppercase) + value (mono,
  large) + state chip (`ok`/`warn`/`bad`).
- **Code block**: `--panel-2`, mono 13px, copy button, language label.
- **Table** (docs, pricing): hairline rows, right-aligned numerics, mono digits.
- **Inputs** (hero widget selects): native `<select>` styled — no custom
  dropdown invention; states mirror Button.
- **Empty/loading/error**: hero widget ships all three (skeleton shimmer for
  loading, `--bad` text + retry for error, honest "—" for empty).

## 6. Motion & Interaction

- Durations: 120ms (state), 200ms (reveal), 400ms (instrument number settle).
- Easing: `cubic-bezier(0.2, 0.7, 0.2, 1)` — ease-out only. **No bounce**:
  nothing here is physical.
- Animates: hero instrument number transitions (counts to new value), nav
  background, hover/focus states, section reveal (opacity+8px rise, once).
- Never animates: layout, font size, anything on scroll-jack.
- `prefers-reduced-motion: reduce` → all durations collapse to 0ms, reveal
  becomes instant, number counting is disabled (values swap directly).

## 7. Depth & Surface

Elevation is a hierarchy signal, so exactly two levels exist: flat (`--bg`
with `--line` borders) and raised (`--panel` + 1px `--line-2` + soft 24px
shadow at 25% black). Raised is used only for: sticky nav on scroll, the hero
instrument, and the deploy pricing table. Everything else is flat. No blur,
no glass, no gradients as surfaces — the only gradient permitted is the hero
grid backdrop (a 2D projection of the app's 3D board grid, radial-masked).

## 8. Accessibility Constraints & Accepted Debt

Honored: AA contrast on all shipped pairings; full keyboard path (nav →
hero widget → CTAs; docs sidebar is a real `<nav>` with skip link); visible
focus everywhere; native controls; `aria-live="polite"` on the instrument
readout so value changes are announced; reduced-motion collapse; semantic
headings order per page.

Accepted debt (each with reason):
- **No i18n / CJK** — English-only audience, stated in §3.
- **Hero widget computes client-side with the same engine as the app** —
  deliberate: numbers must be the real engine's, and the engine is the
  product's single source of truth.
- **No dark/light toggle** — the product is dark-only by identity; a light
  mode would be a second design system, not a variant.
- **Inline prose links in docs are exempt from the 24px target rule**
  (WCAG 2.5.8's inline exception) — they sit inside sentences where a larger
  hit box would break reading rhythm. Standalone nav/footer links do meet it.
- **`--dim-2` amended** from `#5e6670` to `#7a838d` after the first visual-QA
  pass measured 3.35:1 at 11–13px (below the §2 AA floor); the new value is
  5.06:1 on `--bg`. Contract and code updated together.

## 9. Site v2 — dynamic + colour (amendment, same day)

The first pass was disciplined but static; this amendment adds motion and a
real colour system **without** breaking §2's discipline. The rule that keeps
it honest: **colour encodes meaning, never decoration.**

- **Vendor colours** (hardware identity, used on chips, cards, marquee):
  `--nv` `#76b900` (NVIDIA), `--apple` `#c3ccd8`, `--amd` `#f2545b`,
  `--generic` `#8b95a3`.
- **Interaction gradient**: `--grad` `linear-gradient(135deg,#67e8f9,#7dd3fc 45%,#a78bfa)`
  on primary CTAs, key numbers, active states. Accent budget (§2) still
  ≤10% of surface — the gradient *is* the accent, not an addition to it.
- **New tokens**: `--cyan` `#67e8f9`, `--violet` `#a78bfa`, `--panel-3` `#171d26`.
- **Motion (all reduced-motion aware)**: aurora drift behind the hero (≤20s
  loop, opacity-only), scroll reveal (opacity + 10px rise, once, IO-based),
  count-up on stat numbers (skipped when reduced-motion), marquee of device
  chips (pauses on hover/focus), hover lift + glow on bento cards. No scroll
  hijacking; nothing animates layout.
- **New components**: `.marquee` (device strip), `.bento` (asymmetric feature
  grid with per-card accent), `.aurora` (hero backdrop), `.reveal`
  (intersection-observed wrapper), `.chip-vendor`.
- The app shell (`frontend/src/index.css`) carries the same direction so
  site → simulator feels like one product.
- Unchanged: every number on the page is still computed from the shipped data
  files or the real engine — motion never fabricates state, and the postmortem
  shown on the landing is a real captured run, labelled as a capture.
