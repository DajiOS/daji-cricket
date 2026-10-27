# Proposed GO / NO-GO: Daji Master Patch V2

**Proposal: NO-GO for live release today. GO for a staff pilot on a test server once the conditions at the bottom are met.**
This is a proposal. It is not signed. Only a person signs it. Guppi Booking is **not marked complete**: your rule needs all applicable REL-LANG tests to pass with evidence, device parity on desktop web, iPad web, iOS and Android, no unresolved language defects, and complete traceability. Tests, language defects and traceability are met; **device parity is not** (iOS, Android and a real iPad were not run).

## The gates (re-run on the V2 tree)

| Gate | Result | Where it comes from |
|---|---|---|
| Open P0 defects | **0 known** | Every defect found has a fix and a retest: `REL_LANG/DEFECT_LOG.csv` (two P0 in V2, DEF-LANG-041 and DEF-LANG-042, both the payment-action boundary, plus DEF-SEP-001) and the first package's defects (tracker "Before-Fix Result"). |
| Failed required P0 tests | **0** | 104 of 104 required rows PASS in automated scope (59 from the first package, plus REL-LANG-001..044 and REL-SEP-001). Server suite 842 of 842 pass, 0 skipped, run with the old-release fixture. |
| Required P0 not run | **0 by the tracker; NOT MET in substance** | 17 rows pass only in their automated scope; the column "Residual (not proven here)" names what is NOT_RUN: real payment provider, real ClamAV, devices, real offsite backup, a copy of real production. |
| Unapproved skipped P0 | **0** | Nothing skipped in the final run. |
| Unexplained integrity findings | **0** | `FINAL_RECONCILIATION`: the rehearsal databases reconcile clean; negative controls fail as they should. |

## Guppi Booking language gate (your rule)

| Condition | Result |
|---|---|
| All applicable REL-LANG tests pass with evidence | **45 of 45 records PASS** (`REL_LANG/REL_LANG_TEST_MATRIX.csv`, transcripts in `REL_LANG_TRANSCRIPTS.csv`) |
| Device parity: desktop web, iPad web, iOS, Android | **NOT MET.** Desktop Chromium: 6 of 6 browser scenarios PASS. iPad: PASS only as an emulation (iPad screen size, touch, user agent), not a real iPad. iOS app and Android app: screen written, **NOT_RUN** (no devices; not type-checked here). |
| No unresolved language defects | Met: 8 defects found by the tests, all fixed and retested. The open limit is P1-16. |
| Traceability complete | Met for tests (`REL_LANG_TRACEABILITY.csv`); no requirement is marked complete only because a test file exists. |
| REL-SEP-001 project purity | **PASS.** The stylesheet is `daji.css`; searched the repository and this package; remaining occurrences are listed with reasons in `SEPARATION/REL-SEP-001-search-evidence.txt`. |

## Why NO-GO

1. **Real payment provider NOT_RUN** (REL-PAY-001..007, 011 are proven with the demo gateway and signed test payloads only).
2. **Real ClamAV NOT_RUN.** The server refuses to start live without it.
3. **No devices.** iOS, Android and real iPad runs are NOT_RUN. The Guppi Booking mobile screen has not even been compiled here.
4. **Migration and backup rehearsed on a generated old-release database**, not on a copy of production; the real offsite backup and restore were not run.
5. **The staff desk was not rebuilt with the normal toolchain** (repatch point 6): build tools are not available here.
6. **Construction to Finance:** the producer side is proven; the real consumer was not run.
7. **Owner decisions still open:** UD-01 (what "deposit" means), UD-02 (whole ground versus nets), UD-03 (reschedule policy). Sunny's message of 27 Oct 2026 answered UD-08, UD-09 and gave Guppi language principles (recorded as UD-10..12) and the account-name rule (UD-13), but his texts under the numbers UD-01..03 answer different questions, so I did not treat the three original questions as answered.
8. **Verification is a strict self-review by the building model**, not the independent Opus Max review (`INDEPENDENT_OPUS_MAX_REPORT` NOT_RUN).
9. **No staff pilot and no customer canary.**

## Conditions to move to GO

1. Sunny answers the original UD-01 (what "deposit" means), UD-02 (whole ground versus nets) and UD-03 (reschedule policy). UD-08..UD-13 are decided.
2. Run the payment rows against the provider's test mode, then a small controlled live payment and refund.
3. Run the file-safety tests and the construction upload test against a real ClamAV (EICAR).
4. Run the parity table, including PAR-004 Guppi Booking, on a real iPad, iPhone and Android phone; type-check and build the mobile app in CI.
5. Repeat the migration, interrupted-migration, backup and restore, and rollback rehearsals on a protected copy of the real database; run the real offsite process.
6. Construction: apply `006_upload_scan.sql` on a copy; show the real Finance consumer.
7. Operator sets `APP_ENV=live`, `FILE_SCANNER=clamav`, real provider keys. Release switches: `guppiAssistEnabled` and `customerRescheduleEnabled` ship OFF; switch Guppi on only for the staff pilot after step 4.
8. Rebuild the staff desk with `desk/build.mjs`.
9. Independent verification by a fresh reviewer at Max effort, re-running all required tests.
10. Staff pilot passes and reconciles, then the customer canary passes and reconciles, then a person signs.

## Sign-off (blank on purpose)

| Role | Name | Decision | Date |
|---|---|---|---|
| Release Manager | | | |
| Technical Lead | | | |
| Payment Lead | | | |
| Security Lead | | | |
