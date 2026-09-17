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
