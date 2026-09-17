# Event log — First Commit (Sep 17–20, 2026)

## Day 1 — Thu Sep 17

- **08:26** — Live site check: countdown flipped to "ENDS IN 3 DAYS, 11 HOURS" → build clock open; deadline ≈ Sun ~19:30 IST (schedule page still says exact hours are being finalised).
- **08:28** — Repo created at kickoff — public, commit history starts inside the event window.
- **08:29** — Scaffold committed: docs, license, README, .gitignore. Frontend scaffolded (Vite 8 + React 19 + TS) and building clean.
- **08:33** — Sim engine skeleton committed: decode physics (bandwidth-bound) + fit accounting; **20 tests, all passing**, calibrated against three measured anchors (A1: RTX 3090 → 111.74 tok/s; A2: RTX 4090 → 127.74; A6: M2 Ultra → 76.28), each within its published tolerance. A negative-control test proves the tolerance band rejects uncalibrated physics.
- **08:36** — Backend live: Lambda `clusterbreak-api` (python3.13) + API Gateway HTTP API. `GET /health` returns `{"ok": true, ...}` — verified over the public endpoint.
- **08:37** — Frontend uploaded to private S3 bucket; CloudFront distribution `EX9Y84FE8SFH3` created with OAC + bucket policy (bucket readable only through this distribution).
- **08:4x** — Placeholder landing page (real Clusterbreak identity, dark theme) deployed behind CloudFront.
- **08:52** — **Thin deploy verified end-to-end**: `https://d1at2woaiwy2hz.cloudfront.net` serves the landing page over HTTPS (SPA fallback → 200 on unknown paths), the S3 bucket is private (direct object access → 403), and `https://wa7rwqxhk0.execute-api.ap-south-1.amazonaws.com/health` answers from the public internet. Commit `9858f63`.
- **08:53** — Submission form not visible on the event site yet (nav shows only "Check in"); will re-check before end of day.

## Learnings (kept for the writeup)

- **`NODE_ENV=production` in this shell silently skips npm devDependencies** — `npm install` reports "up to date" while `node_modules/.bin` stays empty; `--include=dev` fixes it. Cost ~10 min at the start of the day.
- **API Gateway quick-create does not attach the Lambda permission** — the endpoint 500s until `lambda:add-permission` is added by hand.
- **Fresh `execute-api` hostnames + campus DNS = intermittent resolution failure** — `curl --resolve` bypasses it; works fine once propagated.
- **Fit-threshold recalibration**: first-pass "tight fit" rule called a 138GB model on 192GB unified memory "comfortable"; the researched verdict (30GB headroom is *not* enough for KV growth) forced a stricter 20%-of-usable rule. Caught by the test suite, fixed in the engine.
