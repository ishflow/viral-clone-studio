#!/bin/bash
# Shared helpers for ops/*.sh. Sourced, never run. Written for bash 3.2 (the macOS default): no associative arrays, no ${x,,}.

OPS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$OPS_DIR/.." && pwd)
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/viralclone"
LABELS="app.viralclone.web app.viralclone.worker app.viralclone.backup app.viralclone.payments"

say()  { printf '%s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*" >&2; }
die()  { printf 'ERROR %s\n' "$*" >&2; exit 1; }

default_env_file() { printf '%s' "${VC_ENV_FILE:-$HOME/.config/viralclone/env}"; }

# Octal mode and owner of a path (macOS stat).
mode_of()  { stat -f '%Lp' "$1"; }
owner_of() { stat -f '%u' "$1"; }

# Read NAME from the env file WITHOUT sourcing it (health checks must not execute the file). Values are single-quoted: NAME='value'.
env_get() {
  local file=$1 name=$2 line
  line=$(grep -E "^${name}=" "$file" | tail -n 1) || true
  line=${line#"${name}="}
  line=${line#\'}; line=${line%\'}
  printf '%s' "$line"
}

# The env file is a secret: only the owner may read it, and only the owner may have made it.
check_env_file() {
  local file=$1
  [ -f "$file" ] || die "env file not found: $file (run ops/install.sh --apply first)"
  [ "$(mode_of "$file")" = "600" ] || die "env file must be mode 600, is $(mode_of "$file"): chmod 600 '$file'"
  [ "$(owner_of "$file")" = "$(id -u)" ] || die "env file is not owned by you: $file"
}

# True when every entry of a comma-separated mail allow-list is a full address (has an @). `*`, a bare domain, an empty entry or an
# empty list lets strangers in: the owner test does not start with one (the same rule as web/src/core/paid-mode.ts).
mail_allow_names_people() {
  local open=',[^@,]*,'
  ! [[ ",$1," =~ $open ]]
}

# Empty means the default (127.0.0.1) wherever the site is started.
is_loopback() { case "$1" in ''|127.0.0.1|::1) return 0 ;; *) return 1 ;; esac; }

# Allow-list, not a deny-list: loopback or ONE Tailscale address (100.64.0.0/10); every other spelling (::0, 0, [::], hostnames) is refused.
bind_host_ok() {
  case "$1" in
    127.0.0.1|::1) return 0 ;;
    100.*.*.*)
      local a b c d rest; IFS=. read -r a b c d rest <<EOF2
$1
EOF2
      [ -z "$rest" ] || return 1
      local o
      for o in "$b" "$c" "$d"; do case "$o" in 0|[1-9]|[1-9][0-9]|[1-9][0-9][0-9]) [ "$o" -le 255 ] || return 1 ;; *) return 1 ;; esac; done
      [ "$b" -ge 64 ] && [ "$b" -le 127 ] ;;
    *) return 1 ;;
  esac
}

# A bind address other than loopback is an explicit opt-in (docs/runbook.md section 5); a wildcard is never allowed.
check_bind_host() {
  bind_host_ok "$1" || die "VC_BIND_HOST='$1' is not allowed: bind 127.0.0.1 or one Tailscale address (100.64.0.0/10), never a wildcard"
}
