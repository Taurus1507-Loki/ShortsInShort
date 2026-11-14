#!/bin/sh
# Nightly MongoDB backup loop (runs in the `backup` service of docker-compose.prod.yml).
# Writes /backups/shortsinshort-YYYYmmdd-HHMM.archive.gz and deletes dumps older than BACKUP_KEEP_DAYS.
# Restore: mongorestore --uri "$MONGO_URI" --gzip --archive=/backups/<file> --drop
set -eu
: "${MONGO_URI:?MONGO_URI is required}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
while true; do
  file="/backups/shortsinshort-$(date -u +%Y%m%d-%H%M).archive.gz"
  if mongodump --uri "$MONGO_URI" --gzip --archive="$file.partial" --quiet; then
    mv "$file.partial" "$file"
    echo "backup ok: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.partial"
    echo "backup FAILED at $(date -u)" >&2
  fi
  find /backups -name 'shortsinshort-*.archive.gz' -mtime +"$KEEP" -delete
  sleep 86400
done
