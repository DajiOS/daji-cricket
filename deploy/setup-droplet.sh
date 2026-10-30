#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 22.04/24.04 server (DigitalOcean droplet, Lightsail, any VPS).
# Run as root from the project folder:   cd /opt/daji && bash deploy/setup-droplet.sh
# It installs Docker, opens the firewall, writes deploy/.env with fresh secrets, starts the server and shows what to do next.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
cd "$(dirname "$0")/.."

echo "== Installing Docker and the firewall"
apt-get update -y && apt-get upgrade -y
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
if command -v ufw >/dev/null; then ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable; fi
sh deploy/ensure-swap.sh

if [ ! -f deploy/.env ]; then
  echo "== Writing deploy/.env with new secrets"
  cp deploy/.env.example deploy/.env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" deploy/.env
  sed -i "s|^FIELD_KEY=.*|FIELD_KEY=$(openssl rand -base64 36 | tr -d '\n')|" deploy/.env
  sed -i "s|^BACKUP_PASSPHRASE=.*|BACKUP_PASSPHRASE=$(openssl rand -base64 36 | tr -d '\n')|" deploy/.env
  chmod 600 deploy/.env
  echo
  echo "!! SAVE THESE TWO NOW in a password manager, away from this server (lose them and encrypted data/backups cannot be recovered):"
  grep -E '^(FIELD_KEY|BACKUP_PASSPHRASE)=' deploy/.env
  echo
  echo "Now add your keys:  nano deploy/.env   (GMAIL_APP_PASSWORD, RAZORPAY_*), then run this script again."
  exit 0
fi

echo "== Starting the server"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
echo
echo "Next: create the first super admin:"
echo "  read -s -p \"Admin password: \" P; echo"
echo "  docker compose -f deploy/docker-compose.yml exec -e ADMIN_EMAIL=you@example.com -e ADMIN_NAME=\"Your Name\" -e ADMIN_PASSWORD=\"\$P\" api node --disable-warning=ExperimentalWarning scripts/create-admin.ts; unset P"
echo "Then open https://api.dajicricket.com/api/health (the first load can take a few seconds while the certificate is issued)."
