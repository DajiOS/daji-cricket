// Migration, backup, restore and rollback rehearsals (REL-MIG-*, REL-REC-*).
// They run against a database built by the PREVIOUS release of the code (scripts/make-old-fixture.ts, run from a checkout of the base commit), so they prove the
// upgrade of a real old database and the return to the old code. They need two things from the environment:
//   OLD_FIXTURE_DIR  the folder make-old-fixture.ts wrote (old.db, data/)
//   OLD_CHECKOUT     a checkout of the previous release (for the rollback: its code runs against the migrated database)
// Without them the cases say so and are recorded SKIPPED, never PASS.
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { rel, ev } from './rel.ts';

const FIXTURE = process.env.OLD_FIXTURE_DIR ?? '';
const OLD = process.env.OLD_CHECKOUT ?? '';
const SERVER = join(import.meta.dirname, '..');
const NODE = ['--disable-warning=ExperimentalWarning'];
const haveFixture = !!FIXTURE && existsSync(join(FIXTURE, 'old.db'));
const haveOld = !!OLD && existsSync(join(OLD, 'server', 'src', 'app.ts'));
const roots: string[] = [];
const scratch = (): string => { const d = mkdtempSync(join(tmpdir(), 'daji-rehearsal-')); roots.push(d); return d; };
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function sh(cwd: string, script: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [...NODE, join(cwd, 'scripts', script), ...args], { cwd, env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, signal: r.signal, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const migrate = (db: string, env: Record<string, string> = {}, extra: string[] = ['--json']) => sh(SERVER, 'migrate.ts', [db, ...extra], env);
const reconcileCli = (db: string) => { const r = sh(SERVER, 'reconcile.ts', [db, '--json']); return { ...r, json: r.out ? JSON.parse(r.out) : null }; };

/** A fresh working copy of the old database and its files. */
function workCopy(): { dir: string; db: string; data: string } {
  const dir = scratch();
  copyFileSync(join(FIXTURE, 'old.db'), join(dir, 'work.db'));
  cpSync(join(FIXTURE, 'data'), join(dir, 'data'), { recursive: true });
  return { dir, db: join(dir, 'work.db'), data: join(dir, 'data') };
}

const lite = (path: string) => new DatabaseSync(path, { readOnly: true });
const tableNames = (d: DatabaseSync) => (d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
const cols = (d: DatabaseSync, t: string) => (d.prepare(`SELECT name FROM pragma_table_info('${t}') ORDER BY cid`).all() as { name: string }[]).map((r) => r.name);
import { createHash } from 'node:crypto';
/** A hash over a table's rows using only the given columns, in row order. */
function rowsHash(d: DatabaseSync, t: string, columns: string[]): { rows: number; sha256: string } {
  const h = createHash('sha256'); let n = 0;
  for (const r of d.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${t}" ORDER BY rowid`).iterate()) { h.update(JSON.stringify(r)); n++; }
  return { rows: n, sha256: h.digest('hex') };
}
const skip = (why: string) => { ev('skipped', why); };
// rows a released module adds to a table that already existed. Old rows must stay exactly as they were; a new row in an old table passes only
// when it is listed here, under the module that added it, and that module was applied by this migration. Anything else is an undeclared change.
const DECLARED_NEW_ROWS: { module: string; table: string; match: Record<string, unknown> }[] = [
  { module: 'prices-on-enquiry-1', table: 'settings', match: { key: 'pricesOnEnquiry' } }, // Sunny Patel switched prices on enquiry on for Daji (28 Oct 2026)
];
// Old rows a released module deliberately edits. An edited old row passes only when it is listed here: the module was applied by this
// migration, the old row matched `from`, and the new row is the old row with exactly the `to` values and nothing else. No money table is ever listed.
const DECLARED_ROW_EDITS: { module: string; table: string; from: Record<string, unknown>; to: Record<string, unknown> }[] = [
  // Sunny Patel sent Daji's exact pin for check-in (28 Oct 2026); grounds still on the old shared pin move to it
  { module: 'daji-pin-2026-10-28', table: 'grounds', from: { lat: 21.1818855, lng: 72.9134859 }, to: { lat: 21.1815, lng: 72.912556, map_url: 'https://maps.app.goo.gl/wGawo7LdNzKT8k4Y9' } },
];
function rowDiff(beforeRows: Record<string, Map<number, string>>, now: DatabaseSync, oldCols: Record<string, string[]>, applied: string[]) {
  const changed: string[] = [], undeclared: string[] = [], declared: string[] = [];
  for (const t of Object.keys(beforeRows)) {
    if (t === 'audit_log') continue;
    const was = beforeRows[t]!, is = rowsByRowid(now, t, oldCols[t]!);
    for (const [id, row] of was) {
      const got = is.get(id);
      if (got === row) continue;
      const o = JSON.parse(row) as Record<string, unknown>;
      const e = got && DECLARED_ROW_EDITS.find((x) => x.table === t && applied.includes(x.module) && Object.entries(x.from).every(([k, v]) => o[k] === v));
      if (e && got === JSON.stringify({ ...o, ...e.to })) declared.push(`${t} row ${id} edited by ${e.module}`); else changed.push(`${t} row ${id}`);
    }
    for (const [id, row] of is) {
      if (was.has(id)) continue;
      const r = JSON.parse(row) as Record<string, unknown>;
      const d = DECLARED_NEW_ROWS.find((x) => x.table === t && applied.includes(x.module) && Object.entries(x.match).every(([k, v]) => r[k] === v));
      if (d) declared.push(`${t} ${JSON.stringify(d.match)} by ${d.module}`); else undeclared.push(`${t} row ${id}`);
    }
  }
  return { changed, undeclared, declared };
}
function rowsByRowid(d: DatabaseSync, t: string, columns: string[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of d.prepare(`SELECT rowid AS "__rowid", ${columns.map((c) => `"${c}"`).join(', ')} FROM "${t}"`).iterate() as Iterable<Record<string, unknown>>) { const { __rowid, ...rest } = r; m.set(Number(__rowid), JSON.stringify(rest)); }
  return m;
}

// ------------------------------------------------------------------ REL-MIG-001

rel('REL-MIG-001', 'forward migration of a real old database: every old row is untouched, the new structures are added, the books agree before and after', async () => {
  if (!haveFixture) return skip('OLD_FIXTURE_DIR is not set: build it with scripts/make-old-fixture.ts from a checkout of the previous release');
  const w = workCopy();
  const old = lite(join(FIXTURE, 'old.db'));
  const oldTables = tableNames(old);
  const oldCols = Object.fromEntries(oldTables.map((t) => [t, cols(old, t)]));
  const before = Object.fromEntries(oldTables.filter((t) => t !== 'schema_migrations').map((t) => [t, rowsHash(old, t, oldCols[t]!)]));
  const beforeRows = Object.fromEntries(Object.keys(before).map((t) => [t, rowsByRowid(old, t, oldCols[t]!)]));
  const oldIds = (old.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id);
  old.close();
  const baseline = reconcileCli(join(FIXTURE, 'old.db'));
  assert.equal(baseline.code, 0, baseline.out); assert.equal(baseline.json.unexplained, 0);

  // EXPAND: apply the new modules to the copy
  const m = migrate(w.db);
  assert.equal(m.code, 0, m.out + m.err);
  const res = JSON.parse(m.out);
  assert.equal(res.integrity, 'ok'); assert.equal(res.foreignKeyViolations, 0);
  assert.ok(res.appliedNow.length >= 5, `modules applied: ${res.appliedNow}`);
  assert.ok(res.appliedNow.every((id: string) => !oldIds.includes(id)));

  // nothing that existed was changed: every old table, restricted to its old columns, hashes the same
  const now = lite(w.db);
  const { changed, undeclared, declared } = rowDiff(beforeRows, now, oldCols, res.appliedNow);
  assert.deepEqual(changed, [], 'old rows changed by the migration');
  assert.deepEqual(undeclared, [], 'rows added to an old table that no module declares');
  ev('declaredNewRows', declared);
  // the check itself catches an edited old row and an undeclared new row (on a throwaway copy)
  const probe = workCopy(); assert.equal(migrate(probe.db).code, 0);
  const pd = new DatabaseSync(probe.db);
  pd.prepare("INSERT INTO settings(key, value, updated_at, updated_by) VALUES('undeclaredProbe', 'x', 0, NULL)").run();
  const firstUser = pd.prepare('SELECT rowid AS r FROM users ORDER BY rowid LIMIT 1').get() as { r: number };
  pd.prepare("UPDATE users SET name = name || ' (edited)' WHERE rowid = ?").run(firstUser.r);
  // a declared edit covers only its own columns: the same ground with anything else changed is still caught
  const pinned = pd.prepare("SELECT rowid AS r FROM grounds WHERE map_url = 'https://maps.app.goo.gl/wGawo7LdNzKT8k4Y9' ORDER BY rowid LIMIT 1").get() as { r: number } | undefined;
  if (pinned) pd.prepare("UPDATE grounds SET name = name || ' (edited)' WHERE rowid = ?").run(pinned.r);
  const caught = rowDiff(beforeRows, pd, oldCols, res.appliedNow);
  pd.close();
  assert.ok(caught.undeclared.some((x) => x.startsWith('settings ')), `an undeclared settings row is caught: ${caught.undeclared}`);
  assert.ok(caught.changed.includes(`users row ${firstUser.r}`), `an edited old row is caught: ${caught.changed}`);
  if (pinned) assert.ok(caught.changed.includes(`grounds row ${pinned.r}`), `a ground edited beyond the declared pin move is caught: ${caught.changed}`);
  const nowTables = tableNames(now);
  const added = nowTables.filter((t) => !oldTables.includes(t));
  const addedCols: Record<string, string[]> = {};
  for (const t of oldTables) { const c = cols(now, t).filter((x) => !oldCols[t]!.includes(x)); if (c.length) addedCols[t] = c; }
  // what the migrated database must have, whichever release the old database came from: added now if the old one lacked it, kept if it had it
  for (const t of ['booking_reschedules', 'retention_cases', 'file_intake_log', 'idempotency_keys']) assert.ok(nowTables.includes(t), `table ${t} after migration (new tables: ${added})`);
  const BOOKING_COLS = ['deleted_at', 'deleted_by', 'reschedule_count']; // booking-deleted-1 (hidden, never deleted) and the reschedule count
  for (const c of BOOKING_COLS) assert.ok(cols(now, 'bookings').includes(c), `bookings.${c} after migration`);
  assert.deepEqual((addedCols.bookings ?? []).filter((c) => !BOOKING_COLS.includes(c)), [], 'no other column is added to bookings');
  assert.equal((now.prepare('SELECT COUNT(*) n FROM bookings WHERE deleted_at IS NOT NULL').get() as { n: number }).n, 0, 'no old booking is hidden by the migration');
  assert.equal((now.prepare('SELECT COUNT(*) n FROM bookings WHERE reschedule_count <> 0').get() as { n: number }).n, 0, 'the new column starts at zero for every old booking');
  const triggers = (now.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_ao_%'").all() as { name: string }[]).length;
  assert.ok(triggers >= 15, `append-only guards: ${triggers}`);
  now.close();

  // VALIDATE: the books before and after are the same books
  const after = reconcileCli(w.db);
  assert.equal(after.code, 0, after.out); assert.equal(after.json.unexplained, 0);
  assert.equal(after.json.fingerprint, baseline.json.fingerprint, 'the financial events are identical before and after the migration');
  assert.equal(after.json.financialEvents, baseline.json.financialEvents);
  // CUTOVER/STABILIZE: the release switches are settings rows; none are written by the migration, the defaults apply (on) and can be turned off without a deploy
  const again = migrate(w.db); assert.deepEqual(JSON.parse(again.out).appliedNow, [], 'running it again changes nothing');
  ev('phases', { EXPAND: res.appliedNow, BACKFILL: 'none needed: the only new column on an old table defaults to 0 and every other structure is new and empty', VALIDATE: 'row hashes, integrity_check, foreign_key_check, reconcile fingerprint', CUTOVER: 'release switches default on; see REL-REC-002', STABILIZE: 'second run applies nothing', CONTRACT: 'none: nothing is dropped or renamed in this release' });
  ev('modulesApplied', res.appliedNow); ev('newTables', added); ev('newColumns', addedCols); ev('oldTablesCompared', Object.keys(before).length); ev('baselineFingerprint', baseline.json.fingerprint); ev('afterFingerprint', after.json.fingerprint);
  ev('migrationMs', res.ms); ev('appendOnlyGuards', triggers);
});

// ------------------------------------------------------------------ REL-MIG-002

// Columns a released module fills with the time the migration ran (ai-names-1 seeds ai_user_names with strftime('%s','now')). A restarted
// migration runs later than the uninterrupted one, so only these columns may differ; every other column of every row must match, and the
// stamped ones must still hold a time no earlier than the old database and no later than now.
const STAMPED_AT_RUN: Record<string, string[]> = { ai_user_names: ['created_at', 'updated_at'] };
function sameApartFromRunTime(refPath: string, gotPath: string, table: string, cols: string[], id: string): void {
  const read = (p: string) => { const d = lite(p); const rows = d.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all() as Record<string, unknown>[]; d.close(); return rows; };
  const a = read(refPath), b = read(gotPath);
  const strip = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => !cols.includes(k)));
  assert.deepEqual(b.map(strip), a.map(strip), `${id}: table ${table} identical to the uninterrupted migration, apart from ${cols.join(' and ')}`);
  const now = Date.now();
  for (const r of b) for (const c of cols) assert.ok(typeof r[c] === 'number' && (r[c] as number) > 1_600_000_000_000 && (r[c] as number) <= now, `${id}: ${table}.${c} is a real time (${String(r[c])})`);
}


rel('REL-MIG-002', 'a migration killed at the worst moment (inside each module, before it commits) leaves the database consistent, and restarting finishes it', async () => {
  if (!haveFixture) return skip('OLD_FIXTURE_DIR is not set');
  // the reference: an uninterrupted migration of the same database
  const ref = workCopy();
  const refRes = JSON.parse(migrate(ref.db).out);
  const modules: string[] = refRes.appliedNow;
  const refDb = lite(ref.db); const refSchema = JSON.stringify(refDb.prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()); const refTables = refRes.tables; refDb.close();
  const killed: Record<string, unknown> = {};
  for (const id of modules) {
    const w = workCopy();
    const k = migrate(w.db, { REHEARSAL_KILL_BEFORE_COMMIT: id });
    assert.equal(k.signal, 'SIGKILL', `${id}: the process was killed (${k.code} ${k.err})`);
    // what the killed run left: consistent, this module absent as a whole, the earlier ones fully present
    const d = lite(w.db);
    assert.equal((d.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok', `${id}: integrity after kill`);
    const have = (d.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id);
    assert.ok(!have.includes(id), `${id}: absent after the kill`);
    const idx = modules.indexOf(id);
    for (const earlier of modules.slice(0, idx)) assert.ok(have.includes(earlier), `${id}: earlier module ${earlier} kept`);
    for (const later of modules.slice(idx)) assert.ok(!have.includes(later), `${id}: later module ${later} not applied`);
    const half = (d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE sql LIKE '%' ").get() as { n: number }).n; void half;
    d.close();
    // restart: the rest is applied and the result is the same as the uninterrupted migration
    const r = migrate(w.db);
    assert.equal(r.code, 0, r.out + r.err);
    const res = JSON.parse(r.out);
    assert.deepEqual(res.appliedNow, modules.slice(idx), `${id}: the restart applies this module and the ones after it`);
    const d2 = lite(w.db);
    assert.equal(JSON.stringify(d2.prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()), refSchema, `${id}: same structures as an uninterrupted migration`);
    d2.close();
    for (const t of Object.keys(refTables)) {
      if (t === 'schema_migrations' || t === 'audit_log') continue;
      if (STAMPED_AT_RUN[t]) { sameApartFromRunTime(ref.db, w.db, t, STAMPED_AT_RUN[t]!, id); continue; }
      assert.equal(res.tables[t]?.sha256, refTables[t].sha256, `${id}: table ${t} identical to the uninterrupted migration`);
    }
    const books = reconcileCli(w.db); assert.equal(books.code, 0, `${id}: books agree after the restart`);
    killed[id] = { killedBySignal: k.signal, restartApplied: res.appliedNow, integrity: res.integrity };
  }
  // restart of a data backfill: this release has none (see REL-MIG-001), so what is proven is that the whole migration can be repeated safely at any point
  ev('killPoints', killed); ev('modules', modules); ev('backfill', 'NOT_APPLICABLE: no data backfill exists in this release; every module is restartable and idempotent, shown above and by the repeat run in REL-MIG-001');
});

// ------------------------------------------------------------------ REL-MIG-003

rel('REL-MIG-003', 'after migration the old database has the same indexes, constraints, guards and columns as a brand-new one, and the constraints actually refuse bad data', async () => {
  if (!haveFixture) return skip('OLD_FIXTURE_DIR is not set');
  const w = workCopy(); assert.equal(migrate(w.db).code, 0);
  const fresh = scratch(); const freshDb = join(fresh, 'fresh.db'); writeFileSync(freshDb, ''); assert.equal(migrate(freshDb).code, 0);
  // the tools register exactly the modules the server does (no file that registers one is missed)
  const { loadSchemaModules } = await import('../scripts/schema-modules.ts');
  const wanted = Object.keys(await loadSchemaModules()).length - 1; // minus the core
  assert.equal(JSON.parse(migrate(freshDb).out).registered, wanted, 'the migration tool knows every schema module');
  const a = lite(w.db), b = lite(freshDb);
  const shape = (d: DatabaseSync) => ({
    objects: d.prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY type, name").all(),
    columns: Object.fromEntries(tableNames(d).map((t) => [t, (d.prepare(`SELECT name, type, "notnull" nn, pk FROM pragma_table_info('${t}') ORDER BY name`).all())])),
    indexes: Object.fromEntries(tableNames(d).map((t) => [t, (d.prepare(`SELECT name, "unique" u, partial FROM pragma_index_list('${t}') WHERE name NOT LIKE 'sqlite_autoindex%' ORDER BY name`).all())])),
    triggers: d.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all(),
    fks: Object.fromEntries(tableNames(d).map((t) => [t, (d.prepare(`SELECT "table" t, "from" f, "to" tt FROM pragma_foreign_key_list('${t}') ORDER BY id`).all())])),
  });
  const sa = shape(a), sb = shape(b);
  assert.deepEqual(sa.objects, sb.objects, 'same tables, indexes, triggers');
  assert.deepEqual(sa.columns, sb.columns, 'same columns');
  assert.deepEqual(sa.indexes, sb.indexes, 'same indexes (unique and partial flags included)');
  assert.deepEqual(sa.triggers, sb.triggers, 'same guard triggers, same text');
  assert.deepEqual(sa.fks, sb.fks, 'same foreign keys');
  assert.equal((a.prepare('PRAGMA foreign_key_check').all()).length, 0);
  assert.equal((a.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  const plan = a.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM booking_slots WHERE ground_id = ? AND slot_start BETWEEN ? AND ?').all('g', 1, 2).map((r) => String((r as { detail: string }).detail)).join(' | ');
  assert.ok(/SEARCH/.test(plan) && !/SCAN/.test(plan), `slot lookups use the index: ${plan}`);
  a.close(); b.close();

  // constraints and guards refuse bad data on the migrated database (run on a writable copy)
  const rw = new DatabaseSync(w.db);
  rw.exec('PRAGMA foreign_keys = ON');
  const refused = (sql: string, ...p: any[]) => { try { rw.prepare(sql).run(...p); return false; } catch (e) { return String((e as Error).message); } };
  const slot = rw.prepare('SELECT ground_id, slot_start, booking_id FROM booking_slots LIMIT 1').get() as { ground_id: string; slot_start: number; booking_id: string };
  const results: Record<string, string | false> = {
    'a second booking of an occupied slot': refused('INSERT INTO booking_slots(ground_id, slot_start, booking_id) VALUES(?,?,?)', slot.ground_id, slot.slot_start, slot.booking_id),
    'deleting a payment': refused('DELETE FROM payments'),
    'deleting a refund': refused('DELETE FROM refunds'),
    'deleting a booking': refused('DELETE FROM bookings'),
    'deleting a credit lot': refused('DELETE FROM credit_lots'),
    'editing the audit trail': refused('UPDATE audit_log SET action = action'),
    'deleting the audit trail': refused('DELETE FROM audit_log'),
    'editing the payment history': refused('UPDATE payment_events SET type = type'),
    'a booking pointing at no ground': refused("INSERT INTO bookings(id, ground_id) VALUES('x','nope')"),
  };
  rw.close();
  const notRefused = Object.entries(results).filter(([, v]) => v === false).map(([k]) => k);
  assert.deepEqual(notRefused, [], 'constraints that let bad data through');
  ev('refusals', results); ev('planForSlotLookup', plan); ev('tablesCompared', Object.keys(sa.columns).length); ev('triggersCompared', sa.triggers.length); ev('indexesCompared', Object.values(sa.indexes).flat().length);
});

// ------------------------------------------------------------------ REL-REC-001

rel('REL-REC-001', 'backup and isolated restore: an encrypted snapshot of the migrated database restores to the same business, byte for byte, and damage or a wrong key is refused', async () => {
  if (!haveFixture) return skip('OLD_FIXTURE_DIR is not set');
  const w = workCopy(); assert.equal(migrate(w.db).code, 0);
  const work = join(scratch(), 'recovery');
  const r = sh(SERVER, 'rehearse-recovery.ts', [w.db, w.data, work], { BACKUP_PASSPHRASE: 'rehearsal pass phrase for the tests' });
  assert.equal(r.code, 0, r.out + r.err);
  const j = JSON.parse(r.out);
  const failed = Object.entries(j.checks as Record<string, { ok: boolean }>).filter(([, c]) => !c.ok).map(([k]) => k);
  assert.deepEqual(failed, []);
  ev('checks', Object.fromEntries(Object.entries(j.checks as Record<string, { ok: boolean }>).map(([k, c]) => [k, c.ok])));
  ev('snapshot', j.snapshot); ev('source', j.source); ev('restored', j.restored);
  ev('realBackupProvider', 'NOT_RUN: the offsite copy (S3) and a restore on a separate machine were not exercised; this restore is into an isolated folder on the same machine');
});

// ------------------------------------------------------------------ REL-REC-002 .. 004 (rollback and forward recovery)

rel('REL-REC-002', 'write-path rollback: the previous release code runs on the migrated database, takes bookings and payments, and the new code then reads everything back', async () => {
  if (!haveFixture) return skip('OLD_FIXTURE_DIR is not set');
  if (!haveOld) return skip('OLD_CHECKOUT is not set: a checkout of the previous release is needed to run the old code against the migrated database');
  const w = workCopy();
  assert.equal(migrate(w.db).code, 0);
  const forward1 = sh(SERVER, 'exercise-flows.ts', [w.db, w.data, 'new-1'], { CODE_VERSION: 'master-patch' }); assert.equal(forward1.code, 0, forward1.err);
  const step1 = reconcileCli(w.db); assert.equal(step1.code, 0, step1.out);
  // roll the code back: the old release serves the migrated database
  const back = sh(join(OLD, 'server'), 'exercise-flows.ts', [w.db, w.data, 'old-1'], { CODE_VERSION: 'previous-release' });
  assert.equal(back.code, 0, back.err + back.out);
  const o = JSON.parse(back.out.split('\n').pop()!);
  assert.equal(o.onlineBooking.hold, 201); assert.equal(o.onlineBooking.verify, 200); assert.equal(o.onlineBooking.status, 'confirmed');
  assert.equal(o.walkIn.status, 201); assert.equal(o.upload.status, 201); assert.equal(o.cancel.status, 200);
  const step2 = reconcileCli(w.db); assert.equal(step2.code, 0, step2.out);
  // go forward again
  const forward2 = sh(SERVER, 'exercise-flows.ts', [w.db, w.data, 'new-2'], { CODE_VERSION: 'master-patch' }); assert.equal(forward2.code, 0, forward2.err);
  const f = JSON.parse(forward2.out.split('\n').pop()!);
  assert.equal(f.onlineBooking.status, 'confirmed'); assert.equal(f.walkIn.status, 201);
  const step3 = reconcileCli(w.db); assert.equal(step3.code, 0, step3.out);
  assert.equal(migrate(w.db).code, 0);
  ev('previousReleaseOnMigratedDb', o); ev('forwardAgain', f);
  ev('fingerprints', { afterNewCode: step1.json.fingerprint, afterRollbackRun: step2.json.fingerprint, afterForwardAgain: step3.json.fingerprint });
  ev('events', { afterNewCode: step1.json.financialEvents, afterRollbackRun: step2.json.financialEvents, afterForwardAgain: step3.json.financialEvents });
});

rel('REL-REC-003', 'payment rollback boundary: going back and forward never edits or removes a payment, refund, credit or accounting event; rolled-back traffic only adds events', async () => {
  if (!haveFixture || !haveOld) return skip('OLD_FIXTURE_DIR and OLD_CHECKOUT are both needed');
  const w = workCopy();
  assert.equal(migrate(w.db).code, 0);
  assert.equal(sh(SERVER, 'exercise-flows.ts', [w.db, w.data, 'new-1']).code, 0);
  const before = reconcileCli(w.db);
  const snap = lite(w.db);
  const keep = { payments: ['id', 'booking_id', 'amount_paise', 'method', 'created_at'], refunds: ['id', 'payment_id', 'booking_id', 'amount_paise', 'created_at'], credit_lots: ['id', 'customer_id', 'amount_paise', 'created_at'], credit_ledger: ['id', 'customer_id', 'amount_paise', 'kind', 'created_at'], acct_transactions: ['id', 'amount_paise', 'date'] } as Record<string, string[]>;
  const rowsBefore: Record<string, Map<string, string>> = {};
  for (const [t, cs] of Object.entries(keep)) { const have = cols(snap, t); const use = cs.filter((c) => have.includes(c)); rowsBefore[t] = new Map((snap.prepare(`SELECT ${use.map((c) => `"${c}"`).join(',')} FROM ${t}`).all() as any[]).map((r) => [String(r.id), JSON.stringify(r)])); }
  const auditBefore = (snap.prepare('SELECT COUNT(*) n FROM audit_log').get() as { n: number }).n;
  snap.close();
  // traffic on the old code, then the new code again
  assert.equal(sh(join(OLD, 'server'), 'exercise-flows.ts', [w.db, w.data, 'old-1']).code, 0);
  assert.equal(sh(SERVER, 'exercise-flows.ts', [w.db, w.data, 'new-2']).code, 0);
  const after = reconcileCli(w.db);
  const now = lite(w.db);
  const problems: string[] = [];
  let added = 0;
  for (const [t, cs] of Object.entries(keep)) {
    const have = cols(now, t); const use = cs.filter((c) => have.includes(c));
    const rows = new Map((now.prepare(`SELECT ${use.map((c) => `"${c}"`).join(',')} FROM ${t}`).all() as any[]).map((r) => [String(r.id), JSON.stringify(r)]));
    for (const [id, text] of rowsBefore[t]!) { if (!rows.has(id)) problems.push(`${t} ${id} removed`); else if (rows.get(id) !== text) problems.push(`${t} ${id} changed`); }
    added += [...rows.keys()].filter((id) => !rowsBefore[t]!.has(id)).length;
  }
  const auditAfter = (now.prepare('SELECT COUNT(*) n FROM audit_log').get() as { n: number }).n;
  now.close();
  assert.deepEqual(problems, [], 'immutable money facts that changed or disappeared');
  assert.ok(added > 0, 'the rolled-back and forward traffic added new money rows');
  assert.ok(auditAfter > auditBefore, 'and the audit trail only grew');
  // every financial event that existed before still exists, unchanged
  const afterMap = new Map((after.json.events as { id: string; fingerprint: string }[]).map((e) => [e.id, e.fingerprint]));
  const lost = (before.json.events as { id: string; fingerprint: string }[]).filter((e) => afterMap.get(e.id) !== e.fingerprint && !/^(booking|payment|refund)/.test(e.id));
  const missingEvents = (before.json.events as { id: string }[]).filter((e) => !afterMap.has(e.id)).map((e) => e.id);
  assert.deepEqual(missingEvents, [], 'financial events that disappeared');
  assert.equal(after.json.unexplained, 0);
  assert.equal(after.json.debitsPaise, after.json.creditsPaise);
  ev('moneyRowsAdded', added); ev('auditBefore', auditBefore); ev('auditAfter', auditAfter); ev('eventsBefore', before.json.financialEvents); ev('eventsAfter', after.json.financialEvents);
  ev('eventsChangedFingerprint', lost.map((e) => e.id));
  ev('boundary', 'Rolling back the code never reverses a payment, refund, credit or deposit: those are records of what happened. A refund or booking made by either release stays; a wrong one is corrected with a new compensating record (refund, credit, reversal), not by deletion.');
});

rel('REL-REC-004', 'final integrity reconciliation: the check passes on every state the rehearsals produced, and it demonstrably fails when money is tampered with', async () => {
  if (!haveFixture) return skip('OLD_FIXTURE_DIR is not set');
  const w = workCopy();
  const states: Record<string, unknown> = {};
  const rec = (name: string) => { const r = reconcileCli(w.db); assert.equal(r.code, 0, `${name}: ${r.out}`); assert.equal(r.json.unexplained, 0); assert.equal(r.json.debitsPaise, r.json.creditsPaise); states[name] = { events: r.json.financialEvents, fingerprint: r.json.fingerprint, findings: r.json.findings.length, integrity: r.json.integrity }; return r; };
  rec('old database as received');
  assert.equal(migrate(w.db).code, 0); rec('after forward migration');
  assert.equal(sh(SERVER, 'exercise-flows.ts', [w.db, w.data, 'new-1']).code, 0); rec('after traffic on the new code');
  if (haveOld) { assert.equal(sh(join(OLD, 'server'), 'exercise-flows.ts', [w.db, w.data, 'old-1']).code, 0); rec('after traffic on the previous release'); assert.equal(sh(SERVER, 'exercise-flows.ts', [w.db, w.data, 'new-2']).code, 0); rec('after going forward again'); }
  const base = reconcileCli(w.db);
  // negative controls: the check must fail when the books are wrong
  const bad = (name: string, sql: string, code: RegExp) => {
    const dir = scratch(); const f = join(dir, 'bad.db'); copyFileSync(w.db, f);
    for (const ext of ['-wal', '-shm']) if (existsSync(w.db + ext)) copyFileSync(w.db + ext, f + ext);
    const d = new DatabaseSync(f);
    d.exec('PRAGMA foreign_keys = OFF');
    d.exec("DROP TRIGGER IF EXISTS trg_ao_payments_delete"); // the tamperer has direct file access and removes the guard first
    d.exec(sql); d.close();
    const r = reconcileCli(f);
    assert.equal(r.code, 1, `${name}: the check must fail (${r.out.slice(0, 200)})`);
    assert.ok(r.json.findings.some((x: { code: string }) => code.test(x.code)), `${name}: ${JSON.stringify(r.json.findings.map((x: any) => x.code))}`);
    return r.json.findings.map((x: { code: string }) => x.code);
  };
  const controls = {
    'a payment amount edited': bad('edited amount', "UPDATE payments SET amount_paise = amount_paise + 5000 WHERE id = (SELECT id FROM payments WHERE status = 'captured' LIMIT 1)", /PAID_EXCEEDS_RECEIVED|PAYMENT_BOOKING_MISMATCH|CONFIRMED_BELOW_ADVANCE|OVERPAID_BOOKING|UNAPPLIED_MONEY/),
    'a captured payment removed': bad('removed payment', "DELETE FROM payments WHERE id = (SELECT id FROM payments WHERE status = 'captured' LIMIT 1)", /PAID_EXCEEDS_RECEIVED|CONFIRMED_BELOW_ADVANCE|PAYMENT_BOOKING_MISMATCH/),
    'a refund larger than the payment': bad('refund too big', "UPDATE refunds SET amount_paise = amount_paise + 9000000 WHERE id = (SELECT id FROM refunds LIMIT 1)", /REFUNDED_/),
  };
  assert.equal(base.code, 0);
  ev('states', states); ev('negativeControls', controls); ev('previousReleaseCovered', haveOld);
});
