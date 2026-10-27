# Proposed GO / NO-GO: Daji Master Patch V2 (revision 4)

**Build status: BUILD COMPLETE (code side). Release proposal: NO-GO for live today; GO for a staff pilot on a test server once the external gates below that a pilot needs are PASS.**
This is a proposal. It is not signed. Only a person signs it. Guppi Booking: tests, language defects and traceability are met; real-device parity (iPad, iPhone, Android) is **NOT_RUN**, so it is not marked complete.

## The gates (re-run on the revision 4 tree)

| Gate | Result | Where it comes from |
|---|---|---|
| Open P0 defects | **0** (DEF-MAP-001..004 and DEF-MAP-101 FIXED) | `DEFECT_CLOSURE/`, `REL_LANG/DEFECT_LOG.csv` |
| Failed required P0 tests | **0** | 138 of 138 required rows PASS in automated scope. Server suite 895 of 895 pass, 0 skipped, run with the old-release fixture. |
| Required P0 not run | **0 by the tracker; the residual column names what is NOT_RUN in substance** | 17 rows pass only in their automated scope: real payment provider, real ClamAV, real devices, real offsite backup, a copy of real production |
| Unapproved skipped | **0** | Nothing skipped in the final run |
| Source mapping (73 rows) | **73 VERIFIED, 0 PARTIAL; 0 P0 rows not VERIFIED** | `SOURCE_MAPPING/SOURCE_MAPPING_VERIFICATION.md`. Reviewer acceptance is PENDING for all 73 (self-review is not independent), so no row is a final PASS and every Final_Status is BLOCKED |
| Client evidence | **web 10/10, app screens (emulation) 4/4, staff desk 10/10 scenarios PASS** | `TESTS/client-evidence`. Chromium only; not real devices |
| Unexplained integrity findings | **0** | `FINAL_RECONCILIATION`: rehearsal databases reconcile clean; negative controls fail as they should |

## Why NO-GO for live

1. Real payment provider NOT_RUN (the difference payment and REL-PAY-* ran against the demo gateway and signed test payloads).
2. Real ClamAV NOT_RUN.
3. No real iPad, iPhone or Android run of any screen (emulation only).
4. Migration and backup rehearsed on a generated old-release database, not a copy of production; real offsite backup NOT_RUN.
5. Construction to Finance: producer side proven, real consumer NOT_RUN.
6. The verification is a self-review, not the independent review; reviewer acceptance PENDING.
7. No staff pilot and no customer canary.
8. No human sign-off.

## Conditions to move to GO

`REMAINING_GATES_REGISTER.csv` lists each one with its exact prerequisite (GATE-01..14). In order: provider test mode and one controlled live payment and refund (including the difference payment); ClamAV with EICAR; the client scenarios on a real iPad, iPhone and Android phone and Safari / Firefox; migration, backup and rollback rehearsal on a protected copy of the real database; independent review; staff pilot then reconciliation; customer canary then reconciliation; a person signs. The three feature switches stay OFF until the device runs pass.

## Sign-off (blank on purpose)

| Role | Name | Decision | Date |
|---|---|---|---|
| Release Manager | | | |
| Technical Lead | | | |
| Payment Lead | | | |
| Security Lead | | | |
