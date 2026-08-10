#!/usr/bin/env bash
# Redeploy after a code change: pulls latest main, rebuilds both services,
# restarts them. Run this on the VM any time new code is merged — the
# manual equivalent of what Railway's auto-deploy used to do. Must run
# with sudo.
set -euo pipefail

REPO_DIR="/home/ubuntu/tdis"

if [ "$EUID" -ne 0 ]; then
  echo "Run this with sudo: sudo bash $0"
  exit 1
fi

cd "$REPO_DIR"
sudo -u ubuntu git pull

cd "$REPO_DIR/connector-service"
sudo -u ubuntu npm install
sudo -u ubuntu npx prisma generate --schema=../prisma/schema.prisma
sudo -u ubuntu npm run build

cd "$REPO_DIR/whatsapp-service"
sudo -u ubuntu npm install
sudo -u ubuntu npm run build

systemctl restart connector-service whatsapp-service

echo "Redeployed and restarted both services."
echo "Check logs with: sudo journalctl -u connector-service -f"
