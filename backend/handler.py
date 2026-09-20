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
import urllib.error
import urllib.request

SERVICE = "clusterbreak-api"
VERSION = "0.7.1"
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
CONNECT_STACK_NAME = "clusterbreak-connect"
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
            cfn = session.client("cloudformation", region_name=REGION)
            # Guard: only sweep a stack that already existed when the timer was
            # set. Reusing a stack name (the UI pre-fills one) used to let a
            # stale record delete a rig that had just been created — the new
            # stack must outlive the old record's teardownAt.
            try:
                st = cfn.describe_stacks(StackName=stack)["Stacks"][0]
                created = st.get("CreationTime")
                if created is not None and created.timestamp() > int(teardown_at):
                    print(f"auto-teardown: skipping {stack} (created after its teardownAt)", flush=True)
                    continue
            except Exception:
                pass
            cfn.delete_stack(StackName=stack)
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
    api_key = body.get("apiKey") or ("cbk-" + "".join(random.choices(ID_ALPHABET + ID_ALPHABET.upper(), k=32)))
    params = [
        {"ParameterKey": "KeyName", "ParameterValue": key_name},
        {"ParameterKey": "ApiKey", "ParameterValue": api_key},
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
    replaced_dead_stack = False
    cleaning_up = False

    def _create(cfn_):
        return cfn_.create_stack(
            StackName=stack_name,
            TemplateBody=template,
            Parameters=params,
            RoleARN=f"arn:aws:iam::{item['accountId']}:role/{EXEC_ROLE_NAME}",
            OnFailure="DELETE",
            Tags=[{"Key": "created-by", "Value": "clusterbreak"}],
        )

    try:
        session = _assume(item["roleArn"], item["externalId"])
        cfn = session.client("cloudformation", region_name=REGION)
        res = _create(cfn)
    except Exception as e:
        if "AlreadyExists" not in str(e):
            print(f"provision failed: {e!r}", flush=True)
            return _response(502, {"ok": False, "error": "provision_failed", "detail": str(e)[:200]})
        # The name is taken. A *dead* stack (failed create / rolled back) can
        # never be updated and only blocks the name — clean it up and retry, so
        # the user is not stuck retyping a stack name after a failed attempt.
        existing = _describe_stack(cfn, stack_name) or {}
        status = existing.get("StackStatus", "UNKNOWN")
        if status.startswith("DELETE_"):
            # Already on its way out: nothing to fix, just don't race it.
            if _wait_stack_gone(cfn, stack_name, budget_s=18):
                try:
                    res = _create(cfn)
                    replaced_dead_stack = True
                except Exception as e3:
                    return _response(502, {"ok": False, "error": "provision_failed", "detail": str(e3)[:200]})
            else:
                return _response(202, {"ok": True, "stackName": stack_name, "cleaningUp": True,
                                       "detail": "a previous stack with this name is still being deleted; "
                                                 "provisioning again in a moment will work"})
        elif status in DEAD_STATES:
            print(f"replacing dead stack {stack_name} ({status})", flush=True)
            try:
                cfn.delete_stack(StackName=stack_name)
            except Exception as de:
                return _response(502, {"ok": False, "error": "cleanup_failed", "detail": str(de)[:200]})
            if not _wait_stack_gone(cfn, stack_name):
                # Deletion is running but slower than our window; the account
                # itself is now clean-ish, so tell the truth and let them retry.
                cleaning_up = True
                return _response(202, {"ok": True, "stackName": stack_name, "cleaningUp": True,
                                       "detail": "removed a failed stack that was holding this name; "
                                                 "give it a moment, then provision again"})
            try:
                res = _create(cfn)
                replaced_dead_stack = True
            except Exception as e2:
                print(f"provision retry failed: {e2!r}", flush=True)
                return _response(502, {"ok": False, "error": "provision_failed", "detail": str(e2)[:200]})
        else:
            # Genuinely live: name the conflict and the way out of it.
            meta = {}
            for s_item in _get_sessions().scan().get("Items", []):
                if s_item.get("stackName") == stack_name:
                    meta = s_item
                    break
            detail = f"a rig named {stack_name} already exists ({status})"
            if status.startswith("CREATE_"):
                detail += " — it is still being created, wait for it to finish"
            elif status.startswith("UPDATE_"):
                detail += " — an update is running, wait for it to finish"
            else:
                detail += " — tear it down, or provision under a different name"
            return _response(409, {
                "ok": False, "error": "stack_exists", "status": status, "detail": detail,
                "accountId": item["accountId"],
                "teardownAt": int(meta["teardownAt"]) if meta.get("teardownAt") else None,
                "action": "teardown_or_rename",
            })
    if teardown_hours <= 0:
        try:
            _get_sessions().update_item(
                Key={"id": item["id"]},
                UpdateExpression="SET stackName = :s, apiKey = :k",
                ExpressionAttributeValues={":s": stack_name, ":k": api_key},
            )
        except Exception as e:
            print(f"stack record failed: {e!r}", flush=True)
    # Only the newest session may own a stack name: otherwise a previous
    # record's teardownAt can sweep a rig that was just re-created under the
    # same name (found live — the sweep deleted a brand-new rig).
    try:
        for other in _get_sessions().scan().get("Items", []):
            if other.get("id") != item["id"] and other.get("stackName") == stack_name:
                _get_sessions().update_item(
                    Key={"id": other["id"]},
                    UpdateExpression="REMOVE stackName, teardownAt",
                )
    except Exception as e:
        print(f"stale claim cleanup failed: {e!r}", flush=True)
    if teardown_hours > 0:
        try:
            _get_sessions().update_item(
                Key={"id": item["id"]},
                UpdateExpression="SET stackName = :s, teardownAt = :t, apiKey = :k",
                ExpressionAttributeValues={
                    ":s": stack_name,
                    ":t": int(time.time() + teardown_hours * 3600),
                    ":k": api_key,
                },
            )
        except Exception as e:
            print(f"teardown schedule failed: {e!r}", flush=True)
    return _response(202, {"ok": True, "stackId": res["StackId"], "stackName": stack_name,
                           "accountId": item["accountId"],
                           "replacedDeadStack": replaced_dead_stack, "cleaningUp": cleaning_up,
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
    try:
        _get_sessions().update_item(
            Key={"id": item["id"]},
            UpdateExpression="REMOVE stackName, teardownAt",
        )
    except Exception as e:
        print(f"claim release failed: {e!r}", flush=True)
    return _response(200, {"ok": True, "stackName": stack_name, "status": "DELETE_IN_PROGRESS"})


# Stacks in these states can never be updated and block reuse of their name.
DEAD_STATES = ("CREATE_FAILED", "ROLLBACK_COMPLETE", "ROLLBACK_FAILED", "DELETE_FAILED")


def _describe_stack(cfn, name):
    try:
        return cfn.describe_stacks(StackName=name)["Stacks"][0]
    except Exception:
        return None


def _wait_stack_gone(cfn, name, budget_s=20):
    """Bounded wait so a cleanup stays inside the API gateway's 30s window."""
    deadline = time.time() + budget_s
    while time.time() < deadline:
        st = _describe_stack(cfn, name)
        if st is None or st.get("StackStatus") == "DELETE_COMPLETE":
            return True
        time.sleep(2)
    return False


def _session_stacks(session_id):
    """The rigs Clusterbreak created in THIS account.

    Deliberately not `describe_stacks()` with no name: listing every stack in
    the account needs DescribeStacks on "*", which the connect role does not
    grant (it is scoped to clusterbreak-* stacks). Instead we read the stack
    names Clusterbreak itself recorded, then describe each one by name — the
    scoped permission covers that, and we only ever show what we manage.
    """
    item = _session_from(session_id)
    if not item:
        return None, _response(404, {"ok": False, "error": "session_not_found"})
    meta = {}
    try:
        for s_item in _get_sessions().scan().get("Items", []):
            if s_item.get("accountId") != item["accountId"]:
                continue
            nm = s_item.get("stackName")
            if isinstance(nm, str) and STACK_RE.match(nm):
                meta[nm] = {
                    "teardownAt": int(s_item["teardownAt"]) if s_item.get("teardownAt") else None,
                    "apiKey": s_item.get("apiKey"),
                    "mine": s_item.get("id") == session_id,
                }
    except Exception as e:
        print(f"session scan failed: {e!r}", flush=True)
        return None, _response(503, {"ok": False, "error": "storage_unavailable"})
    stacks = []
    scoped_listing = False
    try:
        session = _assume(item["roleArn"], item["externalId"])
        cfn = session.client("cloudformation", region_name=REGION)
    except Exception as e:
        print(f"assume failed: {e!r}", flush=True)
        return None, _response(403, {"ok": False, "error": "assume_failed"})
    # Preferred: ask the account for every clusterbreak-* stack, so rigs created
    # outside the app (manual deploys, older sessions) are visible and cleanable
    # too — and so a failed stack cannot silently block its own name.
    named = {}
    try:
        for page in cfn.get_paginator("describe_stacks").paginate():
            for st in page.get("Stacks", []):
                nm = st.get("StackName", "")
                if nm == CONNECT_STACK_NAME:
                    continue  # the connect stack is plumbing, not a rig
                if STACK_RE.match(nm) and st.get("StackStatus") != "DELETE_COMPLETE":
                    named[nm] = st
    except Exception as e:
        # Older connect stacks only permit describe-by-name; fall back to the
        # names Clusterbreak recorded so this keeps working.
        scoped_listing = True
        print(f"account-wide listing unavailable ({e!r}); falling back to recorded names", flush=True)
        for nm in meta:
            try:
                named[nm] = cfn.describe_stacks(StackName=nm)["Stacks"][0]
            except Exception:
                continue
    if named:
        for name in named:
            st = named[name]
            m = meta.get(name, {})
            if st.get("StackStatus") == "DELETE_COMPLETE":
                continue
            last_failure = None
            if str(st.get("StackStatus", "")).endswith(("FAILED", "ROLLBACK_COMPLETE")):
                try:
                    for ev in cfn.describe_stack_events(StackName=name)["StackEvents"]:
                        if str(ev.get("ResourceStatus", "")).endswith("FAILED") and ev.get("ResourceStatusReason"):
                            last_failure = f"{ev.get('LogicalResourceId')}: {ev['ResourceStatusReason']}"[:300]
                            break
                except Exception:
                    pass
            stacks.append({
                "name": name,
                "status": st.get("StackStatus"),
                "lastFailure": last_failure,
                "createdAt": st.get("CreationTime").isoformat() if st.get("CreationTime") else None,
                "outputs": {o["OutputKey"]: o["OutputValue"] for o in st.get("Outputs", [])},
                "teardownAt": m.get("teardownAt"),
                "apiKey": m.get("apiKey"),
                "mine": bool(m.get("mine")),
                "managed": name in meta,
            })
    stacks.sort(key=lambda s: s.get("createdAt") or "", reverse=True)
    # must go through _response(): a bare dict skips the CORS headers, and the
    # browser then blocks the call ("blocked by CORS policy") while curl is
    # perfectly happy — found live, never by the API tests.
    return _response(200, {"ok": True, "accountId": item["accountId"], "stacks": stacks,
                           "scopedListing": scoped_listing}), None


def _get_keypairs(session_id):
    """Key pair names in the user's account, so the UI can offer a dropdown
    instead of asking them to remember an EC2 key name."""
    item = _session_from(session_id)
    if not item:
        return _response(404, {"ok": False, "error": "session_not_found"})
    try:
        session = _assume(item["roleArn"], item["externalId"])
        kps = session.client("ec2", region_name=REGION).describe_key_pairs()["KeyPairs"]
    except Exception as e:
        print(f"keypair listing failed: {e!r}", flush=True)
        return _response(502, {"ok": False, "error": "keypairs_failed", "detail": str(e)[:200]})
    return _response(200, {"ok": True, "keyPairs": sorted(k["KeyName"] for k in kps)})


def _whoami(event):
    """The caller's own source IP — used to prefill '<ip>/32' for SSH."""
    ip = None
    try:
        ip = event.get("requestContext", {}).get("http", {}).get("sourceIp")
    except Exception:
        pass
    return _response(200, {"ok": True, "ip": ip})


def _api_key_for_stack(stack_name):
    try:
        for s_item in _get_sessions().scan().get("Items", []):
            if s_item.get("stackName") == stack_name and s_item.get("apiKey"):
                return s_item["apiKey"]
    except Exception as e:
        print(f"api key lookup failed: {e!r}", flush=True)
    return None


CHAT_TIMEOUT_S = 26
MAX_CHAT_TOKENS = 768
ROLES = {"system", "user", "assistant"}


# What each EC2 GPU class actually carries. The same mapping the deploy kit uses
# (deploy/cfn.ts -> instanceForDevice) so the model's self-description matches the
# product's own documentation instead of a guess.
GPU_BY_INSTANCE = {
    "g5.xlarge": "NVIDIA A10G, 24 GB VRAM",
    "g5.2xlarge": "NVIDIA A10G, 24 GB VRAM",
    "g4dn.xlarge": "NVIDIA T4, 16 GB VRAM",
    "g6e.xlarge": "NVIDIA L40S, 48 GB VRAM",
}


def _with_deployment_facts(messages, stack, outputs):
    """Put the model's real deployment facts in front of it.

    A quantized LLM cannot inspect its host, so asked "what GPU are you on?" it
    answers with the most likely-sounding chip in its training data — an 8B here
    confidently claimed A100 while running on an A10G. These facts are read from
    the CloudFormation stack itself, so the model answers from truth (and says
    "I can't know that" when it genuinely cannot) instead of inventing hardware.
    """
    params = {p.get("ParameterKey"): p.get("ParameterValue") for p in stack.get("Parameters", [])}
    model_file = (params.get("ModelUrl") or "").rsplit("/", 1)[-1]
    ctx = params.get("ContextTokens") or ""
    facts = [
        "You are a quantized language model served by llama.cpp, running on an EC2 GPU instance"
        f" that Clusterbreak provisioned in AWS region {REGION}.",
        f"Your weights file: {model_file or 'not reported by this stack'}.",
    ]
    itype = outputs.get("Node1InstanceType")
    facts.append(
        f"Your instance type: {itype}." if itype
        else "Your exact instance type is not exposed by this stack — do not guess it."
    )
    if itype in GPU_BY_INSTANCE:
        facts.append(f"Your GPU: {GPU_BY_INSTANCE[itype]}.")
    if ctx:
        facts.append(f"Context window: {ctx} tokens.")
    facts.append(
        "You have no internet access, no tools, and no way to inspect the host beyond this message."
        " If asked about your hardware, environment or capabilities, answer from these facts and say"
        " plainly when something is not knowable to you — never invent a GPU model or a spec."
    )
    return [{"role": "system", "content": " ".join(facts)}] + messages


def _post_chat(event):
    """Proxy a chat completion to the rig's llama.cpp server.

    The browser talks HTTPS to us; we talk to the instance over its bearer key.
    Direct browser → http://ec2 would be blocked as mixed content, and handing
    the key to the page is unnecessary — so the key stays server-side."""
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
    messages = body.get("messages")
    if not (isinstance(messages, list) and 1 <= len(messages) <= 24):
        return _response(400, {"ok": False, "error": "invalid_messages", "detail": "1-24 messages"})
    clean = []
    for m in messages:
        if not (isinstance(m, dict) and m.get("role") in ROLES and isinstance(m.get("content"), str)):
            return _response(400, {"ok": False, "error": "invalid_message", "detail": "role + string content"})
        if len(m["content"]) > 4000:
            return _response(400, {"ok": False, "error": "message_too_long", "detail": "4000 chars max"})
        clean.append({"role": m["role"], "content": m["content"]})
    try:
        max_tokens = int(body.get("maxTokens", 512))
    except (TypeError, ValueError):
        max_tokens = 512
    max_tokens = max(16, min(MAX_CHAT_TOKENS, max_tokens))

    try:
        session = _assume(item["roleArn"], item["externalId"])
        st = session.client("cloudformation", region_name=REGION).describe_stacks(StackName=stack_name)["Stacks"][0]
    except Exception as e:
        if "does not exist" in str(e):
            return _response(404, {"ok": False, "error": "stack_not_found"})
        return _response(502, {"ok": False, "error": "describe_failed", "detail": str(e)[:200]})
    outputs = {o["OutputKey"]: o["OutputValue"] for o in st.get("Outputs", [])}
    endpoint = outputs.get("Node1Endpoint") or outputs.get("LlamaCppUrl")
    if not endpoint:
        return _response(409, {"ok": False, "error": "no_endpoint",
                               "detail": "stack has no endpoint output yet - wait for CREATE_COMPLETE"})
    api_key = _api_key_for_stack(stack_name)
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
    payload = {"messages": _with_deployment_facts(clean, st, outputs),
               "max_tokens": max_tokens, "temperature": 0.7, "stream": False}
    req = urllib.request.Request(
        endpoint.rstrip("/") + "/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=CHAT_TIMEOUT_S) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        print(f"chat upstream {e.code}: {detail}", flush=True)
        return _response(502, {"ok": False, "error": "upstream_error", "upstreamStatus": e.code, "detail": detail})
    except Exception as e:
        print(f"chat unreachable: {e!r}", flush=True)
        return _response(504, {"ok": False, "error": "endpoint_unreachable",
                               "detail": "the instance is still downloading/loading the model, or llama.cpp is not up yet"})
    choice = (data.get("choices") or [{}])[0]
    return _response(200, {
        "ok": True,
        "reply": (choice.get("message") or {}).get("content", ""),
        "model": data.get("model"),
        "usage": data.get("usage"),
    })


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
        return _response(200, {"ok": True, "service": SERVICE, "version": VERSION, "hint": "GET /health · POST /runs · GET /runs/{id} · POST /aws/connect · POST /aws/provision · GET /aws/status/{session}/{stack} · GET /aws/stacks/{session} · GET /aws/keypairs/{session} · GET /whoami · POST /aws/chat · POST /aws/teardown"})
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
    if method == "GET" and path.startswith("/aws/stacks/"):
        payload, err = _session_stacks(path[len("/aws/stacks/"):])
        return err or payload
    if method == "POST" and path == "/aws/chat":
        return _post_chat(event)
    if method == "GET" and path == "/whoami":
        return _whoami(event)
    if method == "GET" and path.startswith("/aws/keypairs/"):
        return _get_keypairs(path[len("/aws/keypairs/"):])
    return _response(404, {"ok": False, "error": "not_found", "path": path})


def handler(event, context):  # noqa: ARG001 — context intentionally unused
    if event.get("source") == "aws.events":
        return _sweep()
    http = event.get("requestContext", {}).get("http", {})
    return route(http.get("method", "GET"), http.get("path", "/"), event)
