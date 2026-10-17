# Putting the server online (api.dajicricket.com)

Status: this setup is live (www.dajicricket.com, Caddy and Docker on AWS Lightsail, Mumbai).

## Updating the live server

```
cd ~/daji-cricket-new
git pull origin main
git log --oneline -1
sudo cp ~/cricket-booking/deploy/.env deploy/.env
sudo docker compose -f deploy/docker-compose.yml up -d --build
```

Then hard-refresh the site and the desk (Ctrl+Shift+R). Secrets (WhatsApp, payment and SMS keys) belong only in `deploy/.env`, never in chat or in git. The phone app is rebuilt separately with EAS (`mobile/`).

## What you need
- A small Linux server (1 vCPU, 1 GB RAM is plenty to start) with Docker and the Compose plugin, ports 80 and 443 open.
- Your domain's DNS: in Wix Domains, Manage DNS Records, add an **A record**: host `api`, pointing to the server's IP.
- Razorpay keys (test first) if online payments should work.

## Steps
1. Copy the project to the server, e.g. `/opt/daji`.
2. `cp deploy/.env.example deploy/.env` and fill it in. Generate secrets with `openssl rand -base64 48`.
   **Store `FIELD_KEY` and `BACKUP_PASSPHRASE` somewhere safe away from the server** (a password manager). Lose them and encrypted data cannot be recovered.
3. `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`
4. Create the first super admin: first `read -s -p "Admin password: " P; echo`, then `docker compose -f deploy/docker-compose.yml exec -e ADMIN_EMAIL=you@example.com -e ADMIN_NAME="Your Name" -e ADMIN_PASSWORD="$P" api node --disable-warning=ExperimentalWarning scripts/create-admin.ts`, then `unset P` (the script reads its answers from ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD)
5. Check `https://api.dajicricket.com/api/health`. The first request can take a few seconds while Caddy gets the certificate.
6. In the Razorpay dashboard set the webhook to `https://api.dajicricket.com/api/webhooks/razorpay` with the same secret as `RAZORPAY_WEBHOOK_SECRET`.

## Backups
The server takes an encrypted snapshot daily at 03:15 IST and keeps `BACKUP_KEEP`. **That is on the same disk, so it does not protect against losing the server.** Schedule `deploy/offsite-backup.sh` (rsync or rclone) so copies leave the machine.

## Restoring
```
BACKUP_PASSPHRASE=... docker compose -f deploy/docker-compose.yml run --rm -e BACKUP_PASSPHRASE api \
  node scripts/restore-backup.ts /data/backups/<snapshot> /data/restored
```
It prints the integrity check and the user and booking counts. Then stop the `api` container, copy `daji.db` and the folders `uploads/`, `task-photos/`, `avatars/`, `cards/`, `library/` and `media/` from `/data/restored` into `/data`, and start it again. Do a practice restore once before you need one.

## Database
This build uses SQLite (one file, safe for one server and one owner's traffic, with the snapshots above). A move to Postgres is only worth it for many tenants or several servers; it is **not done**, and `db/postgres` is empty.

## Updating
Copy the new files, then repeat step 3. Data lives in the `daji-data` volume and survives rebuilds.

## Making dajicricket.com open this site (instead of Wix)

1. Merge and deploy, so Caddy knows the names `dajicricket.com` and `www.dajicricket.com`.
2. In Wix Domains, if the domain is connected to the Wix site, disconnect it from the site first (Domains, the domain's menu, Manage, remove the connection), so the DNS records can be changed.
3. Manage DNS Records: change the **A record for `@`** to this server's IP, and make `www` a **CNAME to `dajicricket.com`** (or an A record to the same IP). **Leave every MX and TXT record as it is** so email keeps working.
4. Wait for DNS (minutes to a few hours), then open `https://dajicricket.com`. Caddy gets the certificate on the first visit.
5. To go back to Wix: put the original Wix records back and reconnect the domain to the Wix site.
6. The `api.` address keeps working for the apps and Razorpay. Set `PUBLIC_URL=https://dajicricket.com` (already the example value).
