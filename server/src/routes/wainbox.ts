import { Router, ok, created } from '../http.ts';
import type { Reply } from '../http.ts';
import { HttpError } from '../errors.ts';
import { U, ownerOrFail } from './helpers.ts';
import { dismissMessage, failedDeliveries, getMessage, handleInbound, inboxStatus, linkMessage, linkedTo, listMessages, mediaFile, moveMessage, replyTo, requestFromMessage, restoreMessage, retryMedia, unlinkMessage, verifySubscription } from '../wainbox.ts';

// Inbound WhatsApp (wainbox.ts): Meta's webhook, and the review inbox on the desk.
export function waInboxRoutes(r: Router): void {
  // Meta checks the webhook address once, when it is saved in the Meta app. The answer is the challenge, as plain text.
  r.get('/api/webhooks/whatsapp', (c): Reply => {
    const challenge = verifySubscription(c.cfg, c.query);
    if (challenge === null) throw new HttpError(403, 'FORBIDDEN', 'The verify token does not match');
    return { status: 200, raw: challenge, contentType: 'text/plain; charset=utf-8' };
  }, { rate: 'none' });

  // Every message and delivery status. The signature is over the raw bytes, so nothing may re-serialise the body first.
  r.post('/api/webhooks/whatsapp', (c) => {
    const sig = c.req.headers['x-hub-signature-256'];
    const res = handleInbound(c.cfg, c.raw, Array.isArray(sig) ? sig[0] : sig);
    if (res.status === 401) throw new HttpError(401, 'BAD_SIGNATURE', 'The signature does not match');
    if (res.status === 503) throw new HttpError(503, 'NOT_SET_UP', 'Messages coming in are not set up on this server');
    if (res.status === 400) throw new HttpError(400, 'BAD_REQUEST', 'The webhook body is not valid');
    return ok({ received: true, outcome: res.outcome, messages: res.messages, duplicates: res.duplicates, statuses: res.statuses });
  }, { rate: 'none', maxBody: 1024 * 1024 });

  const TEAM = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };
  const o = (c: Parameters<Parameters<Router['get']>[1]>[0]) => ownerOrFail(c, 'use the WhatsApp inbox');
  r.get('/api/whatsapp/status', (c) => ok(inboxStatus(c.cfg, U(c), o(c))), TEAM);
  r.get('/api/whatsapp/messages', (c) => ok(listMessages(U(c), o(c), { state: c.query.get('state'), personId: c.query.get('personId'), limit: Number(c.query.get('limit')) || undefined })), TEAM);
  r.get('/api/whatsapp/messages/:id', (c) => ok(getMessage(U(c), o(c), c.params.id!)), TEAM);
  r.get('/api/whatsapp/messages/:id/media', (c): Reply => {
    const f = mediaFile(c.cfg.dataDir, U(c), o(c), c.params.id!);
    const inline = /^(image\/(png|jpeg|webp|gif)|video\/mp4|audio\/(ogg|mpeg|mp4|aac|amr))$/.test(f.mime);
    return { status: 200, raw: f.buf, contentType: inline ? f.mime : 'application/octet-stream', headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': inline ? 'inline' : 'attachment' } };
  }, TEAM);
  r.get('/api/whatsapp/linked', (c) => ok(linkedTo(U(c), o(c), c.query.get('kind') ?? '', c.query.get('id') ?? '')), TEAM);
  r.get('/api/whatsapp/deliveries', (c) => ok(failedDeliveries(U(c), o(c))), TEAM);
  r.post('/api/whatsapp/messages/:id/link', async (c) => ok(await linkMessage(c.cfg.dataDir, U(c), o(c), c.params.id!, c.json())), TEAM);
  r.post('/api/whatsapp/messages/:id/unlink', (c) => ok(unlinkMessage(U(c), o(c), c.params.id!, c.json())), TEAM);
  r.post('/api/whatsapp/messages/:id/request', async (c) => created(await requestFromMessage(c.cfg.dataDir, U(c), o(c), c.params.id!, c.json())), TEAM);
  r.post('/api/whatsapp/messages/:id/dismiss', (c) => ok(dismissMessage(U(c), o(c), c.params.id!, c.json())), TEAM);
  r.post('/api/whatsapp/messages/:id/restore', (c) => ok(restoreMessage(U(c), o(c), c.params.id!)), TEAM);
  r.post('/api/whatsapp/messages/:id/media/retry', (c) => ok(retryMedia(U(c), o(c), c.params.id!)), TEAM);
  r.post('/api/whatsapp/messages/:id/move', (c) => ok(moveMessage(c.cfg.dataDir, U(c), c.realUser ?? U(c), o(c), c.params.id!, c.json())), TEAM);
  r.post('/api/whatsapp/messages/:id/reply', async (c) => created(await replyTo(c.cfg, U(c), o(c), c.params.id!, c.json())), TEAM);
}
