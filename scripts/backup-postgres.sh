#!/usr/bin/env bash
#
# backup-postgres.sh — daily pg_dump of the tgshop Postgres database, gzipped,
# with rotation of old backups.
#
# Usage:
#   ./scripts/backup-postgres.sh
#
# Reads DATABASE_URL from the environment (or .env at repo root if present).
# Writes to $BACKUP_DIR (default: ./backups), named tgshop_YYYY-mm-dd_HHMMSS.sql.gz
# Deletes backups older than $RETENTION_DAYS (default: 14).
#
# Cron example (daily at 03:15):
#   15 3 * * * cd /opt/tgshop && ./scripts/backup-postgres.sh >> /var/log/tgshop-backup.log 2>&1
#
# Restore: see ./scripts/restore-postgres.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL must be set (env or .env)}"

BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y-%m-%d_%H%M%S)"
OUT_FILE="${BACKUP_DIR}/tgshop_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[backup-postgres] Dumping database to ${OUT_FILE} ..."

# --format=plain (default) piped through gzip keeps the restore path simple
# (psql < gunzip'd file) as documented in restore-postgres.sh. Use --no-owner
# and --no-privileges so restores work regardless of the target role name.
if command -v pg_dump >/dev/null 2>&1; then
  pg_dump --no-owner --no-privileges --dbname="${DATABASE_URL}" | gzip -9 > "${OUT_FILE}"
else
  echo "[backup-postgres] pg_dump not found locally, falling back to docker compose exec ..." >&2
  docker compose -f "${REPO_ROOT}/docker-compose.yml" exec -T postgres \
    pg_dump --no-owner --no-privileges -U tgshop -d tgshop | gzip -9 > "${OUT_FILE}"
fi

BYTES="$(wc -c < "${OUT_FILE}" | tr -d ' ')"
if [[ "${BYTES}" -lt 100 ]]; then
  echo "[backup-postgres] ERROR: backup file is suspiciously small (${BYTES} bytes), aborting rotation to avoid deleting good backups." >&2
  exit 1
fi

echo "[backup-postgres] Wrote $(du -h "${OUT_FILE}" | cut -f1) to ${OUT_FILE}"

echo "[backup-postgres] Rotating backups older than ${RETENTION_DAYS} days in ${BACKUP_DIR} ..."
find "${BACKUP_DIR}" -maxdepth 1 -name 'tgshop_*.sql.gz' -type f -mtime "+${RETENTION_DAYS}" -print -delete

echo "[backup-postgres] Done."
