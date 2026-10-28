// Voice paths (the voice-action layer of the phone apps): the actions file, what the native build generates from it, and that a voice
// question is answered with exactly the access a typed one has. The native code itself is compiled only by the app build (EAS).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { startHarness, type Harness } from './helpers.ts';
import { many } from '../src/db.ts';

const require = createRequire(import.meta.url);
const ACTIONS = JSON.parse(readFileSync(new URL('../../mobile/voice-actions.json', import.meta.url), 'utf8')) as Record<'staff' | 'customer', { id: string; title: string; phrase: string; personal: string; question?: string; screen?: string }[]>;
const plugin = require('../../mobile/plugins/withDajiVoice.js') as { swiftSource: (c: unknown) => string; shortcutsXml: (c: unknown) => string };
const admin = { name: 'Daji Admin', scheme: 'dajiadmin', extra: { variant: 'admin' }, android: { package: 'com.dajicricket.admin' } };
const customer = { name: 'Daji Cricket Ground', scheme: 'dajicricket', extra: { variant: 'customer' }, android: { package: 'com.dajicricket.app' } };

test('every voice action is well formed: a unique id, a phrase with the app name, a personal phrase with the assistant name, and a question or a screen', () => {
  for (const list of [ACTIONS.staff, ACTIONS.customer]) {
    assert.ok(list.length >= 1 && list.length <= 10, 'Apple allows at most 10 App Shortcuts');
    assert.equal(new Set(list.map((a) => a.id)).size, list.length);
    for (const a of list) {
      assert.match(a.id, /^[a-z]+$/);
      assert.match(a.phrase, /\bAPP\b/, `${a.id}: Apple requires the app's name in a built-in phrase`);
      assert.match(a.personal, /\bNAME\b/, `${a.id}: the personal phrase uses the assistant name the person picked`);
      assert.ok(!!a.question !== !!a.screen, `${a.id}: asks a question or opens a screen, not both`);
      assert.doesNotMatch(`${a.title} ${a.phrase} ${a.question ?? ''}`, /\b(approve|pay|refund|release|transfer|delete)\b/i, `${a.id}: voice never approves or moves money`);
    }
  }
  const text = JSON.stringify([ACTIONS.staff, ACTIONS.customer]);
  assert.ok(!text.includes('Guppi') && !text.includes('Daji'), 'no assistant or app name is hard-coded into the actions');
});

test('the generated Siri intents only open the app at its own link, need the phone unlocked and never speak a result', () => {
  for (const [cfg, list] of [[admin, ACTIONS.staff], [customer, ACTIONS.customer]] as const) {
    const swift = plugin.swiftSource(cfg);
    for (const a of list) assert.ok(swift.includes(`DajiVoiceLink.open("${a.id}"`), a.id);
    assert.equal((swift.match(/AppShortcut\(intent:/g) ?? []).length, list.length);
    assert.equal((swift.match(/\\\(\.applicationName\)/g) ?? []).length, list.length, 'each built-in phrase carries the app name token');
    assert.equal((swift.match(/openAppWhenRun: Bool = true/g) ?? []).length, list.length);
    assert.equal((swift.match(/authenticationPolicy: IntentAuthenticationPolicy = \.requiresAuthentication/g) ?? []).length, list.length);
    assert.doesNotMatch(swift, /dialog:|ProvidesDialog|ReturnsValue|URLSession|http/, 'no spoken answer and no network call from the intent');
    assert.ok(swift.includes(`"${cfg.scheme}://voice/"`));
  }
});

test('Android shortcuts open the same links', () => {
  const x = plugin.shortcutsXml(customer);
  assert.match(x, /actions\.intent\.OPEN_APP_FEATURE/);
  for (const a of ACTIONS.customer.slice(0, 4)) assert.ok(x.includes(`android:data="dajicricket://voice/${a.id}"`), a.id);
  assert.ok(!x.includes('dajiadmin'));
});

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => h.reset());

test('a voice question gets the same answer and the same limits as a typed one, and is logged as voice', async () => {
  const owner = await h.login('owner1'), staff = await h.login('staff1'), cust = await h.login('customer');
  for (const a of ACTIONS.staff.filter((x) => x.question)) {
    const typed = await h.post('/api/staff/ask', { question: a.question }, staff);
    const voice = await h.post('/api/staff/ask', { question: a.question, via: 'voice' }, staff);
    assert.equal(voice.status, typed.status, a.id);
    assert.equal(voice.body.answer, typed.body.answer, `${a.id}: voice sees exactly what a tap sees`);
    assert.equal((await h.post('/api/staff/ask', { question: a.question, via: 'voice' }, owner)).status, 200, a.id);
  }
  for (const a of ACTIONS.customer.filter((x) => x.question)) assert.equal((await h.post('/api/ask', { question: a.question, via: 'voice' }, cust)).status, 200, a.id);
  // a customer cannot reach the team's assistant by voice either
  assert.equal((await h.post('/api/staff/ask', { question: 'What was the revenue today?', via: 'voice' }, cust)).status, 403);
  const voiced = many<{ detail: string }>("SELECT detail FROM audit_log WHERE action IN ('ask.question', 'ask.customer')").map((r) => JSON.parse(r.detail));
  assert.ok(voiced.some((d) => d.via === 'voice') && voiced.some((d) => d.via === undefined));
  assert.ok(!voiced.some((d) => d.via && d.via !== 'voice'), 'anything other than "voice" is logged as typed');
});
