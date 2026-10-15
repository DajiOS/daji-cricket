import { Router, ok } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { ask, examplesFor } from '../ask/index.ts';
import { aiConfigured } from '../config.ts';
import { askCustomer, CUSTOMER_EXAMPLES } from '../ask/customer.ts';

const A = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[], maxBody: 4096 };

export function askRoutes(r: Router): void {
  // POST { "question": "What was the revenue for the past 37 days?" }
  r.post('/api/staff/ask', async (c) => {
    const owner = ownerOrFail(c, 'ask a question');
    return ok(await ask(c.cfg, U(c), owner, (c.json() as { question?: unknown }).question));
  }, A);

  r.get('/api/staff/ask/examples', (c) => {
    const user = U(c);
    const owner = ownerOrFail(c, 'ask a question');
    return ok({ items: examplesFor({ ownerId: owner, user }), claudeEnabled: aiConfigured(c.cfg) && c.cfg.ai.mode !== 'builtin' });
  }, A);

  // Customers: only their own bookings and credit, plus public ground details. Built-in answerer only.
  r.post('/api/ask', (c) => ok(askCustomer(U(c), (c.json() as { question?: unknown }).question)), { auth: ['customer'], maxBody: 4096 });
  r.get('/api/ask/examples', () => ok({ items: CUSTOMER_EXAMPLES }), { auth: ['customer'] });
}
