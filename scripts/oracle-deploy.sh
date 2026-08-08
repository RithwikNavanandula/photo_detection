#!/usr/bin/env bash
# Build and (re)start Label Scanner on this VM.
# Run from the repo root:  bash scripts/oracle-deploy.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  cp .env.oracle.example .env
  echo "Created .env from .env.oracle.example — edit FLASK_SECRET_KEY before production use."
fi

# Ensure secret is not the placeholder if user forgot
if grep -q 'change-me-to-a-long-random-string' .env 2>/dev/null; then
  NEW_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 32)"
  sed -i "s/FLASK_SECRET_KEY=.*/FLASK_SECRET_KEY=${NEW_SECRET}/" .env
  echo "Generated a random FLASK_SECRET_KEY in .env"
fi

echo "==> Building and starting (this can take several minutes on Ampere free tier)"
docker compose up -d --build

echo ""
echo "==> Status"
docker compose ps
echo ""
PUBLIC_IP="$(curl -fsS -m 3 ifconfig.me 2>/dev/null || curl -fsS -m 3 icanhazip.com 2>/dev/null || echo YOUR_PUBLIC_IP)"
PORT="$(grep -E '^HOST_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 3000)"
PORT="${PORT:-3000}"
echo "App should be at: http://${PUBLIC_IP}:${PORT}"
echo "Logs: docker compose logs -f"
echo "Data volume: docker volume inspect photo_detection_label_scanner_data  (name may vary)"
