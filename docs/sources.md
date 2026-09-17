# Data sources

Every device and model constant in `sim/` carries its own source URL and retrieval date (2026-09-17). Primary source families:

- **llama.cpp community benchmark tables** (GPU-Bench README and similar) — per-GPU decode/prompt rates with exact model + quant.
- **MLX benchmark methodology** (Apple Silicon scaling: single → TP2 → TP4 efficiency).
- **TechPowerUp GPU database** — memory bandwidth / VRAM specs.
- **Apple technical specifications** — unified memory bandwidth.
- **Hugging Face GGUF repos** (bartowski et al.) — file sizes per quantization.

Where a number was estimated rather than observed, the row says so.
