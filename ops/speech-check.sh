#!/bin/bash
# Does a local clip speak its lines? Offline: whisper hears the clip, the engine's own alignment scores it. No network, no keys.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
exec node "$OPS_DIR/speech-check.mjs" "$@"
