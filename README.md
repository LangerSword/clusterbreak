# Clusterbreak
**Build a rig. Run a model. Break it on purpose.**

An interactive simulator for local AI inference clusters: assemble a virtual rig from real hardware (GPUs, Macs, laptops), pick a model and quantization, watch a simulated generation run with live tokens/s, TTFT, memory-bandwidth and VRAM meters — then inject failures (unplug a node mid-generation, throttle the network, mix architectures) and get a "what died and why" report you can share.

## Why
Everyone asks *"can my machines run this?"* — and the honest answer is scattered across benchmarks, spreadsheets and guesswork. Clusterbreak makes the physics visible: the limiting resource (VRAM, memory bandwidth, interconnect, compute), the causal chain, and the repair.

## Status
Day 1 of a 4-day build (First Commit hackathon, Sep 17–20 2026). Repo history starts at kickoff; see `docs/event-log.md` for the build log.

**Live now:** https://d1at2woaiwy2hz.cloudfront.net (landing placeholder) · `GET /health` on the API is up; the interactive simulator lands next.

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

## Honesty notes
The simulator is calibrated against published, cited measurements; every simplification is documented in `docs/limitations.md` and surfaced in-app. Numbers are estimates, not measurements of your hardware.

## AI tools used
Hermes Agent — research, scaffolding and development assistance (listed per event rules).

## License
MIT
