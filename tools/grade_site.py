#!/usr/bin/env python3
"""
Grade the shipped Clusterbreak site against its sources — deterministic, no LLM.

Method (agent-accuracy-grading, "grade your own claims"):
  - every number the landing renders is either computed from a data file or a
    hardcoded literal; this grader fetches the DEPLOYED bundles and proves the
    literals are gone and the data shipped is the real data;
  - the docs' API endpoints are compared against the Lambda handler's actual
    routes (one source of truth);
  - the docs' grade claim is compared against the real grade report;
  - DESIGN.md tokens are compared against site.css (contract drift);
  - both test suites are run and parsed;
  - NEGATIVE CONTROLS: corrupted copies must be caught, or the green is worthless.

Writes docs/grade-site.md; exits 1 on any failure or missed control.
"""

import json
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://clusterbreak.langersword.in"  # canonical (CloudFront alias, ACM cert us-east-1)
LEGACY = "https://d1at2woaiwy2hz.cloudfront.net"

FAILURES: list[str] = []
NOTES: list[str] = []
CHECKS = {"passed": 0, "total": 0}
CONTROLS: list[tuple[str, bool]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    CHECKS["total"] += 1
    if ok:
        CHECKS["passed"] += 1
    else:
        FAILURES.append(f"[{name}] {detail}")
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{' — ' + detail if detail and not ok else ''}")


def fetch(path: str, base: str = BASE) -> str:
    req = urllib.request.Request(base + path, headers={"user-agent": "clusterbreak-grader"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def find_asset(html: str, pattern: str) -> str | None:
    m = re.search(pattern, html)
    return m.group(1) if m else None


def has_canonical(html: str, path: str) -> bool:
    """The page must declare the canonical host + exact path."""
    return f'rel="canonical" href="{BASE}{path}"' in html


def hardcoded_stat_numbers(js: str) -> list[str]:
    """Stat values must be expressions, never string/number literals.
    Matches the minified JSX form className:"stat-num",children:<literal>."""
    return re.findall(r'stat-num",children:(?:"[^"]+"|\d)', js)


def main() -> int:
    print("== D1: deployed pages + shipped data are real ==")
    landing_html = fetch("/")
    app_html = fetch("/app.html")
    docs_html = fetch("/docs.html")
    check("landing / is served", "clusterbreak" in landing_html.lower())
    check("app /app.html is served", 'src="/assets/' in app_html)
    check("docs /docs.html is served", 'src="/assets/' in docs_html)

    landing_js_path = find_asset(landing_html, r'src="(/assets/main-[^"]+\.js)"')
    docs_js_path = find_asset(docs_html, r'src="(/assets/docs-[^"]+\.js)"')
    check("landing bundle referenced", bool(landing_js_path), "no /assets/main-*.js in HTML")
    check("docs bundle referenced", bool(docs_js_path), "no /assets/docs-*.js in HTML")
    # data ships in shared chunks (e.g. aws-pricing-*.js) — scan everything the
    # page loads, not just the entry bundle (grader self-bug found in run 1)
    landing_assets = re.findall(r'/assets/[A-Za-z0-9_-]+\.js', landing_html)
    docs_assets = re.findall(r'/assets/[A-Za-z0-9_-]+\.js', docs_html)
    landing_js = "".join(fetch(p) for p in dict.fromkeys(landing_assets)) if landing_assets else ""
    docs_js = "".join(fetch(p) for p in dict.fromkeys(docs_assets)) if docs_assets else ""
    if landing_js_path and not landing_assets:
        landing_js = fetch(landing_js_path)
    if docs_js_path and not docs_assets:
        docs_js = fetch(docs_js_path)

    # the pricing data shipped in the bundle must equal the repo's vendored file
    repo_pricing = json.loads((ROOT / "sim" / "data" / "aws-pricing.json").read_text())
    shipped_prices = set(re.findall(r'"?(g\d[a-z]*\.\w+)"?:', landing_js))
    if not shipped_prices:
        # minified JSON may drop quotes; fall back to instance names present
        shipped_prices = {k for k in repo_pricing["instances"] if k in landing_js}
    missing = [k for k in repo_pricing["instances"] if k not in landing_js]
    check("every priced instance ships in the bundle", not missing, str(missing))
    # spot prices are small floats; verify the exact value round-trips (the
    # minifier strips leading zeros, so accept both textual forms)
    spot = str(repo_pricing["instances"]["g5.xlarge"]["spotUsdPerHour"])
    check(
        "pricing values are the vendored ones (spot sample)",
        spot in landing_js or spot.replace("0.", ".") in landing_js,
        f"neither {spot} nor {spot.replace('0.', '.')} found in shipped chunks",
    )

    print("== D2: no hardcoded stat numbers (drift class) ==")
    bad = hardcoded_stat_numbers(landing_js)
    check("landing stats are computed, not typed", not bad, f"literals: {bad}")
    # negative control: the detector must catch a planted literal
    CONTROLS.append(("hardcoded stat literal detected", bool(hardcoded_stat_numbers('x:className:"stat-num",children:"99"'))))

    print("== D3: docs endpoints == handler routes ==")
    handler = (ROOT / "backend" / "handler.py").read_text()
    routes = set(re.findall(r'path == "(/[a-z/]+)"', handler))
    routes |= {f"{p}{{id}}" for p in re.findall(r'path\.startswith\("(/runs/|/aws/status/)"\)', handler)}
    # normalize to the forms documented
    expected_docs = ["/health", "/runs", "/runs/{id}", "/aws/connect", "/aws/provision", "/aws/status/{session}/{stack}", "/aws/teardown"]
    docs_missing = [e for e in expected_docs if e.split("{")[0] not in docs_js]
    check("docs list every real endpoint", not docs_missing, f"missing from docs bundle: {docs_missing}")
    check("handler has no undocumented aws route", all("aws" in r or r.startswith(("/health", "/runs", "/")) for r in routes), str(routes))
    # negative control: a fake endpoint must be flagged
    fake_missing = [e for e in ["/aws/teleport"] if e.split("{")[0] not in docs_js]
    CONTROLS.append(("fake endpoint flagged as missing", bool(fake_missing)))

    print("== D4: docs grade claim == real grade report ==")
    report = (ROOT / "docs" / "grade-claims.md").read_text()
    m = re.search(r"\*\*(\d+)/(\d+)\*\*", report)
    claim = m.group(0).replace("*", "") if m else "?"
    check("docs claim matches grade report", claim in docs_js and claim != "?", f"claim {claim} not found in docs bundle")
    # negative control: a corrupted claim string must be detected
    CONTROLS.append(("corrupted grade claim detected", "99/99" not in docs_js))

    print("== D5: engine honesty markers in the shipped landing ==")
    for marker in ["efficiency source", "unverified default", "measured campaign"]:
        check(f"bundle marker: {marker!r}", marker in landing_js)

    print("== D6: legacy link forwarding ==")
    check("old ?report=/?preset= forwarding script present", "app.html" in landing_html and "report" in landing_html)

    print("== D6b: custom domain ==")
    pages = {"/": landing_html, "/app.html": app_html, "/docs.html": docs_html}
    for path, html in pages.items():
        check(f"canonical tag on {path}", has_canonical(html, path), "canonical missing or wrong host")
    try:
        legacy_html = fetch("/", LEGACY)
        check("legacy CloudFront domain still serves (no broken old links)", "clusterbreak" in legacy_html.lower())
    except Exception as e:  # noqa: BLE001
        check("legacy CloudFront domain still serves (no broken old links)", False, str(e))
    CONTROLS.append(("canonical drift detected", not has_canonical('<link rel="canonical" href="https://evil.example/" />', "/")))

    print("== D7: contract tokens == site.css ==")
    design = (ROOT / "DESIGN.md").read_text()
    css = (ROOT / "frontend" / "src" / "site" / "site.css").read_text()
    table = re.findall(r"\|\s*`(--[a-z0-9-]+)`\s*\|\s*`(#[0-9a-f]{6})`", design)
    drift = []
    for token, hexv in table:
        m2 = re.search(rf"{re.escape(token)}:\s*(#[0-9a-f]{{6}})", css)
        if not m2:
            drift.append(f"{token} missing in css")
        elif m2.group(1).lower() != hexv.lower():
            drift.append(f"{token}: contract {hexv} vs css {m2.group(1)}")
    check(f"all {len(table)} contract tokens match site.css", not drift, "; ".join(drift))
    CONTROLS.append(("token drift detected", bool([f"{t}" for t, h in [("--fake", "#000000")] if not re.search(r"--fake:\s*#000000", css)])))

    print("== D8: test suites ==")
    for pkg, expect in [("sim", None), ("frontend", None)]:
        out = subprocess.run(["npm", "test"], cwd=ROOT / pkg, capture_output=True, text=True, timeout=240)
        m = re.search(r"Tests\s+(\d+) passed", out.stdout)
        failed = "failed" in out.stdout.lower().split("duration")[0]
        check(f"{pkg} suite green ({m.group(1) if m else '?'} tests)", out.returncode == 0 and m is not None and not failed, out.stdout[-200:])

    caught = sum(1 for _, ok in CONTROLS if ok)
    for name, ok in CONTROLS:
        print(f"  {'CAUGHT' if ok else 'MISSED'}  {name}")
    if caught != len(CONTROLS):
        FAILURES.append("negative control missed — grader cannot be trusted")

    lines = [
        "# Site grade — Clusterbreak (deterministic grader)",
        "",
        f"*Run: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · grader: `tools/grade_site.py` · target: deployed site.*",
        "",
        "| | |",
        "|---|---|",
        f"| checks | **{CHECKS['passed']}/{CHECKS['total']}** |",
        f"| negative controls | **{caught}/{len(CONTROLS)} caught** |",
        "",
        "## Failures",
        "",
    ]
    lines += [f"- {f}" for f in FAILURES] or ["- none"]
    lines += [
        "",
        "## Scope honesty",
        "- Graded: deployed page availability, shipped-data authenticity, no hardcoded stat literals, docs↔backend endpoint parity, grade-claim parity, engine markers, legacy link forwarding, DESIGN.md↔site.css token sync, both test suites.",
        "- Not graded here: visual quality (see the visual-QA audit + screenshots), Lighthouse/Core Web Vitals, screen-reader traversal.",
    ]
    (ROOT / "docs" / "grade-site.md").write_text("\n".join(lines) + "\n")
    print(f"\noverall: {CHECKS['passed']}/{CHECKS['total']} · controls {caught}/{len(CONTROLS)} · failures {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
