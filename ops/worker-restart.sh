#!/bin/bash
# Restart the worker (launchd app.viralclone.worker) ONLY when no video is in the making. Never writes to the database.
#   ops/worker-restart.sh [--dry-run] [--force] [--env-file F] [--data-dir D]
# A video in the making (a produce run `running`, its worker beat in the last 60 s) is cut by a restart: the request that is on its way to the
# provider in that moment (a few seconds per request) ends as submission-unknown, and an operator settles it by hand (docs/runbook.md).
# --force restarts anyway; --dry-run only says what it would do (and refuses exactly as the real run does). Without --data-dir the folder comes from the env file;
# --data-dir (look at another database, e.g. a trial's) is accepted only with --dry-run: the worker that is restarted is always the live one.
set -eu
. "$(dirname "$0")/lib.sh"

LABEL=app.viralclone.worker
STALE_SECONDS=60                                                  # as STALE_MS in viraleditor/src/db/runs.ts
env_file=$(default_env_file); data_dir=""; dry=0; force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) env_file=${2:?}; shift ;;
    --data-dir) data_dir=${2:?}; shift ;;
    --dry-run) dry=1 ;;
    --force) force=1 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done
if [ -n "$data_dir" ] && [ "$dry" != 1 ]; then
  die "--data-dir only goes with --dry-run: the worker that is restarted is always the live one, whatever folder is looked at; nothing was restarted"
fi
if [ -z "$data_dir" ]; then
  check_env_file "$env_file"
  data_dir=$(env_get "$env_file" VC_DATA_DIR)
  [ -n "$data_dir" ] || die "VC_DATA_DIR is not set in $env_file"
fi
db="$data_dir/db.sqlite"
# without the database nothing can be said about what is in the making: not even --force goes on
[ -f "$db" ] || die "no database at $db: cannot tell whether a video is in the making, nothing was restarted"

# not `-readonly`: a WAL database nobody holds open (the worker is down) cannot be opened that way; `query_only` writes nothing either
count() { sqlite3 "$db" ".timeout 5000" "PRAGMA query_only = 1;" "$1" || die "could not read $db"; }
noun() { if [ "$1" = 1 ]; then printf '1 video'; else printf '%s videos' "$1"; fi; }
live="kind = 'produce' AND state = 'running' AND claimed_by IS NOT NULL AND (heartbeat IS NULL OR heartbeat >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-$STALE_SECONDS seconds'))"
making=$(count "SELECT COUNT(*) FROM runs WHERE $live")
orphans=$(count "SELECT COUNT(*) FROM runs WHERE kind = 'produce' AND state = 'running' AND NOT ($live)")
if [ "$orphans" -gt 0 ]; then
  if [ "$orphans" = 1 ]; then say "note: 1 video has no worker (given back, or no beat for over $STALE_SECONDS s): the next worker takes it over"; else say "note: $orphans videos have no worker (given back, or no beat for over $STALE_SECONDS s): the next worker takes them over"; fi
fi
queued=$(count "SELECT COUNT(*) FROM runs WHERE kind = 'produce' AND state = 'queued'")
if [ "$queued" -gt 0 ]; then
  warn "$(noun "$queued") waiting in the queue: a worker that takes one between this check and the restart is cut by it (rare; it is given back and taken over)"
fi

if [ "$making" -gt 0 ]; then
  say "$(noun "$making") in the making (run, worker, last beat):"
  count "SELECT '  ' || substr(id, 1, 8) || '  ' || COALESCE(claimed_by, '-') || '  ' || COALESCE(heartbeat, '-') FROM runs WHERE $live ORDER BY created_at"
  if [ "$force" != 1 ]; then
    die "$(noun "$making") in the making: a restart now cuts them. Wait until they are done, or restart anyway with --force (a request on its way to the provider ends as submission-unknown and is settled by hand)"
  fi
  warn "--force: restarting with $(noun "$making") in the making; every request that is on its way to the provider in this moment ends as submission-unknown (settle it by hand: docs/runbook.md section 9, never send it again)"
fi

target="gui/$(id -u)/$LABEL"
if [ "$dry" = 1 ]; then say "dry-run: would restart $LABEL (launchctl kickstart -k $target)"; exit 0; fi
launchctl print "$target" >/dev/null 2>&1 || die "$LABEL is not loaded in launchd: nothing to restart (ops/install.sh --apply --load)"
launchctl kickstart -k "$target"
say "restarted: $LABEL. Check: ops/health.sh"
