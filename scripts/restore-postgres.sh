#!/usr/bin/env bash
#
# restore-postgres.sh — restore a tgshop Postgres database from a backup
# produced by ./scripts/backup-postgres.sh.
#
# Usage:
#   ./scripts/restore-postgres.sh <path-to-backup.sql.gz> [--yes]
#
# By default this asks for confirmation before wiping the target database,
# since restore is destructive (it DROPs and recreates the public schema).
# Pass --yes to skip the prompt (e.g. in scripted disaster recovery).
#
# Reads DATABASE_URL from the environment (or .env at repo root if present).
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

BACKUP_FILE="${1:-}"
CONFIRM="${2:-}"

if [[ -z "${BACKUP_FILE}" ]]; then
  echo "Usage: $0 <path-to-backup.sql.gz> [--yes]" >&2
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "[restore-postgres] ERROR: file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

echo "[restore-postgres] Target: ${DATABASE_URL}"
echo "[restore-postgres] Source: ${BACKUP_FILE}"
echo "[restore-postgres] WARNING: this will DROP and recreate the 'public' schema, destroying all current data."

if [[ "${CONFIRM}" != "--yes" ]]; then
  read -r -p "Type 'restore' to continue: " ANSWER
  if [[ "${ANSWER}" != "restore" ]]; then
    echo "[restore-postgres] Aborted."
    exit 1
  fi
fi

echo "[restore-postgres] Dropping and recreating schema public ..."
psql --dbname="${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "[restore-postgres] Restoring from ${BACKUP_FILE} ..."
gunzip -c "${BACKUP_FILE}" | psql --dbname="${DATABASE_URL}" -v ON_ERROR_STOP=1

echo "[restore-postgres] Restore complete. Consider running 'pnpm db:generate' and restarting services."
