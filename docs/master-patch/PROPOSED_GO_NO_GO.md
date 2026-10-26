# Proposed GO / NO-GO: Daji Master Patch

**Proposal: NO-GO for live release today. GO for a staff pilot on a test server once the conditions at the bottom are met.**
This is a proposal. It is not signed. Only a person signs it.

## The five gates

| Gate | Result | Where it comes from |
|---|---|---|
| Open P0 defects | **0 known** | Every defect found on the base release has a fix and a retest (tracker, "Before-Fix Result" and "Defect ID"). |
| Failed P0 tests | **0** | 59 of 59 required P0 rows PASS (`P0_TEST_EXECUTION_TRACKER`). Server suite 797 of 797; construction suite 146 of 146. |
| Required P0 not run | **0 by the tracker; NOT MET in substance** | 17 of the 59 rows pass only in their automated scope. The column "Residual (not proven here)" names the real-world part that was **NOT_RUN**: real payment provider, real ClamAV, devices, real offsite backup, a copy of the real production database. I count those as required-and-not-run, so this gate is not met. |
| Unapproved skipped P0 | **0** | The final run skipped nothing (migration and rollback cases ran with the old-release fixture). Without the fixture they record SKIPPED, which counts as not run. |
| Unexplained integrity findings | **0** | `RECONCILIATION`: the migrated database reconciles clean (debits equal credits, 13 financial events, no unexplained finding); negative controls fail as they should. |

## Why NO-GO

1. **Real payment provider NOT_RUN.** REL-PAY-001..007 and 011 are proven with the demo gateway and signed test payloads only.
2. **Real ClamAV NOT_RUN.** The built-in scanner and a stand-in that speaks the ClamAV protocol were run. The patched server refuses to start live without ClamAV, so this must be exercised before go-live.
3. **No devices.** iOS, Android, iPad and desktop-browser runs of the parity table are NOT_RUN. Parity is proven at API level for four client identities only. Rescheduling and the Guppi booking assistant have no screen on any client (open P1-01, P1-02).
4. **Migration rehearsed on a generated old-release database**, not a copy of the real production database. Offsite backup and restore not run.
5. **Three decisions are still Sunny's** (UD-01 deposit means the booking advance; UD-02 hierarchy reading; UD-03 reschedule policy). The tests prove the assumptions as written.
6. **Verification was a strict self-review on Sonnet 5.5, not an independent Opus Max pass** (your choice on the decision card). It is not independent evidence. See `TESTS/VERIFICATION_PASS.md`.
7. **No staff pilot and no customer canary** have happened.

## Conditions to move to GO

1. Sunny confirms or changes UD-01, UD-02, UD-03.
2. Run the payment rows against the provider's test mode (staging account), then the provider's live mode with a small real payment and refund.
3. Run REL-FILE-001 and the construction upload test against a real ClamAV (EICAR test file).
4. Run the parity table on real devices; run an EAS preview build against a test server (REL-ENV-003, REL-CH-002).
5. Repeat the migration, interrupted-migration, backup/restore and rollback rehearsals on a copy of the real production database; run the existing offsite backup and restore practice.
6. Construction: apply `006_upload_scan.sql` on a copy, confirm the live Finance consumer of `finance.ra_bill.certified`.
7. Operator sets `APP_ENV=live`, `FILE_SCANNER=clamav` with the ClamAV service, real provider keys (the server will not start otherwise). Decide the release switches; recommended OFF for `guppiAssistEnabled` and `customerRescheduleEnabled` until screens exist.
8. Rebuild the staff desk with `desk/build.mjs` (open P1-12).
9. Independent verification of this package (a second reviewer or a stronger model), including a fresh run of all tests.
10. Staff pilot passes, then customer canary passes, then a person signs the final GO/NO-GO.

## Sign-off (blank on purpose)

| Role | Name | Decision | Date |
|---|---|---|---|
| Release Manager | | | |
| Technical Lead | | | |
| Payment Lead | | | |
| Security Lead | | | |
