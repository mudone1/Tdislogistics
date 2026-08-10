#!/usr/bin/env bash
# Builds both services, installs them as systemd services (auto-restart on
# crash or VM reboot), configures Caddy for free automatic HTTPS via
# sslip.io (no domain purchase needed), and starts everything. Run once
# after setup.sh + filling in both .env files. Must run with sudo.
set -euo pipefail

REPO_DIR="/home/ubuntu/tdis"

if [ "$EUID" -ne 0 ]; then
  echo "Run this with sudo: sudo bash $0"
  exit 1
fi

# --- Detect the VM's public IP (used to build the sslip.io hostnames) ---
PUBLIC_IP=$(curl -s https://ifconfig.me || curl -s https://api.ipify.org || true)
if [ -z "$PUBLIC_IP" ]; then
  PUBLIC_IP="${1:-}"
fi
if [ -z "$PUBLIC_IP" ]; then
  echo "Couldn't auto-detect the public IP and none was passed. Run: sudo bash $0 <your-vm-ip>"
  exit 1
fi
IP_DASHED=$(echo "$PUBLIC_IP" | tr '.' '-')
echo "Detected public IP: $PUBLIC_IP (will use *.${IP_DASHED}.sslip.io)"

# --- Build both services ---
cd "$REPO_DIR/connector-service" && sudo -u ubuntu npm run build
cd "$REPO_DIR/whatsapp-service" && sudo -u ubuntu npm run build

# --- Install systemd unit files ---
sed "s#{{REPO_DIR}}#$REPO_DIR#g" "$REPO_DIR/deploy/oracle/connector-service.service.template" > /etc/systemd/system/connector-service.service
sed "s#{{REPO_DIR}}#$REPO_DIR#g" "$REPO_DIR/deploy/oracle/whatsapp-service.service.template" > /etc/systemd/system/whatsapp-service.service

systemctl daemon-reload
systemctl enable connector-service whatsapp-service
systemctl restart connector-service whatsapp-service

# --- Configure Caddy (reverse proxy + automatic HTTPS) ---
sed "s#{{IP_DASHED}}#$IP_DASHED#g" "$REPO_DIR/deploy/oracle/Caddyfile.template" > /etc/caddy/Caddyfile
systemctl restart caddy

echo ""
echo "=== Done ==="
echo "connector-service: https://connector.${IP_DASHED}.sslip.io"
echo "whatsapp QR code:  https://whatsapp.${IP_DASHED}.sslip.io/qr"
echo ""
echo "Set CONNECTOR_SERVICE_URL in Vercel to https://connector.${IP_DASHED}.sslip.io and redeploy."
echo "Check status any time with: sudo systemctl status connector-service"
