#!/bin/sh
# Checks the live server after a deploy: the health check answers, the database is readable and demo mode is off.
#   sh deploy/check-live.sh                      (checks https://api.dajicricket.com)
#   sh deploy/check-live.sh https://api.example.com
# Exits 0 when all is well, 1 otherwise. Needs curl. Reads nothing secret.
set -u
API="${1:-${API_URL:-https://api.dajicricket.com}}"
BODY="$(curl -fsS --max-time 15 "$API/api/health")" || { echo "FAIL  $API/api/health did not answer (is the server up? is DNS pointing at it?)"; exit 1; }
fail=0
case "$BODY" in *'"ok":true'*) echo "ok    health check answers" ;; *) echo "FAIL  health check says not ok: $BODY"; fail=1 ;; esac
case "$BODY" in *'"database":"ok"'*) echo "ok    database is readable" ;; *) echo "FAIL  database is not readable"; fail=1 ;; esac
case "$BODY" in *'"demo":false'*) echo "ok    demo mode is off" ;; *) echo "FAIL  demo mode is ON: set DEMO_MODE=off in deploy/.env and restart"; fail=1 ;; esac
[ "$fail" -eq 0 ] && echo "All checks passed for $API"
exit "$fail"
