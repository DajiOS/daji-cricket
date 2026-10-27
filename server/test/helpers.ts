// Test harness. Every test file runs in its own process (node --test), so each gets its own in-memory
// database, its own port and its own frozen clock: files can run in parallel without touching each other.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadConfig, type Config } from '../src/config.ts';
import { openDb, closeDb, db } from '../src/db.ts';
import { withAppendOnlyLifted } from '../src/appendOnly.ts';
import { buildServer } from '../src/app.ts';
import { seedDemo, DEMO_ACCOUNTS } from '../src/seed.ts';
import { setNow, resetClock, advance, T0 } from '../src/clock.ts';
import { stopScheduler } from '../src/jobs.ts';
import { ensureBuiltinCategories } from '../src/accounting/schema.ts';
import { updateSettings } from '../src/settings.ts';
import { istDate, addDays, istMidnight, HOUR, MIN, DAY } from '../src/time.ts';
import { checkoutSignature, webhookSignature, DEMO } from '../src/gateway.ts';
import type { Booking, HoldResponse } from '@daji/shared';

export { T0, HOUR, MIN, DAY, DEMO_ACCOUNTS, setNow, advance };

export interface Reply<T = any> { status: number; body: T; headers: Headers }

export interface Harness {
  cfg: Config;
  url: string;
  server: Server;
  /** Wipe every table and re-create the demo accounts and grounds. The clock goes back to T0. */
  reset(): void;
  close(): Promise<void>;
  call<T = any>(method: string, path: string, opts?: { token?: string | null; body?: unknown; raw?: Buffer | string; headers?: Record<string, string> }): Promise<Reply<T>>;
  get<T = any>(path: string, token?: string | null): Promise<Reply<T>>;
  post<T = any>(path: string, body?: unknown, token?: string | null): Promise<Reply<T>>;
  put<T = any>(path: string, body?: unknown, token?: string | null): Promise<Reply<T>>;
  patch<T = any>(path: string, body?: unknown, token?: string | null): Promise<Reply<T>>;
  del<T = any>(path: string, token?: string | null): Promise<Reply<T>>;
  login(account: keyof typeof DEMO_ACCOUNTS): Promise<string>;
}

export async function startHarness(env: Record<string, string> = {}): Promise<Harness> {
  const cfg = loadConfig({ PUBLIC_URL: 'http://localhost:4000', RATE_LIMIT: 'off', REQUIRE_STAFF_TERMS: 'off', LOG: 'off', DEMO_MODE: 'on', ...env });
  setNow(T0);
  openDb(':memory:');
  seedDemo(cfg);
  updateSettings({ requireApproval: false, bookingsOpenFrom: '', bookingsCloseFrom: '', guppiAssistEnabled: true, customerRescheduleEnabled: true, securityDepositEnabled: true }, null); // the older tests book and confirm straight away; approval has its own tests. The release switches ship OFF; tests of those features turn them on here (rel-lang.test.ts checks the shipped defaults).
  const server = buildServer(cfg);
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call<T>(method: string, path: string, opts: { token?: string | null; body?: unknown; raw?: Buffer | string; headers?: Record<string, string> } = {}): Promise<Reply<T>> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let body: string | Buffer | undefined;
    if (opts.raw !== undefined) body = opts.raw;
    else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
    const r = await fetch(url + path, { method, headers, body });
    const text = await r.text();
    let parsed: any = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* leave as text */ }
    return { status: r.status, body: parsed as T, headers: r.headers };
  }

  const h: Harness = {
    cfg, url, server,
    reset() {
      const d = db();
      d.exec('PRAGMA foreign_keys = OFF');
      const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      withAppendOnlyLifted(d, () => { for (const t of tables) d.exec(`DELETE FROM "${t.name}"`); });
      d.exec('PRAGMA foreign_keys = ON');
      setNow(T0);
      seedDemo(cfg);
      updateSettings({ requireApproval: false, bookingsOpenFrom: '', bookingsCloseFrom: '', guppiAssistEnabled: true, customerRescheduleEnabled: true, securityDepositEnabled: true }, null);
      ensureBuiltinCategories();
    },
    async close() {
      stopScheduler();
      await new Promise<void>((res) => { server.close(() => res()); server.closeAllConnections(); });
      closeDb();
      resetClock();
    },
    call,
    get: (p, token) => call('GET', p, { token }),
    post: (p, body, token) => call('POST', p, { body: body ?? {}, token }),
    put: (p, body, token) => call('PUT', p, { body: body ?? {}, token }),
    patch: (p, body, token) => call('PATCH', p, { body: body ?? {}, token }),
    del: (p, token) => call('DELETE', p, { token }),
    async login(account) {
      const a = DEMO_ACCOUNTS[account];
      const r = await call<{ token: string }>('POST', '/api/auth/login', { body: { email: a.email, password: a.password } });
      if (r.status !== 200) throw new Error(`login ${account} failed: ${r.status} ${JSON.stringify(r.body)}`);
      return r.body.token;
    },
  };
  return h;
}

export interface GroundLite { id: string; name: string; ownerId: string; pricePaise: number; weekendPricePaise: number | null }

export async function grounds(h: Harness): Promise<GroundLite[]> {
  const r = await h.get<{ items: GroundLite[] }>('/api/grounds');
  return r.body.items;
}

/** Date (IST, YYYY-MM-DD) that is `days` after the frozen "today". */
export const dayFromNow = (days: number): string => addDays(istDate(T0), days);

/** The instant a slot starts, as the server computes it. */
export const slotStart = (date: string, hhmm: string): number => istMidnight(date) + Number(hhmm.slice(0, 2)) * HOUR + Number(hhmm.slice(3)) * MIN;

export interface Held { booking: Booking; res: HoldResponse; paymentId: string; orderId: string | null }

/** Place an online hold and return what the checkout would need. */
export type HoldReply = Reply<HoldResponse & { error: { code: string; message: string; details?: any } }>;
export async function hold(h: Harness, token: string, groundId: string, date: string, startTime: string, slots = 1, extra: Record<string, unknown> = {}): Promise<HoldReply> {
  return h.post('/api/bookings', { groundId, date, startTime, slots, ...extra }, token);
}

/** Hold and pay in full through the demo gateway; returns the confirmed booking. */
export async function bookAndPay(h: Harness, token: string, groundId: string, date: string, startTime: string, slots = 1): Promise<Booking> {
  const r = await hold(h, token, groundId, date, startTime, slots);
  if (r.status !== 201) throw new Error(`hold failed: ${r.status} ${JSON.stringify(r.body)}`);
  const orderId = r.body.payment.razorpay!.orderId;
  const pay = await h.post<{ paymentId: string; signature: string }>('/api/gateway/demo/pay', { orderId }, token);
  const v = await h.post<{ booking: Booking }>('/api/payments/razorpay/verify', { orderId, paymentId: pay.body.paymentId, signature: pay.body.signature }, token);
  if (v.status !== 200) throw new Error(`verify failed: ${v.status} ${JSON.stringify(v.body)}`);
  return v.body.booking;
}

/** A Razorpay webhook call, signed with the demo secret over the exact bytes sent. */
export async function sendWebhook(h: Harness, payload: unknown, opts: { eventId?: string; secret?: string; signature?: string } = {}): Promise<Reply> {
  const raw = Buffer.from(JSON.stringify(payload));
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-razorpay-signature': opts.signature ?? webhookSignature(opts.secret ?? DEMO.webhookSecret, raw) };
  if (opts.eventId) headers['x-razorpay-event-id'] = opts.eventId;
  return h.call('POST', '/api/webhooks/razorpay', { raw, headers });
}

export const capturedEvent = (orderId: string, amountPaise: number, paymentId = 'pay_wh_1') => ({
  entity: 'event', event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: amountPaise, currency: 'INR', status: 'captured' } } },
});

export const setting = (patch: Record<string, unknown>): void => { updateSettings(patch, null); };
export { checkoutSignature, webhookSignature, DEMO };
