#!/bin/bash
# Entry point launchd calls:  ops/run.sh web|worker
# launchd cannot read an env file, so this loads the secrets (mode 0600 file, see ops/README.md) and then replaces itself with the real process.
# Web and worker read the SAME file, so VC_PROVIDER cannot differ between them.
set -eu
. "$(dirname "$0")/lib.sh"

role=${1:-}
env_file=$(default_env_file)
check_env_file "$env_file"
set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

: "${VC_DATA_DIR:?VC_DATA_DIR is not set in $env_file}"

case "$role" in
  web)
    : "${VC_SESSION_SECRET:?VC_SESSION_SECRET is not set in $env_file}"
    # Payment pipeline secrets (VC_PAYMENTS, VC_PAYMENTS_WEBHOOK_SECRET, PUBLIC_BASE_URL, INTERNAL_CRON_SECRET) live in their own 0600 file, web only.
    payments_env=${VC_PAYMENTS_ENV_FILE:-$HOME/.config/viral-klon/payments.env}
    if [ -e "$payments_env" ]; then
      check_env_file "$payments_env"
      provider_before=${VC_PROVIDER:-}
      set -a
      # shellcheck disable=SC1090
      . "$payments_env"
      set +a
      [ "${VC_PROVIDER:-}" = "$provider_before" ] || die "$payments_env must not change VC_PROVIDER: site and worker read it from the main env file"
    fi
    host=${VC_BIND_HOST:-127.0.0.1}
    check_bind_host "$host"
    if [ "${VC_TRUST_PROXY:-}" = 1 ] && [ "$host" != 127.0.0.1 ]; then die "VC_TRUST_PROXY=1 only with VC_BIND_HOST=127.0.0.1: the proxy must be the only way in, otherwise anyone can forge the client address headers"; fi
    if [ "${VC_TRUST_PROXY:-}" = cloudflare ] && ! is_loopback "$host"; then die "VC_TRUST_PROXY=cloudflare only with a loopback VC_BIND_HOST: the Cloudflare Tunnel must be the only way in, otherwise anyone can write cf-connecting-ip"; fi
    if [ "${VC_DEMO_LINKS:-}" = 1 ] && ! is_loopback "$host"; then die "VC_DEMO_LINKS=1 with VC_BIND_HOST='$host': demo links hand a reset token to anyone who can reach the site; bind 127.0.0.1 or clear VC_DEMO_LINKS"; fi
    is_loopback "$host" || [ "${VC_TRUST_PROXY:-}" = 1 ] || warn "bound to $host without VC_TRUST_PROXY: every client shares one rate-limit bucket, so one flood blocks everyone's log-in (VC_TRUST_PROXY=1 is not safe here: client address headers can be forged)"
    [ -f "$REPO/web/.next/BUILD_ID" ] || die "no production build: run  pnpm --dir '$REPO/web' build  once"
    export VC_BIND_HOST="$host"
    exec pnpm --dir "$REPO/web" start -H "$host" -p "${VC_PORT:-3000}"
    ;;
  worker)
    cd "$REPO/viraleditor"
    exec node src/worker/main.ts
    ;;
  *) die "usage: run.sh web|worker" ;;
esac
