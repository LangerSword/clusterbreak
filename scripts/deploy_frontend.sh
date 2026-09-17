#!/usr/bin/env bash
# Build the frontend and sync it to the S3 bucket behind CloudFront.
# Optionally invalidate CloudFront when CF_DIST_ID is set.
set -euo pipefail
: "${FRONTEND_BUCKET:=clusterbreak-703651068111-frontend}"
cd "$(dirname "$0")/../frontend"
npm run build
aws s3 sync dist "s3://${FRONTEND_BUCKET}" --delete --region ap-south-1
echo "deployed to s3://${FRONTEND_BUCKET}"
if [ -n "${CF_DIST_ID:-}" ]; then
  aws cloudfront create-invalidation --distribution-id "${CF_DIST_ID}" --paths "/*" >/dev/null
  echo "invalidated CloudFront ${CF_DIST_ID}"
fi
