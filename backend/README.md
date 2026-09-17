# backend

Serverless API for Clusterbreak: **API Gateway (HTTP API) → Lambda → DynamoDB**.

v0 routes: `GET /health` (plus a service banner at `/`). Saved runs
(`POST /runs`, read-only `GET /runs/{id}`) land next — same function, routed by
path.

No third-party dependencies: the handler runs on the plain Python runtime, so
packaging is a single-file zip (`scripts/package_backend.sh`) and cold starts
stay minimal.
