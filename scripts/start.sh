#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/var/data}"
mkdir -p "$DATA_DIR" 2>/dev/null || {
  DATA_DIR="/app/data"
  mkdir -p "$DATA_DIR"
}
export DB_PATH="${DB_PATH:-$DATA_DIR/users.db}"
export SCAN_PHOTOS_DIR="${SCAN_PHOTOS_DIR:-$DATA_DIR/scan_photos}"
export FLASK_ORIGIN="${FLASK_ORIGIN:-http://127.0.0.1:5000}"
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export SESSION_COOKIE_SECURE="${SESSION_COOKIE_SECURE:-1}"

mkdir -p "$SCAN_PHOTOS_DIR"

# Initialize local SQLite if missing (persistent disk keeps it across redeploys)
if [ ! -f "$DB_PATH" ]; then
  echo "Initializing database at $DB_PATH..."
  cd /app/api
  python3 setup_db.py
  echo "Database initialized"
fi

echo "Starting Flask API on 127.0.0.1:5000 (DB_PATH=$DB_PATH)"
cd /app/api
# Single worker avoids SQLite write-lock fights under gunicorn
gunicorn server:app \
  --bind 127.0.0.1:5000 \
  --workers "${WEB_CONCURRENCY:-1}" \
  --threads 8 \
  --timeout "${GUNICORN_TIMEOUT:-180}" \
  --graceful-timeout 30 \
  --access-logfile - \
  --error-logfile - &

i=0
until curl -sf "http://127.0.0.1:5000/api/check-auth" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "Flask failed to become ready" >&2
    exit 1
  fi
  sleep 0.5
done
echo "Flask is ready"

echo "Starting Next.js on 0.0.0.0:${PORT}"
cd /app/web
exec node server.js
