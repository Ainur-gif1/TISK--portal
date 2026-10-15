#!/usr/bin/env bash
# PostgreSQL backup for the College Portal (Linux server).
# This script is a template. It does not install itself or schedule jobs.
set -Eeuo pipefail
umask 077

: "${PGDATABASE:?PGDATABASE is required}"
: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"

command -v pg_dump >/dev/null || { echo "pg_dump not found" >&2; exit 1; }
command -v pg_restore >/dev/null || { echo "pg_restore not found" >&2; exit 1; }

mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"

# Prevent overlapping backup jobs. Ensure the machine has flock (standard on Linux).
command -v flock >/dev/null || { echo "flock not found" >&2; exit 1; }
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo "Another backup is running" >&2; exit 1; }

tmp_file="$(mktemp "$BACKUP_DIR/.college-XXXXXXXX.dump")"
trap 'rm -f -- "$tmp_file"' EXIT
out_file="$BACKUP_DIR/college_$(date -u +%Y%m%dT%H%M%SZ).dump"

# libpq reads PGHOST, PGPORT, PGUSER, PGDATABASE and, if specified, PGPASSFILE.
# Use a protected .pgpass file rather than putting a database password into code.
pg_dump --format=custom --no-owner --file="$tmp_file" "$PGDATABASE"
test -s "$tmp_file"
pg_restore --list "$tmp_file" >/dev/null
mv -- "$tmp_file" "$out_file"

# Keep backups for roughly seven days. This is NOT a substitute for offsite storage.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'college_*.dump' -mtime +6 -delete
printf 'Backup created: %s\n' "$out_file"
