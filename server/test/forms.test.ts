// No form may turn a person away without saying why. These tests check the words people see, the server answers the forms
// rely on, and the form code itself, so a new form that can fail silently is caught here rather than by a customer.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startHarness, dayFromNow, grounds, type Harness } from './helpers.ts';
import { fieldSentence, problemsSentence, fieldName } from '../../desk/src/formtext.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const p = `${dir}/${f}`;
  return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
});
const DESK = walk('desk/src');
const lineOf = (src: string, i: number) => src.slice(0, i).split('\n').length;

test('field problems from the server read as plain sentences', () => {
  assert.equal(fieldSentence({ field: 'customer.phone', message: 'Required' }), 'Enter the mobile number.');
  assert.equal(fieldSentence({ field: 'groundId', message: 'Required' }), 'Choose the ground.');
  assert.equal(fieldSentence({ field: 'password', message: 'Use a capital letter, a small letter and a number' }), 'Password: use a capital letter, a small letter and a number.');
  assert.equal(fieldSentence({ field: 'phone', message: 'Must be a 10-digit Indian mobile number' }), 'Mobile number: must be a 10-digit Indian mobile number.');
  assert.equal(fieldName('billDate'), 'bill date');
  assert.equal(fieldName('amountPaise'), 'amount');
  // the same problem twice is said once, and no field key ("customer.phone") ever reaches the person
  const s = problemsSentence([{ field: 'customer.phone', message: 'Required' }, { field: 'phone', message: 'Required' }, { field: 'customer.firstName', message: 'Required' }]);
  assert.equal(s, 'Enter the mobile number. Enter the first name.');
  assert.doesNotMatch(s, /[a-z]\.[a-z]|:\s*Required/);
});

test('a desk booking without a mobile number is refused with the field named, so the desk can point at it', async () => {
  const g = (await grounds(h))[0]!;
  const r = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(3), startTime: '08:00', slots: 1, customer: { firstName: 'Ravi', lastName: 'Shah', phone: '' }, payment: { method: 'cash', amountPaise: 0 } }, await h.login('owner1'));
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.error.details.fields.map((f: any) => f.field), ['customer.phone']);
  assert.equal(problemsSentence(r.body.error.details.fields), 'Enter the mobile number.');
});

test('a weak password at sign-up names the password field, so the website can point at it', async () => {
  const w = await h.post('/api/auth/register', { firstName: 'Sunny', lastName: 'Patel', email: 'weak@example.com', countryCode: '+91', phone: '9624055599', password: 'cricketclub' });
  assert.equal(w.status, 400);
  assert.deepEqual(w.body.error.details.fields.map((f: any) => f.field), ['password']);
  assert.equal(problemsSentence(w.body.error.details.fields), 'Password: use a capital letter, a small letter and a number.');
});

// ---- the form code itself

test('desk: a submit button is never greyed out because a field is empty (pressing it must say what is missing)', () => {
  // Buttons may be disabled while sending, or when there is truly nothing to do (no changes to save, already sent).
  const OK = [/^(busy|working|saving|sending|scanning|f\.busy)$/, /^busy === [\w.+ ]+$/, /^testing === /, /^!(data|d)$/, /^!changed$/, /^!dirty$/, /^body === t\.body$/, /^!editable$/, /^(sheet\.)?locked$/, /^disabled$/];
  // greyed out with the reason written right beside the button
  const EXPLAINED = ['!d.providers.setu', "c.status === 'REVOKED'", "c.status === 'REJECTED'", '!!invalid'];
  const bad: string[] = [];
  for (const f of DESK) {
    const src = read(f);
    for (const m of src.matchAll(/<button\b[^>]*className="[^"]*\bprimary\b[^"]*"[^>]*?disabled=\{([^}]*)\}/g)) {
      const parts = m[1]!.split('||').map((x) => x.trim().replace(/^\(|\)$/g, ''));
      for (const p of parts) if (!OK.some((r) => r.test(p)) && !EXPLAINED.includes(p)) bad.push(`${f}:${lineOf(src, m.index!)} disabled={${m[1]}}`);
    }
  }
  assert.deepEqual(bad, [], 'Keep the button enabled and say what is missing when it is pressed (useSubmit().check, or setErr):\n' + bad.join('\n'));
});

test('desk: every error a form keeps is shown somewhere', () => {
  const bad: string[] = [];
  // lib.ts and ui.tsx hold the hooks that hand the error to the page that shows it
  for (const f of DESK.filter((x) => !/\/(lib\.ts|ui\.tsx)$/.test(x))) {
    const src = read(f);
    for (const m of src.matchAll(/const \[(\w+), (set\w+)\] = useState<string \| null>\(null\)/g)) {
      const [, name, setter] = m;
      if (!/^(err|error|e2|fail|problem|msg)$/i.test(name!)) continue;
      if (!src.includes(`${setter}(`)) continue;
      const shown = new RegExp(`msg=\\{${name}\\b|\\{${name} &&|\\{${name}\\}|\\b${name} \\?`).test(src);
      if (!shown) bad.push(`${f}:${lineOf(src, m.index!)} ${name} is set but never shown`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('desk: a failed save is never swallowed', () => {
  const bad: string[] = [];
  for (const f of DESK) {
    const src = read(f);
    src.split('\n').forEach((l, i) => {
      if (!/\b(post|put|patch|del|sendFile)\(|method: '(POST|PUT|PATCH|DELETE)'/.test(l)) return;
      if (/catch\s*(\(\w*\))?\s*\{\s*(\/\*[^*]*\*\/\s*)?\}|\.catch\(\(\) => (\{\}|undefined|null)\)/.test(l)) bad.push(`${f}:${i + 1}`);
    });
  }
  // Background work may stay quiet; a save the person pressed may not. These are background: signing out goes ahead
  // even when the server cannot be told, the camera view link renews itself, the paperclip counts are a read sent as a POST,
  // and joining bank accounts after the bank window closes is a bonus step.
  const allowed = ['desk/src/App.tsx', 'desk/src/pages/Cameras.tsx', 'desk/src/parts/books/Txns.tsx', 'desk/src/parts/books/YodleeConnect.tsx'];
  assert.deepEqual(bad.filter((b) => !allowed.some((a) => b.startsWith(a + ':'))), []);
});

test('desk: errors scroll into view and field problems are reworded for people', () => {
  const ui = read('desk/src/ui.tsx'), lib = read('desk/src/lib.ts');
  assert.match(ui, /export function ErrorBox[\s\S]{0,300}scrollIntoView/, 'ErrorBox must bring itself into view');
  assert.match(lib, /problemsSentence/, 'the API client must turn field problems into sentences');
  for (const f of DESK) assert.doesNotMatch(read(f), /\$\{x\.field\}: \$\{x\.message\}/, `${f} shows raw field keys`);
});

test('website: every form says why it did not go through, right by its button', () => {
  for (const file of ['web/public/app.js', 'web/public/club.js']) {
    const src = read(file);
    const forms = [...src.matchAll(/addEventListener\('submit', async/g)];
    assert.ok(forms.length > 0);
    for (const m of forms) {
      const body = src.slice(m.index!, m.index! + 2500);
      assert.match(body, /formFail\(/, `${file}:${lineOf(src, m.index!)} must show its errors with formFail`);
      assert.match(body, /formCheck\(/, `${file}:${lineOf(src, m.index!)} must check required fields with formCheck before sending`);
    }
    assert.doesNotMatch(src, /\$\{k\}: \$\{m\}/, `${file} shows raw field keys`);
  }
  const app = read('web/public/app.js');
  assert.match(app, /function formFail[\s\S]{0,1400}scrollIntoView/, 'formFail must bring the problem into view');
  assert.match(read('web/public/site.css'), /\.formerr/);
});
