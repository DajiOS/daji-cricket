// A schema module runs once per database and is never run again, so an edit to a released module only reaches
// databases created afterwards: the live database and a fresh one quietly drift apart. schema.lock.json holds the
// checksum of every released module; this test fails when one changes, disappears, or a new one is not locked yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadSchemaModules, compareLock, LOCK_PATH } from '../scripts/schema-modules.ts';
import { openDb, closeDb, schemaDrift, schemaChecksum, one } from '../src/db.ts';

test('no released schema module was edited or removed, and every new one is in the lock', async () => {
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  const { added, changed, removed } = compareLock(lock, await loadSchemaModules());
  assert.deepEqual(changed, [], `These schema modules changed after release, so live databases will never get the change: ${changed.join(', ')}. Put the change in a new registerSchema('<id>-2', ...) instead.`);
  assert.deepEqual(removed, [], `These schema modules were removed but live databases still have them: ${removed.join(', ')}.`);
  assert.deepEqual(added, [], `New schema modules are not in schema.lock.json yet: ${added.join(', ')}. Run: cd server && node scripts/schema-lock.ts`);
});

test('the database remembers each module\'s checksum and reports one that changed after it was applied', async () => {
  await loadSchemaModules();
  const dir = mkdtempSync(join(tmpdir(), 'daji-drift-'));
  const path = join(dir, 'drift.db');
  try {
    openDb(path);
    const row = one<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE id = 'grounds-map-url-1'");
    assert.equal(row?.checksum, schemaChecksum('ALTER TABLE grounds ADD COLUMN map_url TEXT;'));
    assert.deepEqual(schemaDrift(), []);
    closeDb();

    // as if the module had been edited after this database applied it
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE schema_migrations SET checksum = 'old' WHERE id = 'grounds-map-url-1'").run();
    raw.close();
    const warn = console.warn; const said: string[] = [];
    console.warn = (m: string) => { said.push(m); };
    try { openDb(path); } finally { console.warn = warn; }
    assert.deepEqual(schemaDrift(), ['grounds-map-url-1']);
    assert.ok(said.some((m) => /grounds-map-url-1/.test(m)));
    closeDb();
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a database from before checksums gets them filled in, with no drift reported', async () => {
  await loadSchemaModules();
  const dir = mkdtempSync(join(tmpdir(), 'daji-drift-'));
  const path = join(dir, 'old.db');
  try {
    openDb(path); closeDb();
    const raw = new DatabaseSync(path);
    raw.exec('CREATE TABLE sm2 AS SELECT id, applied_at FROM schema_migrations; DROP TABLE schema_migrations; ALTER TABLE sm2 RENAME TO schema_migrations;');
    raw.close();
    openDb(path);
    assert.deepEqual(schemaDrift(), []);
    assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM schema_migrations WHERE checksum IS NULL')?.n, 0);
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
});
