import { randomBytes } from 'node:crypto';
import { Router, ok } from '../http.ts';
import { U } from './helpers.ts';
import { HttpError } from '../errors.ts';
import { Validator } from '../input.ts';
import { DEMO, checkoutSignature, getGateway, webhookSignature } from '../gateway.ts';
import { handleWebhook, markFailed } from '../payments.ts';
import { one } from '../db.ts';
import { razorpayConfigured } from '../config.ts';

export function gatewayRoutes(r: Router): void {
  // Razorpay calls this. The signature is over the raw bytes, so nothing may re-serialise the body first.
  r.post('/api/webhooks/razorpay', (c) => {
    const sig = c.req.headers['x-razorpay-signature'];
    const eid = c.req.headers['x-razorpay-event-id'];
    const out = handleWebhook(c.cfg, c.raw, { signature: Array.isArray(sig) ? sig[0] : sig, eventId: Array.isArray(eid) ? eid[0] : eid });
    if (out.status === 404) throw new HttpError(404, 'NOT_FOUND', 'Not known here yet; send it again later');
    if (out.status !== 200) throw new HttpError(out.status, out.outcome === 'bad_signature' ? 'BAD_SIGNATURE' : 'BAD_REQUEST', out.outcome === 'bad_signature' ? 'The signature does not match' : 'The webhook body is not valid');
    return ok({ received: true, outcome: out.outcome });
  }, { rate: 'none', maxBody: 1024 * 1024 });

  // Demo checkout: only exists when Razorpay keys are NOT configured and demo mode is on. Mirrors what Razorpay Checkout hands back.
  const demoOnly = (c: { cfg: any }) => {
    if (razorpayConfigured(c.cfg) || !c.cfg.demoMode || !getGateway(c.cfg)?.demo) throw new HttpError(404, 'NOT_FOUND', 'No such endpoint');
  };

  r.post('/api/gateway/demo/pay', (c) => {
    demoOnly(c);
    const v = new Validator(c.json());
    const orderId = v.str('orderId', { required: true, max: 80 });
    const outcome = v.oneOf('outcome', ['success', 'failure'] as const) ?? 'success';
    v.done();
    const p = one<{ id: string; customer_id: string }>('SELECT id, customer_id FROM payments WHERE rp_order_id = ?', orderId!);
    const u = U(c);
    if (!p || (u.role === 'customer' && p.customer_id !== u.id)) throw new HttpError(404, 'NOT_FOUND', 'No payment is waiting for that order');
    if (outcome === 'failure') {
      markFailed(p.id, 'demo card declined', { id: u.id, role: u.role });
      throw new HttpError(402, 'PAYMENT_DECLINED', 'The demo card was declined');
    }
    const paymentId = `pay_demo_${randomBytes(7).toString('hex')}`;
    return ok({ orderId, paymentId, signature: checkoutSignature(DEMO.keySecret, orderId!, paymentId) });
  }, { auth: 'user' });

  // Lets the demo UI show a "payment confirmed by webhook later" case without a real Razorpay account.
  r.post('/api/gateway/demo/webhook', (c) => {
    demoOnly(c);
    const v = new Validator(c.json());
    const orderId = v.str('orderId', { required: true, max: 80 });
    const event = v.oneOf('event', ['payment.authorized', 'payment.captured', 'payment.failed'] as const, true);
    v.done();
    const p = one<{ amount_paise: number }>('SELECT amount_paise FROM payments WHERE rp_order_id = ?', orderId!);
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'No payment for that order');
    const body = Buffer.from(JSON.stringify({ entity: 'event', event, payload: { payment: { entity: { id: `pay_demo_${randomBytes(7).toString('hex')}`, order_id: orderId, amount: p.amount_paise, status: event === 'payment.failed' ? 'failed' : 'captured', error_description: 'demo failure' } } } }));
    const out = handleWebhook(c.cfg, body, { signature: webhookSignature(DEMO.webhookSecret, body), eventId: `evt_demo_${randomBytes(6).toString('hex')}` });
    return ok({ outcome: out.outcome });
  }, { auth: 'user' });
}
