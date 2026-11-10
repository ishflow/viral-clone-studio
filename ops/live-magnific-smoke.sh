#!/bin/bash
# One supported single image; no retries. Default dry-run. Operator only.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
case "${1:-}" in ''|--yes) ;; *) die 'usage: ops/live-magnific-smoke.sh [--yes]' ;; esac
exec node "$OPS_DIR/live-magnific-smoke.mjs" "${1:-}"
