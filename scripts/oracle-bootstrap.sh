#!/usr/bin/env bash
# Bootstrap an Oracle Cloud Always Free Ubuntu VM for Label Scanner.
# Run ONCE on a fresh VM as a user with sudo:
#   curl -fsSL ... | bash
# or:
#   bash scripts/oracle-bootstrap.sh

set -euo pipefail

echo "==> Installing Docker Engine + Compose plugin"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg git

if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if ! groups | grep -q docker; then
  sudo usermod -aG docker "$USER" || true
  echo "NOTE: log out/in (or reboot) so docker works without sudo."
fi

echo "==> Allowing port 3000 in local firewall (if ufw is active)"
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 22/tcp || true
  sudo ufw allow 3000/tcp || true
  sudo ufw allow 80/tcp || true
  sudo ufw allow 443/tcp || true
fi

echo ""
echo "Bootstrap done."
echo "Next:"
echo "  1) Clone your repo (or scp it) into ~/photo_detection"
echo "  2) cp .env.oracle.example .env && nano .env"
echo "  3) docker compose up -d --build"
echo "  4) Open OCI Console → Networking → Security Lists → Ingress:"
echo "       Source 0.0.0.0/0  TCP  3000"
echo "  5) Visit http://YOUR_PUBLIC_IP:3000"
echo ""
echo "Default login after first boot: superadmin / super123  (change immediately)"
