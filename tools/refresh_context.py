#!/usr/bin/env python3
"""Verified context windows, one row per model, straight from the model's own GGUF metadata.

Source: Hugging Face model API `?expand[]=gguf` -> `gguf.context_length`. This is the
field llama.cpp itself reads from the file header, so it is the number that governs
what a provisioned rig can actually load - not a marketing figure from a model card.

Writes sim/data/model-context.json. Re-run with: python3 tools/refresh_context.py
"""
import json
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SIZES = ROOT / "sim" / "data" / "model-sizes.json"
OUT = ROOT / "sim" / "data" / "model-context.json"


def get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"user-agent": "clusterbreak-data"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main() -> None:
    sizes = json.loads(SIZES.read_text())
    out: dict = {
        "retrieved": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "method": (
            "Hugging Face model API ?expand[]=gguf -> gguf.context_length, per repo in "
            "model-sizes.json. This is the model's own GGUF metadata (the field llama.cpp "
            "reads from the file header), so it is what a provisioned instance can load."
        ),
        "models": {},
    }
    for mid, entry in sizes["models"].items():
        repo = (entry or {}).get("repo")
        if not repo:
            print(f"  {mid}: no repo, skipped")
            continue
        try:
            d = get(f"https://huggingface.co/api/models/{repo}?expand[]=gguf")
            g = d.get("gguf") or {}
            ctx = g.get("context_length")
            out["models"][mid] = {
                "repo": repo,
                "contextLength": ctx,
                "architecture": g.get("architecture"),
            }
            print(f"  {mid}: {ctx:,} tokens  ({g.get('architecture')})" if ctx else f"  {mid}: no context_length")
        except Exception as e:  # noqa: BLE001 - report and keep going
            out["models"][mid] = {"repo": repo, "contextLength": None, "error": str(e)[:160]}
            print(f"  {mid}: FAILED {e!r}")
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"\nwrote {OUT.relative_to(ROOT)} ({len(out['models'])} rows)")


if __name__ == "__main__":
    main()
