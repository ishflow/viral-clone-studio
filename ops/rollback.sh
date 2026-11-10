#!/bin/bash
# Take viralclone out of launchd. DRY-RUN unless --apply. Moves the plists aside (not deleted); the env file, data and backups stay untouched.
#   ops/rollback.sh [--apply]
set -eu
. "$(dirname "$0")/lib.sh"
apply=0
case "${1:-}" in --apply) apply=1 ;; '') ;; *) die "usage: rollback.sh [--apply]" ;; esac
stamp=$(date +%Y%m%d-%H%M%S); aside="$LOG_DIR/plists-removed-$stamp"
say "== viralclone rollback ($([ "$apply" = 1 ] && echo APPLY || echo DRY-RUN)) =="
for label in $LABELS; do
  target="$LAUNCH_AGENTS/$label.plist"
  if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
    if [ "$apply" = 1 ]; then launchctl bootout "gui/$(id -u)/$label"; say "stopped: $label"; else say "would stop: $label"; fi
  else say "not loaded: $label"; fi
  if [ -f "$target" ]; then
    if [ "$apply" = 1 ]; then mkdir -p "$aside"; mv "$target" "$aside/"; say "moved: $target -> $aside/"; else say "would move: $target -> $aside/"; fi
  fi
done
say "kept: env file ($(default_env_file)), data and backups. Restore data: ops/README.md, 'Restore'."
