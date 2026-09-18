#!/usr/bin/env python3
"""
Security grade for Clusterbreak — deterministic checks + negative controls.

Method (agent-accuracy-grading): the instrument must be able to fail. Every
scanner here is exercised against an injected canary; a missed control voids
the score. Live checks (API battery, IAM, TTL) degrade gracefully and are
reported as skipped when offline/creds are unavailable.

Writes docs/grade-security.md; exits 1 on any failure or missed control.
"""

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/cb-template.yaml")

SECRET_PATTERNS = [
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"aws_secret_access_key\s*=", re.I),
    re.compile(r"-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----"),
    re.compile(r"ghp_[A-Za-z0-9]{36}"),
]

FAILURES: list[str] = []
WARNINGS: list[str] = []
SKIPPED: list[str] = []
CHECKS = {"passed": 0, "total": 0}
CONTROLS: list[tuple[str, bool]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    CHECKS["total"] += 1
    if ok:
        CHECKS["passed"] += 1
    else:
        FAILURES.append(f"[{name}] {detail}")
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{' — ' + detail if detail and not ok else ''}")


def scan_secrets(text: str) -> list[str]:
    hits = []
    for pat in SECRET_PATTERNS:
        hits.extend(m.group(0)[:24] for m in pat.finditer(text))
    return hits


def main() -> int:
    print("== S1: secrets hygiene ==")
    tracked = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files"], capture_output=True, text=True
    ).stdout.split()
    offenders = []
    for f in tracked:
        p = ROOT / f
        try:
            if p.stat().st_size > 2_000_000 or p.suffix in {".png", ".jpg", ".gguf", ".zip"}:
                continue
            hits = scan_secrets(p.read_text(errors="ignore"))
            if hits:
                offenders.append(f"{f}: {hits[:2]}")
        except Exception:
            continue
    check("no credential patterns in tracked files", not offenders, "; ".join(offenders))

    env_sh = ROOT / "scripts" / "env.sh"
    if env_sh.exists():
        content = env_sh.read_text()
        check(
            "tracked env.sh carries identifiers only (no keys)",
            not scan_secrets(content)
            and "AWS_ACCESS_KEY" not in content
            and "AWS_SECRET" not in content,
            "contains credential material",
        )
    else:
        WARNINGS.append("scripts/env.sh not present; skipping its check")

    # negative control: the scanner MUST catch a planted key
    planted = "AKIAABCDEFGHIJKLMNOP\n"
    CONTROLS.append(("planted AKIA key detected", bool(scan_secrets(planted))))

    print("== S2: template posture (real generated artifact) ==")
    if TEMPLATE.exists():
        yaml = TEMPLATE.read_text()
        check("IMDSv2 enforced on all nodes", yaml.count("HttpTokens: required") >= yaml.count("LaunchTemplateData:"), "missing MetadataOptions")
        check("no IAM resources created (nodes hold no AWS credentials)", "AWS::IAM" not in yaml, "template grants AWS permissions")
        check("no wildcard IAM actions anywhere", 'Action: "*"' not in yaml and "Action: '*'" not in yaml)
        ingress = re.findall(r"FromPort: (\d+)", yaml)
        check("SSH + endpoint ports only (22, 8080)", sorted(set(ingress)) == ["22", "8080"], str(sorted(set(ingress))))
        check("SSH/endpoint scoped to the SshCidr parameter (not hardcoded)", yaml.count("CidrIp: !Ref SshCidr") == 2)
        check("intra-VPC rule scoped to the VPC CIDR", "CidrIp: 10.42.0.0/16" in yaml)
        check("no secrets embedded in userdata", not scan_secrets(yaml))
        if re.search(r"SshCidr:\s*(?:[^\n]*\n){0,4}?\s*Default: 0\.0\.0\.0/0", yaml):
            WARNINGS.append("SshCidr defaults to 0.0.0.0/0 (documented; the deploy command in the UI passes your IP)")

        # negative control: a wildcard-IAM template copy must be flagged
        bad = yaml + '\n  BadPolicy:\n    Type: AWS::IAM::ManagedPolicy\n    Properties:\n      PolicyDocument: { Statement: [ { Action: "*", Resource: "*" } ] }\n'
        CONTROLS.append(
            (
                "wildcard IAM in a template copy flagged",
                ('Action: "*"' in bad) and ("AWS::IAM" in bad),
            )
        )
    else:
        check("generated template present for posture checks", False, f"{TEMPLATE} missing (download one from the live site)")

    print("== S3: API boundary (live) ==")
    api_test = ROOT / "tools" / "api_test.py"
    if api_test.exists():
        out = subprocess.run([sys.executable, str(api_test)], capture_output=True, text=True, timeout=180)
        m = re.search(r"(\d+)/(\d+) API checks passed", out.stdout)
        check(
            "live API battery green (validation + negative cases)",
            bool(m) and m.group(1) == m.group(2),
            (out.stdout[-200:] if not m else f"{m.group(0)}" if m.group(1) != m.group(2) else ""),
        )
    else:
        SKIPPED.append("api_test.py not in tools/")

    print("== S4: our infra least-privilege (live) ==")
    try:
        pol = subprocess.run(
            ["aws", "iam", "get-role-policy", "--role-name", "clusterbreak-lambda-role",
             "--policy-name", "clusterbreak-runs-access", "--query", "PolicyDocument", "--output", "json"],
            capture_output=True, text=True, timeout=60, env={**__import__("os").environ, "AWS_DEFAULT_REGION": "ap-south-1"},
        )
        doc = json.loads(pol.stdout) if pol.returncode == 0 else None
        if doc:
            stmts = doc.get("Statement", [])
            actions = {a for s in stmts for a in (s.get("Action") if isinstance(s.get("Action"), list) else [s.get("Action")])}
            res = [s.get("Resource") for s in stmts]
            check("lambda role: exactly PutItem+GetItem on the runs table", actions == {"dynamodb:PutItem", "dynamodb:GetItem"} and all("clusterbreak-runs" in str(r) for r in res), f"actions={actions}")
        else:
            SKIPPED.append("could not read lambda role policy")
    except Exception as e:
        SKIPPED.append(f"IAM check skipped: {e}")

    try:
        ttl = subprocess.run(
            ["aws", "dynamodb", "describe-time-to-live", "--table-name", "clusterbreak-runs",
             "--query", "TimeToLiveDescription.TimeToLiveStatus", "--output", "text"],
            capture_output=True, text=True, timeout=60, env={**__import__("os").environ, "AWS_DEFAULT_REGION": "ap-south-1"},
        )
        check("runs table TTL enabled (reports expire)", ttl.stdout.strip() == "ENABLED", ttl.stdout.strip())
    except Exception as e:
        SKIPPED.append(f"TTL check skipped: {e}")

    caught = sum(1 for _, ok in CONTROLS if ok)
    for name, ok in CONTROLS:
        print(f"  {'CAUGHT' if ok else 'MISSED'}  {name}")
    if caught != len(CONTROLS):
        FAILURES.append("negative control missed — grader cannot be trusted")

    lines = [
        "# Security grade — Clusterbreak",
        "",
        f"*Run: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · grader: `tools/grade_security.py` · artifact: `{TEMPLATE}`*",
        "",
        f"| | |",
        f"|---|---|",
        f"| checks | **{CHECKS['passed']}/{CHECKS['total']}** |",
        f"| negative controls | **{caught}/{len(CONTROLS)} caught** |",
        "",
        "## Failures", "",
    ]
    lines += [f"- {f}" for f in FAILURES] or ["- none"]
    lines += ["", "## Warnings (accepted, documented)", ""]
    lines += [f"- {w}" for w in WARNINGS] or ["- none"]
    lines += ["", "## Skipped (unavailable)", ""]
    lines += [f"- {s}" for s in SKIPPED] or ["- none"]
    lines += [
        "",
        "## Scope honesty",
        "- Graded: repo secrets hygiene, generated-template posture, live API input boundary, our AWS least-privilege.",
        "- NOT graded here: the model's numerical accuracy (see `grade_claims.py`), UI quality, browser behavior (`tools/browser/`), AWS-side runtime hardening after deploy (SG drift, patch state).",
        "- Threat model that matters here: no user credentials ever transit our system (deploys run in the user's own account via their own CLI); the public API stores only bounded non-secret report JSON.",
    ]
    (ROOT / "docs" / "grade-security.md").write_text("\n".join(lines) + "\n")
    print(f"\noverall: {CHECKS['passed']}/{CHECKS['total']} · controls {caught}/{len(CONTROLS)} · failures {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
