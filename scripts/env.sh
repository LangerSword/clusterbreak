#!/usr/bin/env bash
# Shared deployment variables. Usage: `source scripts/env.sh`
export AWS_REGION=ap-south-1
export AWS_DEFAULT_REGION=ap-south-1
export ACCOUNT_ID=703651068111
export FRONTEND_BUCKET="clusterbreak-${ACCOUNT_ID}-frontend"
export LAMBDA_FUNCTION=clusterbreak-api
export LAMBDA_ROLE=clusterbreak-lambda-role
