# Clusterbreak
**Build a rig. Run a model. Break it on purpose.**

An interactive simulator for local AI inference clusters: assemble a virtual rig from real hardware (GPUs, Macs, laptops), pick a model and quantization, watch a simulated generation run with live tokens/s, TTFT, memory-bandwidth and VRAM meters — then inject failures (unplug a node mid-generation, throttle the network, mix architectures) and get a "what died and why" report you can share.

## Why
Everyone asks *"can my machines run this?"* — and the honest answer is scattered across benchmarks, spreadsheets and guesswork. Clusterbreak makes the physics visible: the limiting resource (VRAM, memory bandwidth, interconnect, compute), the causal chain, and the repair.

## Status
Built solo during **First Commit** (WeMakeDevs × AWS Builder Center, Sep 17–20 2026), shipped to the **Ship It** track. Repo history starts at kickoff — `docs/event-log.md` is the build log, including the bugs that only showed up against real AWS.

**Live:** https://clusterbreak.langersword.in

- **Simulate** — place devices on the 3D board, wire them, get live tokens/s, TTFT, memory-bandwidth and VRAM meters. Break-it scenarios included: unplug a node mid-generation, cut the interconnect, cap VRAM, mix architectures — each ends in a causal postmortem ("what died and why", traced to the constraint that produced it) with a shareable report.
- **Deploy** — generate a real CloudFormation template for NVIDIA cards from the rig you built (validated with `cfn-lint` as a shipped artifact, priced from a vendored AWS Pricing API snapshot).
- **Provision** — connect your own AWS account with a scoped, revocable role (**no keys change hands**: CloudFormation trust role + ExternalId, assumed via STS) and launch the rig you simulated on a real `g5.xlarge` (Deep Learning base AMI, llama.cpp in Docker behind a per-stack API key).
- **Chat** — prompt the model running on that rig from the browser (server-side proxy; the key never reaches the client), or point any OpenAI-compatible harness at the endpoint. Rigs are listed from the account itself, so a refresh or another browser still sees what's up — with one-click teardown and a 15-minute sweep that kills anything forgotten.

## Architecture (v0)
- `frontend/` — static SPA (Vite + React + TS); the simulator runs fully client-side
- `sim/` — the simulation engine (pure TypeScript, deterministic, unit-tested against cited real-world measurements)
- `backend/` — small serverless API (API Gateway + Lambda + DynamoDB) for saved reports and the calibration corpus
- Hosted on AWS: S3 + CloudFront (frontend) · API Gateway HTTP API + Lambda + DynamoDB (reports)

## Local development
```bash
# engine
cd sim && npm install && npm test

# app
cd frontend && npm install && npm run dev
```

## Verification
- **Engine**: 37 tests (`cd sim && npm test`) — anchors, KV math, pipeline, run simulator, user-measurement calibration; includes a negative-control test that a wrong efficiency fails its band.
- **Rig interaction**: 9 tests (`cd frontend && npm test`).
- **Claims grader**: `python3 tools/grade_claims.py` → `docs/grade-claims.md` — recomputes every fitted number from raw sources, re-fetches the HF API + benchmark tables live and diffs, runs the suites, and proves itself with negative controls (injected corruptions must be caught).
- **Deployed-site suite**: `tools/browser/` (Playwright + software GL) — drives the real flows on the live URL and fails on any console error.

## Honesty notes
Every model size is pulled live from the Hugging Face API, and every device's decode efficiency is fitted from measured llama.cpp benchmark campaigns — one command (`python3 tools/refresh_data.py`) refreshes and re-verifies the whole dataset (see `docs/data-report.md`). Devices with no published measurement are marked **unverified** in-app rather than shown a fabricated number. Every simplification is documented in `docs/limitations.md`.

## AI tools used
Hermes Agent — research, scaffolding and development assistance (listed per event rules).

## License
MIT
