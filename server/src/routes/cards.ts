import { Router, ok, created } from '../http.ts';
import type { Reply } from '../http.ts';
import { U, page, ownerOrFail } from './helpers.ts';
import { requirePermission } from '../auth.ts';
import { attachCardImage, addCard, allCards, cardImage, getCard, listCards, removeCard, scanCard, toVcard, updateCard, MAX_CARD_BYTES } from '../cards.ts';
import { aiConfigured } from '../config.ts';
import type { Ctx } from '../http.ts';

const STAFF: ('owner' | 'staff' | 'super_admin')[] = ['owner', 'staff', 'super_admin'];
const A = { auth: STAFF, maxBody: 64 * 1024 };
const FILE = { auth: STAFF, maxBody: MAX_CARD_BYTES + 1024 };
const vcf = (name: string, body: string): Reply => ({ status: 200, raw: Buffer.from(body, 'utf8'), contentType: 'text/vcard; charset=utf-8', headers: { 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export function cardRoutes(r: Router): void {
  const who = (c: Ctx, what: string) => {
    const u = U(c);
    requirePermission(u, 'view_customers');
    return { u, owner: ownerOrFail(c, what), actor: { id: u.id, role: u.role } };
  };

  r.get('/api/staff/cards/status', (c) => { who(c, 'use business cards'); return ok({ ocr: aiConfigured(c.cfg) }); }, A);

  // POST the photo as the request body (image/png, image/jpeg or image/webp). Returns a draft to check; nothing is saved.
  r.post('/api/staff/cards/scan', async (c) => { const w = who(c, 'scan a card'); return ok(await scanCard(c.cfg, w.u.id, w.owner, c.raw)); }, FILE);

  // POST { name, title, company, phones[], emails[], website, address, notes }. The photo can be attached after with /image.
  r.post('/api/staff/cards', (c) => { const w = who(c, 'save a contact'); return created(addCard(c.cfg.dataDir, w.owner, w.actor, c.json())); }, A);
  r.post('/api/staff/cards/:id/image', (c) => {
    const w = who(c, 'attach a photo');
    attachCardImage(c.cfg.dataDir, w.owner, w.actor, c.params.id!, c.raw);
    return ok({ attached: true });
  }, FILE);

  r.get('/api/staff/cards', (c) => { const w = who(c, 'list contacts'); const { limit, offset } = page(c, 50); return ok(listCards(w.owner, (c.query.get('q') ?? '').trim().slice(0, 80), limit, offset)); }, { auth: STAFF });
  r.get('/api/staff/cards/export.vcf', (c) => { const w = who(c, 'export contacts'); return vcf('daji-contacts.vcf', toVcard(allCards(w.owner))); }, { auth: STAFF });
  r.get('/api/staff/cards/:id', (c) => { const w = who(c, 'read a contact'); return ok(getCard(w.owner, c.params.id!)); }, { auth: STAFF });
  r.get('/api/staff/cards/:id/vcard', (c) => { const w = who(c, 'export a contact'); const card = getCard(w.owner, c.params.id!); return vcf(`${card.name.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'contact'}.vcf`, toVcard([card])); }, { auth: STAFF });
  r.get('/api/staff/cards/:id/image', (c): Reply => {
    const w = who(c, 'see a card photo');
    const f = cardImage(c.cfg.dataDir, w.owner, c.params.id!);
    return { status: 200, raw: f.data, contentType: f.mime, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } };
  }, { auth: STAFF });
  r.patch('/api/staff/cards/:id', (c) => { const w = who(c, 'edit a contact'); return ok(updateCard(w.owner, w.actor, c.params.id!, c.json())); }, A);
  r.del('/api/staff/cards/:id', (c) => { const w = who(c, 'delete a contact'); removeCard(w.owner, w.actor, c.params.id!); return ok({ removed: true }); }, { auth: STAFF });
}
