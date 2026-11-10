#!/bin/bash
# Live Claude isolation check. Explicit operator action; never run by a worker.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
file=$(default_env_file)
check_env_file "$file"
export CLAUDE_CODE_OAUTH_TOKEN="$(env_get "$file" CLAUDE_CODE_OAUTH_TOKEN)"
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || die "CLAUDE_CODE_OAUTH_TOKEN empty"
cd "$REPO/viraleditor"
VC_LIVE_LLM=1 pnpm vitest run src/adapters/llm.test.ts
