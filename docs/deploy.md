# Deploying Clusterbreak

Everything lives in **ap-south-1 (Mumbai)**. Deploys are script-driven — no console clicks.

## Live resources (Day 1)

| Piece | Where |
|---|---|
| Frontend | https://d1at2woaiwy2hz.cloudfront.net — S3 `clusterbreak-703651068111-frontend` behind CloudFront `EX9Y84FE8SFH3` (OAC `E30OI2CJKLSOHS`, bucket private) |
| API | https://wa7rwqxhk0.execute-api.ap-south-1.amazonaws.com — `GET /health` |
| Lambda | `clusterbreak-api` (python3.13, 256MB, 10s timeout) |
| IAM | role `clusterbreak-lambda-role` (basic execution) |

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

## Runs API deployment (v0.2)
1. `aws dynamodb create-table --table-name clusterbreak-runs --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST` (+ TTL on `expiresAt` once ACTIVE).
2. Inline role policy on `clusterbreak-lambda-role`: `dynamodb:PutItem` + `dynamodb:GetItem` on that table.
3. `bash scripts/package_backend.sh` → `aws lambda update-function-code --function-name clusterbreak-api --zip-file fileb://backend/function.zip` → `update-function-configuration --environment 'Variables={RUNS_TABLE=clusterbreak-runs}'`.
4. Routing is handled **inside** the Lambda (the HTTP API uses a `$default` route) — no route changes needed per endpoint.
5. Verify: `python3 /tmp/api_test.py` (9 checks incl. negative cases: bad id → 400, unknown → 404, oversized → 413, preflight → 204).
