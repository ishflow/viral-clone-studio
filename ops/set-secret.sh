#!/bin/bash
# Put one secret into the env file without it touching shell history or the process list: the value is typed at a hidden prompt.
#   ops/set-secret.sh CLAUDE_CODE_OAUTH_TOKEN | MAGNIFIC_API_KEY | VC_ADMIN_PASSWORD | VC_SESSION_SECRET   [--env-file F]
# Replaces that one line; the file stays mode 0600. Restart after: launchctl kickstart -k gui/$UID/app.viralclone.worker (and .web).
# VC_SESSION_SECRET changes end every login. VC_ADMIN_PASSWORD only matters before the first site.json (docs/runbook.md section 13).
set -eu
. "$(dirname "$0")/lib.sh"

name=${1:-}; env_file=$(default_env_file)
[ $# -ge 1 ] || die "usage: set-secret.sh NAME"
shift
while [ $# -gt 0 ]; do
  case "$1" in --env-file) env_file=${2:?}; shift ;; *) die "unknown option: $1" ;; esac
  shift
done
case "$name" in
  CLAUDE_CODE_OAUTH_TOKEN|MAGNIFIC_API_KEY|VC_ADMIN_PASSWORD|VC_SESSION_SECRET) ;;
  *) die "only CLAUDE_CODE_OAUTH_TOKEN, MAGNIFIC_API_KEY, VC_ADMIN_PASSWORD or VC_SESSION_SECRET" ;;
esac
check_env_file "$env_file"
[ -t 0 ] || die "run this in a terminal: the value is typed at a hidden prompt"

printf 'Value for %s (hidden): ' "$name" >&2
IFS= read -rs value; printf '\n' >&2
[ -n "$value" ] || die "empty value: nothing changed"
case "$value" in *"'"*|*[[:cntrl:]]*) die "value must not contain a quote mark or control character" ;; esac
case "$name" in
  VC_ADMIN_PASSWORD) [ "${#value}" -ge 12 ] || die "at least 12 characters" ;;
  VC_SESSION_SECRET) [ "${#value}" -ge 32 ] || die "at least 32 characters" ;;
esac

umask 077
tmp="$env_file.tmp.$$"
# the value goes in through the environment, not argv (argv shows in `ps`)
SECRET_VALUE=$value awk -v key="$name" 'BEGIN{done=0} $0 ~ "^"key"=" {print key"='\''"ENVIRON["SECRET_VALUE"]"'\''"; done=1; next} {print} END{if(!done) print key"='\''"ENVIRON["SECRET_VALUE"]"'\''"}' "$env_file" > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$env_file"
say "$name updated in $env_file (mode $(mode_of "$env_file")). Restart the services to use it."
