// A database from before names could be chosen: the team saw "Guppi", so that becomes their own pick; customers keep the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_CORE, openDb, closeDb, many } from '../src/db.ts';
import '../src/aiNames.ts';

test('an existing database keeps "Guppi" for the people who already saw it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daji-ainame-'));
  const path = join(dir, 'old.db');
  try {
    const old = new DatabaseSync(path);
    old.exec(SCHEMA_CORE);
    old.prepare("INSERT INTO users(id, role, name, created_at, updated_at) VALUES('u1','owner','Old Owner',1,1)").run();
    old.prepare("INSERT INTO users(id, role, name, owner_id, created_at, updated_at) VALUES('u2','staff','Old Staff','u1',1,1)").run();
    old.prepare("INSERT INTO users(id, role, name, created_at, updated_at) VALUES('u3','customer','Old Customer',1,1)").run();
    old.close();
    openDb(path);
    const rows = many<{ user_id: string; name: string }>('SELECT user_id, name FROM ai_user_names ORDER BY user_id');
    assert.deepEqual(rows.map((r) => [r.user_id, r.name]), [['u1', 'Guppi'], ['u2', 'Guppi']]);
    closeDb();
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
});
