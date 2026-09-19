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
VERSION = "0.4.0"
TABLE_NAME = os.environ.get("RUNS_TABLE", "clusterbreak-runs")
SESSIONS_TABLE_NAME = os.environ.get("SESSIONS_TABLE", "clusterbreak-sessions")
REGION = os.environ.get("AWS_REGION", "ap-south-1")
MAX_BODY_BYTES = 8192
MAX_TEMPLATE_CHARS = 60000
ID_LEN = 10
ID_ALPHABET = string.ascii_lowercase + string.digits
ID_RE = re.compile(r"^[a-z0-9]{6,16}$")
SESSION_RE = re.compile(r"^[a-z0-9]{16}$")
STACK_RE = re.compile(r"^clusterbreak-[a-z0-9-]{3,40}$")
ROLE_ARN_RE = re.compile(r"^arn:aws:iam::\d{12}:role/ClusterbreakDeployRole$")
EXTERNAL_ID_RE = re.compile(r"^[A-Za-z0-9+/=_-]{16,64}$")
EXEC_ROLE_NAME = "ClusterbreakStackRole"
TTL_DAYS = 90
SESSION_TTL_HOURS = 24
QUANTS = {"q4_k_m", "q8_0", "bf16"}

_table_cache = None
_sessions_cache = None


def _get_table():
    global _table_cache
    if _table_cache is None:
        region = os.environ.get("AWS_REGION", "ap-south-1")
        _table_cache = boto3.resource("dynamodb", region_name=region).Table(TABLE_NAME)
    return _table_cache


def _get_sessions():
    global _sessions_cache
    if _sessions_cache is None:
        _sessions_cache = boto3.resource("dynamodb", region_name=REGION).Table(SESSIONS_TABLE_NAME)
    return _sessions_cache


def _assume(role_arn, external_id):
    """Assume the user's connect role. STS itself enforces the trust policy
    (our exact backend role + the ExternalId) — nothing else can succeed."""
    sts = boto3.client("sts", region_name=REGION)
    creds = sts.assume_role(
        RoleArn=role_arn, RoleSessionName="clusterbreak-api", ExternalId=external_id
    )["Credentials"]
    return boto3.session.Session(
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
        region_name=REGION,
    )


def _session_from(session_id):
    res = _get_sessions().get_item(Key={"id": session_id})
    return res.get("Item")


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


def _load_session(body):
    sid = (body or {}).get("sessionId", "")
    if not (isinstance(sid, str) and SESSION_RE.match(sid)):
        return None, _response(400, {"ok": False, "error": "invalid_session"})
    item = _session_from(sid)
    if not item:
        return None, _response(404, {"ok": False, "error": "session_not_found"})
    return item, None


def _sweep():
    """Auto-teardown sweep: delete stacks whose sessions have expired.

    Runs on an EventBridge schedule. This exists because we left a g5.xlarge
    running for 23 hours during development — the product must never let that
    happen to anyone: every provisioned rig self-destructs by default."""
    now = int(time.time())
    try:
        items = _get_sessions().scan().get("Items", [])
    except Exception as e:
        print(f"sweep scan failed: {e!r}", flush=True)
        return {"ok": False, "swept": 0}
    swept = 0
    for item in items:
        teardown_at = item.get("teardownAt")
        stack = item.get("stackName")
        if teardown_at is None or int(teardown_at) > now:
            continue
        if not (isinstance(stack, str) and STACK_RE.match(stack)):
            continue
        try:
            session = _assume(item["roleArn"], item["externalId"])
            session.client("cloudformation", region_name=REGION).delete_stack(StackName=stack)
            _get_sessions().delete_item(Key={"id": item["id"]})
            swept += 1
            print(f"auto-teardown: deleted {stack} (session {item['id']})", flush=True)
        except Exception as e:
            print(f"auto-teardown failed for {stack}: {e!r}", flush=True)
    return {"ok": True, "swept": swept}


def _post_connect(event):
    """Verify a user's connect stack by assuming its role, then mint a session id.
    The ExternalId + trust policy are enforced by STS; we only ever hold the
    role ARN and ExternalId, never long-lived credentials."""
    try:
        body = json.loads(event.get("body") or "")
    except json.JSONDecodeError:
        return _response(400, {"ok": False, "error": "invalid_json"})
    role_arn = body.get("roleArn", "")
    external_id = body.get("externalId", "")
    if not (isinstance(role_arn, str) and ROLE_ARN_RE.match(role_arn)):
        return _response(400, {"ok": False, "error": "invalid_role_arn",
                               "detail": "expected arn:aws:iam::<account>:role/ClusterbreakDeployRole"})
    if not (isinstance(external_id, str) and EXTERNAL_ID_RE.match(external_id)):
        return _response(400, {"ok": False, "error": "invalid_external_id"})
    try:
        session = _assume(role_arn, external_id)
        account_id = session.client("sts", region_name=REGION).get_caller_identity()["Account"]
    except Exception as e:
        print(f"connect assume failed: {e!r}", flush=True)
        return _response(403, {"ok": False, "error": "assume_failed",
                               "detail": "check the role ARN + ExternalId and that the connect stack is deployed"})
    gpu_quota = None
    try:
        q = session.client("service-quotas", region_name=REGION).get_service_quota(
            ServiceCode="ec2", QuotaCode="L-DB2E81BA")
        gpu_quota = q["Quota"]["Value"]
    except Exception:
        pass
    session_id = "".join(random.choices(ID_ALPHABET, k=16))
    now = int(time.time())
    try:
        _get_sessions().put_item(Item={
            "id": session_id,
            "roleArn": role_arn,
            "externalId": external_id,
            "accountId": account_id,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
            "expiresAt": now + SESSION_TTL_HOURS * 3600,
        })
    except Exception as e:
        print(f"session store failed: {e!r}", flush=True)
        return _response(503, {"ok": False, "error": "storage_unavailable"})
    return _response(200, {"ok": True, "sessionId": session_id, "accountId": account_id,
                           "region": REGION, "gpuQuotaVcpus": gpu_quota, "expiresInHours": SESSION_TTL_HOURS})


def _post_provision(event):
    try:
        body = json.loads(event.get("body") or "")
    except json.JSONDecodeError:
        return _response(400, {"ok": False, "error": "invalid_json"})
    item, err = _load_session(body)
    if err:
        return err
    stack_name = body.get("stackName", "")
    if not (isinstance(stack_name, str) and STACK_RE.match(stack_name)):
        return _response(400, {"ok": False, "error": "invalid_stack_name",
                               "detail": "clusterbreak-<lowercase/digits/dashes>"})
    template = body.get("template", "")
    if not (isinstance(template, str) and 100 < len(template) <= MAX_TEMPLATE_CHARS):
        return _response(400, {"ok": False, "error": "invalid_template"})
    if "AWSTemplateFormatVersion" not in template:
        return _response(400, {"ok": False, "error": "not_cloudformation"})
    key_name = body.get("keyName", "")
    ssh_cidr = body.get("sshCidr", "")
    if not (isinstance(key_name, str) and re.match(r"^[\w-]{1,255}$", key_name)):
        return _response(400, {"ok": False, "error": "invalid_key_name"})
    if not (isinstance(ssh_cidr, str) and re.match(r"^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$", ssh_cidr)):
        return _response(400, {"ok": False, "error": "invalid_ssh_cidr", "detail": "e.g. 1.2.3.4/32"})
    params = [
        {"ParameterKey": "KeyName", "ParameterValue": key_name},
        {"ParameterKey": "SshCidr", "ParameterValue": ssh_cidr},
        {"ParameterKey": "Mode", "ParameterValue": body.get("mode", "on-demand")},
        {"ParameterKey": "GpuMode", "ParameterValue": body.get("gpuMode", "gpu")},
        {"ParameterKey": "ContextTokens", "ParameterValue": str(int(body.get("contextTokens", 4096)))},
    ]
    if isinstance(body.get("modelUrl"), str) and body["modelUrl"].startswith("https://"):
        params.append({"ParameterKey": "ModelUrl", "ParameterValue": body["modelUrl"][:500]})
    teardown_hours = body.get("autoTeardownHours", 6)
    if not (isinstance(teardown_hours, (int, float)) and 0 <= teardown_hours <= 168):
        return _response(400, {"ok": False, "error": "invalid_auto_teardown",
                               "detail": "hours, 0 = never, max 168"})
    try:
        session = _assume(item["roleArn"], item["externalId"])
        cfn = session.client("cloudformation", region_name=REGION)
        res = cfn.create_stack(
            StackName=stack_name,
            TemplateBody=template,
            Parameters=params,
            RoleARN=f"arn:aws:iam::{item['accountId']}:role/{EXEC_ROLE_NAME}",
            OnFailure="DELETE",
            Tags=[{"Key": "created-by", "Value": "clusterbreak"}],
        )
    except Exception as e:
        detail = str(e)[:200]
        if "AlreadyExists" in str(e):
            return _response(409, {"ok": False, "error": "stack_exists"})
        print(f"provision failed: {e!r}", flush=True)
        return _response(502, {"ok": False, "error": "provision_failed", "detail": detail})
    if teardown_hours > 0:
        try:
            _get_sessions().update_item(
                Key={"id": item["id"]},
                UpdateExpression="SET stackName = :s, teardownAt = :t",
                ExpressionAttributeValues={
                    ":s": stack_name,
                    ":t": int(time.time() + teardown_hours * 3600),
                },
            )
        except Exception as e:
            print(f"teardown schedule failed: {e!r}", flush=True)
    return _response(202, {"ok": True, "stackId": res["StackId"], "stackName": stack_name,
                           "accountId": item["accountId"],
                           "autoTeardownHours": teardown_hours or None})


def _get_status(session_id, stack_name):
    if not (SESSION_RE.match(session_id or "") and STACK_RE.match(stack_name or "")):
        return _response(400, {"ok": False, "error": "bad_params"})
    item = _session_from(session_id)
    if not item:
        return _response(404, {"ok": False, "error": "session_not_found"})
    try:
        session = _assume(item["roleArn"], item["externalId"])
        cfn = session.client("cloudformation", region_name=REGION)
        res = cfn.describe_stacks(StackName=stack_name)["Stacks"][0]
    except Exception as e:
        if "does not exist" in str(e):
            return _response(404, {"ok": False, "error": "stack_not_found"})
        print(f"status failed: {e!r}", flush=True)
        return _response(502, {"ok": False, "error": "status_failed", "detail": str(e)[:200]})
    outputs = {o["OutputKey"]: o["OutputValue"] for o in res.get("Outputs", [])}
    reason = res.get("StackStatusReason")
    if res["StackStatus"].endswith("FAILED") and not reason:
        try:
            for ev in cfn.describe_stack_events(StackName=stack_name)["StackEvents"]:
                if ev.get("ResourceStatus", "").endswith("FAILED") and ev.get("ResourceStatusReason"):
                    reason = ev["ResourceStatusReason"]
                    break
        except Exception:
            pass
    return _response(200, {"ok": True, "status": res["StackStatus"], "reason": reason,
                           "outputs": outputs, "accountId": item["accountId"]})


def _post_teardown(event):
    try:
        body = json.loads(event.get("body") or "")
    except json.JSONDecodeError:
        return _response(400, {"ok": False, "error": "invalid_json"})
    item, err = _load_session(body)
    if err:
        return err
    stack_name = body.get("stackName", "")
    if not (isinstance(stack_name, str) and STACK_RE.match(stack_name)):
        return _response(400, {"ok": False, "error": "invalid_stack_name"})
    try:
        session = _assume(item["roleArn"], item["externalId"])
        session.client("cloudformation", region_name=REGION).delete_stack(StackName=stack_name)
    except Exception as e:
        print(f"teardown failed: {e!r}", flush=True)
        return _response(502, {"ok": False, "error": "teardown_failed", "detail": str(e)[:200]})
    return _response(200, {"ok": True, "stackName": stack_name, "status": "DELETE_IN_PROGRESS"})


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
        return _response(200, {"ok": True, "service": SERVICE, "version": VERSION, "hint": "GET /health · POST /runs · GET /runs/{id} · POST /aws/connect · POST /aws/provision · GET /aws/status/{session}/{stack} · POST /aws/teardown"})
    if method == "POST" and path == "/runs":
        return _post_runs(event)
    if method == "GET" and path.startswith("/runs/"):
        return _get_run(path[len("/runs/"):])
    if method == "POST" and path == "/aws/connect":
        return _post_connect(event)
    if method == "POST" and path == "/aws/provision":
        return _post_provision(event)
    if method == "GET" and path.startswith("/aws/status/"):
        parts = path[len("/aws/status/"):].split("/")
        if len(parts) == 2:
            return _get_status(parts[0], parts[1])
        return _response(400, {"ok": False, "error": "bad_path"})
    if method == "POST" and path == "/aws/teardown":
        return _post_teardown(event)
    return _response(404, {"ok": False, "error": "not_found", "path": path})


def handler(event, context):  # noqa: ARG001 — context intentionally unused
    if event.get("source") == "aws.events":
        return _sweep()
    http = event.get("requestContext", {}).get("http", {})
    return route(http.get("method", "GET"), http.get("path", "/"), event)
