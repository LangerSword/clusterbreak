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

## Runs API (shareable postmortems, v0.2)
`POST /runs` stores a bounded report (≤8 KB, validated: ≤8 nodes, ≤16 links, quant whitelist, verdict ≤2000 chars) in DynamoDB `clusterbreak-runs` and returns a random 10-char id; `GET /runs/{id}` returns it. Reports carry a 90-day TTL. Writes are one-shot, reads are by unguessable id — no auth by design, no user data.

**Cost decisions (Ship It):** the simulation itself is 100% client-side — zero server cost per run or per viewer. The backend exists only for share links: DynamoDB on-demand ($1.25/M writes, $0.25/M reads, $0.25/GB-month storage) + HTTP API ($1/M requests) + Lambda free tier. At demo scale (thousands of shares) this is literally pennies per month, with no capacity planning and automatic expiry capping storage.

**Two bugs found by not trusting green:** (1) `_table = None` at module level was shadowed by `def _table()` — the accessor returned itself; fixed by renaming the cache. (2) boto3's DynamoDB resource rejects Python floats — reports parse floats as `Decimal` and serialize them back on read. Both were invisible from the client (silent 503); the decisive tool was running the *deployed* handler locally against the real table.

## Non-goals (v0)
No real telemetry upload, no auth (share via unguessable links), no batching simulation, no tensor-parallel micro-model beyond a simplified collective cost.
