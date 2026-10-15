// A database created before the map link existed must upgrade in place, keep its grounds, and gain the column.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_CORE, openDb, closeDb, one, many } from '../src/db.ts';
import { groundRow, toGround } from '../src/grounds.ts';

test('an older database gets map_url on start-up, and its grounds are untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daji-migrate-'));
  const path = join(dir, 'old.db');
  try {
    // The database as the first release left it: core tables only, no schema_migrations entries, and one ground.
    const old = new DatabaseSync(path);
    old.exec(SCHEMA_CORE);
    old.prepare("INSERT INTO users(id, role, name, created_at, updated_at) VALUES('u1','owner','Old Owner',1,1)").run();
    old.prepare("INSERT INTO grounds(id, owner_id, name, slug, city, price_paise, created_at, updated_at) VALUES('g1','u1','Old Ground','old-ground','Surat',100000,1,1)").run();
    const before = (old.prepare("SELECT name FROM pragma_table_info('grounds')").all() as { name: string }[]).map((c) => c.name);
    assert.ok(!before.includes('map_url'), 'the old schema has no map_url');
    old.close();

    openDb(path);
    const cols = many<{ name: string }>("SELECT name FROM pragma_table_info('grounds')").map((c) => c.name);
    assert.ok(cols.includes('map_url'));
    const g = toGround(groundRow('g1')!);
    assert.equal(g.name, 'Old Ground');
    assert.equal(g.mapUrl, null);
    assert.equal(g.directionsUrl, null, 'no link and no coordinates: no directions');
    assert.ok(one('SELECT 1 FROM schema_migrations WHERE id = ?', 'grounds-map-url-1'));
    closeDb();

    // Starting again must not try to add the column a second time.
    openDb(path);
    assert.equal(many<{ id: string }>("SELECT id FROM schema_migrations WHERE id = 'grounds-map-url-1'").length, 1);
    closeDb();
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
});
