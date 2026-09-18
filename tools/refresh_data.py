#!/usr/bin/env python3
"""
Clusterbreak data pipeline — one command that refreshes and re-verifies all
simulation data:

  1. benchmarks: pulls the measured llama.cpp benchmark tables (XiongjieDai
     GPU-Benchmarks-on-LLM-Inference) and parses the LLaMA 3 decode/prompt rows.
  2. model-sizes: queries the Hugging Face API for the exact GGUF blob sizes of
     every model in our catalog (no hand-entered sizes).
  3. efficiencies: fits each device's decode efficiency from a measured anchor:
        efficiency = measured_tok_s * bytes_per_token / peak_bandwidth
     using the verified Llama-3.1-8B Q4_K_M size and a 1024-token context.

Outputs (checked into the repo for reproducibility):
  sim/data/benchmarks.json
  sim/data/model-sizes.json
  sim/data/efficiencies.json

Requires: python3 (stdlib only), network access.
"""

import json
import re
import subprocess
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "sim" / "data"
RETRIEVED = date.today().isoformat()

BENCH_URL = (
    "https://raw.githubusercontent.com/XiongjieDai/GPU-Benchmarks-on-LLM-Inference/main/README.md"
)

# Our model catalog -> Hugging Face repos (verified in the research phase).
HF_REPOS = {
    "qwen3.5_4b": "bartowski/Qwen_Qwen3.5-4B-GGUF",
    "llama3.1_8b": "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
    "gemma3_27b": "bartowski/google_gemma-3-27b-it-GGUF",
    "qwen3_32b": "bartowski/Qwen_Qwen3-32B-GGUF",
    "qwen3.5_35b_a3b": "bartowski/Qwen_Qwen3.5-35B-A3B-GGUF",
    "llama3.3_70b": "bartowski/Llama-3.3-70B-Instruct-GGUF",
    "gpt_oss_120b": "bartowski/openai_gpt-oss-120b-GGUF",
    "minimax_m2.5": "ox-ox/MiniMax-M2.5-GGUF",
}

# Quant tags -> regexes over file names. BF16/F16 fallback tries both tags.
QUANT_PATTERNS = {
    "q4_k_m": re.compile(r"(?i)q4_k_m"),
    "q8_0": re.compile(r"(?i)q8_0"),
    "bf16": re.compile(r"(?i)(bf16|f16)"),
}

# First-GPU device bandwidths (GB/s) for efficiency fitting, with source.
DEVICE_BANDWIDTH = {
    # id: (bandwidth_gbps, source)
    "rtx3070_8gb": (448, "TechPowerUp GPU database"),
    "rtx3080_10gb": (760, "TechPowerUp GPU database"),
    "rtx3080_ti_12gb": (912, "TechPowerUp GPU database"),
    "rtx4070ti_12gb": (504, "TechPowerUp GPU database"),
    "rtx4080_16gb": (717, "TechPowerUp GPU database"),
    "rtx4000_ada_20gb": (360, "TechPowerUp GPU database"),
    "rtx5000_ada_32gb": (576, "TechPowerUp GPU database"),
    "rtx3090_24gb": (936, "TechPowerUp GPU database"),
    "rtx4090_24gb": (1008, "TechPowerUp GPU database"),
    "a100_pcie_80gb": (1935, "NVIDIA A100 datasheet (PCIe)"),
    "h100_pcie_80gb": (2039, "NVIDIA H100 datasheet (PCIe)"),
    "apple_m1_7core_8gb": (68.25, "Apple technical specifications"),
    "apple_m1_max_64gb": (400, "Apple technical specifications (32-core GPU)"),
    "apple_m2_ultra_192gb": (800, "Apple technical specifications (76-core GPU)"),
    "apple_m3_max_64gb": (400, "Apple technical specifications (40-core GPU)"),
}

# Benchmark row label -> our device id (single-GPU rows only).
BENCH_GPU_MAP = {
    "3070 8GB": "rtx3070_8gb",
    "3080 10GB": "rtx3080_10gb",
    "3080 Ti 12GB": "rtx3080_ti_12gb",
    "4070 Ti 12GB": "rtx4070ti_12gb",
    "4080 16GB": "rtx4080_16gb",
    "RTX 4000 Ada 20GB": "rtx4000_ada_20gb",
    "RTX 5000 Ada 32GB": "rtx5000_ada_32gb",
    "3090 24GB": "rtx3090_24gb",
    "4090 24GB": "rtx4090_24gb",
    "A100 PCIe 80GB": "a100_pcie_80gb",
    "H100 PCIe 80GB": "h100_pcie_80gb",
    "M1 7-Core GPU 8GB": "apple_m1_7core_8gb",
    "M1 Max 32-Core GPU 64GB": "apple_m1_max_64gb",
    "M2 Ultra 76-Core GPU 192GB": "apple_m2_ultra_192gb",
    "M3 Max 40-Core GPU 64GB": "apple_m3_max_64gb",
}


def fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode("utf-8", errors="replace")


def parse_bench_tables(md: str) -> dict:
    """Parse markdown tables: first table = decode tok/s, second = prompt tok/s (LLaMA 3)."""
    tables = []
    current: list[list[str]] = []
    for line in md.splitlines():
        if line.strip().startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if all(set(c) <= set("-: ") for c in cells):
                continue  # separator row
            current.append(cells)
        else:
            if current:
                tables.append(current)
                current = []
    if current:
        tables.append(current)

    out = {"decode": {}, "prompt": {}}
    for table in tables:
        if not table:
            continue
        header = " ".join(table[0])
        if "8B Q4_K_M" not in header:
            continue
        kind = "decode" if out["decode"] == {} else "prompt"
        for row in table[1:]:
            label = row[0].strip()
            norm = (
                label.replace("\u2011", "-")
                .replace("\u2010", "-")
                .replace("\u2013", "-")
                .replace("\u2014", "-")
            )
            dev = BENCH_GPU_MAP.get(label) or BENCH_GPU_MAP.get(norm)
            if dev is None:
                continue
            try:
                val = float(row[1].replace("*", "").replace(",", "").strip())
            except (ValueError, IndexError):
                continue  # OOM or unparsable
            out[kind][dev] = val
    return out


def hf_sizes(repo: str) -> dict:
    url = f"https://huggingface.co/api/models/{repo}?blobs=true"
    data = json.loads(fetch(url))
    files = [
        s for s in data.get("siblings", []) if s.get("rfilename", "").lower().endswith(".gguf")
    ]
    result: dict = {}
    for quant, pat in QUANT_PATTERNS.items():
        matches = [f for f in files if pat.search(f["rfilename"])]
        if not matches:
            result[quant] = None
            continue
        # Split GGUFs: pick the quant that exposes total parts and sum them all.
        total = sum(f.get("size", 0) for f in matches)
        result[quant] = {
            "bytes": total,
            "files": [f["rfilename"] for f in matches],
        }
    return result


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)

    print("== 1. benchmarks: fetching measured llama.cpp tables ==")
    md = fetch(BENCH_URL)
    bench = parse_bench_tables(md)
    (DATA / "benchmarks.json").write_text(
        json.dumps(
            {
                "source": BENCH_URL,
                "source_note": "XiongjieDai/GPU-Benchmarks-on-LLM-Inference (llama.cpp, LLaMA 3, generation of 1024 tokens; repo last pushed 2024-05-13)",
                "retrieved": RETRIEVED,
                "decode_tok_s_8b_q4km": bench["decode"],
                "prompt_tok_s_8b_q4km": bench["prompt"],
            },
            indent=2,
        )
        + "\n"
    )
    print(f"  decode rows parsed: {len(bench['decode'])}")
    for k, v in sorted(bench["decode"].items()):
        print(f"    {k}: {v} tok/s")
    print(f"  prompt rows parsed: {len(bench['prompt'])}")

    print("== 2. model sizes: verifying GGUF blobs via the Hugging Face API ==")
    sizes = {}
    for model_id, repo in HF_REPOS.items():
        sizes[model_id] = {"repo": repo, **hf_sizes(repo)}
        q4 = sizes[model_id].get("q4_k_m")
        q4gb = f"{q4['bytes'] / 1e9:.2f} GB" if q4 else "MISSING"
        print(f"    {model_id:18s} {repo:55s} Q4_K_M={q4gb}")
    (DATA / "model-sizes.json").write_text(
        json.dumps(
            {"retrieved": RETRIEVED, "method": "Hugging Face API ?blobs=true; split files summed", "models": sizes},
            indent=2,
        )
        + "\n"
    )

    print("== 3. efficiencies: fitting from the measured anchor (Llama 3 8B Q4_K_M, ctx 1024) ==")
    llama = sizes["llama3.1_8b"]["q4_k_m"]
    if not llama:
        print("  !! Llama-3.1-8B Q4_K_M size missing; cannot fit")
        sys.exit(1)
    weights_bytes = llama["bytes"]
    kv_bytes = 131072 * 1024  # 32 L x 8 kv heads x 128 dim x 2 x fp16, at 1024 ctx
    bpt = weights_bytes + kv_bytes
    fitted = {}
    for device_id, (bw, bw_source) in DEVICE_BANDWIDTH.items():
        tps = bench["decode"].get(device_id)
        if tps is None:
            continue
        eff = tps * bpt / (bw * 1e9)
        fitted[device_id] = {
            "efficiency": round(eff, 4),
            "measuredTokS": tps,
            "bandwidthGbps": bw,
            "bandwidthSource": bw_source,
            "basis": f"fitted from measured {tps} tok/s (Llama 3 8B Q4_K_M, 1024-token generation; XiongjieDai llama.cpp campaign, 2024-05-13)",
        }
        print(f"    {device_id:28s} bw={bw:7.2f} measured={tps:8.2f} tok/s -> efficiency={eff:.3f}")
    (DATA / "efficiencies.json").write_text(
        json.dumps(
            {
                "retrieved": RETRIEVED,
                "method": "efficiency = measured_tok_s * (weights_bytes + kv_bytes(ctx=1024)) / peak_bandwidth_bytes_per_s",
                "anchor": "Llama 3 8B Q4_K_M decode, XiongjieDai GPU-Benchmarks (2024-05-13); weights size cross-verified from the HF API",
                "devices": fitted,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"  wrote {len(fitted)} fitted efficiencies to sim/data/efficiencies.json")


if __name__ == "__main__":
    main()
