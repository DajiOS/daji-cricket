import { Router, ok, created } from '../http.ts';
import { U, page } from './helpers.ts';
import { approveRefund, declineRefund, listRefunds } from '../payments.ts';
import { Validator } from '../input.ts';
import { HttpError, notFound } from '../errors.ts';
import { audit, listAudit } from '../audit.ts';
import { checkPasswordStrength, createUser, setPassword, toUser, userByEmail, userRow, type UserRow } from '../auth.ts';
import { splitName, titleCase } from '../names.ts';
import { getSettings, updateSettings } from '../settings.ts';
import { many, one, run } from '../db.ts';
import { now } from '../clock.ts';
import { STAFF_PERMISSIONS, type StaffPermission } from '@daji/shared';
import { closedDates, setClosed } from '../closures.ts';
import { integrationStatuses, testIntegration } from '../integrations.ts';
import { addService, deleteService, listServices, updateService } from '../services.ts';
import { saveYodleeSettings, testYodlee, viewYodleeSettings } from '../yodleeSettings.ts';
import { backupNow, BACKUP_AT, listBackups, nextBackupAt } from '../backup.ts';

const UPI_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,30}$/;

export function adminRoutes(r: Router): void {
  // Platform controls: settings, booking window, closures, backups, connections, people. The owner holds them, and the super admin too.
  const A = { auth: ['owner' as const, 'super_admin' as const] };

  r.get('/api/admin/settings', () => ok(getSettings()), A);

  r.put('/api/admin/settings', (c) => {
    const body = c.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'VALIDATION_FAILED', 'Send a JSON object of settings', { fields: [{ field: '(body)', message: 'Expected a JSON object' }] });
    const u = U(c);
    const changed = updateSettings(body as Record<string, unknown>, u.id);
    for (const [k, v] of Object.entries(changed)) audit({ id: u.id, role: u.role }, k === 'razorpayEnabled' ? 'settings.razorpay_toggle' : 'settings.update', 'setting', k, v);
    return ok(getSettings());
  }, A);

  // Switch single days off (or back on) for online booking.
  r.get('/api/admin/closed-dates', () => ok({ items: closedDates() }), A);
  r.post('/api/admin/closed-dates', (c) => { const b = c.json() as Record<string, unknown>; return ok({ ...setClosed(U(c), b.dates, b.closed, b.reason, b.scopes), items: closedDates() }); }, A);

  // The connections: what each outside service needs, whether it is set up, and a safe live test where one exists.
  // Yodlee keys: the software owner only (it is the platform's account, not one business's)
  const SA = { auth: ['super_admin' as const] };
  r.get('/api/admin/yodlee', (c) => ok(viewYodleeSettings(c.cfg)), SA);
  r.put('/api/admin/yodlee', (c) => ok(saveYodleeSettings(c.cfg, { id: U(c).id, role: U(c).role }, c.json())), SA);
  r.post('/api/admin/yodlee/test', async (c) => { const res = await testYodlee(c.cfg); audit({ id: U(c).id, role: U(c).role }, 'yodlee.test', 'yodlee', null, { ok: res.ok }); return ok(res); }, { ...SA, rate: 'auth' });
  r.get('/api/admin/integrations', (c) => ok({ items: integrationStatuses(c.cfg) }), A);
  r.post('/api/admin/integrations/:id/test', async (c) => ok(await testIntegration(c.cfg, U(c), c.params.id!)), A);

  // The notebook of outside services and the accounts they were opened with (never keys or passwords).
  r.get('/api/admin/services', () => ok({ items: listServices() }), A);
  r.post('/api/admin/services', (c) => created(addService(U(c), c.json())), A);
  r.patch('/api/admin/services/:id', (c) => ok(updateService(U(c), c.params.id!, c.json())), A);
  r.del('/api/admin/services/:id', (c) => { deleteService(U(c), c.params.id!); return ok({ removed: true }); }, A);

  r.get('/api/admin/users', (c) => {
    const { limit, offset } = page(c, 50);
    const where: string[] = [];
    const p: (string | number)[] = [];
    const role = c.query.get('role');
    if (role) { where.push('role = ?'); p.push(role); }
    const q = c.query.get('q');
    if (q) { where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')"); const l = `%${q.replace(/[%_\\]/g, '\\$&')}%`; p.push(l, l, l); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = one<{ n: number }>(`SELECT COUNT(*) n FROM users ${w}`, ...p)!.n;
    const rows = many<UserRow>(`SELECT * FROM users ${w} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`, ...p, limit, offset);
    return ok({ items: rows.map(toUser), total, limit, offset });
  }, A);

  r.post('/api/admin/users', (c) => {
    const u = U(c);
    const v = new Validator(c.json());
    const role = v.oneOf('role', ['owner', 'staff', 'super_admin'] as const, true);
    const name = v.str('name', { required: true, min: 2, max: 80 });
    const email = v.email('email', true);
    const phone = v.phone('phone');
    const password = v.str('password', { required: true, trim: false });
    const businessName = v.str('businessName', { max: 80 });
    const upiId = v.str('upiId', { max: 80 });
    const ownerId = v.str('ownerId');
    const permsArr = v.strArray('permissions', { max: 20 });
    if (upiId && !UPI_RE.test(upiId)) v.fail('upiId', 'Must look like name@bank');
    if (password) { const pw = checkPasswordStrength(password); if (pw) v.fail('password', pw); }
    if (permsArr?.some((p) => !(STAFF_PERMISSIONS as readonly string[]).includes(p))) v.fail('permissions', 'Unknown permission');
    if (role === 'staff') { const o = ownerId ? userRow(ownerId) : undefined; if (!o || o.role !== 'owner') v.fail('ownerId', 'Staff need an owner to work for'); }
    v.done();
    const row = createUser({ role: role!, name: name!, email: email!, phone: phone ?? null, password: password!, businessName: businessName ?? null, upiId: upiId ?? null, ownerId: role === 'staff' ? ownerId! : null, permissions: (permsArr ?? []) as StaffPermission[] });
    audit({ id: u.id, role: u.role }, 'user.create', 'user', row.id, { role }, row.owner_id ?? (row.role === 'owner' ? row.id : null));
    return created(toUser(row));
  }, A);

  r.patch('/api/admin/users/:id', (c) => {
    const u = U(c);
    const target = userRow(c.params.id!);
    if (!target) throw notFound('User not found');
    const v = new Validator(c.json());
    const name = v.str('name', { min: 2, max: 80 });
    const firstName = v.str('firstName', { min: 1, max: 40 });
    const lastName = v.str('lastName', { min: 1, max: 40 });
    const email = v.email('email');
    if (email && userByEmail(email) && userByEmail(email)!.id !== target.id) v.fail('email', 'Another account already uses this email');
    const phone = v.phone('phone');
    const active = v.bool('active');
    const upiId = v.str('upiId', { max: 80 });
    const businessName = v.str('businessName', { max: 80 });
    const permsArr = v.strArray('permissions', { max: 20 });
    if (upiId && !UPI_RE.test(upiId)) v.fail('upiId', 'Must look like name@bank');
    if (permsArr?.some((p) => !(STAFF_PERMISSIONS as readonly string[]).includes(p))) v.fail('permissions', 'Unknown permission');
    if (active === false && target.id === u.id) v.fail('active', 'You cannot disable your own account');
    v.done();
    // names are always stored with capital first letters; first and last can be changed on their own
    const cur = splitName(target.name);
    const f = firstName !== undefined ? titleCase(firstName) : name !== undefined ? splitName(titleCase(name)).first : target.first_name ?? cur.first;
    const l = lastName !== undefined ? titleCase(lastName) : name !== undefined && firstName === undefined ? splitName(titleCase(name)).last : target.last_name ?? cur.last;
    const newName = firstName !== undefined || lastName !== undefined || name !== undefined ? [f, l].filter(Boolean).join(' ') : null;
    if (newName) run('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?', f, l, target.id);
    if (email) run('UPDATE users SET email = ? WHERE id = ?', email, target.id);
    run(`UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), active = COALESCE(?, active), upi_id = COALESCE(?, upi_id), business_name = COALESCE(?, business_name),
           permissions = COALESCE(?, permissions), token_version = token_version + ?, updated_at = ? WHERE id = ?`,
      newName, phone ?? null, active === undefined ? null : active ? 1 : 0, upiId ?? null, businessName ?? null, permsArr ? JSON.stringify(permsArr) : null, active === false || permsArr ? 1 : 0, now(), target.id);
    audit({ id: u.id, role: u.role }, 'user.update', 'user', target.id, { active, permissions: permsArr }, target.owner_id ?? (target.role === 'owner' ? target.id : null));
    return ok(toUser(userRow(target.id)!));
  }, A);

  r.post('/api/admin/users/:id/password', (c) => {
    const u = U(c);
    const target = userRow(c.params.id!);
    if (!target) throw notFound('User not found');
    const v = new Validator(c.json());
    const pw = v.str('password', { required: true, trim: false });
    if (pw) { const p = checkPasswordStrength(pw); if (p) v.fail('password', p); }
    v.done();
    setPassword(target.id, pw!);
    audit({ id: u.id, role: u.role }, 'user.password_reset', 'user', target.id);
    return ok({ ok: true });
  }, A);

  // ---- backups: a snapshot every day at 03:15 IST, and one on demand ----
  r.get('/api/admin/backups', (c) => ok({
    enabled: c.cfg.backup.enabled, at: BACKUP_AT, keep: c.cfg.backup.keep,
    nextAt: c.cfg.backup.enabled ? nextBackupAt() : null,
    items: listBackups(c.cfg),
  }), A);

  r.post('/api/admin/backups', (c) => {
    const u = U(c);
    try { return created(backupNow(c.cfg, 'manual', { id: u.id, role: u.role })); }
    catch (e) { throw new HttpError(500, 'BACKUP_FAILED', `The backup could not be completed: ${(e as Error).message}`); }
  }, A);

  const SUP = { auth: ['super_admin' as const] };
  r.get('/api/admin/refunds', (c) => { const st = c.query.get('status') ?? 'awaiting'; return ok({ items: st === 'awaiting' ? listRefunds(c.query.get('ownerId'), 'pending').filter((x) => !x.approvedAt) : listRefunds(c.query.get('ownerId'), st) }); }, SUP);
  r.post('/api/admin/refunds/:id/approve', (c) => ok(approveRefund(U(c), c.params.id!)), SUP);
  r.post('/api/admin/refunds/:id/decline', (c) => { const v = new Validator(c.json()); const reason = v.str('reason', { required: true, max: 200 }); v.done(); return ok(declineRefund(U(c), c.params.id!, reason!)); }, SUP);
  r.get('/api/admin/audit', (c) => {
    const { limit, offset } = page(c, 50);
    return ok(listAudit({ ownerId: c.query.get('ownerId'), entity: c.query.get('entity') ?? undefined, entityId: c.query.get('entityId') ?? undefined, action: c.query.get('action') ?? undefined, limit, offset }));
  }, A);
}
