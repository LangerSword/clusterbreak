"""Clusterbreak API — AWS Lambda handler (API Gateway HTTP API, payload v2).

Routes (v0):
  GET /        -> service banner
  GET /health  -> liveness + service metadata
  everything else -> 404 JSON

Kept dependency-free (stdlib only) so the deploy zip is a single file and cold
starts stay minimal.
"""

import json
import time

SERVICE = "clusterbreak-api"
VERSION = "0.1.0"


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "content-type": "application/json",
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
        },
        "body": json.dumps(body),
    }


def route(method, path):
    if method == "GET" and path == "/health":
        return _response(
            200,
            {"ok": True, "service": SERVICE, "version": VERSION, "time": int(time.time())},
        )
    if method == "GET" and path == "/":
        return _response(
            200, {"ok": True, "service": SERVICE, "version": VERSION, "hint": "GET /health"}
        )
    return _response(404, {"ok": False, "error": "not_found", "path": path})


def handler(event, context):  # noqa: ARG001 — context intentionally unused
    http = event.get("requestContext", {}).get("http", {})
    return route(http.get("method", "GET"), http.get("path", "/"))
