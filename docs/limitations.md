# Limitations & simplifications (v0)

- Batch-1 decode model (single stream); batching/continuous-batching effects deferred.
- Pipeline-parallel network model is simplified: boundary activation transfer + per-hop latency; no NCCL/RDMA micro-details yet.
- CPU/disk offload is modeled as severe configurable penalty bands, not exact measured curves.
- Calibration anchors carry tolerance bands (±15–25%); the simulator reports estimates, not measurements of your hardware.
- Device and model data are community/vendor numbers with stated provenance; borderline "tight fit" cases are flagged as such.
