"""Clusterbreak API — AWS Lambda handler (API Gateway HTTP API, payload v2).

Routes (v0.2):
  GET  /            -> service banner
  GET  /health      -> liveness + service metadata
  POST /runs        -> validate + store a run report; returns {"id": ...}
  GET  /runs/{id}   -> fetch a stored report
  everything else   -> 404 JSON

Storage: DynamoDB `clusterbreak-runs` (PK `id`, TTL `expiresAt`), on-demand.
Reports are small bounded JSON documents, written once and read by random id
(enumeration impractical), expiring automatically — so steady-state cost is
storage-only and demo-scale. boto3 ships with the Lambda runtime.
"""

import decimal
import json
import os
import random
import re
import string
import time

import boto3

SERVICE = "clusterbreak-api"
VERSION = "0.2.1"
TABLE_NAME = os.environ.get("RUNS_TABLE", "clusterbreak-runs")
MAX_BODY_BYTES = 8192
ID_LEN = 10
ID_ALPHABET = string.ascii_lowercase + string.digits
ID_RE = re.compile(r"^[a-z0-9]{6,16}$")
TTL_DAYS = 90
QUANTS = {"q4_k_m", "q8_0", "bf16"}

_table_cache = None


def _get_table():
    global _table_cache
    if _table_cache is None:
        region = os.environ.get("AWS_REGION", "ap-south-1")
        _table_cache = boto3.resource("dynamodb", region_name=region).Table(TABLE_NAME)
    return _table_cache


def _json_default(o):
    # DynamoDB returns numbers as Decimal — serialize them back as plain numbers.
    if isinstance(o, decimal.Decimal):
        return float(o)
    raise TypeError(f"not JSON serializable: {type(o)}")


def _response(status, body, extra_headers=None):
    headers = {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
    }
    if extra_headers:
        headers.update(extra_headers)
    return {
        "statusCode": status,
        "headers": headers,
        "body": json.dumps(body, default=_json_default),
    }


def _num(v, lo, hi):
    return isinstance(v, (int, float, decimal.Decimal)) and not isinstance(v, bool) and lo <= v <= hi


def _str(v, maxlen):
    return isinstance(v, str) and 0 < len(v) <= maxlen


def validate_report(r):
    """Bounded structural validation. Returns an error string or None."""
    if not isinstance(r, dict) or r.get("v") != 1:
        return "expected v:1 report"
    rig, model, outcome, verdict = r.get("rig"), r.get("model"), r.get("outcome"), r.get("verdict")
    if not isinstance(rig, dict) or not isinstance(model, dict) or not isinstance(outcome, dict):
        return "rig/model/outcome must be objects"
    nodes = rig.get("nodes")
    if not isinstance(nodes, list) or not (1 <= len(nodes) <= 8):
        return "rig.nodes must be a list of 1..8 nodes"
    for n in nodes:
        if not isinstance(n, dict) or not _str(n.get("device"), 80) or not _num(n.get("memoryGb"), 0.1, 2048):
            return "bad node entry"
        if "fitted" in n and not isinstance(n["fitted"], bool):
            return "node.fitted must be boolean"
    links = rig.get("links", [])
    if not isinstance(links, list) or len(links) > 16:
        return "rig.links must be a list of <=16"
    for l in links:
        if not isinstance(l, dict) or not _num(l.get("gbps"), 0.001, 1000):
            return "bad link entry"
    if not _str(model.get("name"), 120):
        return "model.name required"
    if model.get("quant") not in QUANTS:
        return "model.quant must be one of q4_k_m|q8_0|bf16"
    if not _num(model.get("contextTokens"), 0, 2**21):
        return "model.contextTokens out of range"
    if not _str(outcome.get("status"), 16):
        return "outcome.status required"
    if outcome.get("death") is not None:
        d = outcome["death"]
        if not isinstance(d, dict) or not _str(d.get("cause"), 200) or not _str(d.get("detail"), 400):
            return "outcome.death malformed"
    if "unplugged" in outcome and (
        not isinstance(outcome["unplugged"], list) or len(outcome["unplugged"]) > 8
    ):
        return "outcome.unplugged malformed"
    if not _str(verdict, 2000):
        return "verdict required (<=2000 chars)"
    if "preset" in r and not _str(r["preset"], 40):
        return "preset malformed"
    return None


def _post_runs(event):
    raw = event.get("body") or ""
    print(f"POST /runs received: {len(raw)} bytes, b64={bool(event.get('isBase64Encoded'))}", flush=True)
    if event.get("isBase64Encoded"):
        return _response(400, {"ok": False, "error": "binary_body"})
    if len(raw.encode()) > MAX_BODY_BYTES:
        return _response(413, {"ok": False, "error": "too_large", "limit": MAX_BODY_BYTES})
    try:
        # DynamoDB (boto3) rejects Python floats — parse them as Decimal up front
        # so nested report numbers are storable as-is. _json_default converts
        # them back to plain numbers on the way out.
        report = json.loads(raw, parse_float=decimal.Decimal)
    except json.JSONDecodeError:
        return _response(400, {"ok": False, "error": "invalid_json"})
    err = validate_report(report)
    if err:
        return _response(400, {"ok": False, "error": "invalid_report", "detail": err})

    run_id = "".join(random.choices(ID_ALPHABET, k=ID_LEN))
    now = int(time.time())
    try:
        _get_table().put_item(
            Item={
                "id": run_id,
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
                "expiresAt": now + TTL_DAYS * 86400,
                "report": report,
            }
        )
    except Exception as e:  # surface as a 503; log the detail to CloudWatch, never leak it
        print(f"put_item failed for {run_id}: {e!r}", flush=True)
        return _response(503, {"ok": False, "error": "storage_unavailable"})
    return _response(201, {"ok": True, "id": run_id, "expiresInDays": TTL_DAYS})


def _get_run(run_id):
    if not ID_RE.match(run_id or ""):
        return _response(400, {"ok": False, "error": "invalid_id"})
    try:
        res = _get_table().get_item(Key={"id": run_id})
    except Exception as e:  # pragma: no cover
        print(f"get_item failed for {run_id}: {e!r}", flush=True)
        return _response(503, {"ok": False, "error": "storage_unavailable"})
    item = res.get("Item")
    if not item:
        return _response(404, {"ok": False, "error": "not_found", "id": run_id})
    return _response(200, {"ok": True, "id": run_id, "createdAt": item.get("createdAt"), "report": item.get("report")})


def route(method, path, event):
    if method == "OPTIONS":
        return _response(
            204,
            {},
            {
                "access-control-allow-methods": "GET, POST, OPTIONS",
                "access-control-allow-headers": "content-type",
                "access-control-max-age": "86400",
            },
        )
    if method == "GET" and path == "/health":
        return _response(200, {"ok": True, "service": SERVICE, "version": VERSION, "time": int(time.time())})
    if method == "GET" and path == "/":
        return _response(200, {"ok": True, "service": SERVICE, "version": VERSION, "hint": "GET /health · POST /runs · GET /runs/{id}"})
    if method == "POST" and path == "/runs":
        return _post_runs(event)
    if method == "GET" and path.startswith("/runs/"):
        return _get_run(path[len("/runs/"):])
    return _response(404, {"ok": False, "error": "not_found", "path": path})


def handler(event, context):  # noqa: ARG001 — context intentionally unused
    http = event.get("requestContext", {}).get("http", {})
    return route(http.get("method", "GET"), http.get("path", "/"), event)
