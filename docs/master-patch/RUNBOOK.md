# Daji Master Patch: release, recovery and evidence runbook

This is for the person releasing the patch. Commands are run from `server/` unless it says otherwise. Everything below was rehearsed on a generated copy of the previous release's database (see `MIGRATION_EVIDENCE`). **Nothing here has been run against your real production database, a real payment provider, a real ClamAV or a real offsite backup.** Do that rehearsal first.

## 1. Before the first start of the patched release (the server refuses to start without these)

| Setting | Live value | Why |
|---|---|---|
| `APP_ENV` | `live` (or `test` / `dev` for rehearsals) | **If it is not set at all the server refuses to start, in every environment.** The server states what it is. Apps and tools that expect another environment are refused with `409 ENV_MISMATCH`. |
| `FILE_SCANNER` | `clamav` | The built-in scanner is a minimum, not a malware engine. A live server refuses to start with it. |
| `CLAMAV_HOST` / `CLAMAV_PORT` | `clamav` / `3310` | The ClamAV service in `deploy/docker-compose.yml`. If it is down, uploads are refused (fail closed), not accepted. |
| `DEMO_MODE` | off | Demo accounts and the fake payment gateway must not exist on a real domain. |
| Razorpay keys, webhook secret | set (live keys, not `rzp_test_`), or `PAYMENTS_MODE=upi_only` | Live payments need them; a test key in a live system is refused, and a live key in a test system is refused. |
| `PUBLIC_URL` | `https://...` | Refused otherwise. |

`deploy/.env.example` has these. `deploy/check-live.sh` checks `/api/health` says `env: live`. Mobile: EAS `production*` profiles point at `https://api.dajicricket.com` and say `live`; `development` and `preview*` profiles never default to live (a preview build needs `EXPO_PUBLIC_API_URL` set to a test server).

**Release switches** (Settings, admin): `guppiAssistEnabled`, `customerRescheduleEnabled`, `retentionDisputesEnabled`. A switched-off feature answers `503 FEATURE_OFF` on every route. Recommended for the first live release: switch the first two OFF, because no client has screens for them yet (open P1-01, P1-02).

## 2. Forward migration (phases)

The schema is a list of append-only modules; each is applied in its own transaction when the server starts. The six new modules are `append-only-1`, `idempotency-1`, `reschedule-1`, `retention-1`, `file-intake-1`, `no-delete-1`.

| Phase | What happens here | Command / proof |
|---|---|---|
| EXPAND | New tables and one new column (`bookings.reschedule_count`) are added; no old column or table is changed or removed. | `node --disable-warning=ExperimentalWarning scripts/migrate.ts <db> --dry-run --json` (works on a copy) |
| BACKFILL | **Not needed.** The new tables start empty and no old row changes. | Row hashes of every old table are identical before and after (`MIGRATION_EVIDENCE`). |
| VALIDATE | Integrity check, foreign-key check, structure equal to a fresh database, financial reconciliation. | `scripts/migrate.ts` prints them; `scripts/reconcile.ts <db> --json` must exit 0. |
| CUTOVER | Take a backup, stop the old server, start the patched server (it applies the modules). | Backup first (section 4). |
| STABILIZE | Watch `/api/health`, run `scripts/reconcile.ts` on a copy daily for the pilot, keep the old release available. | |
| CONTRACT | **Deferred.** Nothing legacy is removed in this patch. Remove only after the staff pilot and customer canary pass. | |

Interrupted migration: kill the process at any point; the module that was open is simply absent and the next start applies it again (rehearsed at every module with `REHEARSAL_KILL_BEFORE_COMMIT=<module id>`).

## 3. Reconciliation

`node --disable-warning=ExperimentalWarning scripts/reconcile.ts <db> [--owner <id>] [--json] [--events]` works on a copy. Exit 0 = no unexplained problem; 1 = unexplained problem (listed); 2 = unreadable. The admin screen/route runs the same check. `info` findings are explained differences (for example `REFUND_AFTER_PAYMENT_APPLIED`, open P1-03).

## 4. Backup and restore

`BACKUP_PASSPHRASE=... node --disable-warning=ExperimentalWarning scripts/rehearse-recovery.ts <db> <data folder> <work folder>` takes an encrypted snapshot, restores it to an isolated folder, and proves the same integrity, the same financial fingerprint and byte-identical files; a damaged snapshot or wrong passphrase is refused. The existing `deploy/offsite-backup.sh` and `deploy/restore-practice.sh` were not changed and **were not run here**.

## 5. Rollback and forward recovery

1. **Feature rollback (preferred):** switch the feature off (section 1). No data change. Tested in `rel-rollback.test.ts`.
2. **Write-path rollback:** start the previous release's code against the migrated database. The new tables are ignored by old code; the new triggers only forbid editing or deleting history. Bookings and payments taken by the old code afterwards are ordinary rows. Rehearsed: old code against the migrated database, then forward again; money rows only appended; reconcile clean (negative controls prove reconcile fails when a row is tampered with).
3. **Restore from backup:** only if the data itself is damaged; money taken since the backup must be re-entered from the provider's records using the payment reconciliation.

## 6. Re-running the evidence

```
# full server suite with evidence records
EVIDENCE_DIR=/path/evidence APP_VERSION=$(git rev-parse --short HEAD) \
OLD_FIXTURE_DIR=/path/fixture-old OLD_CHECKOUT=/path/old-main npm test

# P0 tracker from the records (exit 1 if any gate is not met)
node --disable-warning=ExperimentalWarning scripts/build-p0-tracker.ts --starter <starter dir> --evidence /path/evidence \
  --construction <vitest json> --before <base-release records> --before-logs <base-release logs> --out <dir>
```

Without `OLD_FIXTURE_DIR` and `OLD_CHECKOUT` the migration and rollback cases record `SKIPPED` (counted as not run), never a pass. The old-release fixture is made by `scripts/make-old-fixture.ts` run from a checkout of the base commit `4edac99`.

## 7. What is still not proven (see `PROPOSED_GO_NO_GO`)

Real payment provider; real ClamAV; iOS, Android, iPad and desktop-browser runs; real offsite backup and restore; rehearsal on a copy of the real production database; Sunny's confirmation of UD-01..UD-03; staff pilot and customer canary.
