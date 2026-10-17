import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { runFastSweeps, takeLease } from '../src/jobs.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

test('site files carry an ETag and answer 304 when the browser already has them', async () => {
  const a = await fetch(h.url + '/site.css');
  assert.equal(a.status, 200);
  const tag = a.headers.get('etag');
  assert.ok(tag);
  const b = await fetch(h.url + '/site.css', { headers: { 'If-None-Match': tag! } });
  assert.equal(b.status, 304);
  assert.equal((await fetch(h.url + '/site.css', { headers: { 'If-None-Match': '"other"' } })).status, 200);
});

test('the dashboard trend comes back in one request, oldest month first', async () => {
  const owner = await h.login('owner1');
  const r = await h.get('/api/staff/reports/overview-series?months=6', owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 6);
  const p = r.body.items.map((x: { period: string }) => x.period);
  assert.deepEqual([...p].sort(), p);
  assert.ok(r.body.items[5].overview.bookings);
});

test('the scheduler has separate lanes and the fast one runs without the slow one', async () => {
  const res = await runFastSweeps(h.cfg);
  assert.equal(typeof res.completed, 'number');
  assert.equal(takeLease('sweeps', 60_000, 'a'), true);
  assert.equal(takeLease('sweeps-slow', 60_000, 'a'), true);
  assert.equal(takeLease('sweeps', 60_000, 'b'), false);
});
