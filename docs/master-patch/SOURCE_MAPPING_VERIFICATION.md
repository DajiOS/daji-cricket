# SOURCE_MAPPING_VERIFICATION

Daji V2 source mapping of the 73 rows of DAJI_V2_TRACEABILITY_FOR_CLAUDE_SOURCE_MAPPING_WITH_REVIEW.csv. Daji only. Inspected at commit `f61fe8e`.

Method: every file and symbol in the completed CSV was looked up in the working tree by an exact pattern (a missing one aborts the build, so none is invented); each row's required test was executed in the final run and its result is read from the evidence file it wrote (a row with no evidence record would be NOT_RUN and cannot be VERIFIED); clients were searched for competing business rules.

**This is a Claude self-review, not an independent review.** No row is final PASS: real-device runs (desktop web, iPad web, iOS, Android) are NOT_RUN and reviewer acceptance is pending for all 73, so every Final_Status is BLOCKED. Where the review checklist says VERIFIED needs reviewer acceptance but the status definition does not, VERIFIED here follows the status definition (exact implementation mapped and covered by an executed, passing test and evidence) and acceptance is a separate column (`Reviewer_Acceptance` = PENDING).

## Counts

| | Rows |
|---|---|
| Total rows | 73 |
| Verified rows | 73 |
| Partial rows | 0 |
| Missing rows | 0 |
| Duplicate rows | 0 |
| Legacy rows | 0 |
| Not-applicable rows | 0 |
| P0 rows | 43 (VERIFIED 43) |
| Automated tests executed and PASS | 73 of 73 |
| Open P0 mapping defects | 0 |

## Every non-VERIFIED P0 row

None: every P0 row is VERIFIED (reviewer acceptance is pending for all rows, see above).

## Mapping defects and their status

* **DEF-MAP-001** (P0, FIXED): No website or mobile screen for the security deposit. Rows: REL-BIZ-UD01-002, REL-PAR-005. The security deposit existed in the service but staff could not collect, refund, deduct or show it on the website or the mobile app and customers could not see it. Correction: Staff desk panel (collect, return, keep part with reason, reverse; owner-only actions hidden from other staff) and a read-only customer deposit view on the website (also iPad web) and in the iOS/Android app; advance and security deposit shown separately. Feature stays OFF by default.
* **DEF-MAP-002** (P0, FIXED): No customer rescheduling screen on any platform. Rows: REL-BIZ-UD03-001, REL-BIZ-UD03-006, REL-PAR-009, REL-PAR-010. The reschedule rules were enforced for every channel but no website or mobile screen showed eligibility, options or the settlement. Correction: Customer "Change time" flow on the website (also iPad web) and in the app: eligibility (GET /api/bookings/:id/reschedule), offered replacement times, preview of the difference or the cheaper-move settlement (POST .../reschedule-preview), then the existing move. Feature stays OFF by default.
* **DEF-MAP-003** (P0, FIXED): No staff screen for a staff reschedule override. Rows: REL-BIZ-UD03-008. POST /api/staff/bookings/:id/reschedule worked but the staff desk had no control for it. Correction: "Move booking" dialog on the staff booking (preview, reason of 10+ characters, server errors rendered); it does not use the customer's allowance.
* **DEF-MAP-004** (P0, FIXED): A dearer replacement had no online way to pay the difference. Rows: REL-BIZ-UD03-005. The difference was only a balance collected at the ground. Owner decision 27 Oct 2026 (locked): the customer must be able to pay the exact difference online on web and mobile. Correction: POST /api/bookings/:id/pay-difference opens one payment session for exactly the difference through the existing payment-instructions and provider path; provider-confirmed state is authoritative; an incomplete attempt stays outstanding; website and app screens call it.
* **DEF-MAP-101** (P0, FIXED): Guppi and the website called the booking advance a "deposit". Rows: REL-LANG-009, REL-BIZ-UD01-001. Found while mapping REL-LANG-009: Guppi's selected/deposit answers said "advance (deposit)" in all five languages and the website said "Your deposit is holding the slot". Under UD-01 the deposit is the separate refundable security deposit. Correction: Fixed in guppiText.ts (all five languages: "advance"; the answer now says a security deposit is separate and handled by the ground) and web/public/app.js. Retest: REL-BIZ-UD01-004 and REL-LANG-009 PASS.

## What the inspection found

* **One authoritative service per rule.** Booking and price: hold.ts planFor/holdSlots, options.ts, bookings.ts advanceFor. Slot conflicts: groundLinks.ts linkedBusy, called from hold.ts takeSlots (the final guard). Rescheduling: reschedule.ts rescheduleBooking, called by the customer route, the staff route and Guppi. Security deposit: securityDeposit.ts. Accounting: accounting/ledger.ts, finevents.ts.
* **Clients are presentation only.** The website (web/public/app.js, which also serves iPad web) and the Expo app (mobile/src, which serves iOS and Android) were searched for price, advance, balance, cutoff, refund and permission arithmetic: none found. There is no separate iPad client.
* **Guppi owns no rule.** guppiLang.ts interprets words; guppiBooking.ts asks the booking system for options and shows its figures; guppi.ts hold/reschedule call the normal services with the customer's own rights; routes/guppi.ts has no pay, confirm, refund, waive, approve or cancel route.
* **Duplicate check.** No duplicate business rule found in Customer Web, Daji Admin, iPad web, iOS, Android, Guppi or manual/walk-in booking. Three code paths write booking_slots (hold.takeSlots, payments.lateForExpired, grounds.blockRange for owner blocks): the first two consult linkedBusy; the late-payment path was missing the linked check at first and is covered by REL-BIZ-UD02-004. Owner block rows on a whole ground do not block its nets (only bookings do).
* **Legacy kept.** retention.ts (deposit disputes on the booking advance) stays until a replacement passes; it is not the security deposit.
* **Mapping found and fixed one P0 defect (DEF-MAP-101).** Guppi's selected/deposit answers (five languages) and one website message called the booking advance a "deposit". Fixed and retested (REL-BIZ-UD01-004, REL-LANG-009).
* **Client surfaces added by the completion patch (DEF-MAP-001..004):** customer security-deposit view, customer reschedule flow with online payment of the exact difference, staff deposit panel, staff Move Booking dialog and the ground-link settings, on the website (also iPad web), the Expo app (iOS and Android) and the staff desk. Customer rescheduling and the security deposit stay OFF by default.

## UD-03 exact locations

* 24-hour comparison (REL-BIZ-UD03-011): `server/src/reschedule.ts` L118: `b.start_at - t <= policy.cutoffHours * HOUR`.
* Successful-reschedule counter (REL-BIZ-UD03-010): `server/src/reschedule.ts` L204: `reschedule_count = reschedule_count + ?` inside the same transaction as the move; the limit check reads the append-only history at L119.
* Replacement taken before the old time is released: L201 then L202.

## Files

* `DAJI_V2_TRACEABILITY_FOR_CLAUDE_SOURCE_MAPPING_COMPLETED.csv`: the completed mapping (73 rows).
* `IMPL/IMPL-<TEST_ID>.md`: one record per row.
* `MAP_CHECKLIST_RESULTS.csv`: the review checklist result per row and item (MAP-<TEST_ID>).
* `TRACEABILITY/EV/EV-*.md`: one DAJI V2 EXECUTION EVIDENCE record per row.
