#!/bin/bash
# Health check of a running install. Read only. Exit 0 = nothing failed (warnings allowed), 1 = something failed.
#   ops/health.sh [--env-file F]
set -u
. "$(dirname "$0")/lib.sh"

env_file=$(default_env_file)
while [ $# -gt 0 ]; do
  case "$1" in --env-file) env_file=${2:?}; shift ;; -h|--help) sed -n '2,3p' "$0"; exit 0 ;; *) die "unknown option: $1" ;; esac
  shift
done

fails=0
ok()   { printf 'ok    %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
note() { printf 'warn  %s\n' "$*"; }

# ---- env file -------------------------------------------------------------------------------------------------
if [ ! -f "$env_file" ]; then bad "env file missing: $env_file"; printf '\n1 check failed\n'; exit 1; fi
[ "$(mode_of "$env_file")" = 600 ] && ok "env file mode 600" || bad "env file mode is $(mode_of "$env_file"), must be 600"
data_dir=$(env_get "$env_file" VC_DATA_DIR); provider=$(env_get "$env_file" VC_PROVIDER)
host=$(env_get "$env_file" VC_BIND_HOST); host=${host:-127.0.0.1}; port=$(env_get "$env_file" VC_PORT); port=${port:-3000}
secret=$(env_get "$env_file" VC_SESSION_SECRET)
[ "${#secret}" -ge 32 ] && ok "VC_SESSION_SECRET set (${#secret} chars)" || bad "VC_SESSION_SECRET missing or shorter than 32"
case "$provider" in fake|magnific) ok "VC_PROVIDER=$provider (one value for site and worker)" ;; *) bad "VC_PROVIDER must be fake or magnific, is '$provider'" ;; esac
[ -n "$(env_get "$env_file" CLAUDE_CODE_OAUTH_TOKEN)" ] && ok "CLAUDE_CODE_OAUTH_TOKEN set" || bad "CLAUDE_CODE_OAUTH_TOKEN empty: every model call is refused (ops/set-secret.sh)"
if [ "$provider" = magnific ]; then
  [ -n "$(env_get "$env_file" MAGNIFIC_API_KEY)" ] && ok "MAGNIFIC_API_KEY set" || bad "VC_PROVIDER=magnific but MAGNIFIC_API_KEY is empty"
fi
case "$host" in 127.0.0.1) ok "site bound to loopback only" ;; ::1) note "site bound to ::1 (loopback)" ;; *) bind_host_ok "$host" || bad "VC_BIND_HOST='$host' is not loopback or a Tailscale address (wildcard or unknown spelling)"; bind_host_ok "$host" && note "site bound to $host (Tailscale opt-in): confirm that is intended" ;; esac
is_loopback "$host" || [ "$(env_get "$env_file" VC_TRUST_PROXY)" = 1 ] || note "non-loopback bind without VC_TRUST_PROXY: all clients share one rate-limit bucket, one flood blocks everyone's log-in (trust proxy is not safe on this bind)"
{ [ "$(env_get "$env_file" VC_DEMO_LINKS)" = 1 ] && ! is_loopback "$host"; } && bad "VC_DEMO_LINKS=1 with a non-loopback bind: anyone who can reach the site can get a reset link"
[ "$(env_get "$env_file" VC_TRUST_PROXY)" = 1 ] && { [ "$host" = 127.0.0.1 ] && note "VC_TRUST_PROXY=1: correct only if a proxy on this Mac is the sole way in" || bad "VC_TRUST_PROXY=1 with a non-loopback bind: client address headers can be forged"; }
[ "$(env_get "$env_file" VC_TRUST_PROXY)" = cloudflare ] && { is_loopback "$host" && note "VC_TRUST_PROXY=cloudflare: correct only if the Cloudflare Tunnel on this Mac is the sole way in" || bad "VC_TRUST_PROXY=cloudflare with a non-loopback bind: cf-connecting-ip can be forged and the site does not start"; }

payments_env=${VC_PAYMENTS_ENV_FILE:-$HOME/.config/viral-klon/payments.env}
if [ -e "$payments_env" ]; then
  [ "$(mode_of "$payments_env")" = 600 ] && ok "payments.env mode 600" || bad "payments.env mode is $(mode_of "$payments_env"), must be 600"
  [ "$(owner_of "$payments_env")" = "$(id -u)" ] || bad "payments.env is not owned by you"
else note "no payments.env: the site runs on the demo payment ports (no VC_PAYMENTS)"; fi

# ---- launchd --------------------------------------------------------------------------------------------------
for label in app.viralclone.web app.viralclone.worker; do
  state=$(launchctl print "gui/$(id -u)/$label" 2>/dev/null | sed -n 's/^[[:space:]]*state = //p' | head -n 1)
  [ "$state" = running ] && ok "$label running" || bad "$label not running (state: ${state:-not loaded})"
done
launchctl print "gui/$(id -u)/app.viralclone.backup" >/dev/null 2>&1 && ok "daily backup job loaded" || note "daily backup job not loaded"
launchctl print "gui/$(id -u)/app.viralclone.payments" >/dev/null 2>&1 && ok "payments sweep job loaded (every 60 s)" || { [ -e "$payments_env" ] && bad "payments.env exists but the payments sweep job is not loaded: mail delivery and pending expiry would only run by hand"; }

# ---- site -----------------------------------------------------------------------------------------------------
headers=$(curl -s -m 5 -D - -o /dev/null "http://$host:$port/login" 2>/dev/null)
code=$(printf '%s' "$headers" | sed -n '1s/^HTTP\/[0-9.]* \([0-9]*\).*/\1/p')
[ "$code" = 200 ] && ok "site answers /login with 200 ($host:$port)" || bad "site /login at $host:$port answered '${code:-nothing}'"
printf '%s' "$headers" | grep -qi '^content-security-policy:' && ok "security headers present" || note "no Content-Security-Policy header on /login"
listen=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $9}' | sort -u | tr '\n' ' ')
case "$listen" in
  *'*:'*) bad "port $port listens on all interfaces ($listen)" ;;
  '') note "could not read the listener on port $port" ;;
  *) ok "port $port listens on $listen" ;;
esac

# ---- worker ---------------------------------------------------------------------------------------------------
if [ -f "$data_dir/db.sqlite" ]; then
  raw=$(sqlite3 -readonly "$data_dir/db.sqlite" "SELECT value FROM health WHERE id = 1" 2>/dev/null)
  if [ -z "$raw" ]; then bad "worker has not written a health row yet"
  else
    verdict=$(HEALTH_JSON=$raw WANT=$provider node -e '
      const h = JSON.parse(process.env.HEALTH_JSON); const age = Math.round((Date.now() - Date.parse(h.workerAt)) / 1000);
      const out = [];
      out.push(age <= 90 ? "ok    worker heartbeat " + age + " s ago" : "FAIL  worker heartbeat is " + age + " s old (beats every 30 s)");
      out.push(h.provider === process.env.WANT ? "ok    worker provider " + h.provider + " matches the env file" : "FAIL  worker provider " + h.provider + " but env file says " + process.env.WANT);
      out.push(h.renderer === "ready" ? "ok    renderer ready" : "FAIL  renderer not ready");
      out.push(h.note ? "warn  worker note: " + h.note : "ok    worker note empty"); if (h.noCredits) out.push("warn  provider credits: " + h.noCredits);
      console.log(out.join("\n"));' 2>&1)
    printf '%s\n' "$verdict"
    fails=$((fails + $(printf '%s\n' "$verdict" | grep -c '^FAIL')))
  fi
else bad "no database at $data_dir/db.sqlite"; fi
[ -f "$data_dir/site.json" ] && { [ "$(mode_of "$data_dir/site.json")" = 600 ] && ok "site.json mode 600" || bad "site.json mode is $(mode_of "$data_dir/site.json"), must be 600"; } || note "no site.json yet"

# ---- disk and backup ------------------------------------------------------------------------------------------
free_gb=$(df -g "${data_dir:-/}" 2>/dev/null | awk 'NR==2{print $4}')
[ "${free_gb:-0}" -ge 10 ] && ok "disk free ${free_gb} GB" || bad "disk free only ${free_gb:-?} GB (< 10)"
backup_dir=$(env_get "$env_file" VC_BACKUP_DIR)
latest=$(find "${backup_dir:-/nonexistent}" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*-[0-9]*' 2>/dev/null | sort | tail -n 1)
if [ -z "$latest" ]; then note "no backup yet (ops/backup.sh)"
else
  age_h=$(( ($(date +%s) - $(stat -f %m "$latest")) / 3600 ))
  [ "$age_h" -le 36 ] && ok "latest backup ${age_h} h old ($(basename "$latest"))" || note "latest backup is ${age_h} h old ($(basename "$latest"))"
fi

printf '\n'
if [ "$fails" -eq 0 ]; then say "all checks passed"; exit 0; fi
say "$fails check(s) failed"; exit 1
