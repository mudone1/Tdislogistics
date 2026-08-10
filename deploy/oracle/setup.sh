#!/usr/bin/env bash
# One-time bootstrap for a fresh Oracle Cloud Ubuntu VM. Installs Node.js,
# Caddy (automatic HTTPS reverse proxy), Playwright's Chromium + system
# deps, clones the repo, and installs dependencies for both services.
# Does NOT start anything — fill in the .env files it creates, then run
# start.sh (see deploy/oracle/README.md for the full walkthrough).
set -euo pipefail

REPO_DIR="/home/ubuntu/tdis"
REPO_URL="https://github.com/mudone1/Tdislogistics.git"

echo "=== TDIS connector-service + whatsapp-service: Oracle VM setup ==="

# --- System packages ---
sudo apt-get update -y
sudo apt-get install -y curl git build-essential

# --- Node.js 22 ---
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# --- Caddy (automatic HTTPS reverse proxy) ---
if ! command -v caddy >/dev/null 2>&1; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

# --- Clone or update the repo ---
if [ -d "$REPO_DIR/.git" ]; then
  echo "Repo already exists at $REPO_DIR, pulling latest..."
  cd "$REPO_DIR" && git pull
else
  git clone "$REPO_URL" "$REPO_DIR"
  cd "$REPO_DIR"
fi

# --- connector-service: install deps, Prisma client, Chromium ---
cd "$REPO_DIR/connector-service"
npm install
npx prisma generate --schema=../prisma/schema.prisma
npx playwright install --with-deps chromium

# --- whatsapp-service: install deps, auth-session directory ---
cd "$REPO_DIR/whatsapp-service"
npm install
mkdir -p auth

# --- Create .env files (empty placeholders) if they don't exist yet —
# never overwrites real values on a re-run of this script. ---
if [ ! -f "$REPO_DIR/connector-service/.env" ]; then
  cat > "$REPO_DIR/connector-service/.env" <<'EOF'
PORT=4100
DATABASE_URL=
CONNECTOR_ENCRYPTION_KEY=
CONNECTOR_SERVICE_API_KEY=
ENUGU_BOOKING_ACCOUNTS=
EOF
  echo "Created connector-service/.env — fill in the real values before running start.sh"
fi

if [ ! -f "$REPO_DIR/whatsapp-service/.env" ]; then
  cat > "$REPO_DIR/whatsapp-service/.env" <<EOF
PORT=4101
MAIN_APP_URL=
BOT_MENTION_TRIGGER=@tdisbot
AUTH_DIR=$REPO_DIR/whatsapp-service/auth
EOF
  echo "Created whatsapp-service/.env — fill in the real values before running start.sh"
fi

echo ""
echo "=== Setup done. Next steps: ==="
echo "1. nano $REPO_DIR/connector-service/.env"
echo "2. nano $REPO_DIR/whatsapp-service/.env"
echo "3. sudo bash $REPO_DIR/deploy/oracle/start.sh"
