#!/bin/sh
# FeedElity server entrypoint.
#
# On first start, seeds the live database from the read-only dev snapshot so a
# fresh stack already has the catalog/subscriptions/credentials from local dev
# without needing a manual re-import. On every subsequent start the existing
# database is reused untouched, so data survives restarts.
#
# Layout:
#   ${DATABASE_DIR}/local.db   live database (persisted via a named volume)
#   ${SEED_DB_PATH}            read-only dev snapshot bind-mounted from the host
set -eu

DATABASE_DIR="${DATABASE_DIR:-/data}"
DATABASE_FILE="${DATABASE_DIR}/local.db"
SEED_DB_PATH="${SEED_DB_PATH:-/seed/local.db}"

mkdir -p "${DATABASE_DIR}"

if [ -f "${DATABASE_FILE}" ]; then
  echo "[feedelity] Existing database found at ${DATABASE_FILE}; reusing it."
else
  if [ -f "${SEED_DB_PATH}" ]; then
    SEED_SIZE=$(wc -c < "${SEED_DB_PATH}" | tr -d ' ')
    echo "[feedelity] Seeding ${DATABASE_FILE} from ${SEED_DB_PATH} (${SEED_SIZE} bytes) on first start."
    cp "${SEED_DB_PATH}" "${DATABASE_FILE}"
    # libsql file databases use a sibling -wal file; drop any stale wal so the
    # copied snapshot starts clean and writes land in the live database.
    rm -f "${DATABASE_FILE}-wal" "${DATABASE_FILE}-shm"
  else
    echo "[feedelity] No seed database at ${SEED_DB_PATH}; starting with an empty database. Ingestion tables must be created separately."
  fi
fi

DATABASE_URL="file:${DATABASE_FILE}"
export DATABASE_URL

echo "[feedelity] Starting server with DATABASE_URL=${DATABASE_URL} PORT=${PORT:-31001}"
exec bun run dist/index.mjs
