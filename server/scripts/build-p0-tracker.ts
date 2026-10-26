// Builds the P0 execution tracker from what the tests recorded. Nothing here decides a result: a row is PASS only when every test case carrying its id wrote a PASS
// record, FAIL when any wrote FAIL, and NOT_RUN when no record exists. A case that skipped itself (missing fixture, missing tool) is SKIPPED and counts as not run.
//
//   node scripts/build-p0-tracker.ts --starter <dir with the starter CSVs> --evidence <dir of rel JSON records> --out <dir>
//        [--construction <vitest json>] [--before <dir of records from the base release>] [--executor "<name>"] [--evidence-prefix TESTS/evidence]
//
// Writes P0_TEST_EXECUTION_TRACKER.csv, P0_GATES.json and TRACEABILITY.csv into --out, and exits 1 when a gate is not met (so a pipeline cannot call it a GO).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const starter = arg('starter'), evidenceDir = arg('evidence'), out = arg('out');
if (!starter || !evidenceDir || !out) { console.error('usage: build-p0-tracker.ts --starter D --evidence D --out D [--construction F] [--before D] [--executor N]'); process.exit(2); }
const constructionFile = arg('construction'), beforeDir = arg('before'), executor = arg('executor', 'Claude Code (automated test run)')!, prefix = arg('evidence-prefix', 'TESTS/evidence')!;

// ---- CSV helpers
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
  return rows;
}
const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';

// ---- records
interface Rec { id: string; title: string; result: 'PASS' | 'FAIL' | 'SKIPPED'; error?: string; facts: Record<string, unknown>; startedAt: string; versions: Record<string, unknown>; environment: Record<string, unknown>; file: string; _name: string }
function load(dir: string): Rec[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ ...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Rec), _name: f }));
  } catch { return []; }
}
const after = load(evidenceDir);
const before = beforeDir ? load(beforeDir) : [];
const group = (recs: Rec[]) => { const m = new Map<string, Rec[]>(); for (const r of recs) m.set(r.id, [...(m.get(r.id) ?? []), r]); return m; };
const A = group(after), B = group(before);

// ---- construction suite (a separate Fastify/Postgres project): its vitest JSON is evidence for the ids it covers
interface VT { fullName: string; status: string }
const construction: VT[] = [];
if (constructionFile) {
  const j = JSON.parse(readFileSync(constructionFile, 'utf8')) as { testResults: { assertionResults: VT[] }[] };
  for (const f of j.testResults) construction.push(...f.assertionResults);
}
const CONSTRUCTION_MAP: Record<string, RegExp[]> = {
  'REL-AUTH-006': [/P0-R .*project isolation/],
  'REL-ACC-005': [/P0-K .* K03 /, /P0-K .* K09 /, /P0-K .* K10 /, /P0-E .* E01 /],
};
function constructionRecs(id: string): Rec[] {
  const pats = CONSTRUCTION_MAP[id];
  if (!pats || !construction.length) return [];
  return pats.map((p) => {
    const t = construction.find((x) => p.test(x.fullName));
    return { id, title: t?.fullName ?? `no construction test matches ${p}`, result: t?.status === 'passed' ? 'PASS' : t ? 'FAIL' : 'SKIPPED', facts: { suite: 'Daji Admin construction (vitest, PostgreSQL 16)' }, startedAt: '', versions: {}, environment: { database: 'PostgreSQL 16 (local)' }, file: constructionFile!, _name: constructionFile! } as Rec;
  });
}

// What a PASS here does NOT prove. These are not hidden: they are printed in the tracker and carried into the GO/NO-GO paper.
const RESIDUAL: Record<string, string> = {
  'REL-PAY-001': 'Real payment provider checkout NOT_RUN (demo gateway only).',
  'REL-PAY-002': 'Real provider signature scheme NOT_RUN against a live account.',
  'REL-PAY-003': 'Real provider redelivery NOT_RUN.',
  'REL-PAY-004': 'Real provider payloads NOT_RUN; mismatch proven with signed demo-gateway payloads.',
  'REL-PAY-005': 'Real provider late capture NOT_RUN.',
  'REL-PAY-006': 'Direct UPI verification against a real bank/provider NOT_RUN.',
  'REL-PAY-007': 'Real provider refund settlement NOT_RUN.',
  'REL-PAY-011': 'Real provider reversal/dispute notices NOT_RUN.',
  'REL-FILE-001': 'Real ClamAV daemon NOT_RUN (built-in scanner and a stand-in clamd speaking the protocol were run).',
  'REL-CH-002': 'On-device WebView behaviour (iOS/Android) NOT_RUN; the URL/origin guard is proven in code.',
  'REL-ENV-003': 'A built EAS preview binary on a device NOT_RUN; the app guard and build profiles are proven in code.',
  'REL-MIG-001': 'Rehearsed on a generated old-release database, not on a copy of production data.',
  'REL-MIG-002': 'Rehearsed on a generated old-release database, not on a copy of production data.',
  'REL-REC-001': 'Offsite/provider-managed backup and restore NOT_RUN; local encrypted snapshot restore was run.',
  'REL-REC-003': 'Provider-side money state after rollback NOT_RUN; the app-side boundary is proven.',
  'REL-CH-001': 'iOS/Android/iPad screens NOT_RUN; one authoritative API is proven at API level.',
  'REL-ACC-005': 'Proven in the construction suite on local PostgreSQL; the live Finance consumer of the outbox event is outside this repository.',
};

const trackerRows = parseCsv(readFileSync(join(starter, 'P0_TEST_EXECUTION_TRACKER.csv'), 'utf8')).filter((r) => r.length > 1);
const header = trackerRows[0]!;
const extra = ['Requirement', 'App Version', 'DB Version', 'Migration Version', 'Environment', 'Test Data', 'Date', 'Executor', 'Expected', 'Actual', 'Result', 'DB/API/Provider Evidence', 'Audit Evidence', 'Evidence Files', 'Before-Fix Result (base release)', 'Residual (not proven here)', 'Approval'];
const col = (n: string) => header.indexOf(n);

const outRows: string[][] = [[...header, ...extra]];
const gates = { requiredTotal: 0, passed: 0, failed: 0, notRun: 0, skippedUnapproved: 0, passedWithResidual: 0, openP0Defects: 0 };
const trace: string[][] = [['Test ID', 'Requirement', 'Test cases found', 'Result', 'Test files']];
const detail: Record<string, unknown>[] = [];

for (const r of trackerRows.slice(1)) {
  const id = r[0]!;
  const recs = [...(A.get(id) ?? []), ...constructionRecs(id)];
  let result: 'PASS' | 'FAIL' | 'NOT_RUN' = 'NOT_RUN';
  if (recs.length) {
    if (recs.some((x) => x.result === 'FAIL')) result = 'FAIL';
    else if (recs.some((x) => x.result === 'SKIPPED')) result = 'NOT_RUN';
    else result = 'PASS';
  }
  const skipped = recs.some((x) => x.result === 'SKIPPED');
  gates.requiredTotal++;
  if (result === 'PASS') { gates.passed++; if (RESIDUAL[id]) gates.passedWithResidual++; }
  else if (result === 'FAIL') gates.failed++;
  else { gates.notRun++; if (skipped) gates.skippedUnapproved++; }

  const bs = B.get(id);
  const beforeResult = !beforeDir ? 'not run' : !bs ? 'no test existed on the base release' : bs.some((x) => x.result === 'FAIL') ? 'FAIL (defect reproduced on the base release)' : bs.every((x) => x.result === 'PASS') ? 'PASS (no defect on the base release)' : 'SKIPPED';
  const defect = /FAIL/.test(beforeResult) && result === 'PASS' ? `DEF-${id}` : '';
  const first = recs[0];
  const facts = recs.flatMap((x) => Object.entries(x.facts).map(([k, v]) => `${k}=${JSON.stringify(v)}`)).join('; ');
  const files = [...new Set(recs.map((x) => x.file).filter(Boolean))].join(' ');
  const audit = recs.flatMap((x) => Object.keys(x.facts).filter((k) => /audit/i.test(k))).join(', ');
  const v = first?.versions ?? {};
  const row = r.slice(0, header.length).map((c) => c ?? '');
  while (row.length < header.length) row.push('');
  row[col('Status')] = result;
  row[col('Evidence Reference')] = recs.length ? recs.filter((x) => x._name.endsWith('.json') && !x._name.includes('/')).map((x) => `${prefix}/${x._name}`).join(' ') || constructionFile || '' : '';
  if (defect) { row[col('Defect ID')] = defect; row[col('Retest Evidence')] = `PASS after fix: ${row[col('Evidence Reference')]}`; }
  const expected = [...new Set(recs.map((x) => x.title))].join(' | ');
  const actual = recs.length ? recs.map((x) => `${x.result}${x.error ? `: ${x.error.slice(0, 200)}` : ''}`).join(' | ') + (facts ? ` || ${facts.slice(0, 600)}` : '') : 'No test record exists.';
  outRows.push([...row,
    r[1]!, String(v.application ?? ''), String(v.databaseVersion ?? ''), String(v.migrationVersion ?? ''),
    first ? String(first.environment.name ?? '') + (first.environment.database ? ` / ${first.environment.database}` : '') + (first.environment.paymentProvider ? ` / ${first.environment.paymentProvider}` : '') : '',
    first ? 'Generated by the test harness: demo ground and accounts, frozen clock' : '',
    first?.startedAt ? first.startedAt.slice(0, 10) : '', recs.length ? executor : '', expected, actual, result,
    recs.length ? 'API responses and database rows asserted by the case (SQLite in-memory; payment provider: demo gateway)' : '', audit || '', files,
    beforeResult, result === 'PASS' ? (RESIDUAL[id] ?? '') : '', '' /* approval: a person signs this, never the tool */]);
  trace.push([id, r[1]!, String(recs.length), result, files]);
  detail.push({ id, result, cases: recs.length, residual: result === 'PASS' ? RESIDUAL[id] ?? null : null });
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'P0_TEST_EXECUTION_TRACKER.csv'), toCsv(outRows));
writeFileSync(join(out, 'TRACEABILITY.csv'), toCsv(trace));
const summary = { ...gates, openP0Defects: gates.failed, extraCases: [...A.keys()].filter((k) => !trackerRows.some((r) => r[0] === k)), detail };
writeFileSync(join(out, 'P0_GATES.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...gates, extraCases: summary.extraCases }, null, 2));
process.exit(gates.failed || gates.notRun ? 1 : 0);
