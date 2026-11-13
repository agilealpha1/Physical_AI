#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 pipeline/refresh.py "$@"
python3 pipeline/build_site_data.py --out site_dist
