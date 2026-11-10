#!/bin/bash
# One tick of the payments sweep (mail delivery, pending-checkout expiry, refund retries): POST /api/payments/sweep with the cron secret.
# launchd runs it every 60 s (app.viralclone.payments). The secret never appears in argv, a log or a plist: it goes to curl through a
# config read from stdin (`-K -`), and only the HTTP status is printed.
set -eu
. "$(dirname "$0")/lib.sh"

env_file=$(default_env_file)
check_env_file "$env_file"
payments_env=${VC_PAYMENTS_ENV_FILE:-$HOME/.config/viral-klon/payments.env}
if [ -e "$payments_env" ]; then check_env_file "$payments_env"; fi

set -a
# shellcheck disable=SC1090
. "$env_file"
# shellcheck disable=SC1090
if [ -e "$payments_env" ]; then . "$payments_env"; fi
set +a

if [ -z "${INTERNAL_CRON_SECRET:-}" ]; then say "skipped: INTERNAL_CRON_SECRET is not set (main env or payments env)"; exit 0; fi
[ "${#INTERNAL_CRON_SECRET}" -ge 32 ] || die "INTERNAL_CRON_SECRET must be at least 32 characters"
# the secret goes into a quoted curl config line: refuse the characters that would break it
case "$INTERNAL_CRON_SECRET" in *[!A-Za-z0-9._~+/=-]*) die "INTERNAL_CRON_SECRET may contain only letters, digits and . _ ~ + / = -" ;; esac

host=${VC_BIND_HOST:-127.0.0.1}
check_bind_host "$host"
url="http://$host:${VC_PORT:-3000}/api/payments/sweep"

# printf is a shell builtin: the secret is not in any process list
code=$(printf 'header = "Authorization: Bearer %s"\n' "$INTERNAL_CRON_SECRET" \
  | curl -sS -K - -X POST -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 50 "$url") || die "payments sweep: the site did not answer at $url"
case "$code" in
  2??) ;;                                     # silent on success: launchd calls this every minute
  401) die "payments sweep: 401, INTERNAL_CRON_SECRET does not match the one the site started with (restart the site after changing it)" ;;
  *) die "payments sweep: HTTP $code" ;;
esac
