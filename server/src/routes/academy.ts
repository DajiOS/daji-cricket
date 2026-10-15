import { forbidden } from '../errors.ts';
import { audit } from '../audit.ts';
import { getSettings, updateSettings } from '../settings.ts';
import { Router, ok, created } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { requirePermission } from '../auth.ts';
import { listFees, raiseFees, recordPayment, getShare, setShare, shareStatement } from '../academy-fees.ts';
import { attendanceFor, childrenOf, createStudent, getSkills, getStudent, linkGuardian, linkStudentSelf, unlinkStudentSelf, listProgress, listStudents, markAttendance, saveProgress, setPublished, setSkills, unlinkGuardian, updateStudent } from '../academy.ts';

const STAFF: ('owner' | 'staff' | 'super_admin')[] = ['owner', 'staff', 'super_admin'];
const A = { auth: STAFF };

export function academyRoutes(r: Router): void {
  const gate = (c: Parameters<typeof U>[0]) => { const u = U(c); requirePermission(u, 'manage_academy'); return { u, actor: { id: u.id, role: u.role }, owner: ownerOrFail(c, 'use the academy') }; };

  // The coaches shown on the website's academy section (one list for the academy; any staff who manage the academy can edit it).
  r.get('/api/staff/academy/coaches', (c) => { requirePermission(U(c), 'manage_academy'); return ok({ items: getSettings().academyCoaches }); }, A);
  r.put('/api/staff/academy/coaches', (c) => {
    const u = U(c); requirePermission(u, 'manage_academy');
    const items = (c.json() as { items?: unknown })?.items;
    updateSettings({ academyCoaches: items }, u.id);
    audit({ id: u.id, role: u.role }, 'academy.coaches.update', 'settings', 'academyCoaches', { count: Array.isArray(items) ? items.length : 0 });
    return ok({ items: getSettings().academyCoaches });
  }, A);

  r.get('/api/staff/academy/skills', (c) => { const g = gate(c); return ok({ skills: getSkills(g.owner) }); }, A);
  r.put('/api/staff/academy/skills', (c) => { const g = gate(c); return ok({ skills: setSkills(g.actor, g.owner, c.json()) }); }, A);

  r.get('/api/staff/academy/students', (c) => {
    const g = gate(c);
    return ok({ items: listStudents(g.owner, { status: c.query.get('status') ?? undefined, batch: c.query.get('batch') ?? undefined, q: c.query.get('q') ?? undefined }) });
  }, A);
  r.post('/api/staff/academy/students', (c) => { const g = gate(c); return created(createStudent(g.actor, g.owner, c.json())); }, A);
  r.get('/api/staff/academy/students/:id', (c) => { const g = gate(c); return ok(getStudent(g.owner, c.params.id!)); }, A);
  r.patch('/api/staff/academy/students/:id', (c) => { const g = gate(c); return ok(updateStudent(g.actor, g.owner, c.params.id!, c.json())); }, A);
  r.post('/api/staff/academy/students/:id/link-guardian', (c) => { const g = gate(c); return ok(linkGuardian(g.actor, g.owner, c.params.id!, (c.json() as { email?: unknown })?.email)); }, A);
  r.post('/api/staff/academy/students/:id/link-student', (c) => { const g = gate(c); return ok(linkStudentSelf(g.actor, g.owner, c.params.id!, (c.json() as { email?: unknown }).email)); }, A);
  r.post('/api/staff/academy/students/:id/unlink-student', (c) => { const g = gate(c); return ok(unlinkStudentSelf(g.actor, g.owner, c.params.id!)); }, A);
  r.post('/api/staff/academy/students/:id/unlink-guardian', (c) => { const g = gate(c); return ok(unlinkGuardian(g.actor, g.owner, c.params.id!)); }, A);

  r.get('/api/staff/academy/attendance', (c) => { const g = gate(c); return ok({ date: c.query.get('date') ?? '', items: attendanceFor(g.owner, c.query.get('date') ?? '') }); }, A);
  r.post('/api/staff/academy/attendance', (c) => { const g = gate(c); return ok(markAttendance(g.actor, g.owner, c.json())); }, A);

  r.get('/api/staff/academy/students/:id/progress', (c) => { const g = gate(c); return ok({ items: listProgress(g.owner, c.params.id!), skills: getSkills(g.owner) }); }, A);
  r.put('/api/staff/academy/students/:id/progress/:month', (c) => { const g = gate(c); return ok(saveProgress(g.actor, g.owner, c.params.id!, c.params.month!, c.json())); }, A);
  r.post('/api/staff/academy/students/:id/progress/:month/publish', (c) => { const g = gate(c); return ok(setPublished(g.actor, g.owner, c.params.id!, c.params.month!, (c.json() as { published?: unknown })?.published)); }, A);

  // fees and the coach's revenue share (terms stay blank until the owner records them)
  r.get('/api/staff/academy/fees', (c) => { const g = gate(c); return ok(listFees(g.owner, c.query.get('month'))); }, A);
  r.post('/api/staff/academy/fees', (c) => { const g = gate(c); return created(raiseFees(g.actor, g.owner, c.json())); }, A);
  r.post('/api/staff/academy/fees/:id/payments', (c) => { const g = gate(c); return created(recordPayment(g.actor, g.owner, c.params.id!, c.json())); }, A);
  r.get('/api/staff/academy/share', (c) => { const g = gate(c); return ok({ ...getShare(g.owner) }); }, A);
  r.put('/api/staff/academy/share', (c) => { const g = gate(c); if (g.u.role === 'staff') throw forbidden('Only the owner can set the share terms.'); return ok({ ...setShare(g.actor, g.owner, c.json()) }); }, A);
  r.get('/api/staff/academy/share/statement', (c) => { const g = gate(c); return ok(shareStatement(g.owner, c.query.get('month'))); }, A);

  // the parent's view: only children staff have linked to this account, only published cards
  r.get('/api/me/children', (c) => ok({ items: childrenOf(U(c).id) }), { auth: ['customer'] });
}
