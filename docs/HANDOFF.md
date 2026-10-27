# Daji Cricket Ground: project handoff

Written 20 October 2026. The ground opens on **14 November 2026**.

## What this is
One system for Daji Cricket Ground (and, later, other ground owners):
- **Website** (www.dajicricket.com): public site, online booking, sign in, academy, live scores. Plain JavaScript in `web/public/`.
- **Server** (`server/`): Node 22 with SQLite. One file holds all the data. It serves the website, the desk and the API.
- **Owner desk** (`desk/`, opens at /desk.html): React app for bookings, payments, customers, accounting, payroll, academy, tasks, media, live cameras and team rights. It is built with esbuild and the built files are committed in `web/public/desk/`.
- **Phone app** (`mobile/`): Expo app with an admin version and a customer version.
- **Camera bridge** (`camera-bridge/`): program for a PC at the ground that sends camera pictures to the desk.
- **Shared types** (`shared/`).

Repo: the `daji-cricket` repository on GitHub. Everything is on `main`; the owner merges pull requests.

## Where it runs
- AWS Lightsail, Mumbai. Docker with Caddy (HTTPS certificates are automatic) and the `api` container.
- Domain: dajicricket.com (DNS was in Wix Domains). `api.dajicricket.com` is also served.
- Server folder: `~/daji-cricket-new`. Settings and secrets: `deploy/.env` (copied from `~/cricket-booking/deploy/.env`). **Secrets never go in git or chat.**

### Update the live server after merging
```
cd ~/daji-cricket-new
git pull origin main
sudo cp ~/cricket-booking/deploy/.env deploy/.env
sudo docker compose -f deploy/docker-compose.yml up -d --build
```
Then hard-refresh the site and the desk (Ctrl+Shift+R). More in `deploy/DEPLOY.md` (first install, backups, restore).

## Keys and accounts to keep safe
Keep these in a password manager, away from the server:
- `FIELD_KEY` and `BACKUP_PASSPHRASE` (without them encrypted data and backups cannot be recovered).
- Server and AWS login, Wix Domains login (for DNS).
- GitHub (owner), Expo/EAS account (phone app builds).
- Razorpay keys and webhook secret (if online payments are on), WhatsApp/SMS keys (not set up yet).
- Admin and owner logins for the desk. Demo accounts exist only in demo mode and must stay off in production (`DEMO_MODE`).

## Backups
The server makes an encrypted snapshot daily at 03:15 IST on the same disk. That does not survive losing the server. **Schedule `deploy/offsite-backup.sh`** so copies leave the machine, and do a practice restore once (steps in `deploy/DEPLOY.md`).

## Working on the code
```
cd server && npm test          # about 585 tests, about 1 minute
cd desk && node build.mjs      # rebuilds web/public/desk (commit the output)
```
- Money is whole paise (integers). The 269ST cash limit is **not enforced** by owner decision; the 40A(3) and 269SS checks remain.
- Database changes: `registerSchema('unique-id', sql)`. A repeated id stops the server booting. A released module never runs again on a database that has it, so never edit one: add `'<id>-2'` instead. After adding a module run `cd server && node scripts/schema-lock.ts` to record it in `server/schema.lock.json`; `test/schema-lock.test.ts` fails on an edited, removed or unrecorded module, and the server logs a warning if a database applied an older version.
- GitHub Actions runs the server tests on every push. They are informational and do not block deploys. If they fail, read the failing test first.
- Permissions are listed in `shared/src/types.ts` (`STAFF_PERMISSIONS`) and labelled in `desk/src/pages/Team.tsx`.

## Phone app
- Builds with EAS from `mobile/` (`eas.json` has profiles such as `preview-admin`). Answer **n** to the emulator question.
- Updates over the air are set up (`updates.url` in `app.json`). After one new build, `npx eas-cli update --channel preview-admin --message "..."` sends changes without a new build.
- **Not done:** iOS (needs an Apple Developer account, then TestFlight); the next batch of screens (money screens: payroll, refund approvals, compliance, software costs; or people screens: reminders, cards, settings).

## Live cameras
Built and live. In the desk: Live cameras, Add camera. A PC at the ground runs `camera-bridge/` (steps in its README). The recorder is on Dahua's serial-number cloud, so the bridge needs the recorder's **local IP**, found with SmartPSS Lite Auto Search from a PC at the ground. Not yet connected end to end.
Option being tested: Imou's official cloud API (no PC at the ground). Needs an Imou developer account, `bindDevice` with the serial number and the 6-digit code from the recorder label, and a check that live streaming is free. If it is not, keep the bridge.

## Website redesign
A clickable mockup (Stone & Forest theme) exists as a design canvas: https://claude.ai/artifact/2K64zkh9zR2hafokxeJRx4 (five screens). It is a mockup only. Rebuilding the real site on it should be done screen by screen so booking and payment keep working.

## Open items and decisions
1. **WhatsApp Business:** number is not yet on WhatsApp; needs verification, a payment method, the `daji_otp` template, and the token placed in `deploy/.env` only.
2. **Phone numbers are not verified** at sign-up. A fix needs working OTP/WhatsApp first.
3. Unresolved fixes: UPI hold expiry, declined refund state, report date basis, waive, credit on expired hold, auto-debit on walk-ins, blocks past midnight, repeat-booking deposits, owner-wide settings, cross-owner customer lookup.
4. **Legal:** advocate review of terms and privacy before 14 Nov; CA decisions on tax and GST; keep the monthly legal-check task. Remove or replace any photo, video, music or logo you do not own (the desk's Photos and videos page, and `brand/reference/` signage images).
5. Real grounds, rates and photos must be entered in the desk before opening; the media banner is pending.
6. Hard-refresh the site and desk after every deploy and recheck the main flows: book, pay, cancel, sign in.

## Before opening day checklist
- Server updated to the latest `main`; health check `https://api.dajicricket.com/api/health` is ok.
- Demo mode off; real owner and staff accounts created; team rights set.
- Rates, grounds, timings and booking window entered.
- Payments tested with Razorpay test mode, then live.
- Offsite backup scheduled and a restore practised.
- Phone app built and installed on the owner's and staff phones.
- Cameras connected (bridge or Imou): steps in `docs/CAMERAS.md`; `node camera-bridge/find-recorder.mjs` finds the recorder's address.
