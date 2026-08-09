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

# E2.1.Micro (1 GB) cannot finish `next build` without swap — create 2G if missing
ensure_swap() {
  local mem_kb swap_kb
  mem_kb="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
  swap_kb="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo)"
  # Only auto-add swap on small VMs (< 2.5 GB RAM) with little/no swap
  if [ "${mem_kb:-0}" -lt 2500000 ] && [ "${swap_kb:-0}" -lt 1000000 ]; then
    if [ ! -f /swapfile ]; then
      echo "==> Low RAM detected — creating 2G swap (needed for Next.js build)"
      sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress
      sudo chmod 600 /swapfile
      sudo mkswap /swapfile
      sudo swapon /swapfile
      if ! grep -q '^/swapfile ' /etc/fstab 2>/dev/null; then
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
      fi
    elif ! swapon --show | grep -q /swapfile; then
      echo "==> Enabling existing /swapfile"
      sudo swapon /swapfile
    fi
    free -h
  fi
}
ensure_swap

echo "==> Building and starting (first Next.js build can take 10–25 min on 1 GB + swap)"
DOCKER_BUILDKIT=1 docker compose up -d --build

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
