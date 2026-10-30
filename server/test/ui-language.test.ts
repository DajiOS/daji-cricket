// Screen language (redesign step 10): English, Gujarati and Hindi on the customer screens, from one shared word list, saved per person.
// The word list is checked line by line, the phone app's and the website's copies are checked against it, and the server's part is
// checked end to end: who can set it, what it refuses, that it follows the person, that it changes no price, and that Ask AI can say what it is.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHarness, type Harness } from './helpers.ts';
import { UI_KEYS, UI_LANGUAGES, uiStrings, uiText } from '../../shared/src/i18n.ts';
import { i18nOutputs } from '../scripts/i18n-outputs.ts';
import { isUiLanguageQuestion } from '../src/uiLanguage.ts';
import { many } from '../src/db.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const holes = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

test('every line is in all three languages, keeps the same {placeholders} and is written in its own script', () => {
  const en = uiStrings('en'), gu = uiStrings('gu'), hi = uiStrings('hi');
  assert.ok(UI_KEYS.length > 150, `only ${UI_KEYS.length} lines`);
  for (const k of UI_KEYS) {
    for (const l of UI_LANGUAGES) assert.ok(uiStrings(l)[k].trim().length > 0, `${l} ${k} is empty`);
    assert.deepEqual(holes(gu[k]), holes(en[k]), `gu ${k}`);
    assert.deepEqual(holes(hi[k]), holes(en[k]), `hi ${k}`);
    assert.match(gu[k], /[઀-૿]/, `gu ${k} has no Gujarati letters: ${gu[k]}`);
    assert.match(hi[k], /[ऀ-ॿ]/, `hi ${k} has no Devanagari letters: ${hi[k]}`);
    // only "Book with the assistant" names the other languages; everywhere else no English sentence is left behind
    if (k !== 'book.withAssistant') { assert.ok(!/[ऀ-ॿ]/.test(gu[k]), `gu ${k} has Hindi letters`); assert.ok(!/[઀-૿]/.test(hi[k]), `hi ${k} has Gujarati letters`); }
  }
});

test('the word list carries no assistant name, no amount and no rule: those come from the server or from aiName', () => {
  for (const l of UI_LANGUAGES) for (const [k, v] of Object.entries(uiStrings(l))) {
    assert.ok(!/guppi|ask ai|ગુપ્પી|गुप्पी/i.test(v), `${l} ${k} names the assistant: ${v}`);
    assert.ok(!/₹|rs\.?\s*\d|\d{3,}/i.test(v), `${l} ${k} has an amount in it: ${v}`);
  }
  assert.equal(uiText('gu', 'me.balance', { amount: '₹1,500' }), 'ગ્રાઉન્ડ પર બાકી: ₹1,500');
  assert.equal(uiText('xx', 'tab.home'), 'Home', 'an unknown language falls back to English');
  assert.equal(uiText('hi', 'book.upTo'), 'एक साथ ज़्यादा से ज़्यादा {n} स्लॉट चुनें।', 'a missing value stays visible, never "undefined"');
});

test('the phone app and website copies are exactly what the build script makes from the shared list', () => {
  for (const o of i18nOutputs()) assert.equal(readFileSync(o.path, 'utf8'), o.text, `${o.path} is out of date: run node server/scripts/i18n-build.ts`);
});

test('every line the screens ask for exists, and every line in the list is used on a screen', () => {
  const mobile = ['mobile/App.tsx', ...readdirSync(join(ROOT, 'mobile/src')).filter((f) => /\.tsx?$/.test(f) && f !== 'strings.gen.ts').map((f) => `mobile/src/${f}`)].map(read).join('\n');
  const web = read('web/public/app.js') + read('web/public/club.js') + read('web/public/index.html');
  const used = new Set([
    ...[...mobile.matchAll(/(?:\bt|\))\('([\w.]+)'/g)].map((m) => m[1]!),
    ...[...mobile.matchAll(/\? '([a-z]+\.[\w.]+)' : '([a-z]+\.[\w.]+)'/g)].flatMap((m) => [m[1]!, m[2]!]),
    ...[...web.matchAll(/\bT\('([\w.]+)'/g)].map((m) => m[1]!),
    ...[...web.matchAll(/data-i18n(?:-aria)?="([\w.]+)"/g)].map((m) => m[1]!),
    // server messages are looked up by error code from a list of quoted keys
    ...[...(mobile + web).matchAll(/'(err\.[A-Z_]+)'/g)].map((m) => m[1]!),
  ]);
  const known = new Set<string>(UI_KEYS);
  for (const k of used) assert.ok(known.has(k), `a screen asks for "${k}", which is not in shared/src/i18n.ts`);
  for (const k of UI_KEYS) assert.ok(used.has(k), `"${k}" is in the list but no screen uses it`);
});

test('every translated server message is for an error code the server really sends', () => {
  const src = readdirSync(join(ROOT, 'server/src'), { recursive: true }).filter((f) => String(f).endsWith('.ts')).map((f) => read(`server/src/${f}`)).join('\n');
  const codes = UI_KEYS.filter((k) => k.startsWith('err.')).map((k) => k.slice(4));
  assert.ok(codes.length >= 20);
  for (const c of codes) assert.ok(c === 'NETWORK' || src.includes(`'${c}'`), `err.${c}: the server never sends ${c}`);
});

test('isUiLanguageQuestion: questions about the screens, in three languages, and not questions about what the assistant speaks', () => {
  for (const q of ['What language is my app in?', 'which language is the website showing', 'change the app to Gujarati', 'switch my language', 'set screen language to hindi', 'એપની ભાષા કઈ છે?', 'ભાષા બદલવી છે', 'ऐप की भाषा क्या है?', 'भाषा बदलनी है', 'app ni bhasha', 'bhasha badlo']) assert.ok(isUiLanguageQuestion(q), q);
  for (const q of ['Do you speak Gujarati?', 'Book Sunday 7 PM', 'what is my next booking', 'tame gujarati samjo cho?', 'What is your name?']) assert.ok(!isUiLanguageQuestion(q), q);
});

let h: Harness, owner: string, staff: string, cust: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); owner = await h.login('owner1'); staff = await h.login('staff1'); cust = await h.login('customer'); });
const me = async (t: string) => (await h.get('/api/me', t)).body.user;

test('everyone starts in English; a person picks Gujarati or Hindi for themselves only, and it follows them to a new sign-in', async () => {
  assert.equal((await me(cust)).language, 'en');
  assert.equal((await me(cust)).languageChosen, false, 'nothing saved yet: the app and website keep the language picked before sign-in');
  assert.equal((await me(staff)).language, 'en');
  const r = await h.patch('/api/me', { language: 'gu' }, cust);
  assert.equal(r.body.user.languageChosen, true);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.language, 'gu');
  assert.equal((await me(cust)).language, 'gu');
  assert.equal((await me(staff)).language, 'en', 'another person is not changed');
  assert.equal((await me(owner)).language, 'en');
  const again = await h.login('customer'); // a second phone, or the website
  assert.equal((await me(again)).language, 'gu');
  assert.equal((await h.patch('/api/me', { language: 'hi' }, staff)).body.user.language, 'hi', 'staff can pick one too');
  const cleared = (await h.patch('/api/me', { language: null }, cust)).body.user;
  assert.equal(cleared.language, 'en', 'clearing goes back to English'); assert.equal(cleared.languageChosen, false);
  assert.equal(many('SELECT 1 FROM ui_languages WHERE user_id = (SELECT id FROM users WHERE role = ? LIMIT 1)', 'customer').length, 0);
});

test('anything other than en, gu or hi is refused with a field message, and nothing is saved', async () => {
  for (const bad of ['fr', 'GU', 'Gujarati', '', 1, true, ['gu'], { lang: 'gu' }, "gu'; DROP TABLE users;--"]) {
    const r = await h.patch('/api/me', { language: bad }, cust);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error.details.fields[0].field, 'language');
    assert.equal(r.body.error.details.fields[0].message, 'Pick English (en), Gujarati (gu) or Hindi (hi).');
  }
  assert.equal((await me(cust)).language, 'en');
  assert.equal((await h.patch('/api/me', { language: 'gu' })).status, 401, 'signed out cannot save one');
});

test('each change is audited once under the real person; saving the same language twice is not a second change', async () => {
  await h.patch('/api/me', { language: 'gu' }, cust);
  await h.patch('/api/me', { language: 'gu' }, cust); // a double tap
  await h.patch('/api/me', { language: 'hi' }, cust);
  const rows = many<{ actor_id: string; entity_id: string; detail: string }>("SELECT actor_id, entity_id, detail FROM audit_log WHERE action = 'ui_language.update' ORDER BY id");
  assert.deepEqual(rows.map((r) => JSON.parse(r.detail)), [{ from: null, to: 'gu' }, { from: 'gu', to: 'hi' }]);
  const id = (await me(cust)).id;
  assert.ok(rows.every((r) => r.actor_id === id && r.entity_id === id));
});

test('the language changes words only: availability, prices and the site settings are the same in every language', async () => {
  const g = (await h.get('/api/grounds')).body.items[0];
  const date = new Date(Date.now() + 3 * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const look = async () => (await h.get(`/api/grounds/${g.id}/availability?date=${date}`, cust)).body;
  const base = await look();
  for (const l of ['gu', 'hi', 'en']) { await h.patch('/api/me', { language: l }, cust); assert.deepEqual(await look(), base, l); }
  const cfg = async () => { const c = (await h.get('/api/config', cust)).body; delete c.serverTime; return c; };
  const c0 = await cfg(); await h.patch('/api/me', { language: 'gu' }, cust); assert.deepEqual(await cfg(), c0);
});

test('Ask AI says which screen language is set and where to change it, for customers and staff, in any of the three languages', async () => {
  const askC = async (q: string) => (await h.post('/api/ask', { question: q }, cust)).body;
  let a = await askC('What language is my app in?');
  assert.equal(a.intent, 'screen_language'); assert.match(a.answer, /Your screens are in English, the starting language/); assert.match(a.answer, /Profile › Screen language/);
  await h.patch('/api/me', { language: 'gu' }, cust);
  a = await askC('એપની ભાષા કઈ છે?');
  assert.equal(a.intent, 'screen_language'); assert.match(a.answer, /Your screens are in ગુજરાતી\./);
  assert.match(a.answer, /not bookings, prices or payments/);
  await h.patch('/api/me', { language: 'hi' }, staff);
  const s = (await h.post('/api/staff/ask', { question: 'ऐप की भाषा क्या है?' }, staff)).body;
  assert.equal(s.source, 'builtin'); assert.match(s.answer, /Your screens are in हिन्दी\./);
  const row = many<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'ask.question' ORDER BY id DESC LIMIT 1")[0]!;
  assert.equal(JSON.parse(row.detail).intent, 'screen_language');
  // what the assistant speaks is a different question, still answered by the assistant's own language handling
  assert.notEqual((await askC('Do you speak Gujarati?')).intent, 'screen_language');
});
