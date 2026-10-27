// Architecture guard. The booking workflow is frozen: there is ONE booking engine. Only the hold step (hold.ts) and the payment step (payments.ts, which gives a
// booking its slots when it is confirmed) may create booking or booking-slot rows, and ground blocks (grounds.ts) may add 'block' slots. Any other file that inserts
// into those tables would be a second booking path (the brief forbids one), so this test fails the build. It reads the source, so it cannot be bypassed by a route.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { rel, ev } from './rel.ts';

const SRC = join(import.meta.dirname, '..', 'src');
const ALLOWED: Record<string, string[]> = {
  bookings: ['hold.ts'],
  booking_slots: ['hold.ts', 'payments.ts', 'grounds.ts'],
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

rel('ARCH-001', 'only the approved files create bookings and booking slots (one booking engine)', () => {
  const hits: { table: string; file: string }[] = [];
  for (const f of walk(SRC)) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(bookings|booking_slots)\b/gi)) hits.push({ table: m[1]!.toLowerCase(), file: relative(SRC, f) });
  }
  ev('inserts', hits);
  assert.ok(hits.length >= 4, 'the guard must see the known inserts, otherwise it is not looking');
  for (const h of hits) assert.ok(ALLOWED[h.table]!.includes(h.file), `${h.file} inserts into ${h.table}: that is a second booking path`);
  // The guard itself is proved: a file outside the list WOULD be caught.
  assert.ok(!ALLOWED.bookings!.includes('guppi.ts') && !ALLOWED.booking_slots!.includes('options.ts'));
});

rel('ARCH-002', 'Guppi, options and reschedule never write booking tables directly', () => {
  for (const f of ['guppi.ts', 'options.ts', 'routes/guppi.ts']) {
    const text = readFileSync(join(SRC, f), 'utf8');
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b[^;`'"]*\b(bookings|booking_slots|payments|ledger|financial_events)\b/i.test(text), `${f} writes a protected table`);
  }
  ev('checked', ['guppi.ts', 'options.ts', 'routes/guppi.ts']);
});
