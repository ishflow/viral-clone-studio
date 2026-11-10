#!/bin/bash
# Read-only local owner setup inspection. Never sources env or calls an external service.
set -u
. "$(dirname "$0")/lib.sh"
file=$(default_env_file)
case "${1:-}" in '') ;; --env-file) file=${2:?} ;; *) die 'usage: ops/preflight.sh [--env-file F]' ;; esac
fails=0
ok() { printf 'OK    %s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; fails=$((fails+1)); }
[ -f "$file" ] || { bad 'env file missing'; exit 1; }
[ "$(mode_of "$file")" = 600 ] && [ "$(owner_of "$file")" = "$(id -u)" ] && ok 'env mode/owner' || bad 'env must be owned by you and mode 600'
for key in VC_SESSION_SECRET CLAUDE_CODE_OAUTH_TOKEN MAGNIFIC_API_KEY; do
  [ -n "$(env_get "$file" "$key")" ] && ok "$key populated (value hidden)" || bad "$key empty"
done
for bin in claude yt-dlp ffmpeg sqlite3; do
  if command -v "$bin" >/dev/null 2>&1; then
    case "$bin" in ffmpeg) version=$(ffmpeg -version 2>/dev/null | head -n 1) ;; *) version=$("$bin" --version 2>/dev/null | head -n 1) ;; esac
    ok "$bin: $version"
  else bad "$bin missing"; fi
done
provider=$(env_get "$file" VC_PROVIDER); host=$(env_get "$file" VC_BIND_HOST)
owner=$(env_get "$file" VC_OWNER_TEST); proxy=$(env_get "$file" VC_TRUST_PROXY)
mail=$(env_get "$file" VC_MAIL); demo=$(env_get "$file" VC_DEMO_LINKS); payments=$(env_get "$file" VC_PAYMENTS)
[ "$provider" = magnific ] && [ "$owner" = 1 ] && ok 'Magnific + owner test selected' || bad 'requires Magnific + VC_OWNER_TEST=1'
[ "$(env_get "$file" VC_ENGINE)" = sqlite ] && ok 'SQLite engine selected' || bad 'owner test requires VC_ENGINE=sqlite'
case "$host" in 127.0.0.1|::1) ok 'explicit loopback host' ;; *) bad 'owner test requires explicit loopback' ;; esac
case "$proxy" in '') ok 'no trusted proxy' ;; cloudflare) ok 'trusted proxy is the Cloudflare Tunnel (the caller is read from cf-connecting-ip)' ;; *) bad 'owner test forbids every trust proxy but VC_TRUST_PROXY=cloudflare' ;; esac
case "$payments" in ''|fake) ok 'local fake/no payments' ;; *) bad 'unsupported payment mode' ;; esac
if [ -n "$demo" ]; then
  [ "$mail" = resend ] && [ -n "$(env_get "$file" VC_MAIL_ALLOW)" ] && ok 'mail allowlist for demo flag' || bad 'demo flag requires Resend + VC_MAIL_ALLOW'
else ok 'demo links disabled'; fi
{ [ "$demo" = 1 ] && ! is_loopback "$host"; } && bad 'demo links with a non-loopback bind'
if [ "$mail" = resend ]; then
  for key in RESEND_API_KEY MAIL_FROM VC_MAIL_ALLOW; do [ -n "$(env_get "$file" "$key")" ] && ok "$key populated (hidden)" || bad "$key missing"; done
  mail_allow_names_people "$(env_get "$file" VC_MAIL_ALLOW)" && ok 'VC_MAIL_ALLOW names full addresses only' || bad 'owner test forbids an open mail list: every VC_MAIL_ALLOW entry must be a full address (no *, no domain, no empty entry); the site does not start (owner-test-forbids-open-mail-allowlist)'
fi
for key in VC_PROVIDER_DAILY_CAP VC_PROVIDER_JOB_CAP; do
 value=$(env_get "$file" "$key")
 if [[ "$value" =~ ^[1-9][0-9]*$ ]]; then ok "$key configured"; else bad "$key requires positive integer"; fi
done
available=$(df -k "$REPO" | awk 'END {print $4}')
[ "$available" -ge 10485760 ] && ok 'disk >= 10 GB' || bad 'disk < 10 GB'
for model in small.en large-v3; do
  model_file="$HOME/.cache/hyperframes/whisper/models/ggml-$model.bin"
  [ -s "$model_file" ] && ok "Whisper $model model cached (offline execution unverified)" || bad "Whisper $model model missing; operator first transcribe may download"
done
# File presence cannot prove an offline recognizer works; report the gap without starting a downloader.
bad 'HyperFrames Whisper small.en / large-v3 offline recognition: unverified. Operator: hyperframes transcribe <local-audio> --engine whisper --model small.en --language en; first run may download. Repeat with network disabled to verify.'
if "$OPS_DIR/health.sh" --env-file "$file"; then ok 'health.sh'; else bad 'health.sh'; fi
[ "$fails" -eq 0 ]
