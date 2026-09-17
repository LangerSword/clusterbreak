# Architecture (v0)

## Components
1. **Frontend — S3 + CloudFront (static SPA)**
   The simulator runs fully client-side: deterministic, instant restarts, zero server compute per run. This is a documented cost/latency decision, not a shortcut.
2. **API — API Gateway HTTP API + Lambda (Python)**
   `GET /health` · `POST /runs` (save a run report → share link) · `GET /runs/{id}` (read-only share view) · `GET/POST /benchmarks` (calibration corpus, later).
3. **Data — DynamoDB**
   `runs` table (share links, TTL) · `benchmarks` table (community measurements, later).
4. **Simulation engine — pure TypeScript (`sim/`)**
   Discrete-event tick loop; decode is bandwidth-bound (`eff_bw / (weight bytes + KV traffic)`), prefill is compute-bound; multi-node layer sharding with per-hop activation transfer; VRAM accounting with configurable offload penalty. Unit-tested against cited measured anchors (tolerance bands ±15–25%).

## Diagram
```
browser ─── SPA (S3 + CloudFront) ── sim engine (client-side)
   │
   └── fetch ──> API Gateway HTTP API ──> Lambda ──> DynamoDB (runs, benchmarks)
```

## Non-goals (v0)
No real telemetry upload, no auth (share via unguessable links), no batching simulation, no tensor-parallel micro-model beyond a simplified collective cost.
