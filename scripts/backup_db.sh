#!/usr/bin/env bash
# Daily PostgreSQL backup for Reserve.
#   DATABASE_URL=postgresql://user:pass@host:5432/reserve ./scripts/backup_db.sh
# Cron example (03:30 every night, keep 14 days):
#   30 3 * * * cd /srv/reserve && DATABASE_URL=... KEEP_DAYS=14 ./scripts/backup_db.sh >> backups/backup.log 2>&1
# Restore:
#   pg_restore --clean --if-exists -d "$DATABASE_URL" backups/reserve-YYYYmmdd-HHMMSS.dump
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
# pg_dump does not understand SQLAlchemy's "+psycopg" driver suffix
URL="${DATABASE_URL/+psycopg/}"

mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/reserve-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --file="$file" "$URL"
echo "$(date -Iseconds) backup written: $file ($(du -h "$file" | cut -f1))"

# Uploaded images live outside the database; archive them too.
MEDIA_DIR="${MEDIA_DIR:-$(dirname "$0")/../backend/media}"
if [ -d "$MEDIA_DIR" ]; then
  tar -czf "${file%.dump}-media.tar.gz" -C "$MEDIA_DIR" .
fi

find "$BACKUP_DIR" -name 'reserve-*' -mtime +"$KEEP_DAYS" -delete
