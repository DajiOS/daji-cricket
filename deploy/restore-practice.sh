#!/bin/sh
# Practises a restore of the newest backup on the server, without touching the live data. Run from the project folder on the server:
#   sh deploy/restore-practice.sh                 (newest snapshot)
#   sh deploy/restore-practice.sh 2026-11-01_031500
# It runs inside the running api container, which already has BACKUP_PASSPHRASE from deploy/.env, so you type no secrets.
set -eu
cd "$(dirname "$0")/.."
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T api \
  node --disable-warning=ExperimentalWarning scripts/restore-practice.ts "$@"
