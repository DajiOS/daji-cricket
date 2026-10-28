import { Router, ok } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { ask, examplesFor, readVia } from '../ask/index.ts';
import { aiConfigured } from '../config.ts';
import { many } from '../db.ts';
import { askCustomer, CUSTOMER_EXAMPLES } from '../ask/customer.ts';

const A = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[], maxBody: 4096 };

export function askRoutes(r: Router): void {
  // POST { "question": "What was the revenue for the past 37 days?" }
  r.post('/api/staff/ask', async (c) => {
    const owner = ownerOrFail(c, 'ask a question');
    const b = c.json() as { question?: unknown; via?: unknown };
    return ok(await ask(c.cfg, U(c), owner, b.question, fetch, { via: readVia(b.via) }));
  }, A);

  r.get('/api/staff/ask/examples', (c) => {
    const user = U(c);
    const owner = ownerOrFail(c, 'ask a question');
    return ok({ items: examplesFor({ ownerId: owner, user }), claudeEnabled: aiConfigured(c.cfg) && c.cfg.ai.mode !== 'builtin' });
  }, A);

  // This login's own recent questions, from the audit trail (the first 200 characters of each; answers are not kept). Nobody sees another person's.
  r.get('/api/staff/ask/history', (c) => {
    const user = U(c);
    const owner = ownerOrFail(c, 'see your questions');
    const rows = many<{ id: number; at: number; detail: string | null }>("SELECT id, at, detail FROM audit_log WHERE action = 'ask.question' AND actor_id = ? AND owner_id = ? ORDER BY at DESC, id DESC LIMIT 50", user.id, owner);
    return ok({ items: rows.map((r) => { let d: { question?: string; source?: string } = {}; try { d = JSON.parse(r.detail ?? '{}'); } catch { /* an unreadable row shows without its text */ } return { id: r.id, at: r.at, question: d.question ?? '', source: d.source ?? null }; }) });
  }, A);

  // Customers: only their own bookings and credit, plus public ground details. Built-in answerer only.
  r.post('/api/ask', (c) => { const b = c.json() as { question?: unknown; via?: unknown }; return ok(askCustomer(U(c), b.question, readVia(b.via))); }, { auth: ['customer'], maxBody: 4096 });
  r.get('/api/ask/examples', () => ok({ items: CUSTOMER_EXAMPLES }), { auth: ['customer'] });
}
