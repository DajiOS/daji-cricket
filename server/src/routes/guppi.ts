import { Router, ok, created } from '../http.ts';
import { U } from './helpers.ts';
import { guppiContext, guppiHold, guppiOptions, guppiReschedule } from '../guppi.ts';

// Guppi's whole reach into the booking system. There is no route here to pay, confirm, refund, waive, approve, cancel or change an amount, and there never should be:
// those stay with the person on the normal screens.
export function guppiRoutes(r: Router): void {
  const idemKey = (c: { req: { headers: Record<string, string | string[] | undefined> } }): string | null => {
    const v = c.req.headers['idempotency-key'];
    return typeof v === 'string' ? v : null;
  };
  r.get('/api/guppi/context', (c) => ok(guppiContext(U(c))), { auth: 'user' });
  r.post('/api/guppi/options', (c) => ok(guppiOptions(c.cfg, U(c), c.json())), { auth: ['customer', 'owner', 'staff'], maxBody: 4096 });
  r.post('/api/guppi/hold', async (c) => created(await guppiHold(c.cfg, U(c), idemKey(c), c.json())), { auth: ['customer'], idempotent: 'required', maxBody: 4096 });
  r.post('/api/guppi/reschedule', (c) => ok(guppiReschedule(c.cfg, U(c), idemKey(c), c.json())), { auth: ['customer'], idempotent: 'required', maxBody: 4096 });
}
