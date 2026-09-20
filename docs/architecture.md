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

## Secure connect + chat (v0.5.0)

The user's AWS account, not the browser, is the source of truth:

```
browser ──HTTPS──> API Gateway ──> Lambda ──assume(roleArn, ExternalId)──> STS
                                    │                                        │
                                    ├─ POST /aws/provision ─────────────────> CloudFormation (clusterbreak-* only)
                                    ├─ GET  /aws/stacks/{session}  ─────────> describe each stack Clusterbreak recorded
                                    ├─ POST /aws/chat ──────────────────────> http://<node>:8080 (Bearer <per-stack key>)
                                    └─ POST /aws/teardown ──────────────────> CloudFormation
```

Three decisions worth defending:

1. **The chat proxy exists because of mixed content and key hygiene.** An HTTPS page cannot call `http://<ip>:8080`, and shipping the instance key into a web page is a bad trade. The browser → Clusterbreak → instance path keeps the key server-side (it lives on the session record, never in the bundle). Cost: replies are capped by the API gateway's 30s integration timeout, which is why the UI limits `max_tokens` to 512.
2. **Rig listing is scoped, not account-wide.** `describe_stacks()` with no name needs `DescribeStacks` on `*`, which the connect role deliberately does not grant. Instead the backend reads the stack names Clusterbreak recorded in `clusterbreak-sessions` (filtered to the caller's account), then describes each by name — permitted by the scoped policy, and it means Clusterbreak only ever shows rigs it created. Found the hard way: the first implementation returned `AccessDenied` from the real role.
3. **Per-stack bearer key, generated server-side.** `POST /aws/provision` mints `cbk-…`, passes it to the stack as a `NoEcho` parameter, and stores it on the session record. llama.cpp runs with `--api-key`, which is what makes it acceptable to leave 8080 open (that's what lets any harness reach the endpoint without knowing the caller's IP first). SSH stays pinned to the user's CIDR.

**Bootstrap: GPU nodes use the AWS Deep Learning base AMI** (driver + container toolkit preinstalled). The earlier design installed the driver in userdata, which only sometimes worked: nouveau had to be blacklisted, the driver needed a machine restart, and a unit that started too early simply died — the first live GPU test failed exactly that way (unit stuck in its GPU wait, nothing listening, no SSH to diagnose). With the DLAMI there is nothing to install and nothing to restart; the unit additionally retries (`Restart=on-failure`, `StartLimitIntervalSec=0`) and logs to the EC2 console, because on a machine you may not have SSH to, the console is the debugging surface.

**Cost decisions (Ship It):** the simulation itself is 100% client-side — zero server cost per run or per viewer. The backend exists only for share links: DynamoDB on-demand ($1.25/M writes, $0.25/M reads, $0.25/GB-month storage) + HTTP API ($1/M requests) + Lambda free tier. At demo scale (thousands of shares) this is literally pennies per month, with no capacity planning and automatic expiry capping storage.

**Two bugs found by not trusting green:** (1) `_table = None` at module level was shadowed by `def _table()` — the accessor returned itself; fixed by renaming the cache. (2) boto3's DynamoDB resource rejects Python floats — reports parse floats as `Decimal` and serialize them back on read. Both were invisible from the client (silent 503); the decisive tool was running the *deployed* handler locally against the real table.

## Non-goals (v0)
No real telemetry upload, no auth (share via unguessable links), no batching simulation, no tensor-parallel micro-model beyond a simplified collective cost.
