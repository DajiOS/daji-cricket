// The assistant's display name: Platform AI underneath, a business default in Settings, each person's own pick in Profile, and a
// reserved list (Siri, Alexa, Hey Google, ...) that no one can save. The name is a label only.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, advance, DAY, type Harness } from './helpers.ts';
import { reservedMatch, BUILTIN_RESERVED } from '../src/aiNames.ts';
import { many } from '../src/db.ts';

let h: Harness, owner: string, staff: string, cust: string, admin: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); owner = await h.login('owner1'); staff = await h.login('staff1'); cust = await h.login('customer'); admin = await h.login('admin'); });

const me = async (t: string) => (await h.get('/api/me', t)).body.user;

test('everyone starts on "Ask AI", and the business default changes it for everyone who has not picked their own', async () => {
  assert.equal((await me(staff)).aiName, 'Ask AI');
  assert.equal((await me(cust)).aiNameOwn, null);
  assert.equal((await h.get('/api/config')).body.aiName, 'Ask AI');
  const r = await h.put('/api/admin/settings', { aiAssistantName: 'Assistant' }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await me(staff)).aiName, 'Assistant');
  assert.equal((await me(cust)).aiName, 'Assistant');
  assert.equal((await h.get('/api/config')).body.aiName, 'Assistant');
});

test('each person picks their own name, shown exactly as typed, and it applies only to them', async () => {
  await h.put('/api/admin/settings', { aiAssistantName: 'Assistant' }, owner);
  for (const name of ['Guppi', 'Hey Guppi', 'Ask Guppi please', 'G', 'ગુપ્પી']) {
    const r = await h.patch('/api/me', { aiName: name }, owner);
    assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.user.aiName, name);
    assert.equal(r.body.user.aiNameOwn, name);
  }
  await h.patch('/api/me', { aiName: 'Guppi' }, owner);
  await h.patch('/api/me', { aiName: 'Hemu Bot' }, staff);
  assert.equal((await me(owner)).aiName, 'Guppi');
  assert.equal((await me(staff)).aiName, 'Hemu Bot');
  assert.equal((await me(cust)).aiName, 'Assistant', 'someone who picked nothing keeps the business default');
  // clearing goes back to the business default
  const back = await h.patch('/api/me', { aiName: '' }, owner);
  assert.equal(back.body.user.aiName, 'Assistant'); assert.equal(back.body.user.aiNameOwn, null);
  const info = (await h.get('/api/ai-name', staff)).body;
  assert.deepEqual([info.core, info.site, info.own, info.name], ['Platform AI', 'Assistant', 'Hemu Bot', 'Hemu Bot']);
});

test('reserved names and wake phrases are refused, in Profile and in Settings, with the agreed message', async () => {
  for (const name of ['Siri', 'Hey Siri', 'hey siri!', 'HeySiri', 'S1ri', 'Ask Siri', 'Alexa', 'OK Google', 'Google Assistant', 'Gemini', 'Copilot', 'Microsoft Copilot', 'Cortana', 'ChatGPT', 'Śiri']) {
    const r = await h.patch('/api/me', { aiName: name }, staff);
    assert.equal(r.status, 400, name);
    assert.match(r.body.error.details.fields[0].message, /cannot be used\. This name or wake phrase is reserved or associated with another product\. Please choose a different name\./, name);
  }
  const s = await h.put('/api/admin/settings', { aiAssistantName: 'Hey Siri' }, owner);
  assert.equal(s.status, 400);
  assert.equal(s.body.error.details.fields[0].message, '"Hey Siri" cannot be used. This name or wake phrase is reserved or associated with another product. Please choose a different name.');
  assert.equal((await me(staff)).aiName, 'Ask AI', 'nothing was saved');
  // the check-as-you-type endpoint says the same without saving
  const c = (await h.post('/api/ai-name/check', { name: 'Hey Alexa' }, cust)).body;
  assert.equal(c.ok, false); assert.match(c.message, /reserved/);
  assert.equal((await h.post('/api/ai-name/check', { name: 'Hey Guppi' }, cust)).body.ok, true);
});

test('"what is your name" in Gujarati and Hindi, in either script, gets the same answer; a question about another name does not', async () => {
  await h.patch('/api/me', { aiName: 'Guppi' }, owner);
  for (const q of ['તમારું નામ શું છે?', 'તમે કોણ છો?', 'तुम्हारा नाम क्या है?', 'आप कौन हैं?', 'tamaru naam shu che', 'Guppi tamaru naam shu che?', 'aapka naam kya hai', 'tum kaun ho']) {
    const a = (await h.post('/api/staff/ask', { question: q }, owner)).body;
    assert.match(a.answer, /You call me Guppi/, q);
  }
  assert.match((await h.post('/api/ask', { question: 'aapka naam kya hai' }, cust)).body.answer, /You call me Ask AI/);
  for (const q of ['customer ka naam kya hai', 'ground nu naam shu che']) assert.doesNotMatch((await h.post('/api/staff/ask', { question: q }, owner)).body.answer, /You call me/, q);
});

test('ordinary names that only look like a reserved one are fine', () => {
  for (const name of ['Alexander', 'Sirius', 'Guppi', 'Hey Guppi', 'Ask AI', 'Copiloto', 'Googly', 'Claudette']) assert.equal(reservedMatch(name, BUILTIN_RESERVED), null, name);
});

test('the software owner adds a reserved name at run time; it applies at once, and built-in ones cannot be removed', async () => {
  assert.equal((await h.get('/api/admin/ai-reserved-names', owner)).status, 403, 'only the software owner manages the list');
  const add = await h.post('/api/admin/ai-reserved-names', { phrase: 'Hey Jarvis', note: 'Another assistant' }, admin);
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.equal((await h.patch('/api/me', { aiName: 'hey jarvis' }, staff)).status, 400);
  assert.equal((await h.patch('/api/me', { aiName: 'Jarvis' }, staff)).status, 400, 'the wake word taken off, the name itself is reserved too');
  assert.equal((await h.post('/api/admin/ai-reserved-names', { phrase: 'hey  JARVIS' }, admin)).status, 409);
  const list = (await h.get('/api/admin/ai-reserved-names', admin)).body.items;
  assert.ok(list.some((x: any) => x.builtin && x.phrase === 'Hey Siri'));
  assert.equal((await h.del(`/api/admin/ai-reserved-names/${add.body.id}`, admin)).status, 200);
  assert.equal((await h.patch('/api/me', { aiName: 'hey jarvis' }, staff)).status, 200, 'removed: usable again');
});

test('the name is a label only: it changes no permission, and Ask AI says what it is called', async () => {
  await h.patch('/api/me', { aiName: 'Guppi' }, staff);
  // staff1 still cannot do what it could not do before
  const before = (await me(staff)).permissions;
  await h.patch('/api/me', { aiName: 'Owner Override Bot' }, staff);
  assert.deepEqual((await me(staff)).permissions, before);
  await h.patch('/api/me', { aiName: 'Guppi' }, owner);
  const a = (await h.post('/api/staff/ask', { question: 'What is your name?' }, owner)).body;
  assert.match(a.answer, /You call me Guppi/); assert.match(a.answer, /Platform AI/);
  const c = (await h.post('/api/ask', { question: 'who are you?' }, cust)).body;
  assert.match(c.answer, /You call me Ask AI/);
  // a voice question is logged as one
  await h.post('/api/staff/ask', { question: 'What is your name?', via: 'voice' }, owner);
  const rows = many<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'ask.question' ORDER BY id DESC LIMIT 1");
  assert.equal(JSON.parse(rows[0]!.detail).via, 'voice');
  const changes = many<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'ai_name.update'");
  assert.ok(changes.length >= 3, 'every change of name is in the audit trail');
});

test('a name reserved after it was saved keeps working for 30 days with a notice, then falls back', async () => {
  await h.patch('/api/me', { aiName: 'Hey Jarvis' }, staff);
  await h.put('/api/admin/settings', { aiAssistantName: 'Jarvis' }, owner);
  assert.equal((await h.post('/api/admin/ai-reserved-names', { phrase: 'Jarvis' }, admin)).status, 201);
  let u = await me(staff);
  assert.equal(u.aiName, 'Hey Jarvis', 'still shown during the grace period');
  assert.match(u.aiNameNotice, /is now reserved for another product\. It keeps working until \d{4}-\d{2}-\d{2}/);
  assert.match((await me(cust)).aiNameNotice, /the owner should pick a new default/);
  advance(31 * DAY);
  staff = await h.login('staff1'); // the old sign-in has run out by now
  u = await me(staff);
  assert.equal(u.aiName, 'Ask AI', 'own pick and business default both reserved: back to Ask AI');
  assert.equal(u.aiNameOwn, null);
  assert.match(u.aiNameNotice, /so the assistant is shown as Ask AI instead/);
  assert.equal((await h.get('/api/config')).body.aiName, 'Jarvis', 'the saved setting is kept; only what people see falls back');
});

test('the owner can switch voice shortcuts off for the whole business', async () => {
  assert.equal((await h.get('/api/config')).body.voiceEnabled, true);
  assert.equal((await h.put('/api/admin/settings', { voiceShortcutsEnabled: false }, owner)).status, 200);
  assert.equal((await h.get('/api/config')).body.voiceEnabled, false);
});
