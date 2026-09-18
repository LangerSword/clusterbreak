#!/usr/bin/env python3
"""Battery test for the clusterbreak runs API (positive + negative cases)."""
import json
import urllib.request
import urllib.error

BASE = "https://wa7rwqxhk0.execute-api.ap-south-1.amazonaws.com"
results = []


def call(method, path, body=None, raw_body=None):
    data = raw_body if raw_body is not None else (json.dumps(body).encode() if body else None)
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"content-type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, dict(res.headers), res.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS" if ok else "FAIL"), name, ("— " + detail) if detail and not ok else "")


# 1. health
s, _, b = call("GET", "/health")
check("health 200 + current version", s == 200 and b"0.2" in b, f"{s} {b[:80]}")

# 2. preflight
s, h, _ = call("OPTIONS", "/runs")
check("OPTIONS preflight 204 + allow-methods", s == 204 and "POST" in h.get("access-control-allow-methods", ""), f"{s} {h.get('access-control-allow-methods')}")

# 3. valid POST
report = json.load(open("/tmp/report.json"))
s, _, b = call("POST", "/runs", body=report)
ok = s == 201
run_id = None
if ok:
    run_id = json.loads(b).get("id")
check("POST /runs valid → 201 + id", ok and bool(run_id), f"{s} {b[:120]}")

# 4. GET it back
if run_id:
    s, _, b = call("GET", f"/runs/{run_id}")
    got = json.loads(b) if s == 200 else {}
    check(
        "GET /runs/{id} returns the stored report",
        s == 200 and got.get("report", {}).get("v") == 1 and got["report"]["preset"] == "dual-3090",
        f"{s} {b[:120]}",
    )

# 5. missing id → 404
s, _, b = call("GET", "/runs/doesnotexist")
check("GET unknown id → 404", s == 404, f"{s} {b[:80]}")

# 6. bad id shape → 400
s, _, b = call("GET", "/runs/!!badID!!")
check("GET malformed id → 400", s == 400, f"{s} {b[:80]}")

# 7. invalid report (v:2) → 400
s, _, b = call("POST", "/runs", body={"v": 2, "rig": {}, "model": {}, "outcome": {}, "verdict": "x"})
check("POST invalid report → 400", s == 400, f"{s} {b[:80]}")

# 8. oversized → 413
s, _, b = call("POST", "/runs", raw_body=b'{"v":1,"pad":"' + b"x" * 9000 + b'"}')
check("POST oversized body → 413", s == 413, f"{s} {b[:80]}")

# 9. wrong method → 404 (no route)
s, _, b = call("DELETE", "/runs")
check("DELETE /runs → 404", s == 404, f"{s} {b[:80]}")

print(f"\n{sum(results)}/{len(results)} API checks passed")
raise SystemExit(0 if all(results) else 1)
