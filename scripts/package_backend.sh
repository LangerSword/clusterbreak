#!/usr/bin/env bash
# Build the Lambda deployment zip. The handler is dependency-free → single-file zip.
set -euo pipefail
cd "$(dirname "$0")/../backend"
rm -f function.zip
python3 -m zipfile -c function.zip handler.py
echo "packaged backend/function.zip ($(du -h function.zip | cut -f1))"
