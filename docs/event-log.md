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

## Learnings (kept for the writeup)

- **`NODE_ENV=production` in this shell silently skips npm devDependencies** — `npm install` reports "up to date" while `node_modules/.bin` stays empty; `--include=dev` fixes it. Cost ~10 min at the start of the day.
- **API Gateway quick-create does not attach the Lambda permission** — the endpoint 500s until `lambda:add-permission` is added by hand.
- **Fresh `execute-api` hostnames + campus DNS = intermittent resolution failure** — `curl --resolve` bypasses it; works fine once propagated.
- **Fit-threshold recalibration**: first-pass "tight fit" rule called a 138GB model on 192GB unified memory "comfortable"; the researched verdict (30GB headroom is *not* enough for KV growth) forced a stricter 20%-of-usable rule. Caught by the test suite, fixed in the engine.
