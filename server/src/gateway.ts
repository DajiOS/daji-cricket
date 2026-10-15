import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.ts';
import { razorpayConfigured } from './config.ts';
import { HttpError } from './errors.ts';

export interface Gateway {
  demo: boolean;
  keyId: string;
  webhookSecret: string;
  createOrder(amountPaise: number, receipt: string, notes: Record<string, string>): Promise<{ id: string }>;
  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean;
  refund(rpPaymentId: string, amountPaise: number, notes: Record<string, string>): Promise<{ id: string; status: string }>;
  /** Auto-debit: the customer approves a UPI AutoPay mandate once; later balances are charged against it. */
  createMandate(who: { name: string; email: string | null; phone: string | null }, rpCustomerId: string | null, maxAmountPaise: number): Promise<{ rpCustomerId: string; orderId: string; authAmountPaise: number }>;
  /** The reusable token Razorpay made when the customer approved the mandate. */
  tokenForPayment(rpPaymentId: string): Promise<string>;
  /** Charges the mandate. `instant` is true when the answer is final now (demo); otherwise the result arrives by webhook. */
  charge(m: { rpCustomerId: string; tokenId: string }, c: { amountPaise: number; receipt: string; email: string | null; phone: string | null; notes: Record<string, string> }): Promise<{ orderId: string; rpPaymentId: string; instant: boolean }>;
}

export const DEMO = { keyId: 'rzp_test_demo', keySecret: 'demo_key_secret', webhookSecret: 'demo_webhook_secret' };

const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');
function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkoutSignature(secret: string, orderId: string, paymentId: string): string {
  return hmac(secret, `${orderId}|${paymentId}`);
}
export function webhookSignature(secret: string, rawBody: Buffer | string): string {
  return hmac(secret, rawBody);
}
export function verifyWebhookSignature(secret: string, rawBody: Buffer, signature: string | undefined): boolean {
  if (!secret || !signature) return false;
  return safeEq(hmac(secret, rawBody), signature);
}

/** The gateway to use now, or null when Razorpay is neither configured nor in demo mode. */
export function getGateway(cfg: Config): Gateway | null {
  if (razorpayConfigured(cfg)) return realGateway(cfg);
  if (cfg.demoMode) return demoGateway();
  return null;
}

export function webhookSecretFor(cfg: Config): string {
  return razorpayConfigured(cfg) ? cfg.razorpay.webhookSecret : cfg.demoMode ? DEMO.webhookSecret : '';
}

function demoGateway(): Gateway {
  return {
    demo: true,
    keyId: DEMO.keyId,
    webhookSecret: DEMO.webhookSecret,
    async createOrder() { return { id: `order_demo_${randomBytes(7).toString('hex')}` }; },
    verifyCheckout(o, p, s) { return safeEq(checkoutSignature(DEMO.keySecret, o, p), s); },
    async refund() { return { id: `rfnd_demo_${randomBytes(7).toString('hex')}`, status: 'processed' }; },
    async createMandate(_who, rpCustomerId) { return { rpCustomerId: rpCustomerId ?? `cust_demo_${randomBytes(6).toString('hex')}`, orderId: `order_demo_${randomBytes(7).toString('hex')}`, authAmountPaise: 100 }; },
    async tokenForPayment() { return `token_demo_${randomBytes(6).toString('hex')}`; },
    async charge(m) {
      if (m.tokenId.includes('fail')) throw new HttpError(402, 'AUTODEBIT_DECLINED', 'The bank declined the auto-debit');
      return { orderId: `order_demo_${randomBytes(7).toString('hex')}`, rpPaymentId: `pay_demo_${randomBytes(7).toString('hex')}`, instant: true };
    },
  };
}

function realGateway(cfg: Config): Gateway {
  const { keyId, keySecret, webhookSecret, apiUrl } = cfg.razorpay;
  const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  async function call(path: string, body: unknown | null): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${apiUrl}${path}`, {
        method: body === null ? 'GET' : 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: body === null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new HttpError(502, 'GATEWAY_ERROR', 'Could not reach the payment gateway. Please try again.', { cause: String((e as Error).message) });
    }
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    if (!res.ok) throw new HttpError(502, 'GATEWAY_ERROR', 'The payment gateway refused the request', { status: res.status, description: json?.error?.description });
    return json;
  }
  return {
    demo: false, keyId, webhookSecret,
    async createOrder(amountPaise, receipt, notes) {
      const j = await call('/v1/orders', { amount: amountPaise, currency: 'INR', receipt, notes });
      if (!j?.id) throw new HttpError(502, 'GATEWAY_ERROR', 'The payment gateway gave an unexpected answer');
      return { id: j.id };
    },
    verifyCheckout(o, p, s) { return safeEq(checkoutSignature(keySecret, o, p), s); },
    async refund(rpPaymentId, amountPaise, notes) {
      const j = await call(`/v1/payments/${encodeURIComponent(rpPaymentId)}/refund`, { amount: amountPaise, notes });
      if (!j?.id) throw new HttpError(502, 'GATEWAY_ERROR', 'The payment gateway gave an unexpected answer');
      return { id: j.id, status: j.status ?? 'pending' };
    },
    // UPI AutoPay (Razorpay recurring payments). Needs Recurring Payments enabled on the Razorpay account; test it in test mode first.
    async createMandate(who, rpCustomerId, maxAmountPaise) {
      let cid = rpCustomerId;
      if (!cid) {
        const c = await call('/v1/customers', { name: who.name, ...(who.email ? { email: who.email } : {}), ...(who.phone ? { contact: who.phone } : {}), fail_existing: '0' });
        if (!c?.id) throw new HttpError(502, 'GATEWAY_ERROR', 'The payment gateway gave an unexpected answer');
        cid = c.id as string;
      }
      const authAmountPaise = 100; // the small first charge that proves the mandate; it is refunded
      const o = await call('/v1/orders', { amount: authAmountPaise, currency: 'INR', customer_id: cid, method: 'upi', payment_capture: 1, token: { max_amount: maxAmountPaise, expire_at: Math.floor(Date.now() / 1000) + 365 * 86400, frequency: 'as_presented' } });
      if (!o?.id) throw new HttpError(502, 'GATEWAY_ERROR', 'The payment gateway gave an unexpected answer');
      return { rpCustomerId: cid, orderId: o.id as string, authAmountPaise };
    },
    async tokenForPayment(rpPaymentId) {
      const j = await call(`/v1/payments/${encodeURIComponent(rpPaymentId)}`, null);
      if (!j?.token_id) throw new HttpError(502, 'GATEWAY_ERROR', 'The bank has not approved the auto-debit yet');
      return j.token_id as string;
    },
    async charge(m, c) {
      const o = await call('/v1/orders', { amount: c.amountPaise, currency: 'INR', receipt: c.receipt, payment_capture: 1, notes: c.notes });
      if (!o?.id) throw new HttpError(502, 'GATEWAY_ERROR', 'The payment gateway gave an unexpected answer');
      const p = await call('/v1/payments/create/recurring', { email: c.email ?? 'noreply@dajicricket.com', contact: c.phone ?? '', amount: c.amountPaise, currency: 'INR', order_id: o.id, customer_id: m.rpCustomerId, token: m.tokenId, recurring: '1', description: 'Daji Cricket Ground booking balance', notes: c.notes });
      const pid = p?.razorpay_payment_id ?? p?.id;
      if (!pid) throw new HttpError(502, 'GATEWAY_ERROR', 'The payment gateway gave an unexpected answer');
      return { orderId: o.id as string, rpPaymentId: pid as string, instant: false };
    },
  };
}
