import { runCheck } from './compliance.ts';
import { syncLawFeed } from './lawUpdates.ts';
import { runSheetSync } from './sheets.ts';
import { runRecurring } from './accounting/books.ts';
import { runDepreciation } from './accounting/plus.ts';
import { runFeedSync } from './accounting/feed.ts';
import { runAaSync } from './accounting/aa.ts';
import { billingDaily } from './billing.ts';
import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { audit, SYSTEM } from './audit.ts';
import { HOUR, MIN } from './time.ts';
import { getSettings } from './settings.ts';
import { bookingOr404, confirmBooking, releaseSiblings, releaseSlots, type BookingRow } from './bookings.ts';
import { logEvent, markFailed, processRefunds, refundPayment, type PaymentRow } from './payments.ts';
import { notify, venueData } from './notifications.ts';
import * as credits from './credits.ts';
import { runBackupIfDue } from './backup.ts';
import type { Config } from './config.ts';
import { chargeDue } from './autodebit.ts';
import { sweepQuarantine } from './intake.ts';
import { sweepFaceForgets } from './players.ts';
import { sweepWaitlist, type WaitlistSweep } from './waitlist.ts';

export interface ExpiryResult { released: number; confirmed: number; extended: number }

/**
 * Hold expiry (FR-02, FR-05, BR-03). A hold is never released just because its timer ran out:
 *   money already received            → confirm
 *   a payment still pending/submitted → extend by the grace period (bounded), flag for staff review
 *   nothing pending, or extensions used up → release
 * A payment that turns up after release is handled in payments.applyCaptured (re-confirm or refund).
 */
export function sweepHolds(): ExpiryResult {
  const res: ExpiryResult = { released: 0, confirmed: 0, extended: 0 };
  const due = many<BookingRow>("SELECT * FROM bookings WHERE status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at <= ? ORDER BY hold_expires_at LIMIT 500", now());
  const s = getSettings();
  for (const d of due) {
    tx(() => {
      const b = bookingOr404(d.id);
      if (b.status !== 'held' || b.hold_expires_at === null || b.hold_expires_at > now()) return;
      const pays = many<PaymentRow>('SELECT * FROM payments WHERE booking_id = ?', b.id);
      if (b.paid_paise >= b.advance_paise) { confirmBooking(b.id, SYSTEM, { via: 'sweep' }); res.confirmed++; return; }
      const pending = pays.some((p) => p.status === 'pending' || p.status === 'submitted');
      if (pending && b.hold_extensions < s.maxHoldExtensions) {
        const next = now() + s.graceMinutes * MIN;
        run('UPDATE bookings SET hold_expires_at = ?, hold_extensions = hold_extensions + 1, needs_review = 1, updated_at = ? WHERE id = ?', next, now(), b.id);
        audit(SYSTEM, 'booking.hold_extend', 'booking', b.id, { extensions: b.hold_extensions + 1, until: next, reason: 'payment pending' }, b.owner_id);
        res.extended++;
        return;
      }
      for (const p of pays) {
        if (p.status === 'created') markFailed(p.id, 'hold expired', SYSTEM);
        else if (p.status === 'pending' || p.status === 'submitted') logEvent(p.id, null, 'hold.released_while_pending', { note: 'a late verification will be reconciled' });
      }
      // Credit used on a booking that never completes goes back to the wallet.
      for (const p of pays) if (p.method === 'credit' && p.status === 'captured') {
        credits.issueCredit({ customerId: b.customer_id, ownerId: b.owner_id, amountPaise: p.amount_paise, source: 'restore', bookingId: b.id, note: `Hold ${b.ref} expired`, silent: true });
        run("UPDATE payments SET status = 'refunded', refunded_paise = amount_paise WHERE id = ?", p.id);
      }
      // Cash that was received but did not reach the advance goes back to the customer.
      for (const p of pays) if (p.method !== 'credit' && (p.status === 'captured' || p.status === 'partially_refunded') && p.amount_paise > p.refunded_paise) {
        refundPayment(p, p.amount_paise - p.refunded_paise, 'hold expired before the advance was paid', SYSTEM);
      }
      run('UPDATE bookings SET paid_paise = 0 WHERE id = ?', b.id);
      releaseSlots(b.id);
      releaseSiblings(b);
      run("UPDATE bookings SET status = 'expired', hold_expires_at = NULL, needs_review = ?, updated_at = ? WHERE id = ?", pending ? 1 : 0, now(), b.id);
      audit(SYSTEM, 'booking.expire', 'booking', b.id, { pendingPaymentIgnored: pending, extensions: b.hold_extensions }, b.owner_id);
      const g = many<{ name: string }>('SELECT name FROM grounds WHERE id = ?', b.ground_id)[0];
      notify(b.customer_id, 'hold_expired', { ref: b.ref, ground: g?.name, startAt: b.start_at }, b.id);
      res.released++;
    });
  }
  return res;
}

/** Confirmed bookings are marked completed a day after they end, unless staff recorded a no-show. */
export function sweepCompleted(): number {
  const rows = many<BookingRow>("SELECT * FROM bookings WHERE status = 'confirmed' AND end_at <= ?", now() - 24 * HOUR);
  for (const b of rows) {
    run("UPDATE bookings SET status = 'completed', updated_at = ? WHERE id = ? AND status = 'confirmed'", now(), b.id);
    audit(SYSTEM, 'booking.complete', 'booking', b.id, null, b.owner_id);
  }
  return rows.length;
}

/** One reminder per confirmed booking, 24 hours before it starts, once. */
export function sweepReminders(): number {
  const t = now();
  const rows = many<BookingRow & { ground_name: string }>("SELECT b.*, g.name AS ground_name FROM bookings b JOIN grounds g ON g.id = b.ground_id WHERE b.status = 'confirmed' AND b.reminded_at IS NULL AND b.start_at > ? AND b.start_at <= ?", t, t + 24 * HOUR);
  for (const b of rows) {
    run('UPDATE bookings SET reminded_at = ? WHERE id = ? AND reminded_at IS NULL', t, b.id);
    notify(b.customer_id, 'booking_reminder', { ref: b.ref, ground: b.ground_name, startAt: b.start_at, amountPaise: Math.max(b.total_paise - b.paid_paise, 0), ...venueData(b.ground_id) }, b.id);
  }
  return rows.length;
}

export interface SweepResult { expiry: ExpiryResult; creditsExpiredPaise: number; reminders: number; completed: number; refundsProcessed: number; waitlist: WaitlistSweep | null }

const logErr = (where: string) => (e: unknown) => console.error(JSON.stringify({ level: 'error', where, error: String((e as Error)?.message ?? e) }));

/** The time-critical part: holds, the waitlist, reminders and refunds. It never waits on bank feeds or billing. */
export async function runFastSweeps(cfg: Config): Promise<SweepResult> {
  const expiry = sweepHolds();
  // after the holds, so a waitlist hold that was not paid has already been released and its session goes back to the others
  let waitlist: WaitlistSweep | null = null;
  try { waitlist = sweepWaitlist(); } catch (e) { logErr('waitlist')(e); }
  const ce = credits.expireDue();
  const reminders = sweepReminders();
  const completed = sweepCompleted();
  const refunds = await processRefunds(cfg);
  return { expiry, creditsExpiredPaise: ce.totalPaise, reminders, completed, refundsProcessed: refunds.done, waitlist };
}

/** The slow part, which calls other services and may take a while: auto-debit, bank feeds, billing, recurring entries, faces players removed (asked of the face service), the compliance check, the law updates feed and the shared spreadsheets. */
export async function runSlowSweeps(cfg: Config): Promise<void> {
  await chargeDue(cfg).catch(logErr('autodebit'));
  try { sweepQuarantine(cfg.dataDir); } catch (e) { logErr('quarantine')(e); }
  await sweepFaceForgets(cfg).catch(logErr('face-forget'));
  runRecurring(null, null);
  runDepreciation(null, SYSTEM);
  await runFeedSync(cfg, logErr('bank-feed'));
  await runAaSync(cfg, logErr('account-aggregator'));
  await billingDaily(cfg, SYSTEM).catch(logErr('billing'));
  try { runCheck(); } catch (e) { logErr('compliance-check')(e); }
  await syncLawFeed(cfg).catch(logErr('law-feed'));
  await runSheetSync(cfg, undefined, logErr('shared-sheet')).catch(logErr('shared-sheet'));
}

/** Everything the scheduler does each minute. Safe to run any number of times. */
export async function runSweeps(cfg: Config): Promise<SweepResult> {
  const r = await runFastSweeps(cfg);
  await runSlowSweeps(cfg);
  return r;
}

registerSchema('scheduler-lease-1', `CREATE TABLE scheduler_lease (name TEXT PRIMARY KEY, holder TEXT NOT NULL, until INTEGER NOT NULL);`);
const instanceId = Math.random().toString(36).slice(2);
/** Only one server process runs the sweeps and backups at a time: a process takes (or renews) the lease, or skips the round when another holds it. */
export function takeLease(name: string, ttlMs: number, holder = instanceId): boolean {
  const t = now();
  run('INSERT INTO scheduler_lease(name, holder, until) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, until = excluded.until WHERE scheduler_lease.holder = excluded.holder OR scheduler_lease.until < ?', name, holder, t + ttlMs, t);
  return one<{ holder: string }>('SELECT holder FROM scheduler_lease WHERE name = ?', name)?.holder === holder;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startScheduler(cfg: Config, onError: (e: unknown) => void = () => {}): void {
  if (timer) return;
  const busy = { fast: false, slow: false };
  const every = cfg.sweepIntervalSeconds * 1000;
  // Two lanes with their own lease: a slow bank feed or billing run cannot delay hold expiry, and the lease is renewed on every tick even while a run is going.
  timer = setInterval(() => {
    const ttl = Math.max(120_000, cfg.sweepIntervalSeconds * 3000);
    if (takeLease('sweeps', ttl) && !busy.fast) {
      busy.fast = true;
      try { runBackupIfDue(cfg, onError); } catch (e) { onError(e); }
      runFastSweeps(cfg).catch(onError).finally(() => { busy.fast = false; });
    }
    if (takeLease('sweeps-slow', Math.max(ttl, 600_000)) && !busy.slow) {
      busy.slow = true;
      runSlowSweeps(cfg).catch(onError).finally(() => { busy.slow = false; });
    }
  }, every);
  timer.unref();
}
export function stopScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
