import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { closeDb } from '../src/db.ts';
import { loadConfig, configWarnings } from '../src/config.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

test('the health check reads the database and says whether demo mode is on', async () => {
  const r = await h.get('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.database, 'ok');
  assert.equal(r.body.demo, true, 'the test harness runs in demo mode');
});

test('a real domain starts with demo mode off unless DEMO_MODE says otherwise, and warns when it is on', () => {
  const real = { PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40) };
  assert.equal(loadConfig(real).demoMode, false);
  assert.ok(!configWarnings(loadConfig(real)).some((w) => /DEMO_MODE/.test(w)));
  const on = loadConfig({ ...real, DEMO_MODE: 'on' });
  assert.equal(on.demoMode, true);
  assert.ok(configWarnings(on).some((w) => /DEMO_MODE is on/.test(w)));
});

test('the health check answers 503 when the database cannot be read', async () => {
  closeDb();
  const r = await h.get('/api/health');
  assert.equal(r.status, 503);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.database, 'error');
});
