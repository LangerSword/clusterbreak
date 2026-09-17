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

## Learnings (kept for the writeup)

- **`NODE_ENV=production` in this shell silently skips npm devDependencies** — `npm install` reports "up to date" while `node_modules/.bin` stays empty; `--include=dev` fixes it. Cost ~10 min at the start of the day.
- **API Gateway quick-create does not attach the Lambda permission** — the endpoint 500s until `lambda:add-permission` is added by hand.
- **Fresh `execute-api` hostnames + campus DNS = intermittent resolution failure** — `curl --resolve` bypasses it; works fine once propagated.
- **Fit-threshold recalibration**: first-pass "tight fit" rule called a 138GB model on 192GB unified memory "comfortable"; the researched verdict (30GB headroom is *not* enough for KV growth) forced a stricter 20%-of-usable rule. Caught by the test suite, fixed in the engine.
- **Negative zero is real**: `Math.round(-0.4)` returns `-0`, which deep-equality assertions and cell keys can trip on; grid cells normalize it.
- **The automation browser runs with `--disable-gpu`** (no WebGL, R3F silently can't render); verifying 3D pages needs a separate headless run with software GL (`--use-angle=swiftshader`).
