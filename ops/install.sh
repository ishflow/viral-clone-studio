#!/bin/bash
# Production setup kit: writes the env file (secrets, mode 0600) and the launchd plists. DRY-RUN unless --apply.
#   ops/install.sh                      show what would be done, change nothing
#   ops/install.sh --apply              write the files (still does not start anything)
#   ops/install.sh --apply --load       also launchctl bootstrap web, worker and the daily backup
# Options: --data-dir D  --backup-dir D  --env-file F  --provider fake|magnific  --bind-host IP  --port N  --trust-proxy  --demo-links
#          --admin-password-prompt | --admin-password-generate   (default: prompt on a terminal, else generate)
# Details: ops/README.md. Nothing is deleted; an existing env file is never rewritten.
set -eu
. "$(dirname "$0")/lib.sh"

apply=0; load=0
data_dir="$HOME/viralclone-data"; backup_dir="$HOME/viralclone-backups"; env_file=$(default_env_file)
provider=fake; bind_host=127.0.0.1; port=3000; trust_proxy=0; demo_links=0; admin_mode=auto

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --load) load=1 ;;
    --data-dir) data_dir=${2:?}; shift ;;
    --backup-dir) backup_dir=${2:?}; shift ;;
    --env-file) env_file=${2:?}; shift ;;
    --provider) provider=${2:?}; shift ;;
    --bind-host) bind_host=${2:?}; shift ;;
    --port) port=${2:?}; shift ;;
    --trust-proxy) trust_proxy=1 ;;
    --demo-links) demo_links=1 ;;
    --admin-password-prompt) admin_mode=prompt ;;
    --admin-password-generate) admin_mode=generate ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

# ---- validate input -------------------------------------------------------------------------------------------
for v in "$data_dir" "$backup_dir" "$env_file" "$REPO" "$HOME"; do
  case "$v" in *'|'*|*'&'*|*'\'*|*"'"*|*'"'*|*'<'*|*'>'*) die "path with a special character is not supported: $v" ;; esac
  case "$v" in /*) ;; *) die "paths must be absolute: $v" ;; esac
done
case "$provider" in fake|magnific) ;; *) die "--provider must be fake or magnific" ;; esac
case "$port" in ''|*[!0-9]*) die "--port must be a number" ;; esac
check_bind_host "$bind_host"
if [ "$trust_proxy" = 1 ] && [ "$bind_host" != 127.0.0.1 ]; then
  die "--trust-proxy only with --bind-host 127.0.0.1: the proxy must be the only way in, otherwise anyone can forge the client address headers"
fi
if [ "$demo_links" = 1 ] && [ "$provider" != fake ]; then die "--demo-links only with --provider fake: those links hand a verification or reset token to whoever asks"; fi
if [ "$demo_links" = 1 ] && ! is_loopback "$bind_host"; then die "--demo-links only with --bind-host 127.0.0.1: anyone who can reach the site could ask for an admin password reset link"; fi
[ "$(uname)" = Darwin ] || die "launchd setup is for macOS"

mode=DRY-RUN; [ "$apply" = 1 ] && mode=APPLY
say "== viralclone install ($mode) =="
say "repo: $REPO"; say "data: $data_dir"; say "backups: $backup_dir"; say "env file: $env_file"
say "provider: $provider (site AND worker read it from the one env file)"; say "site bind: $bind_host:$port"

# ---- checks (read only) ---------------------------------------------------------------------------------------
node_bin=$(command -v node) || die "node not found in PATH"
pnpm_bin=$(command -v pnpm) || die "pnpm not found in PATH"
command -v sqlite3 >/dev/null || die "sqlite3 not found (needed by backup and health)"
command -v openssl >/dev/null || die "openssl not found (needed to make the session secret)"
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" -ge 24 ] || die "node $node_major is too old: the worker runs TypeScript directly and needs node 24 or newer"
tool_path="$(dirname "$node_bin")"
[ "$(dirname "$pnpm_bin")" = "$(dirname "$node_bin")" ] || tool_path="$tool_path:$(dirname "$pnpm_bin")"
tool_path="$tool_path:/usr/local/bin:/usr/bin:/bin"
# The worker starts these by name (the plist PATH is all launchd gives it): claude (often ~/.local/bin), yt-dlp, ffmpeg, ffprobe.
for tool in claude yt-dlp ffmpeg ffprobe; do
  tool_bin=$(command -v "$tool" 2>/dev/null) || { warn "$tool not found on this PATH: the worker will not find it either"; continue; }
  tool_dir=$(dirname "$tool_bin")
  case ":$tool_path:" in *":$tool_dir:"*) ;; *) tool_path="$tool_path:$tool_dir" ;; esac
done
[ -d "$REPO/viraleditor/node_modules" ] || warn "viraleditor/node_modules is missing: pnpm --dir '$REPO/viraleditor' install"
[ -d "$REPO/web/node_modules" ] || warn "web/node_modules is missing: pnpm --dir '$REPO/web' install"
[ -f "$REPO/web/.next/BUILD_ID" ] || warn "no production build yet: pnpm --dir '$REPO/web' build   (the site will not start without it)"
for synced in "$data_dir" "$backup_dir"; do
  case "$synced" in "$HOME/Library/CloudStorage"*|*Nextcloud*|*Dropbox*|*"Mobile Documents"*) warn "folder looks synced ($synced): a sync client can make conflict copies of SQLite and site.json; keep it on a plain local folder" ;; esac
done

# ---- env file -------------------------------------------------------------------------------------------------
make_env=0
if [ -e "$env_file" ]; then
  say "env file exists: kept as is (never rewritten; change a value with ops/set-secret.sh)"
  [ "$(mode_of "$env_file")" = 600 ] || warn "env file mode is $(mode_of "$env_file"), must be 600: chmod 600 '$env_file'"
else
  make_env=1
  say "env file: $([ "$apply" = 1 ] && echo "creating" || echo "would be created"), mode 0600, directory 0700. Keys:"
  say "  VC_ENGINE=sqlite  VC_DATA_DIR  VC_BACKUP_DIR  VC_PROVIDER=$provider  VC_BIND_HOST  VC_PORT"
  say "  VC_SESSION_SECRET=<random 32 bytes>   VC_ADMIN_PASSWORD=<yours or generated>"
  say "  VC_MAIL=fake  RESEND_API_KEY=<empty>  MAIL_FROM=<empty>  VC_MAIL_ALLOW=<empty>  MAIL_FOOTER_ADDRESS=<optional>  INTERNAL_CRON_SECRET=<empty>"
  say "  CLAUDE_CODE_OAUTH_TOKEN=<empty: add with ops/set-secret.sh>   MAGNIFIC_API_KEY=<empty: add with ops/set-secret.sh>"
  [ "$trust_proxy" = 1 ] && say "  VC_TRUST_PROXY=1"
  [ "$demo_links" = 1 ] && say "  VC_DEMO_LINKS=1 (demo only: verification/reset links shown on the page)"
fi

if [ "$apply" = 1 ] && [ "$make_env" = 1 ]; then
  admin_pw=""; shown=0
  if [ "$admin_mode" = auto ]; then if [ -t 0 ]; then admin_mode=prompt; else admin_mode=generate; fi; fi
  if [ "$admin_mode" = prompt ]; then
    printf 'Admin password (12+ characters, no quote marks; empty = generate one): ' >&2
    IFS= read -rs admin_pw; printf '\n' >&2
  fi
  if [ -z "$admin_pw" ]; then
    admin_pw=$(openssl rand -base64 24 | tr -d '=+/\n' | cut -c1-24); shown=1
  fi
  [ "${#admin_pw}" -ge 12 ] || die "admin password must be at least 12 characters"
  case "$admin_pw" in *"'"*|*[[:cntrl:]]*) die "admin password must not contain a quote mark or control character" ;; esac

  secret=$(openssl rand -base64 32 | tr -d '\n')
  umask 077
  mkdir -p "$(dirname "$env_file")"; chmod 700 "$(dirname "$env_file")"
  {
    printf '# viralclone secrets. Mode 0600. Never commit, never paste into chat. Change values with ops/set-secret.sh.\n'
    printf "VC_ENGINE='sqlite'\n"
    printf "VC_DATA_DIR='%s'\n" "$data_dir"
    printf "VC_BACKUP_DIR='%s'\n" "$backup_dir"
    printf "# site and worker both read this one value (a mismatch would make the site sell what the worker fakes, or the reverse)\n"
    printf "VC_PROVIDER='%s'\n" "$provider"
    printf "VC_BIND_HOST='%s'\n" "$bind_host"
    printf "VC_PORT='%s'\n" "$port"
    printf "VC_SESSION_SECRET='%s'\n" "$secret"
    printf "# read only when the first site.json is made; later it lives as a hash in site.json (docs/runbook.md section 13)\n"
    printf "VC_ADMIN_PASSWORD='%s'\n" "$admin_pw"
    printf "# claude setup-token, then: ops/set-secret.sh CLAUDE_CODE_OAUTH_TOKEN\n"
    printf "CLAUDE_CODE_OAUTH_TOKEN=''\n"
    printf "# only with VC_PROVIDER=magnific: ops/set-secret.sh MAGNIFIC_API_KEY\n"
    printf "MAGNIFIC_API_KEY=''\n"
    printf "# Real email: fill the three fields and set VC_MAIL=resend; empty allowlist refuses startup.\nVC_MAIL='fake'\nRESEND_API_KEY=''\nMAIL_FROM=''\nVC_MAIL_ALLOW=''\nMAIL_FOOTER_ADDRESS=''\nINTERNAL_CRON_SECRET=''\n"
    if [ "$demo_links" = 1 ]; then printf "# demo on this Mac only: the site shows verification and reset links itself (no email provider yet)\nVC_DEMO_LINKS='1'\n"; fi
    if [ "$trust_proxy" = 1 ]; then printf "# only behind a proxy on this Mac that overwrites x-forwarded-for\nVC_TRUST_PROXY='1'\n"; fi
  } > "$env_file"
  chmod 600 "$env_file"
  say "env file written: $env_file (0600)"
  if [ "$shown" = 1 ]; then
    say "GENERATED ADMIN PASSWORD (shown once, write it into your password manager now): $admin_pw"
  fi
fi

# ---- folders --------------------------------------------------------------------------------------------------
for d in "$data_dir" "$backup_dir" "$LOG_DIR" "$LAUNCH_AGENTS"; do
  if [ -d "$d" ]; then say "folder exists: $d"
  elif [ "$apply" = 1 ]; then mkdir -p "$d"; say "folder made: $d"
  else say "folder would be made: $d"; fi
done
[ "$apply" = 1 ] && { chmod 700 "$data_dir" "$backup_dir"; }

# ---- plists ---------------------------------------------------------------------------------------------------
render() {
  sed -e "s|@REPO@|$REPO|g" -e "s|@HOME@|$HOME|g" -e "s|@PATH@|$tool_path|g" -e "s|@ENV_FILE@|$env_file|g" "$OPS_DIR/launchd/$1.plist"
}
stamp=$(date +%Y%m%d-%H%M%S)
for label in $LABELS; do
  target="$LAUNCH_AGENTS/$label.plist"
  render "$label" | plutil -lint - >/dev/null || die "rendered $label.plist does not pass plutil -lint"
  if [ -f "$target" ] && [ "$(render "$label" | cmp -s - "$target" && echo same)" = same ]; then
    say "plist up to date: $target"; continue
  fi
  if [ "$apply" = 1 ]; then
    if [ -f "$target" ]; then
      mkdir -p "$LOG_DIR/plist-backups"; cp -p "$target" "$LOG_DIR/plist-backups/$label.plist.$stamp"
      say "old plist copied to $LOG_DIR/plist-backups/$label.plist.$stamp"
    fi
    render "$label" > "$target"; chmod 644 "$target"; say "plist written: $target"
  else
    say "plist would be written: $target (rendered and lint-checked OK)"
  fi
done

# ---- load -----------------------------------------------------------------------------------------------------
if [ "$load" = 1 ]; then
  [ "$apply" = 1 ] || say "--load needs --apply: nothing started"
  if [ "$apply" = 1 ]; then
    [ -f "$env_file" ] || die "no env file"
    for label in app.viralclone.worker app.viralclone.web app.viralclone.backup app.viralclone.payments; do
      if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then say "already loaded: $label (restart: launchctl kickstart -k gui/$(id -u)/$label)"
      else launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENTS/$label.plist"; say "loaded: $label"; fi
    done
  fi
else
  say "not started. Start: ops/install.sh --apply --load   (start the worker before the site: it makes the database)"
fi

if [ "$apply" = 0 ]; then say "== dry-run only: nothing was written. Re-run with --apply =="; fi
say "Next: ops/set-secret.sh CLAUDE_CODE_OAUTH_TOKEN   then   ops/health.sh   (docs/launch-checklist.md for the rest)"
