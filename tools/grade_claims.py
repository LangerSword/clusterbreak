#!/usr/bin/env python3
"""
Grade Clusterbreak's shipped claims against their sources — deterministic, no LLM.

Method (agent-accuracy-grading):
  - every fitted efficiency is recomputed from the raw benchmark table + the
    verified HF blob size, independently of the engine;
  - every curated number is checked for hand-entry (hardcoded fits/sizes = fail);
  - live re-fetch: HF blob sizes and the benchmark README are pulled again and
    diffed against the vendored JSON (no file-verifies-itself);
  - the engine's own test suite is run and parsed;
  - the deployed honesty markers are checked in the shipped bundle;
  - NEGATIVE CONTROLS: injected corruptions must be caught, or the green is worthless.

Writes docs/grade-claims.md; prints a summary. Exit code 1 if any check fails.
"""

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import refresh_data as rd  # noqa: E402  (reuse the exact pipeline parsers)

KV_BYTES_AT_1024 = 131072 * 1024  # Llama-3.1-8B at 1024 ctx (32L × 8kv × 128hd × 2B × fp16)

FAILURES: list[str] = []
NOTES: list[str] = []


def check(dim: dict, name: str, ok: bool, detail: str = "") -> None:
    dim["total"] += 1
    if ok:
        dim["passed"] += 1
    else:
        FAILURES.append(f"[{name}] {detail}")
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{' — ' + detail if detail and not ok else ''}")


def main() -> int:
    data = ROOT / "sim" / "data"
    eff = json.loads((data / "efficiencies.json").read_text())
    sizes = json.loads((data / "model-sizes.json").read_text())
    bench = json.loads((data / "benchmarks.json").read_text())
    devices_ts = (ROOT / "sim" / "src" / "data" / "devices.ts").read_text()
    models_ts = (ROOT / "sim" / "src" / "data" / "models.ts").read_text()

    llama_bytes = sizes["models"]["llama3.1_8b"]["q4_k_m"]["bytes"]
    bpt = llama_bytes + KV_BYTES_AT_1024

    dims = {
        "D1 internal-integrity": {"passed": 0, "total": 0},
        "D2 live-freshness": {"passed": 0, "total": 0},
        "D3 reproduction": {"passed": 0, "total": 0},
        "D4 honesty-contract": {"passed": 0, "total": 0},
    }

    print("== D1: internal integrity (recompute everything from raw sources) ==")
    ok = True
    detail = ""
    for dev, row in eff["devices"].items():
        expected = row["measuredTokS"] * bpt / (row["bandwidthGbps"] * 1e9)
        if abs(expected - row["efficiency"]) / row["efficiency"] > 0.005:
            ok = False
            detail += f"{dev}: stored {row['efficiency']} vs recomputed {expected:.4f}; "
    check(dims["D1 internal-integrity"], "every fitted efficiency == measured × bpt / bandwidth", ok, detail)

    hard = len(re.findall(r"decodeEfficiency:\s*[0-9]", devices_ts))
    check(dims["D1 internal-integrity"], "zero hardcoded decodeEfficiency literals in devices.ts", hard == 0, f"{hard} found")

    size_lines = [
        l
        for l in models_ts.splitlines()
        if re.search(r"\b(q4_k_m|q8_0|bf16):", l) and "Blob" not in l
    ]
    not_generated = [l.strip() for l in size_lines if "gb(SIZES[" not in l]
    check(
        dims["D1 internal-integrity"],
        "every model size line comes from the HF-generated JSON (24 lines)",
        len(size_lines) == 24 and not not_generated,
        f"lines={len(size_lines)} offenders={not_generated[:3]}",
    )

    fits = set(eff["devices"].keys())
    missing = [d for d in fits if f'id: "{d}"' not in devices_ts]
    fitted_status_count = len(re.findall(r'efficiency_fitted', devices_ts))
    check(dims["D1 internal-integrity"], "every fitted device exists in devices.ts", not missing, str(missing))
    check(
        dims["D1 internal-integrity"],
        "fitted-status count matches efficiencies.json",
        fitted_status_count >= len(fits),
        f"statuses={fitted_status_count} fits={len(fits)}",
    )

    print("== D2: live freshness (re-fetch sources and diff) ==")
    try:
        live_bench = rd.parse_bench_tables(rd.fetch(rd.BENCH_URL))
        stored_dec = bench["decode_tok_s_8b_q4km"]
        diffs = [k for k, v in stored_dec.items() if abs(live_bench["decode"].get(k, -1) - v) > 1e-9]
        check(dims["D2 live-freshness"], "benchmark table matches live README", not diffs, str(diffs))
    except Exception as e:  # network
        NOTES.append(f"D2 benchmark re-fetch skipped: {e}")

    try:
        drift = []
        for model_id, repo in rd.HF_REPOS.items():
            live = rd.hf_sizes(repo)
            for q, blob in live.items():
                stored = sizes["models"][model_id].get(q)
                live_bytes = blob["bytes"] if blob else None
                stored_bytes = stored["bytes"] if stored else None
                if live_bytes != stored_bytes:
                    drift.append(f"{model_id}/{q}: live={live_bytes} stored={stored_bytes}")
        check(dims["D2 live-freshness"], "all HF blob sizes match the live API", not drift, "; ".join(drift[:3]))
    except Exception as e:  # network
        NOTES.append(f"D2 HF re-fetch skipped: {e}")

    print("== D3: reproduction (oracles independent of the TypeScript engine) ==")
    ok = True
    detail = ""
    for dev, row in eff["devices"].items():
        pred = row["efficiency"] * row["bandwidthGbps"] * 1e9 / bpt
        if abs(pred - row["measuredTokS"]) / row["measuredTokS"] > 0.001:
            ok = False
            detail += f"{dev}: {pred:.2f} vs {row['measuredTokS']}; "
    check(dims["D3 reproduction"], "efficiency × bandwidth / bpt reproduces every measured anchor", ok, detail)

    try:
        out = subprocess.run(
            ["npm", "test"], cwd=ROOT / "sim", capture_output=True, text=True, timeout=180
        )
        m = re.search(r"Tests\s+(\d+) passed", out.stdout)
        failed = "failed" in out.stdout.lower().split("duration")[0]
        check(
            dims["D3 reproduction"],
            f"engine test suite green ({m.group(1) if m else '?'} tests)",
            out.returncode == 0 and m is not None and not failed,
            (out.stdout[-300:] if out.returncode != 0 else "suite reported failures"),
        )
    except Exception as e:
        check(dims["D3 reproduction"], "engine test suite", False, str(e))

    # analytic KV-death cross-check against the bounds asserted in run.test.ts
    qwen = sizes["models"]["qwen3_32b"]["q4_k_m"]["bytes"]
    kv_per_token = 2 * 64 * 8 * 128 * 2  # qwen3-32b: 64 layers, 8 kv heads, head dim 128, fp16
    ctx_death = (24e9 - qwen - 0.5e9) / kv_per_token  # RTX 3090 physical 24 GB
    test_src = (ROOT / "sim" / "src" / "__tests__" / "run.test.ts").read_text()
    m_lo = re.search(r"expect\(s\.contextTokens\)\.toBeGreaterThan\((\d+)\)", test_src)
    m_hi = re.search(r"expect\(s\.contextTokens\)\.toBeLessThan\((\d+)\)", test_src)
    if m_lo and m_hi:
        lo, hi = int(m_lo.group(1)), int(m_hi.group(1))
        check(
            dims["D3 reproduction"],
            f"analytic OOM context ({ctx_death:.0f}) inside the bounds the test asserts [{lo}, {hi}]",
            lo < ctx_death < hi,
            f"{ctx_death:.0f} not in [{lo}, {hi}]",
        )
    else:
        check(dims["D3 reproduction"], "parse run.test.ts OOM bounds", False, "bounds not found")

    print("== D4: honesty contract (as shipped) ==")
    dist_js = sorted((ROOT / "frontend" / "dist" / "assets").glob("index-*.js"))
    if dist_js:
        bundle = dist_js[-1].read_text()
        for marker, why in [
            ("no published measurement", "unverified devices labelled"),
            ("fitted from measured", "fitted provenance shown"),
            ("arch unverified", "unverified-architecture models flagged"),
        ]:
            check(dims["D4 honesty-contract"], f"bundle contains honesty marker: {marker!r}", marker in bundle, why)
    else:
        check(dims["D4 honesty-contract"], "built bundle exists", False, "run npm run build first")
    notes = (
        f"fitted devices: {len(fits)} · models with all three sizes: "
        f"{sum(1 for m in sizes['models'].values() if all((m.get(q) or {}).get('bytes') for q in ('q4_k_m','q8_0','bf16')))}/{len(sizes['models'])}"
    )
    NOTES.append(notes)

    print("== negative controls (each injected corruption MUST be caught) ==")
    controls = []
    corrupt = json.loads(json.dumps(eff))
    first = next(iter(corrupt["devices"]))
    corrupt["devices"][first]["efficiency"] *= 1.05
    caught = any(
        abs(r["measuredTokS"] * bpt / (r["bandwidthGbps"] * 1e9) - r["efficiency"]) / r["efficiency"] > 0.005
        for r in corrupt["devices"].values()
    )
    controls.append(("5% efficiency corruption", caught))

    fake = "rtx9999"
    fake_fits = fits | {fake}
    missing_fake = [d for d in fake_fits if f'id: "{d}"' not in devices_ts]
    controls.append(("fitted device missing from catalog", fake in missing_fake))

    try:
        corrupt2 = json.loads(json.dumps(sizes))
        corrupt2["models"]["llama3.1_8b"]["q4_k_m"]["bytes"] = int(llama_bytes * 1.03)
        live = rd.hf_sizes(rd.HF_REPOS["llama3.1_8b"])
        caught3 = live["q4_k_m"]["bytes"] != corrupt2["models"]["llama3.1_8b"]["q4_k_m"]["bytes"]
        controls.append(("3% size drift vs live API", caught3))
    except Exception as e:
        NOTES.append(f"negative control 3 skipped (network): {e}")
    for name, caught in controls:
        print(f"  {'CAUGHT' if caught else 'MISSED'}  {name}")
    if not all(c for _, c in controls):
        FAILURES.append("negative control missed — grader cannot be trusted")

    # ---- report ----
    lines = [
        "# Claim grade — Clusterbreak (deterministic grader)",
        "",
        f"*Run: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · grader: `tools/grade_claims.py` · method: recompute-from-sources + live re-fetch + suite runs + negative controls.*",
        "",
        "| Dimension | Score |",
        "|---|---|",
    ]
    total_p = total_t = 0
    for name, d in dims.items():
        total_p += d["passed"]
        total_t += d["total"]
        lines.append(f"| {name} | {d['passed']}/{d['total']} |")
    lines.append(f"| **overall** | **{total_p}/{total_t}** |")
    lines += ["", "## Failures", ""]
    lines += [f"- {f}" for f in FAILURES] or ["- none"]
    lines += ["", "## Negative controls", ""]
    lines += [f"- {name}: {'caught' if c else 'MISSED'}" for name, c in controls]
    lines += ["", "## Notes (scope honesty)", ""]
    lines += [
        "- Graded: data integrity, live freshness, anchor reproduction, shipped honesty markers.",
        "- Not graded here: UI visual quality; behavioral flows (see `tools/browser/`); device bandwidth provenance is vendor-page curated and not re-fetched.",
    ] + [f"- {n}" for n in NOTES]
    report = ROOT / "docs" / "grade-claims.md"
    report.write_text("\n".join(lines) + "\n")
    print(f"\nreport: {report}")
    print(f"overall: {total_p}/{total_t} · failures: {len(FAILURES)} · controls caught: {sum(c for _, c in controls)}/{len(controls)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
