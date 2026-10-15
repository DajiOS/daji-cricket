import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { many } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { startHarness, type Harness } from './helpers.ts';
import { expoPushProvider, saveToken, tokensOf } from '../src/push.ts';

let h: Harness, uid: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); uid = many<{ id: string }>("SELECT id FROM users WHERE email = 'owner1@daji.test'")[0]!.id; });

const T1 = 'ExponentPushToken[aaaaaaaaaaaa]', T2 = 'ExponentPushToken[bbbbbbbbbbbb]';
const cfg = loadConfig({ PUBLIC_URL: 'http://localhost:4000' } as NodeJS.ProcessEnv);

test('a push goes to every phone the person has, with the booking attached', async () => {
  saveToken(uid, T1, 'ios'); saveToken(uid, T2, 'android');
  const seen: any[] = [];
  const send = expoPushProvider(cfg, async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ data: [{ status: 'ok' }, { status: 'ok' }] }) }; });
  const r = await send({ id: 'n1', userId: uid, channel: 'push', category: 'transactional', template: 'booking_needs_approval', subject: 'Booking waiting for approval', body: 'Open the app', to: null, bookingId: 'bkg_1' });
  assert.equal(r.ok, true);
  assert.equal(seen[0].url, 'https://exp.host/--/api/v2/push/send');
  assert.deepEqual(seen[0].body.map((m: any) => m.to).sort(), [T1, T2]);
  assert.equal(seen[0].body[0].title, 'Booking waiting for approval'); assert.equal(seen[0].body[0].data.bookingId, 'bkg_1');
});

test('a phone Expo says is gone is forgotten', async () => {
  saveToken(uid, T1, 'ios'); saveToken(uid, T2, 'android');
  const order = tokensOf(uid);
  const send = expoPushProvider(cfg, async () => ({ ok: true, status: 200, json: async () => ({ data: order.map((_, i) => (i === 0 ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) }) }));
  const r = await send({ id: 'n2', userId: uid, channel: 'push', category: 'transactional', template: 'x', subject: 's', body: 'b', to: null });
  assert.equal(r.ok, true);
  assert.deepEqual(tokensOf(uid), [order[1]]);
});

test('no phone registered means not sent', async () => {
  const send = expoPushProvider(cfg, async () => { throw new Error('should not be called'); });
  assert.equal((await send({ id: 'n3', userId: uid, channel: 'push', category: 'transactional', template: 'x', subject: 's', body: 'b', to: null })).ok, false);
});
