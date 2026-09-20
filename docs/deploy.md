# Deploying Clusterbreak

Everything lives in **ap-south-1 (Mumbai)**. Deploys are script-driven — no console clicks.

## Live resources (Day 1)

| Piece | Where |
|---|---|
| Frontend | **https://clusterbreak.langersword.in** (canonical) — also reachable at https://d1at2woaiwy2hz.cloudfront.net — S3 `clusterbreak-703651068111-frontend` behind CloudFront `EX9Y84FE8SFH3` (OAC `E30OI2CJKLSOHS`, bucket private) |
| Domain | `clusterbreak.langersword.in` → CNAME → `d1at2woaiwy2hz.cloudfront.net`; ACM cert `9a8672c7-d65a-40e7-8d0a-6479991a720a` (**us-east-1**, DNS-validated) attached to the distribution; DNS lives at **Cloudflare** (zone `44e47a40e0c462aa4d2f4e3ca28991ee`), both records **DNS-only (grey cloud)** |
| API | https://wa7rwqxhk0.execute-api.ap-south-1.amazonaws.com — `GET /health` |
| Lambda | `clusterbreak-api` (python3.13, 256MB, 10s timeout) |
| IAM | role `clusterbreak-lambda-role` (basic execution) |

## Custom domain (done Sep 19, for the record)

CloudFront certs **must** live in **us-east-1** (the distribution region's ACM is not used). Cloudflare is the DNS host — records are API-managed with `$CLOUDFLARE_API_TOKEN`.

```bash
# 1. cert (us-east-1!) + DNS validation record
aws acm request-certificate --region us-east-1 \
  --domain-name clusterbreak.langersword.in --validation-method DNS
aws acm describe-certificate --region us-east-1 --certificate-arn <arn> \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'

# 2. put the validation CNAME in Cloudflare (DNS-only), wait for ISSUED (took ~1 min)

# 3. add alias + cert to the distribution (get ETag first, then --if-match it)
aws cloudfront get-distribution-config --id EX9Y84FE8SFH3   # save ETag
#    edit config: Aliases={Quantity:1,Items:[clusterbreak.langersword.in]},
#    ViewerCertificate={ACMCertificateArn:...,SSLSupportMethod:sni-only,
#                       MinimumProtocolVersion:TLSv1.2_2021,CertificateSource:acm}
aws cloudfront update-distribution --id EX9Y84FE8SFH3 \
  --distribution-config file:///tmp/dist-config.json --if-match <ETag>

# 4. CNAME clusterbreak → d1at2woaiwy2hz.cloudfront.net (DNS-only, not proxied)
```

**Cloudflare must be DNS-only (grey cloud)** for the CloudFront CNAME — proxying it would put a second CDN in front and fight over TLS/headers. CORS on the API is `access-control-allow-origin: *`, so the new origin works without any backend change; share links use `window.location.origin`, so they automatically use the new domain.

## Redeploy

```bash
source scripts/env.sh

# frontend (build + sync + invalidate):
CF_DIST_ID=EX9Y84FE8SFH3 bash scripts/deploy_frontend.sh

# backend (zip + update):
bash scripts/package_backend.sh
aws lambda update-function-code --function-name clusterbreak-api \
  --zip-file fileb://backend/function.zip --region ap-south-1
```

## How it was created (Day 1, for the record)

```bash
# bucket (private; served only through CloudFront):
aws s3api create-bucket --bucket clusterbreak-703651068111-frontend \
  --region ap-south-1 --create-bucket-configuration LocationConstraint=ap-south-1

# CloudFront OAC + distribution (config template in scripts/cloudfront/):
aws cloudfront create-origin-access-control --origin-access-control-config \
  '{"Name":"clusterbreak-oac","OriginAccessControlOriginType":"s3","SigningBehavior":"always","SigningProtocol":"sigv4"}'
aws cloudfront create-distribution --distribution-config file:///tmp/cf-dist.json

# bucket policy grants only this distribution read access (OAC condition):
aws s3api put-bucket-policy --bucket clusterbreak-703651068111-frontend --policy file:///tmp/cf-bucket-policy.json

# Lambda:
aws iam create-role --role-name clusterbreak-lambda-role \
  --assume-role-policy-document file://scripts/iam/lambda-trust.json
aws iam attach-role-policy --role-name clusterbreak-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws lambda create-function --function-name clusterbreak-api --runtime python3.13 \
  --role arn:aws:iam::703651068111:role/clusterbreak-lambda-role \
  --handler handler.handler --zip-file fileb://backend/function.zip --region ap-south-1

# API Gateway (HTTP API, quick-create to the Lambda):
aws apigatewayv2 create-api --name clusterbreak-api --protocol-type HTTP \
  --target arn:aws:lambda:ap-south-1:703651068111:function:clusterbreak-api --region ap-south-1
# + explicit invoke permission (quick-create did NOT add it — the API 500s without this):
aws lambda add-permission --function-name clusterbreak-api --statement-id apigw-invoke \
  --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:ap-south-1:703651068111:wa7rwqxhk0/*/*"
```

## Gotchas hit on the way (kept so nobody re-hits them)

- **Lambda is `Pending` right after create** — first invoke fails with `ResourceConflictException`; wait ~10s.
- **`apigatewayv2 create-api --target` does not attach the Lambda invoke permission** — add it explicitly or every request 500s.
- **Fresh `execute-api` hostnames can flake on campus DNS** (negative cache) — `curl --resolve host:443:IP` is the workaround; it settles.
- **`npm install` silently skips devDependencies when `NODE_ENV=production`** — pass `--include=dev` (this env sets it).
- **DynamoDB rejects Python floats from boto3** — parse JSON with `parse_float=decimal.Decimal`, serialize Decimals back to numbers on read. Symptom: silent 503s on POST /runs.
- **Module-level `_table = None` + `def _table()` shadows the cache** — name the accessor differently (`_get_table`). Symptom: `'function' object has no attribute 'put_item'` from CloudWatch.
- **Debugging cold Lambda: run the deployed zip locally** with real credentials (uv venv + boto3) — faster and more honest than CloudWatch-filter archaeology; you get the real exception straight away.
- **`aws cloudfront get-distribution --query 'Distribution.{aliases:Aliases}'` printed `null` for a correctly-set alias** — the shorthand query lied; the raw `DistributionConfig.Aliases` had it. When a value matters, read the raw JSON, not a query shorthand.
- **ACM certs for CloudFront must be in us-east-1** — a cert in the distribution's own region (ap-south-1) is silently unusable for CloudFront.

## Runs API deployment (v0.2)
1. `aws dynamodb create-table --table-name clusterbreak-runs --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST` (+ TTL on `expiresAt` once ACTIVE).
2. Inline role policy on `clusterbreak-lambda-role`: `dynamodb:PutItem` + `dynamodb:GetItem` on that table.
3. `bash scripts/package_backend.sh` → `aws lambda update-function-code --function-name clusterbreak-api --zip-file fileb://backend/function.zip` → `update-function-configuration --environment 'Variables={RUNS_TABLE=clusterbreak-runs}'`.
4. Routing is handled **inside** the Lambda (the HTTP API uses a `$default` route) — no route changes needed per endpoint.
5. Verify: `python3 /tmp/api_test.py` (9 checks incl. negative cases: bad id → 400, unknown → 404, oversized → 413, preflight → 204).

## Connect + chat API (v0.5.0)

| Route | What it does |
|---|---|
| `POST /aws/connect` | assume the connect-stack role via STS, mint a 24h session |
| `POST /aws/provision` | create the rig stack; **generates the per-stack llama.cpp bearer key server-side** and stores it on the session record |
| `GET /aws/status/{session}/{stack}` | one stack's status/reason/outputs |
| `GET /aws/stacks/{session}` | **every `clusterbreak-*` stack in the account** + teardownAt + apiKey — this is what makes a page refresh safe: the account is the source of truth, not the browser |
| `POST /aws/chat` | proxy a chat completion to the rig's llama.cpp server with the stored key (25s upstream timeout; the API gateway closes at 30s, so replies are capped) |
| `POST /aws/teardown` | delete a stack through the assumed role |

Notes worth keeping:
- **Lambda timeout is 29s** (raised from 10s for chat). API Gateway HTTP API integration timeout is 30s — that is the hard ceiling on reply length, which is why the UI caps `max_tokens` at 512.
- **The chat proxy exists for two reasons**: an HTTPS page cannot call `http://<ip>:8080` (mixed content), and the instance key should never be shipped to a browser. The browser → Clusterbreak → instance path keeps the key server-side.
- **Port 8080 is open to `0.0.0.0/0` on purpose** — the bearer key is the gate. That is what lets the endpoint be used from any harness or any network without knowing the caller's IP first. SSH stays pinned to `SshCidr`.
- Session ids persist in `localStorage` (per browser). The **rig list is re-fetched from AWS on every load**, so reconnecting — even from another device — shows the same running stacks and can tear them down. A cleared browser simply reconnects; nothing about the account changes.
- The auto-teardown sweep only deletes a stack that already existed when its timer was set (`CreationTime > teardownAt` → skip), and a new provision takes ownership of a stack name from older session records. Both guards exist because a stale record once swept a rig that had just been re-created under the same name.
- `session_not_found` on refresh is treated as "session expired", not an app error: the panel drops to the connect state and says so.
