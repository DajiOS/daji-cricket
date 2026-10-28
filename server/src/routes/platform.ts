import { Router, ok, created, type Ctx } from '../http.ts';
import { createLead, listLeads, updateLead } from '../platform.ts';
import { U, ownerOrFail } from './helpers.ts';
import { brandOf, clearLogo, logoKind, MAX_LOGO_BYTES, saveBrand, setLogo } from '../businesses.ts';
import { forbidden } from '../errors.ts';
import { CORE_AI_NAME, DEFAULT_AI_NAME, addReservedName, aiNameFor, checkAiName, ownAiName, removeReservedName, reservedNames, siteAiName } from '../aiNames.ts';
import { HttpError } from '../errors.ts';

export function platformRoutes(r: Router): void {
  r.post('/api/platform/leads', (c) => created(createLead(c.json())), { rate: 'auth' });
  r.get('/api/admin/leads', (c) => ok({ items: listLeads(c.query.get('status') ?? undefined) }), { auth: ['super_admin'] });
  // ---- the business's own brand (white-label): its name, app name, ground logo and app logo. The team sees it; the owner (or the
  // software owner for them) changes it. /api/desk/* gets the business the software owner is looking at added by the desk.
  const BIZ = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };
  const boss = (c: Ctx) => { const u = U(c); if (u.role === 'staff') throw forbidden('Only the owner changes the business name and logos.'); return { actor: { id: u.id, role: u.role }, owner: ownerOrFail(c, 'change the brand') }; };
  r.get('/api/desk/brand', (c) => ok(brandOf(ownerOrFail(c, 'see the brand'))), BIZ);
  r.put('/api/desk/brand', (c) => { const b = boss(c); return ok(saveBrand(b.actor, b.owner, c.json())); }, BIZ);
  r.post('/api/desk/brand/logo', (c) => { const b = boss(c); return ok(setLogo(c.cfg.dataDir, b.actor, b.owner, logoKind(c.query.get('kind')), c.raw)); }, { ...BIZ, maxBody: MAX_LOGO_BYTES + 1024, upload: 'business_logo' });
  r.del('/api/desk/brand/logo', (c) => { const b = boss(c); return ok(clearLogo(c.cfg.dataDir, b.actor, b.owner, logoKind(c.query.get('kind')))); }, BIZ);

  r.patch('/api/admin/leads/:id', (c) => { const u = U(c); return ok(updateLead({ id: u.id, role: u.role }, c.params.id!, c.json())); }, { auth: ['super_admin'] });

  // ---- the assistant's display name (aiNames.ts). Platform AI is the core name; the business default and each person's pick are labels.
  r.get('/api/ai-name', (c) => {
    const u = U(c);
    return ok({ core: CORE_AI_NAME, systemDefault: DEFAULT_AI_NAME, site: siteAiName(), own: ownAiName(u.id), name: aiNameFor(u.id), reserved: reservedNames().map((x) => x.phrase) });
  }, { auth: 'user' });
  // checks a name before saving it, so a form can say straight away that "Hey Siri" is reserved
  r.post('/api/ai-name/check', (c) => {
    try { return ok({ ok: true, name: checkAiName((c.json() as { name?: unknown }).name, 'name') }); }
    catch (e) { if (e instanceof HttpError) return ok({ ok: false, message: e.message }); throw e; }
  }, { auth: 'user', maxBody: 1024 });
  // the reserved list: built-in names always apply; the software owner adds more here without a release
  r.get('/api/admin/ai-reserved-names', () => ok({ items: reservedNames() }), { auth: ['super_admin'] });
  r.post('/api/admin/ai-reserved-names', (c) => { const u = U(c); return created(addReservedName({ id: u.id, role: u.role }, c.json())); }, { auth: ['super_admin'] });
  r.del('/api/admin/ai-reserved-names/:id', (c) => { const u = U(c); removeReservedName({ id: u.id, role: u.role }, c.params.id!); return ok({ removed: true }); }, { auth: ['super_admin'] });
}
