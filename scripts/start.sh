#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/var/data}"
mkdir -p "$DATA_DIR" 2>/dev/null || {
  DATA_DIR="/app/data"
  mkdir -p "$DATA_DIR"
}
export DB_PATH="${DB_PATH:-$DATA_DIR/users.db}"
export FLASK_ORIGIN="${FLASK_ORIGIN:-http://127.0.0.1:5000}"
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export SESSION_COOKIE_SECURE="${SESSION_COOKIE_SECURE:-1}"

# Initialize database if it doesn't exist
if [ ! -f "$DB_PATH" ]; then
  echo "Initializing database at $DB_PATH..."
  cd /app/api
  python3 setup_db.py
  echo "Database initialized"
fi

echo "Starting Flask API on 127.0.0.1:5000 (DB_PATH=$DB_PATH)"
cd /app/api
gunicorn server:app \
  --bind 127.0.0.1:5000 \
  --workers "${WEB_CONCURRENCY:-2}" \
  --threads 4 \
  --timeout 120 \
  --access-logfile - \
  --error-logfile - &

# Wait until API accepts connections
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
