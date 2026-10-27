// REL-PKG-001: requirement traceability. Every required P0 id has (a) a row in the gap register, (b) a test that writes a result under that id (or, for the two construction
// ids, a named construction test), and every test file the register names exists. The register may only use the agreed statuses.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rel, ev } from './rel.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const DOCS = join(ROOT, 'docs', 'master-patch');
const TESTS = join(ROOT, 'server', 'test');
const STATUSES = new Set(['VERIFIED', 'EXISTS_UNVERIFIED', 'PARTIAL', 'MISSING', 'DUPLICATE', 'DEFECT', 'LEGACY_REPLACE_AFTER_PASS', 'NOT_APPLICABLE']);
const CONSTRUCTION = new Set(['REL-AUTH-006', 'REL-ACC-005']); // proven in the construction suite, which is a separate project

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

rel('REL-PKG-001', 'every required P0 id traces to a register row, a test and a result', () => {
  const required = readFileSync(join(DOCS, 'REQUIRED_P0_IDS.txt'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  assert.equal(required.length, 59, 'the starter tracker has 59 required P0 tests');

  const [head, ...body] = parseCsv(readFileSync(join(DOCS, 'CURRENT_VS_REQUIRED_GAP_REGISTER.csv'), 'utf8'));
  const col = (n: string) => head!.indexOf(n);
  for (const n of ['Requirement ID', 'Classification', 'Verification Status', 'Required Tests']) assert.ok(col(n) >= 0, `register column ${n}`);
  const byReq = new Map<string, string[][]>();
  for (const r of body) byReq.set(r[col('Requirement ID')]!, [...(byReq.get(r[col('Requirement ID')]!) ?? []), r]);

  // only the agreed statuses
  for (const r of body) {
    assert.ok(STATUSES.has(r[col('Classification')]!), `${r[0]}: classification ${r[col('Classification')]} is not an agreed status`);
    assert.ok(STATUSES.has(r[col('Verification Status')]!), `${r[0]}: verification ${r[col('Verification Status')]} is not an agreed status`);
  }

  // every required id has a register row and a test that writes a result under that id
  const sources = readdirSync(TESTS).filter((f) => f.endsWith('.test.ts')).map((f) => ({ f, text: readFileSync(join(TESTS, f), 'utf8') }));
  const missingRow: string[] = [], missingTest: string[] = [];
  for (const id of required) {
    if (!byReq.has(id)) missingRow.push(id);
    if (!CONSTRUCTION.has(id) && !sources.some((s) => s.text.includes(`rel('${id}'`))) missingTest.push(id);
  }
  ev('required', required.length);
  ev('registerRows', body.length);
  ev('missingRegisterRow', missingRow);
  ev('missingTest', missingTest);
  assert.deepEqual(missingRow, [], 'required ids with no gap-register row');
  assert.deepEqual(missingTest, [], 'required ids with no test');

  // every test file the register names exists
  const named = new Set<string>();
  for (const r of body) for (const m of r[col('Required Tests')]!.matchAll(/[a-z0-9-]+\.test\.ts/g)) named.add(m[0]);
  const absent = [...named].filter((f) => !existsSync(join(TESTS, f)));
  ev('testFilesNamed', [...named].sort());
  assert.deepEqual(absent, [], 'register names test files that do not exist');

  // a row may not claim VERIFIED without naming how it was verified
  const bare = body.filter((r) => r[col('Verification Status')] === 'VERIFIED' && !r[col('Required Tests')]!.trim()).map((r) => r[0]);
  assert.deepEqual(bare, [], 'VERIFIED rows with no test named');
});
