#!/bin/sh
# Copies the encrypted snapshots off the server. Run from cron on the SERVER, e.g. at 04:00 IST (after the 03:15 snapshot):
#   0 4 * * *  /opt/daji/deploy/offsite-backup.sh
# Set DEST to anything rsync or rclone understands. With BACKUP_PASSPHRASE set, only encrypted files leave the server.
set -eu
VOL="${DAJI_VOLUME:-deploy_daji-data}"
SRC="$(docker volume inspect "$VOL" -f '{{ .Mountpoint }}')/backups/"
: "${DEST:?Set DEST, e.g. user@backuphost:/srv/daji-backups/ or an rclone remote like gdrive:daji-backups}"
case "$DEST" in
  *:*) if command -v rclone >/dev/null 2>&1 && rclone listremotes | grep -q "^${DEST%%:*}:"; then rclone copy "$SRC" "$DEST"; else rsync -a --delete "$SRC" "$DEST"; fi ;;
  *) rsync -a --delete "$SRC" "$DEST" ;;
esac
N="$(ls "$SRC" | wc -l | tr -d ' ')"
# Leave a note for the desk (Settings, Backups and the Go-live check) saying when the last copy left the server. Only the time and count, never DEST.
printf '{"at":%s000,"snapshots":%s}\n' "$(date +%s)" "$N" > "${SRC%backups/}offsite-copy.json"
echo "Copied $N snapshots to $DEST"
