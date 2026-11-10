#!/bin/bash
# Backup of the data folder: a consistent SQLite copy (.backup, safe while the worker runs) + site.json, into a new dated folder.
#   ops/backup.sh [--env-file F] [--backup-dir D] [--keep N] [--dry-run]
# NEVER deletes. Older backups pile up: when more than --keep (default 14) exist, the extra ones are only LISTED so you remove them by hand.
# Not included: uploads/, video and image files in the data folder (large; see ops/README.md).
set -eu
. "$(dirname "$0")/lib.sh"

env_file=$(default_env_file); backup_dir=""; keep=14; dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) env_file=${2:?}; shift ;;
    --backup-dir) backup_dir=${2:?}; shift ;;
    --keep) keep=${2:?}; shift ;;
    --dry-run) dry=1 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done
check_env_file "$env_file"
data_dir=$(env_get "$env_file" VC_DATA_DIR)
[ -n "$backup_dir" ] || backup_dir=$(env_get "$env_file" VC_BACKUP_DIR)
[ -n "$data_dir" ] || die "VC_DATA_DIR is not set in $env_file"
[ -n "$backup_dir" ] || die "no backup folder: set VC_BACKUP_DIR in the env file or pass --backup-dir"
case "$keep" in ''|*[!0-9]*) die "--keep must be a number" ;; esac
[ -f "$data_dir/db.sqlite" ] || die "no database at $data_dir/db.sqlite (the worker makes it on first start)"

dest="$backup_dir/$(date +%Y%m%d-%H%M%S)"
if [ "$dry" = 1 ]; then
  say "dry-run: would copy $data_dir/db.sqlite (sqlite .backup) and site.json into $dest"
  exit 0
fi

umask 077
mkdir -p "$backup_dir"
mkdir "$dest" || die "backup folder already exists: $dest"
sqlite3 "$data_dir/db.sqlite" ".timeout 10000" ".backup '$dest/db.sqlite'"
check=$(sqlite3 "$dest/db.sqlite" "PRAGMA integrity_check")
[ "$check" = ok ] || die "backup copy of db.sqlite failed its integrity check ($dest): $check"
if [ -f "$data_dir/site.json" ]; then
  # the site writes site.json by tmp file + rename, so a plain copy is always a whole file
  cp -p "$data_dir/site.json" "$dest/site.json"
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$dest/site.json" || die "site.json copy is not valid JSON ($dest)"
else
  warn "no site.json in $data_dir (the site has not run yet)"
fi
( cd "$dest" && shasum -a 256 ./* > MANIFEST.sha256 )
say "backup written: $dest ($(du -sh "$dest" | cut -f1))"

# rotation without deleting: list the surplus, oldest first
total=$(find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*-[0-9]*' | wc -l | tr -d ' ')
if [ "$total" -gt "$keep" ]; then
  extra=$((total - keep))
  warn "$total backups, keeping $keep: remove the $extra oldest by hand when you are sure:"
  find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*-[0-9]*' | sort | head -n "$extra" | sed 's/^/        /' >&2
fi
