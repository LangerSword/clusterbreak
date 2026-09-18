#!/usr/bin/env python3
"""
Clusterbreak hardware probe — prints THIS machine as a rig JSON you can paste
into the app ("IMPORT RIG"). Reads only local system state; no data leaves the
machine. Bandwidth values are not detectable from hardware, so the app matches
device names against its catalog (or you type them into the custom-device form).

Usage:  python3 tools/detect_hardware.py
"""

import json
import os
import platform
import re
import shutil
import subprocess
import sys


def run(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=15).stdout.strip()
    except Exception:
        return ""


def detect_nvidia() -> list[dict]:
    if not shutil.which("nvidia-smi"):
        return []
    out = run(
        [
            "nvidia-smi",
            "--query-gpu=name,memory.total,compute_cap",
            "--format=csv,noheader,nounits",
        ]
    )
    gpus = []
    for line in out.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2:
            try:
                mem_gb = round(float(parts[1]) / 1024, 1)
            except ValueError:
                mem_gb = None
            gpus.append({"kind": "gpu", "name": parts[0], "memoryGb": mem_gb, "computeCap": parts[2] if len(parts) > 2 else None})
    return gpus


def detect_apple() -> list[dict]:
    if platform.system() != "Darwin":
        return []
    name = run(["sysctl", "-n", "machdep.cpu.brand_string"]) or "Apple Silicon"
    mem = run(["sysctl", "-n", "hw.memsize"])
    mem_gb = round(int(mem) / 1e9, 1) if mem.isdigit() else None
    chip = run(["sysctl", "-n", "hw.model"])
    return [{"kind": "unified", "name": f"{name} ({chip})", "memoryGb": mem_gb}]


def detect_ram_gb() -> float | None:
    try:
        if platform.system() == "Darwin":
            out = run(["sysctl", "-n", "hw.memsize"])
            return round(int(out) / 1e9, 1) if out.isdigit() else None
        with open("/proc/meminfo") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    kb = int(re.findall(r"\d+", line)[0])
                    return round(kb / 1e6, 1)
    except Exception:
        pass
    return None


def detect_cpu() -> dict:
    model = ""
    if platform.system() == "Linux":
        try:
            with open("/proc/cpuinfo") as fh:
                for line in fh:
                    if line.lower().startswith("model name"):
                        model = line.split(":", 1)[1].strip()
                        break
        except Exception:
            pass
    model = model or platform.processor() or "unknown CPU"
    return {"name": model, "cores": os.cpu_count()}


def main() -> None:
    gpus = detect_nvidia() + detect_apple()
    rig = {
        "schema": "clusterbreak.rig/v1",
        "detectedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "host": platform.node(),
        "os": f"{platform.system()} {platform.release()}",
        "cpu": detect_cpu(),
        "ramGb": detect_ram_gb(),
        "gpus": gpus,
        "note": "Bandwidth is not detectable from hardware; the app matches names against its catalog or you enter it in the custom-device form.",
    }
    json.dump(rig, sys.stdout, indent=2)
    print()
    if not gpus:
        print("(no GPU detected — CPU-only rig)", file=sys.stderr)


if __name__ == "__main__":
    main()
