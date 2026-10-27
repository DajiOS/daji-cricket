# Final verification pass (strict self-review), V2 revision 4

**This is not an independent review.** The same model that wrote the code, the tests, the source mapping and the audit wrote this review. The tests may share its blind spots. Treat it as a careful check of the package's own consistency, not as proof. `INDEPENDENT_OPUS_MAX_REPORT` is NOT_RUN and Reviewer_Acceptance stays PENDING on all 73 rows.

Reviewed: branch `master-patch` (PR #143), revision 4. Revision 4 is the completion patch that closes DEF-MAP-001 to DEF-MAP-004, makes a dearer reschedule's difference payable online through the existing payment path, and runs the whole repository-defined build and test scope on the final code commit.

## 1. Result in one paragraph

On the final code commit every defined check exits 0: server suite 895 of 895 (0 failed, 0 cancelled, 0 skipped), server and mobile type checks 0 errors, staff desk rebuild byte-identical to the committed bundle, Expo iOS and Android bundle export, and the three browser runs with every scenario passing. All 73 requirement rows are VERIFIED at code level (implemented file and symbol mapped, executed test passing), with no PARTIAL and no MISSING row. The package is **BUILD COMPLETE** and **not** PILOT READY or LIVE GO: everything that needs an outside resource (real payment provider, real devices, ClamAV, production copy, offsite backup, the Finance consumer, an independent review, pilot and canary, human sign-off) is NOT_RUN and listed in the remaining-gates register. Customer rescheduling and the security deposit stay OFF.

## 2. Checks run, with what each found

| Check | How | Result |
|---|---|---|
| Full test run | `npm test` in server with the old-release fixture and checkout set (migration and rollback cases included) | 895 of 895 pass, 0 fail, 0 cancelled, 0 skipped |
| Type checks | `npm run typecheck` in server and in mobile | Both exit 0, 0 errors. The base release had 41 errors in unrelated files; they were cleared in a separate behaviour-preserving commit (unused names removed, non-null assertions on values already validated, widened types) and the whole suite was re-run after it |
| Lint and format | Searched server, shared, mobile, desk, web for ESLint, Prettier, Biome configuration or scripts | None defined; reported as not defined, not as a pass |
| Desk build | `node build.mjs` in desk, then compared with the committed `web/public/desk` | Exit 0; byte-identical |
| Mobile build | `npx expo export` for iOS and Android | Exit 0 (JavaScript bundles; not a device run) |
| Browser runs | Website (desktop and iPad-size), app screens (phone-size emulation), staff desk (desktop and 390 px) | All scenarios PASS, 0 failures. Emulation only, kept apart from real-device evidence |
| Source mapping | Every `file:symbol (Lnn)` reference in the regenerated 73-row CSV re-checked against the files as committed at the code commit (not the working tree) | 631 references, 0 mismatches |
| Skipped tests | Run log and a search of `server/test` for skip, todo, only | None unapproved |
| Booking architecture | Source guards ARCH-001 and ARCH-002; search for every writer of `booking_slots` | Unchanged; no new writer; no price, cut-off, difference or deposit arithmetic in any client (source guards) |
| Other-project contamination | REL-SEP-001 and a package search | None imported or copied |
| Schema | `schema.lock.json` and `db.ts` against the previous revision | No schema change in revision 4 |
| Evidence hygiene | Search of the evidence for passwords, OTPs, PINs, payment credentials, provider keys, tokens | Only demo accounts and demo-gateway ids appear (result of the final scan is in the build report) |
| Mutation checks | Removed a guard and confirmed a test fails | Mutation check M1 (the preview ignoring a time taken on a linked net) passed the old suite, which exposed a test gap; REL-FIX-002-006 was added and now fails without the guard |

## 3. Problems this review found in my own work, and what I did

The whole-system audit (`WHOLE_SYSTEM_AUDIT_REPORT.md`) lists AUD-01 to AUD-09 with correction and regression proof. In short: the reschedule preview did not refuse a taken replacement time (P0); the amount due for a dearer move summed only the rises (P0); paying the difference while another balance payment was open could close or double it (P0); three clients computed "kept by the ground" themselves (P1); the booking advance was called a "deposit" in nine places outside Guppi (P1); the "booking moved" message told the customer the balance is paid at the ground (P1); two new primary buttons were greyed out against the repository's forms rule (P2); the ground-links card showed stale links after saving (P2); the new browser scripts added type errors (P3). All fixed, each with a named test.

## 4. What an independent reviewer should repeat

* A fresh run of the whole scope with `TESTS/how-the-final-run-was-made.sh`.
* Open ten rows of the 73-row CSV at random and follow each symbol to the code; start with `moveDifferenceDue`, `startDifferencePayment` and `previewReschedule`.
* Move a booking at exactly 24 hours and 24 hours minus a second; a third move; another customer's booking; a cheaper move and any refund that has no request or credit behind it; pay a difference twice, and while an auto-debit order is open.
* Try to book a net while the whole ground is booked, and the reverse, through every writer of `booking_slots`.
* Confirm the money display on each client reads server figures only.
* Run the iOS and Android screens on real devices and the website on a real iPad.

## 5. Open items I am not hiding

* **Real devices, real provider, ClamAV, production copy, offsite backup, Finance consumer, independent review, pilot, canary, human sign-off:** NOT_RUN. Emulation and source inspection are never reported as real-device results.
* **EAS cloud builds, store submission:** NOT_RUN (no credentials here).
* **Rescheduling and the security deposit** are built and tested but OFF by default; turning them on is an owner decision after the gates above.
* **Language:** spelling tolerance for romanized Gujarati and Hindi is a word list, not a language model.
* **Documented limits of the rules:** a whole-ground owner block does not block its nets; ground links go one level only.
* **Construction suite** (separate Daji Admin project) was not re-run in this revision; its last result is kept in the package.
