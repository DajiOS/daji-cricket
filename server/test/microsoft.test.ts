import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { startHarness, DEMO_ACCOUNTS, T0, type Harness } from './helpers.ts';
import { resetMicrosoftTickets } from '../src/microsoft.ts';

// A stand-in for Microsoft's token endpoint: it answers every code with the ID token claims the test sets.
let claims: Record<string, unknown> = {};
let fake: Server, h: Harness;
const idToken = () => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
before(async () => {
  fake = createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id_token: idToken() })); }); });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  h = await startHarness({ MICROSOFT_CLIENT_ID: 'client-1', MICROSOFT_CLIENT_SECRET: 'secret-1', MICROSOFT_LOGIN_URL: `http://127.0.0.1:${(fake.address() as AddressInfo).port}` });
});
after(async () => { await h.close(); await new Promise<void>((r) => fake.close(() => r())); });
beforeEach(() => { h.reset(); resetMicrosoftTickets(); });

const verifier = 'v'.repeat(50);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const PERSONAL = '9188040d-6c67-4c5b-b112-36a304b66dad';
const exp = () => Math.floor(T0 / 1000) + 3600;

/** Runs start and callback like the phone's browser would, and gives back where the app was sent. */
async function signIn(app = 'dajiadmin'): Promise<URL> {
  const start = await fetch(`${h.url}/api/auth/microsoft/start?app=${app}&challenge=${challenge}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location')!);
  assert.equal(to.searchParams.get('client_id'), 'client-1');
  const cb = await fetch(`${h.url}/api/auth/microsoft/callback?code=abc&state=${encodeURIComponent(to.searchParams.get('state')!)}`, { redirect: 'manual' });
  assert.equal(cb.status, 302);
  return new URL(cb.headers.get('location')!);
}

test('the config tells the apps Microsoft sign-in is on', async () => {
  assert.equal((await h.get('/api/config')).body.microsoftSignIn, true);
});

test('a personal Microsoft account with the same email signs in through a one-time ticket', async () => {
  claims = { aud: 'client-1', exp: exp(), tid: PERSONAL, preferred_username: DEMO_ACCOUNTS.owner1.email };
  const back = await signIn();
  assert.equal(back.protocol, 'dajiadmin:');
  const ticket = back.searchParams.get('ticket')!;
  assert.ok(ticket);
  // the ticket is no use without the app's own secret, and a wrong secret burns it
  const wrong = await h.post('/api/auth/microsoft/redeem', { ticket, verifier: 'x'.repeat(50) });
  assert.equal(wrong.status, 401);
  assert.equal((await h.post('/api/auth/microsoft/redeem', { ticket, verifier })).body.error.code, 'TICKET_EXPIRED');

  const again = (await signIn()).searchParams.get('ticket')!;
  const r = await h.post('/api/auth/microsoft/redeem', { ticket: again, verifier });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.email, DEMO_ACCOUNTS.owner1.email);
  assert.equal((await h.get('/api/me', r.body.token)).status, 200);
  assert.equal((await h.post('/api/auth/microsoft/redeem', { ticket: again, verifier })).status, 401); // used once only
});

test('a work account email only counts when Microsoft vouches for it', async () => {
  claims = { aud: 'client-1', exp: exp(), tid: '11111111-2222-3333-4444-555555555555', email: DEMO_ACCOUNTS.owner1.email };
  assert.ok((await signIn()).searchParams.get('error'));
  claims = { ...claims, xms_edov: true };
  assert.ok((await signIn()).searchParams.get('ticket'));
});

test('no account, a token for another app, or an unknown app scheme gets nowhere', async () => {
  claims = { aud: 'client-1', exp: exp(), tid: PERSONAL, preferred_username: 'nobody@example.com' };
  assert.match((await signIn('dajicricket')).searchParams.get('error')!, /no Daji account/);
  claims = { aud: 'someone-else', exp: exp(), tid: PERSONAL, preferred_username: DEMO_ACCOUNTS.owner1.email };
  assert.ok((await signIn()).searchParams.get('error'));
  assert.equal((await fetch(`${h.url}/api/auth/microsoft/start?app=evil&challenge=${challenge}`, { redirect: 'manual' })).status, 400);
  assert.equal((await fetch(`${h.url}/api/auth/microsoft/callback?code=abc&state=forged.mac`, { redirect: 'manual' })).status, 400);
});
