import { Router, ok } from '../http.ts';
import { U } from './helpers.ts';
import { combinedView } from '../combined.ts';

// The owner's combined view across the businesses they marked "Mine" (combined.ts). Read-only. It is about the person who signed
// in, so it answers the same whichever business the desk has open (X-Daji-Business).
export function combinedRoutes(r: Router): void {
  r.get('/api/me/combined', (c) => {
    const q = (k: string) => c.query.get(k);
    return ok(combinedView(c.realUser ?? U(c), { business: q('business'), area: q('area'), project: q('project'), person: q('person'), from: q('from'), to: q('to') }));
  }, { auth: ['owner'] });
}
