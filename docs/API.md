# API routes

Generated from `server/src/routes`. All bodies are JSON unless noted; errors use `{ "error": { "code", "message", "details" } }`. Money is integer paise. Dates are IST. File uploads (receipts, bank statements) send the file itself as the request body with the details in the query string.

| Method | Path | Group |
|---|---|---|
| GET | `/api/accounting/accounts` | accounting |
| POST | `/api/accounting/accounts` | accounting |
| DELETE | `/api/accounting/accounts/:id` | accounting |
| PATCH | `/api/accounting/accounts/:id` | accounting |
| POST | `/api/accounting/attachment-counts` | books |
| GET | `/api/accounting/attachments` | books |
| POST | `/api/accounting/attachments` | books |
| DELETE | `/api/accounting/attachments/:id` | books |
| GET | `/api/accounting/attachments/:id/file` | books |
| GET | `/api/accounting/categories` | accounting |
| POST | `/api/accounting/categories` | accounting |
| GET | `/api/accounting/imports` | books |
| POST | `/api/accounting/imports` | books |
| POST | `/api/accounting/imports/:id/undo` | books |
| GET | `/api/accounting/journal-accounts` | accounting |
| GET | `/api/accounting/journals` | accounting |
| POST | `/api/accounting/journals` | accounting |
| POST | `/api/accounting/journals/:id/void` | accounting |
| GET | `/api/accounting/memos/:month` | accounting |
| PUT | `/api/accounting/memos/:month` | accounting |
| GET | `/api/accounting/overview` | accounting |
| GET | `/api/accounting/reconcile` | books |
| POST | `/api/accounting/reconcile/auto` | books |
| GET | `/api/accounting/recurring` | books |
| POST | `/api/accounting/recurring` | books |
| DELETE | `/api/accounting/recurring/:id` | books |
| PATCH | `/api/accounting/recurring/:id` | books |
| POST | `/api/accounting/recurring/run` | books |
| GET | `/api/accounting/reports/balance-sheet` | accounting |
| GET | `/api/accounting/reports/ledger` | accounting |
| GET | `/api/accounting/reports/pnl` | accounting |
| GET | `/api/accounting/reports/trial-balance` | accounting |
| GET | `/api/accounting/reports/cash-flow` | accounting |
| GET | `/api/accounting/reports/pnl-periods` | accounting (`by=month\|quarter`, `from`, `to`, `basis`; csv/xlsx/pdf too) |
| GET | `/api/accounting/reports/customer-balances` | accounting (`asOf`, `view=summary\|detail`; aging 0-30, 31-60, 61-90, 90+) |
| GET | `/api/accounting/reports/audit-log` | accounting (`from`, `to`) |
| GET | `/api/accounting/transactions/export` | accounting (same filters as the list; `format=csv\|xlsx\|pdf`) |
| GET | `/api/accounting/reports/budget` | accounting |
| GET | `/api/accounting/reports/gst` | accounting |
| GET | `/api/accounting/feed` | accounting |
| POST | `/api/accounting/feed/link` | books |
| POST | `/api/accounting/feed/sync` | books |
| POST | `/api/media` | staff |
| GET | `/api/media` | staff |
| DELETE | `/api/media/:id` | staff |
| GET | `/api/media/:id` | public |
| GET | `/api/accounting/budgets` | accounting |
| PUT | `/api/accounting/budgets` | books |
| POST | `/api/accounting/transfers` | books |
| GET | `/api/accounting/assets` | accounting |
| POST | `/api/accounting/assets` | books |
| POST | `/api/accounting/assets/depreciate` | books |
| POST | `/api/accounting/assets/:id/dispose` | books |
| DELETE | `/api/accounting/assets/:id` | books |
| GET | `/api/accounting/rules` | books |
| POST | `/api/accounting/rules` | books |
| DELETE | `/api/accounting/rules/:id` | books |
| PATCH | `/api/accounting/rules/:id` | books |
| POST | `/api/accounting/rules/apply` | books |
| GET | `/api/accounting/settings` | accounting |
| PATCH | `/api/accounting/settings` | accounting |
| GET | `/api/accounting/signoffs` | accounting |
| POST | `/api/accounting/signoffs` | accounting |
| POST | `/api/accounting/signoffs/reopen` | accounting |
| GET | `/api/accounting/transactions` | accounting |
| POST | `/api/accounting/transactions` | accounting |
| DELETE | `/api/accounting/transactions/:id` | accounting |
| PATCH | `/api/accounting/transactions/:id` | accounting |
| POST | `/api/accounting/transactions/:id/match` | books |
| POST | `/api/accounting/transactions/:id/unmatch` | books |
| GET | `/api/admin/audit` | admin |
| GET | `/api/admin/backups` | admin |
| POST | `/api/admin/backups` | admin |
| POST | `/api/admin/backups/practice-restore` | admin (restores the newest snapshot into a throw-away folder and checks it) |
| GET | `/api/admin/readiness` | owner, admin (the go-live check: what is still unset, by name only) |
| GET | `/api/admin/leads` | platform |
| PATCH | `/api/admin/leads/:id` | platform |
| GET | `/api/admin/settings` | admin |
| PUT | `/api/admin/settings` | admin |
| GET | `/api/admin/users` | admin |
| POST | `/api/admin/users` | admin |
| PATCH | `/api/admin/users/:id` | admin |
| POST | `/api/admin/users/:id/password` | admin |
| POST | `/api/auth/login` | public (`identifier` is an email address or a mobile number; `email` still works) |
| POST | `/api/auth/register` | public |
| GET | `/api/bookings` | customer |
| POST | `/api/bookings` | customer (body: `groundId`, `date`, `startTime`, then `slots`, `formatId`, or `ruleId` (a line of the ground's price list; with `slots` too for a by-the-hour line). A ground with a price list needs `ruleId`; one with play formats needs `formatId`). Ground fields `rates`, `closedDays`, `ratesNote` hold the price list; availability returns `rates` for the day (a fixed session already under way today comes back `proRated: true` with `hoursLeft`, `fullPricePaise`, the first free `time` and a share of the price rounded up to the next ₹50) |
| GET | `/api/bookings/:id` | customer |
| POST | `/api/bookings/:id/cancel` | customer (body `prefer: 'credit'` keeps the full amount as credit; otherwise `cashRefundPercent` of cash paid is refunded) |
| POST | `/api/bookings/:id/resolve` | customer (after a ground cancellation: `choice` is `refund`, `half`, `credit` or `rebook`, and must be one the owner offered) |
| POST | `/api/promo/check` | customer (same body as a hold plus `promoCode`; returns `discountPaise`, `totalPaise`, `fullPricePaise`) |
| POST/DELETE | `/api/me/avatar` | user (the picture itself as the body; 2 MB; the response has `avatarUrl`) |
| GET | `/api/avatar/:id` | public (unguessable address) |
| GET/POST/PATCH/DELETE | `/api/admin/services` | super admin (the notebook of outside services) |
| GET | `/api/admin/integrations` | super admin (what each service needs, and whether it is set up) |
| POST | `/api/admin/integrations/:id/test` | super admin (a free live check, where one exists) |
| POST | `/api/me/push-token` | user (`token`, `platform`) |
| POST | `/api/me/push-token/remove` | user |
| GET | `/api/bookings/:id/cancel-preview` | customer |
| POST | `/api/bookings/:id/upi-reference` | customer |
| GET | `/api/config` | public |
| GET | `/api/credits` | customer |
| POST | `/api/enquiries` | public |
| POST | `/api/gateway/demo/pay` | gateway |
| POST | `/api/gateway/demo/webhook` | gateway |
| GET | `/api/grounds` | public |
| GET | `/api/grounds/:id` | public |
| GET | `/api/grounds/:id/availability` | public (returns `slots` and, per play format, the sessions with their state) |
| GET | `/api/health` | public (`{ ok, time, database, demo }`; 503 when the database cannot be read) |
| GET | `/api/matches` | matches |
| GET | `/api/matches/:id` | matches |
| GET | `/api/me` | customer |
| PATCH | `/api/me` | customer |
| GET | `/api/me/children` | academy |
| GET | `/api/me/mfa` | customer |
| POST | `/api/me/mfa/disable` | customer |
| POST | `/api/me/mfa/enable` | customer |
| POST | `/api/me/mfa/setup` | customer |
| POST | `/api/me/password` | customer |
| GET | `/api/my/enquiries` | customer |
| GET | `/api/my/enquiries/:id` | customer |
| POST | `/api/my/enquiries/:id/quotations/:qid/respond` | customer |
| GET | `/api/notifications` | customer |
| POST | `/api/payments/razorpay/verify` | customer |
| POST | `/api/platform/leads` | platform |
| GET | `/api/staff/academy/attendance` | academy |
| POST | `/api/staff/academy/attendance` | academy |
| GET | `/api/staff/academy/skills` | academy |
| PUT | `/api/staff/academy/skills` | academy |
| GET | `/api/staff/academy/coaches` | academy |
| PUT | `/api/staff/academy/coaches` | academy (up to 12 coaches; shown on the website) |
| GET | `/api/staff/academy/students` | academy |
| POST | `/api/staff/academy/students` | academy |
| GET | `/api/staff/academy/students/:id` | academy |
| PATCH | `/api/staff/academy/students/:id` | academy |
| POST | `/api/staff/academy/students/:id/link-guardian` | academy |
| GET | `/api/staff/academy/students/:id/progress` | academy |
| PUT | `/api/staff/academy/students/:id/progress/:month` | academy |
| POST | `/api/staff/academy/students/:id/progress/:month/publish` | academy |
| POST | `/api/staff/academy/students/:id/unlink-guardian` | academy |
| POST | `/api/staff/ask` | ask |
| GET | `/api/staff/ask/examples` | ask |
| GET | `/api/staff/bookings` | staff |
| POST | `/api/staff/bookings` | staff |
| GET | `/api/staff/bookings/:id` | staff |
| GET/POST | `/api/staff/promos` | owner, super admin (POST: `code`, or `auto: true` with `count`, `prefix`, `oneTime`; plus `kind` percent/flat, `value`, `maxDiscountPaise`, `minTotalPaise`, `validFrom`, `validTo`, `usageLimit`, `perCustomerLimit`, `groundId`) |
| POST | `/api/staff/promos/:id/active` | owner, super admin (`active`) |
| POST | `/api/staff/bookings/:id/approve` | staff (`manage_bookings`) |
| POST | `/api/staff/bookings/:id/cancel` | staff (a booking with money needs `reason`, 10+ characters, else 400 `REASON_REQUIRED`; `offers` lists what the customer may choose: `refund`, `half`, `credit`) |
| GET | `/api/staff/bookings/:id/cancel-preview` | staff |
| POST | `/api/staff/bookings/:id/no-show` | staff |
| POST | `/api/staff/bookings/:id/payments` | staff |
| POST | `/api/staff/bookings/:id/review-done` | staff |
| GET | `/api/staff/broadcast-templates` | contacts |
| GET | `/api/staff/broadcasts` | contacts |
| POST | `/api/staff/broadcasts` | contacts |
| GET | `/api/staff/broadcasts/:id` | contacts |
| GET | `/api/staff/broadcasts/:id/manual` | contacts |
| POST | `/api/staff/broadcasts/:id/manual-sent` | contacts |
| POST | `/api/staff/broadcasts/preview` | contacts |
| GET | `/api/staff/contacts` | contacts |
| POST | `/api/staff/contacts/:id/opt-out` | contacts |
| GET | `/api/staff/contacts/export` | contacts |
| GET | `/api/staff/customers` | staff |
| GET | `/api/staff/customers/lookup` | staff |
| GET | `/api/staff/customers/:id` | staff |
| POST | `/api/staff/customers/:id/credit` | staff |
| GET | `/api/staff/enquiries` | staff |
| GET | `/api/staff/enquiries/:id` | staff |
| POST | `/api/staff/enquiries/:id/close` | staff |
| POST | `/api/staff/enquiries/:id/convert` | staff |
| POST | `/api/staff/enquiries/:id/notes` | staff |
| POST | `/api/staff/enquiries/:id/quotations` | staff |
| GET | `/api/staff/grounds` | staff |
| POST | `/api/staff/grounds` | staff |
| PATCH | `/api/staff/grounds/:id` | staff |
| POST | `/api/staff/grounds/:id/blocks` | staff |
| POST | `/api/staff/grounds/:id/blocks/remove` | staff |
| GET | `/api/staff/matches` | matches |
| POST | `/api/staff/matches` | matches |
| GET | `/api/staff/matches/:id` | matches |
| PATCH | `/api/staff/matches/:id` | matches |
| POST | `/api/staff/matches/:id/balls` | matches |
| POST | `/api/staff/matches/:id/undo` | matches |
| GET | `/api/staff/payments` | staff |
| GET | `/api/staff/payments/:id/history` | staff |
| POST | `/api/staff/payments/:id/verify` | staff |
| GET | `/api/staff/refunds` | staff |
| POST | `/api/staff/refunds/:id/complete` | staff |
| GET | `/api/staff/reports/overview` | staff |
| GET | `/api/staff/team` | staff |
| POST | `/api/staff/team` | staff |
| PATCH | `/api/staff/team/:id` | staff |
| GET | `/api/staff/today` | staff |
| GET | `/api/unsubscribe` | contacts |
| POST | `/api/unsubscribe` | contacts |
| POST | `/api/webhooks/razorpay` | gateway |


### Phone and code sign-in

| Method | Path | Notes |
|---|---|---|
| GET | `/api/auth/microsoft/start` | `app` (`dajicricket` or `dajiadmin`), `challenge` (base64url SHA-256 of a secret the app keeps); sends the browser to Microsoft. 404 `MICROSOFT_OFF` until MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are set |
| GET | `/api/auth/microsoft/callback` | Microsoft comes back here; sends the browser to `<app>://auth/microsoft?ticket=…` (or `?error=…`). The ticket lasts 2 minutes and works once |
| POST | `/api/auth/microsoft/redeem` | body `ticket`, `verifier` (the secret behind the challenge), `code` when the account has 2-step sign-in (else 401 `MFA_REQUIRED`); returns `token`, `user` |
| POST | `/api/auth/otp/request` | body `phone`; sends a 6-digit code (demo mode returns `devCode`) |
| POST | `/api/auth/otp/verify` | body `phone`, `code`, and `firstName`, `lastName` for a new number (else 400 `NAME_REQUIRED`); returns `token`, `user`, `created` |
| POST | `/api/auth/register` | now also accepts `firstName` and `lastName` instead of `name` |
| PATCH | `/api/admin/users/:id` | now accepts `firstName`, `lastName`, `email` |


## Tasks

All need sign-in as owner, staff or super admin (super admin adds `?ownerId=`).

- `GET /api/tasks?status=open|done|cancelled`: staff without `manage_tasks` see only their own and open-to-all tasks.
- `POST /api/tasks` `{title, details?, assignedTo?, dueDate?, photosRequired?}` (needs `manage_tasks`).
- `PATCH /api/tasks/:id`, `POST /api/tasks/:id/cancel`, `POST /api/tasks/:id/reopen` (`manage_tasks`).
- `POST /api/tasks/:id/photos?note=` raw JPEG body (up to 8 MB). Errors: 415 `NOT_A_CAMERA_PHOTO`, 422 `NO_CAMERA_DATA`, 422 `PHOTO_TOO_OLD` (older than 5 minutes), 422 `PHOTO_FROM_FUTURE`, 409 `PHOTO_ALREADY_USED`, 409 `TASK_CLOSED`.
- `POST /api/tasks/:id/complete` `{note?}`: 409 `PHOTOS_NEEDED` until the required photos are in.
- `GET /api/tasks/photos/:id`: the picture (needs the sign-in header).

(The phone app sends `x-app-shot-at` (epoch ms) with a task photo. It is used only when the saved file carries no camera time; a camera time inside the file always wins.)


## Booking window and closed days

- `GET /api/config` (public) carries `bookingsOpenFrom`, `bookingsCloseFrom`, `closedDates {ground, practice, academy}`, `autoDebitEnabled`, `autoDebitHoursBefore`.
- `GET/PUT /api/admin/settings` (owner or super admin): `bookingsOpenFrom`, `bookingsCloseFrom` (YYYY-MM-DD or empty), `autoDebitEnabled`, `autoDebitHoursBefore` (1 to 168).
- `GET /api/admin/closed-dates`; `POST /api/admin/closed-dates` `{dates:[...], closed:true|false, reason?, scopes?:['ground'|'practice'|'academy']}` (no `scopes` means all three). Errors on holds: 409 `NOT_OPEN_YET`, `BOOKINGS_CLOSED`, `DATE_CLOSED`.

## Repeating bookings

`POST /api/bookings` accepts `repeat: {frequency: 'daily'|'weekly'|'monthly'|'yearly', count}` (count includes the first date, 2 or more; most 60 / 52 / 12 / 3). The first date is held and paid like any booking. The other dates are reserved with it (no timer), at that day's price, and confirmed when the first is confirmed; their balance is paid at the ground or by auto-debit. If the first expires or is cancelled unpaid, the others are released. Monthly and yearly keep the day of the month (31 Jan, 28 Feb, 31 Mar...). Dates that are closed, outside the booking window, not on the price list that day or already taken are skipped and listed.

Response adds `series: {id, frequency, created, skipped:[{date, reason}]}`. Bookings carry `seriesId`, `seriesIndex`.

- `GET /api/bookings/:id/series` returns every date of the series.
- `POST /api/bookings/:id/cancel-series` `{reason?}` cancels the upcoming dates with no money on them and returns `{cancelled, kept}`.

## Multi-day bookings (custom programmes)
A camp, tournament or shoot over consecutive days is agreed through an enquiry and quotation, then entered by staff on the web desk (Bookings > Multi-day booking).

- `POST /api/staff/bookings/block` `{ groundId, fromDate, toDate, startTime, endTime, totalPaise, customer, payment, notes }` makes one booking per day (up to 31) for the same hours. The agreed total is shared across the days; the first day's advance must be received now. It is all or nothing, and ignores the ground's maximum hours and weekly closed day.
- `POST /api/staff/enquiries/:id/convert-block` does the same from an enquiry and marks it converted.
- In `GET /api/staff/bookings?group=1` (the list and month calendar; without it every day is its own row) a block is one row (its first day) with `block: {seriesId, days, fromDate, toDate, totalPaise, paidPaise, balancePaise}`; a date filter matches any day of the block. `GET /api/staff/bookings/:id` also returns `block` with `items` (each day).
- `GET /api/staff/reports/upcoming?months=6` returns the confirmed sessions from today by month: `{items:[{period, bookings, totalPaise, paidPaise, balancePaise}], totalPaise, paidPaise, balancePaise, bookings}`. Needs `view_reports` and the revenue switch.
- `POST /api/staff/bookings/block/:seriesId/payments` `{method, amountPaise, reference?, note?}` records one payment for the whole block. It fills the earliest days first; the payment reference stays on the first day.
- Cash is counted for the whole block as one event (section 269ST): cash of Rs 2,00,000 or more across all its days is refused (`CASH_LIMIT_269ST`). Take the rest by UPI, bank transfer or cheque.

## Auto-debit (UPI AutoPay)

Off until the owner turns on `autoDebitEnabled`. Needs Recurring Payments on the Razorpay account; test it in test mode first. Customers only.

- `GET /api/autodebit` returns `{status: none|pending|active, maxAmountPaise, enabled, hoursBefore, limits}`.
- `POST /api/autodebit/start` `{maxAmountPaise?}` (100 to 15,000 rupees, default 5,000) returns `{mandateId, razorpay:{keyId, orderId, customerId, demo, amountPaise, recurring}}`. Open Razorpay Checkout with it (`recurring: 1`, a Rs 1 check that is refunded).
- `POST /api/autodebit/confirm` `{mandateId, paymentId, signature}` (demo mode needs only `mandateId`).
- `DELETE /api/autodebit` turns it off.

Every minute the server charges the balance of confirmed bookings that start within `autoDebitHoursBefore` hours, for customers with an active mandate. Real Razorpay answers by webhook (`payment.captured` or `payment.failed`); a failed charge tells the customer and is retried hourly up to 3 times. A balance above the approved limit is skipped and the customer is told.

## Email (Gmail)

Set `GMAIL_USER` (default dajicricket@gmail.com) and `GMAIL_APP_PASSWORD` (a Google App Password, not the normal password). Messages stay queued until it is set. The Services page has a Test button.

## Statutory payroll (owner only)
`GET /api/accounting/payroll/statutory?month=YYYY-MM` returns what is owed to PF, ESI, Gujarat PT and the tax department for the month, with due dates and per-person lines. Staff profiles accept `pf`, `esi`, `pt`, `tds` (booleans), `tdsFixedPaise`, `uan`, `esicNo`, `pan`. Payroll lines carry `pfEmployeePaise`, `pfEmployerPaise`, `pfAdminPaise`, `esiEmployeePaise`, `esiEmployerPaise`, `ptPaise`, `tdsPaise`; they come off net pay and are frozen when the month is finalised. Rules live in `server/src/accounting/statutory.ts`.

## India tax rules
- Cash limits (`server/src/taxrules.ts`): a cash receipt that brings one customer to Rs 2,00,000 or more in a day, or one booking to that, is refused (422 `CASH_LIMIT_269ST`). Cash to one payee above Rs 10,000 in a day needs `cashReason` on bill payment or a manual cash entry (422 `CASH_REASON_NEEDED`). A cash loan of Rs 20,000 or more is refused (422 `CASH_LIMIT_269SS`).
- `GET /api/bookings/:id/invoice` issues, once, the GST invoice for a confirmed paid booking (customer, or team with `manage_bookings`). Number is `PREFIX/26-27/000001`, never over 16 characters. Without a GSTIN it is a receipt with no tax. Includes SAC, CGST and SGST, and `reverseChargeLine`.
- `GET/PUT /api/accounting/gst-profile`, `GET /api/accounting/invoices?fy=26-27` (owner).

## Compliance register (owner)
`GET /api/compliance` returns rules with review dates, the law-change log and past checks. `POST /api/compliance/:code/review`, `POST /api/compliance/changes`, `POST /api/compliance/:code/limit` (cash limits only, logs a change), `POST /api/compliance/check`. The check also runs by itself on the 1st and 16th (IST).

## Team terms
`GET /api/legal/staff-terms` returns the wording, version and SHA-256. `POST /api/legal/staff-terms/accept {version, sha256}` records the acceptance with time and IP. Until accepted, every other team request returns 403 `TERMS_REQUIRED`. `GET /api/legal/staff-terms/report` (owner) lists who accepted. Changing the wording requires bumping `STAFF_TERMS_VERSION` in `server/src/legal.ts`.

## Sign-out and revenue
`POST /api/auth/logout` revokes the token on the server; `POST /api/auth/logout-all` ends every session. The `view_revenue` permission ("Can see revenue") gates reports, the books, bills and the dashboard money tiles for team members; the owner always sees them.
