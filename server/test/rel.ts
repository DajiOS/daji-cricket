// Release-gate (P0) tests. `rel('REL-BOOK-003', 'title', fn)` is an ordinary node:test case whose name starts with the test id, and it records what it saw:
// when EVIDENCE_DIR is set, every case writes one JSON record (id, result, facts it noted with ev(), versions, environment) that the tracker builder
// (scripts/build-p0-tracker.ts) turns into the P0 execution tracker. Nothing is written when the variable is not set, so ordinary runs are unchanged.
import { test, type TestContext } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dbIsOpen, many, registeredSchemaIds } from '../src/db.ts';

interface Rec { id: string; title: string; result: 'PASS' | 'FAIL' | 'SKIPPED'; error?: string; facts: Record<string, unknown>; startedAt: string; durationMs: number; versions: Record<string, unknown>; environment: Record<string, unknown>; file: string }

let current: { id: string; facts: Record<string, unknown> } | null = null;

/** Note a fact the case observed (a row, a response, a count). It lands in the evidence record. */
export function ev(key: string, value: unknown): void {
  if (current) current.facts[key] = value;
}

function versions(): Record<string, unknown> {
  let applied: string[] = [];
  try { if (dbIsOpen()) applied = many<{ id: string }>('SELECT id FROM schema_migrations ORDER BY applied_at, rowid').map((r) => r.id); } catch { /* no table yet */ }
  const ids = registeredSchemaIds();
  return {
    application: process.env.APP_VERSION ?? 'unversioned-working-tree',
    migrationVersion: ids[ids.length - 1] ?? null,
    schemaModules: ids.length,
    databaseVersion: applied.length ? `schema_migrations=${applied.length}, last=${applied[applied.length - 1]}` : 'in-memory database created from the schema modules',
  };
}

export function rel(id: string, title: string, fn: (t: TestContext) => unknown | Promise<unknown>): void {
  // the test file is read from the stack here, where rel() is called, because inside the async case the stack no longer shows it
  const callerFile = new Error().stack?.split('\n').find((l) => /test[\\/][^:)\\/]+\.test\.ts/.test(l))?.replace(/^.*test[\\/]([^:)\\/]+\.test\.ts).*$/, 'test/$1') ?? '';
  test(`${id}: ${title}`, async (t) => {
    const started = Date.now();
    current = { id, facts: {} };
    const rec: Rec = {
      id, title, result: 'PASS', facts: current.facts, startedAt: new Date(started).toISOString(), durationMs: 0, versions: {},
      environment: { name: 'automated test harness', node: process.version, platform: process.platform, database: 'SQLite (node:sqlite) in-memory unless a case says otherwise', paymentProvider: 'demo gateway (no real provider)', clock: 'frozen test clock' },
      file: callerFile,
    };
    try {
      await fn(t);
      // a case that could not run here (a missing fixture, a tool that is not installed) says so with ev('skipped', why): that is recorded as SKIPPED, never as a pass
      if (typeof current.facts.skipped === 'string') { rec.result = 'SKIPPED'; t.skip(current.facts.skipped); }
    } catch (e) {
      rec.result = 'FAIL';
      rec.error = String((e as Error)?.message ?? e).slice(0, 2000);
      throw e;
    } finally {
      rec.durationMs = Date.now() - started;
      rec.versions = versions();
      const dir = process.env.EVIDENCE_DIR;
      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${id}.${randomBytes(4).toString('hex')}.json`), JSON.stringify(rec, null, 2));
      }
      current = null;
    }
  });
}
