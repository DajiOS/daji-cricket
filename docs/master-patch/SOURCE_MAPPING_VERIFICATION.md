# SOURCE_MAPPING_VERIFICATION

Daji V2 source mapping of the 73 rows of DAJI_V2_TRACEABILITY_FOR_CLAUDE_SOURCE_MAPPING_WITH_REVIEW.csv. Daji only. Inspected at commit `26c59ac`.

Method: every file and symbol in the completed CSV was looked up in the working tree by an exact pattern (a missing one aborts the build, so none is invented); each row's required test was executed in the final run and its result is read from the evidence file it wrote (a row with no evidence record would be NOT_RUN and cannot be VERIFIED); clients were searched for competing business rules.

**This is a Claude self-review, not an independent review.** No row is final PASS: real-device runs (desktop web, iPad web, iOS, Android) are NOT_RUN and reviewer acceptance is pending for all 73, so every Final_Status is BLOCKED. Where the review checklist says VERIFIED needs reviewer acceptance but the status definition does not, VERIFIED here follows the status definition (exact implementation mapped and covered by an executed, passing test and evidence) and acceptance is a separate column (`Reviewer_Acceptance` = PENDING).

## Counts

| | Rows |
|---|---|
| Total rows | 73 |
| Verified rows | 65 |
| Partial rows | 8 |
| Missing rows | 0 |
| Duplicate rows | 0 |
| Legacy rows | 0 |
| Not-applicable rows | 0 |
| P0 rows | 43 (VERIFIED 35) |
| Automated tests executed and PASS | 73 of 73 |
| Open P0 mapping defects | 4 |

## Every non-VERIFIED P0 row

* **REL-BIZ-UD01-002**: PARTIAL. Defect DEF-MAP-001. Service, records, routes, audit and tests exist. No website or mobile screen can collect, refund, deduct or show a security deposit yet: staff can only reach it through the API.
* **REL-BIZ-UD03-001**: PARTIAL. Defect DEF-MAP-002. The service allows a move when strictly more than 24 hours remain. No customer screen exists on the website or mobile app, so a customer can only reach it through the API or Guppi's reschedule action. Customer rescheduling is OFF by default and must stay OFF.
* **REL-BIZ-UD03-005**: PARTIAL. Defect DEF-MAP-004. A dearer replacement raises total_paise; paid stays, so the balance rises by exactly the difference (balancePaise) and is collected through the normal balance payment (desk or recorded payment). There is no online top-up payment for the difference and no customer screen, so the customer cannot pay it themselves from an app.
* **REL-BIZ-UD03-006**: PARTIAL. Defect DEF-MAP-002. A cheaper replacement never refunds silently: the difference is settled by settleCheaper as account credit (default) or, if the owner sets rescheduleCheaperTreatment=refund_request, as a refund request through the existing refund path; paid_paise is reduced, the credit lot and audit record the amount, reconcile counts the restored credit. No customer screen exists to choose or see it.
* **REL-BIZ-UD03-008**: PARTIAL. Defect DEF-MAP-003. An authorised staff move needs manage_bookings and a written reason, ignores the customer cutoff and limit, is recorded with actor role staff, and does not add to the customer's moves (reschedule_count and the customer-move count are unchanged). There is no staff screen for it on the website or mobile app.
* **REL-PAR-005**: PARTIAL. Defect DEF-MAP-001. Price and advance are server figures shown by both apps. The security deposit figure is available from the server (GET /api/bookings/:id/security-deposit) but neither the website nor the mobile app shows it, so deposit parity cannot be demonstrated on a screen.
* **REL-PAR-009**: PARTIAL. Defect DEF-MAP-002. Eligibility is decided in rescheduleBooking and is identical for every client identity, but neither the website nor the mobile app has a reschedule screen or shows eligibility, so cross-platform behavior cannot be shown on a device.
* **REL-PAR-010**: PARTIAL. Defect DEF-MAP-002. The dearer/cheaper financial outcome is decided in rescheduleBooking/settleCheaper and is identical for every client identity; no client screen shows it.

## Open P0 mapping defects

* **DEF-MAP-001** (P0, OPEN): No website or mobile screen for the security deposit. Rows: REL-BIZ-UD01-002, REL-PAR-005. The security deposit exists in the service (securityDeposit.ts, routes, accounting, tests) but staff cannot collect, refund, deduct or show it on the website or the mobile app, and customers cannot see it. Needs a staff panel on a booking and a read-only customer view, then device tests on desktop web, iPad web, iOS and Android. Correction: Add screens; not a redesign (the service and routes are frozen). Feature stays OFF until then.
* **DEF-MAP-002** (P0, OPEN): No customer rescheduling screen on any platform. Rows: REL-BIZ-UD03-001, REL-BIZ-UD03-006, REL-PAR-009, REL-PAR-010. The reschedule rules are enforced in rescheduleBooking for every channel, but the website and the mobile app have no reschedule screen and show no eligibility or settlement. Owner decision: customer rescheduling stays OFF until its screens and device tests pass. Correction: Add customer screens (choose an offered option, show the difference or credit); then device tests. Feature stays OFF until then.
* **DEF-MAP-003** (P0, OPEN): No staff screen for a staff reschedule override. Rows: REL-BIZ-UD03-008. POST /api/staff/bookings/:id/reschedule works (manage_bookings + reason + audit) but neither the website desk nor the mobile desk has a control for it. Correction: Add a reason-required "move booking" control on the staff booking view; then device tests.
* **DEF-MAP-004** (P0, OPEN): A dearer replacement has no online way to pay the difference. Rows: REL-BIZ-UD03-005. The difference becomes a balance that is collected like any balance (desk / recorded payment). The owner said "the customer pays the difference"; whether that must be payable online from the customer's app, or only at the ground, is not stated. Mapped as PARTIAL until the owner confirms. Correction: Owner to confirm: balance at the ground (current) or an online top-up. If online, reuse the existing payment-instructions path for the difference; no new payment architecture.
* **DEF-MAP-101** (P0, FIXED): Guppi and the website called the booking advance a "deposit". Rows: REL-LANG-009, REL-BIZ-UD01-001. Found while mapping REL-LANG-009: Guppi's selected/deposit answers said "advance (deposit)" in all five languages and the website said "Your deposit is holding the slot". Under UD-01 the deposit is the separate refundable security deposit. Correction: Fixed in guppiText.ts (all five languages: "advance"; the answer now says a security deposit is separate and handled by the ground) and web/public/app.js. Retest: REL-BIZ-UD01-004 and REL-LANG-009 PASS.

## What the inspection found

* **One authoritative service per rule.** Booking and price: hold.ts planFor/holdSlots, options.ts, bookings.ts advanceFor. Slot conflicts: groundLinks.ts linkedBusy, called from hold.ts takeSlots (the final guard). Rescheduling: reschedule.ts rescheduleBooking, called by the customer route, the staff route and Guppi. Security deposit: securityDeposit.ts. Accounting: accounting/ledger.ts, finevents.ts.
* **Clients are presentation only.** The website (web/public/app.js, which also serves iPad web) and the Expo app (mobile/src, which serves iOS and Android) were searched for price, advance, balance, cutoff, refund and permission arithmetic: none found. There is no separate iPad client.
* **Guppi owns no rule.** guppiLang.ts interprets words; guppiBooking.ts asks the booking system for options and shows its figures; guppi.ts hold/reschedule call the normal services with the customer's own rights; routes/guppi.ts has no pay, confirm, refund, waive, approve or cancel route.
* **Duplicate check.** No duplicate business rule found in Customer Web, Daji Admin, iPad web, iOS, Android, Guppi or manual/walk-in booking. Three code paths write booking_slots (hold.takeSlots, payments.lateForExpired, grounds.blockRange for owner blocks): the first two consult linkedBusy; the late-payment path was missing the linked check at first and is covered by REL-BIZ-UD02-004. Owner block rows on a whole ground do not block its nets (only bookings do).
* **Legacy kept.** retention.ts (deposit disputes on the booking advance) stays until a replacement passes; it is not the security deposit.
* **Mapping found and fixed one P0 defect (DEF-MAP-101).** Guppi's selected/deposit answers (five languages) and one website message called the booking advance a "deposit". Fixed and retested (REL-BIZ-UD01-004, REL-LANG-009).
* **Missing client surfaces** (website and mobile app): security deposit, ground-link configuration, customer rescheduling, staff reschedule control. These are the reasons for the PARTIAL rows; customer rescheduling and the security deposit stay OFF.

## UD-03 exact locations

* 24-hour comparison (REL-BIZ-UD03-011): `server/src/reschedule.ts` L125: `b.start_at - t <= policy.cutoffHours * HOUR`.
* Successful-reschedule counter (REL-BIZ-UD03-010): `server/src/reschedule.ts` L144: `reschedule_count = reschedule_count + ?` inside the same transaction as the move; the limit check reads the append-only history at L126.
* Replacement taken before the old time is released: L141 then L142.

## Files

* `DAJI_V2_TRACEABILITY_FOR_CLAUDE_SOURCE_MAPPING_COMPLETED.csv`: the completed mapping (73 rows).
* `IMPL/IMPL-<TEST_ID>.md`: one record per row.
* `MAP_CHECKLIST_RESULTS.csv`: the review checklist result per row and item (MAP-<TEST_ID>).
* `TRACEABILITY/EV/EV-*.md`: one DAJI V2 EXECUTION EVIDENCE record per row.
