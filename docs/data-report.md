# Data & accuracy

**Rule: nothing shown is invented.** Every size, spec and efficiency in the app traces to a source, and anything that isn't measured is marked as such in the UI.

## How data is pulled — one command

```bash
python3 tools/refresh_data.py
```

Regenerates three checked-in files under `sim/data/`:

| File | Source | Method |
|---|---|---|
| `benchmarks.json` | XiongjieDai/GPU-Benchmarks-on-LLM-Inference (llama.cpp, LLaMA 3, 1024-token generation; repo last pushed 2024-05-13) | Markdown tables fetched from the README and parsed (15 decode + 15 prompt rows) |
| `model-sizes.json` | Hugging Face API (`?blobs=true` per repo) | Exact blob size of every Q4_K_M / Q8_0 / BF16-F16 artifact; split GGUFs are summed. No size is hand-entered. |
| `efficiencies.json` | Fitted from the measured benchmarks | `efficiency = measured_tok_s × (weights_bytes + kv_bytes@1024ctx) / peak_bandwidth`, per device |

The simulation engine reads these files at build time (`sim/src/data/*.ts` merges them). The engine refuses to simulate model+quant combinations with no verified size.

## What this replaced

- The Qwen3.5-35B-A3B Q4_K_M size was an estimate (20.5 GB) in the research phase; the HF API says **22.29 GB** — the engine now uses the verified number.
- Device efficiencies used to fall back to a single default (0.60) for anything unmeasured. Now **15 devices carry efficiencies fitted from measured runs** (e.g. RTX 3090 → 0.603 from 111.74 tok/s; H100 PCIe → 0.358 from 144.49 tok/s — big GPUs *underutilize* on small models, which a single constant would hide).

## What the UI shows

- A device without a fitted efficiency shows `~` before its tok/s and its panel says *"no published measurement"* — a default parameter is never dressed up as a measurement.
- Each device/model panel links its source; fitted panels quote the measured run ("fitted from measured 111.74 tok/s …").
- Engine tests reproduce **15 measured anchors** within their published tolerance bands, including multi-node pipeline anchors.

## Context windows (verified, per model)

The context dropdown offers up to **128K**, and which options are live is arithmetic, not a taste setting:

- **Source:** each model's own GGUF metadata via the Hugging Face API (`?expand[]=gguf` → `gguf.context_length`) — the same field llama.cpp reads from the file header. Fetched by `tools/refresh_context.py` into `sim/data/model-context.json`. Nothing here is estimated; a model with no verified row returns `null` and is not offered long windows.
- **The figures differ per family** — Llama-3.1/3.3 and Gemma-3 and GPT-OSS say 131,072; Qwen3.5 (incl. the MoE) says 262,144; MiniMax-M2.5 says 196,608; **Qwen3-32B says 32,768**, so 64K/128K are refused for it and the UI names that limit.
- **Memory gates the rest:** the KV cache for a window has to fit beside the weights. Gemma-3-27B at 128K costs 66.6 GB of KV (83.1 GB total) — offered on a 192 GB unified-memory rig, refused on a 24 GB card with *"needs 83.1 GB of memory"*. Every option carries its KV cost, and the app snaps off a window the current board cannot hold instead of displaying one.
- **Fixed along the way:** presets shipped `contextTokens: 2048`, which was never in the fixed option list, so the control silently displayed 512 while the engine ran at 2048. 2048 is now a candidate and the control can no longer disagree with the state.

## Known gaps (honest list)

- **No measured anchor yet** for: RTX 3050/3060/4060, laptop 5060, 5070, 5080, 5090, M1 Pro, M4 Max, Steam Deck, CPU baseline — these render as unverified estimates in-app. Sourcing queue: llama.cpp discussion #4167, LocalScore, vendor-published numbers.
- Fitted efficiency is a per-device constant; the same device spread across context depths and backends (CUDA/Metal/Vulkan) is roughly ±15–25%. The benchmark repo's per-context table (512→8192) is the next refinement to model that directly.
- The newest device rows carry vendor/TPU bandwidth values; deep-link verification for the 2026 rows is queued.
