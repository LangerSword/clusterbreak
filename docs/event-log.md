# Event log — First Commit (Sep 17–20, 2026)

## Day 1 — Thu Sep 17

- **08:26** — Live site check: countdown flipped to "ENDS IN 3 DAYS, 11 HOURS" → build clock open; deadline ≈ Sun ~19:30 IST (schedule page still says exact hours are being finalised).
- **08:28–08:29** — Repo created at kickoff; scaffold committed (docs, license, README, .gitignore).
- **08:31** — Frontend scaffolded (Vite 8 + React 19 + TS), builds clean; committed.
- **08:33** — Sim engine skeleton committed: decode physics (bandwidth-bound) + fit accounting; **20 tests passing**, calibrated to three measured anchors (A1: RTX 3090 → 111.74 tok/s; A2: RTX 4090 → 127.74; A6: M2 Ultra → 76.28) — each within its published tolerance. A negative-control test proves the tolerance band rejects uncalibrated physics.
- **08:35** — Lambda `clusterbreak-api` (python3.13) live — direct invoke returns the `/health` payload (200).
- **08:38** — API Gateway HTTP API created; `GET /health` verified over the public endpoint (`https://wa7rwqxhk0.execute-api.ap-south-1.amazonaws.com/health` → `{"ok": true, ...}`).
- **08:38–08:40** — Frontend synced to the private S3 bucket; CloudFront `EX9Y84FE8SFH3` deployed with OAC + bucket policy; landing page live over HTTPS.
- **08:40–08:42** — Verification sweep: CloudFront 200 (SPA fallback → 200 on unknown paths; direct S3 object → 403, i.e. bucket is private), API `/health` → 200. Commits `9858f63`, `d21c698`.
- **08:41** — Submission form not visible on the event site yet (nav shows only "Check in"); re-check before end of day.
- **09:59–10:17** — **Interactive 3D rig builder live**: place devices on the 3D grid board (palette → board), drag/snap to cells, wire nodes into pipelines (link mode), live decode + pipeline estimates with fit verdicts per node and for the rig as a whole. Engine gained the pipeline estimator — anchors A3 (3090×2 → 108.07 tok/s) and A4 (70B ×2 → 16.29) now covered, **25/25 engine tests**. Frontend rig logic covered by 9 unit tests.
- **10:15** — Deployed-site verification (scripted browser, software GL): WebGL renders, three nodes placed with correct estimates (RTX 3090 + Llama-3.1-8B Q4_K_M → 111.7 tok/s = anchor A1), model/quant/context switches recompute live, **zero console errors**. Screenshot: `/tmp/cb-shot.png`.
- **10:22** — Interaction verification on the deployed bundle: LINK MODE wires two nodes and the pipeline estimate appears ("pipelined across 2 nodes · 1 GbE assumed"); dragging a node moves it across cells; zero console errors through the whole sequence. Screenshot: `/tmp/cb-shot2.png`.
- **10:29** — **Run simulator engine**: deterministic token loop (KV grows with context), fault injection (unplug a node, throttle a link), death detection with repair lists — 9 new tests, engine at **34/34**.
- **10:31–10:36** — **Break-it mode live**: RUN button, live VRAM meters on each node, event console over the board, UNPLUG / link-throttle fault controls, and a postmortem card ("what died and why" + repairs + event trail).
- **10:36** — Verified on the deployed bundle (scripted browser): Llama-3.3-70B across two wired RTX 3090s ran at 13.1 tok/s → unplugging one node killed it with the exact cause (survivors need 43.56 GB, have 24 GB) + repairs; throttling the link 1 → 0.01 GbE moved transfer time 0.13 → 13.11 ms/token live; **zero console errors**. Screenshots: `/tmp/cb-shot3.png` (postmortem), `/tmp/cb-shot4.png` (throttled run).
- **Data pipeline (built after 10:36; see clock note)** — `tools/refresh_data.py` now regenerates the whole dataset from live sources: measured benchmark tables (15 decode + 15 prompt rows), exact GGUF sizes from the Hugging Face API, and **15 device efficiencies fitted from measured runs**. It immediately killed an estimate: Qwen3.5-35B-A3B Q4_K_M was 20.5 GB "estimated" in the research — the live source says **22.29 GB**. The engine is now data-driven (JSON → engine), and devices without a measured anchor are marked unverified in-app instead of showing a default-parameter number. 34/34 engine tests still green; `docs/data-report.md` documents method, sources and gaps.

> **Clock note:** this machine's system clock resynced backwards by ~4h45m during the session (reading 10:42, then 05:53). Entries above record the clock as read at the time; durations between entries are the reliable measure. Deadline estimate from the event site's countdown is unaffected in substance (Sunday close, exact time still being finalised).

## Learnings (kept for the writeup)

- **`NODE_ENV=production` in this shell silently skips npm devDependencies** — `npm install` reports "up to date" while `node_modules/.bin` stays empty; `--include=dev` fixes it. Cost ~10 min at the start of the day.
- **API Gateway quick-create does not attach the Lambda permission** — the endpoint 500s until `lambda:add-permission` is added by hand.
- **Fresh `execute-api` hostnames + campus DNS = intermittent resolution failure** — `curl --resolve` bypasses it; works fine once propagated.
- **Fit-threshold recalibration**: first-pass "tight fit" rule called a 138GB model on 192GB unified memory "comfortable"; the researched verdict (30GB headroom is *not* enough for KV growth) forced a stricter 20%-of-usable rule. Caught by the test suite, fixed in the engine.
- **Negative zero is real**: `Math.round(-0.4)` returns `-0`, which deep-equality assertions and cell keys can trip on; grid cells normalize it.
- **The automation browser runs with `--disable-gpu`** (no WebGL, R3F silently can't render); verifying 3D pages needs a separate headless run with software GL (`--use-angle=swiftshader`).
- **UI layout shifts invalidate cached coordinates in scripted browser tests**: the run bar appearing pushes the canvas down, so element positions captured before it must be re-read after the shift (this bit the first break-it verification run).
- **The Hugging Face API (`?blobs=true`) returns exact GGUF blob sizes** — no size in this project is hand-entered any more; hand-entered numbers are how a 20.5 GB "estimate" survived until a live check said 22.29 GB.
- **Measured benchmark tables need defensive parsing**: bold markdown (`**144.49**`) and non-ASCII dashes (U+2011 in "32‑Core") silently dropped rows until normalized.
- **A single default efficiency constant is wrong by construction**: fitted values span 0.36 (H100 PCIe on an 8B model) to 0.83 (RTX 4000 Ada) — fitting per device from measured runs is the honest minimum.
