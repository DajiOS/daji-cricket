import { createHash } from 'node:crypto';
import { one, run, registerSchema, tx } from './db.ts';
import { now } from './clock.ts';
import { HttpError } from './errors.ts';

// Retries must not repeat an action. A client that sends an `Idempotency-Key` header on a money or booking command gets the first
// answer back on every retry, with the same effect applied once. The key belongs to the signed-in person (another person's identical key
// is a different action), is tied to the exact request (the same key with a different request is refused, never run), and is kept 24 hours.
// A request that fails leaves no trace, so retrying after an error runs it again. Dropped answers (lost network) are the case this is for.

registerSchema('idempotency-1', `
CREATE TABLE idempotency_keys (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('in_progress','done')),
  status INTEGER,
  response TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (scope, key)
);
CREATE INDEX ix_idempotency_created ON idempotency_keys(created_at);
`);

export const IDEMPOTENCY_TTL_MS = 24 * 3600_000;
/** A request that never finished (the server stopped mid-way) is taken over after this long. Its database changes were rolled back with it. */
export const IDEMPOTENCY_STALE_MS = 5 * 60_000;
const KEY_RE = /^[A-Za-z0-9_\-:.]{8,128}$/;

export function parseIdempotencyKey(header: string | string[] | undefined): string | null {
  const v = Array.isArray(header) ? header[0] : header;
  if (v === undefined || v === '') return null;
  if (!KEY_RE.test(v)) throw new HttpError(400, 'IDEMPOTENCY_KEY_INVALID', 'The Idempotency-Key must be 8 to 128 letters, digits, "-", "_", ":" or "."');
  return v;
}

/** The same request written two ways (key order, spacing) is the same request. */
export function requestHash(method: string, pathAndQuery: string, raw: Buffer): string {
  let body: string;
  try { body = JSON.stringify(canonical(JSON.parse(raw.toString('utf8')))); } catch { body = raw.toString('base64'); }
  return createHash('sha256').update(`${method}\n${pathAndQuery}\n${body}`).digest('hex');
}
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canonical(x)]));
  return v;
}

export type IdemStart = { kind: 'run' } | { kind: 'replay'; status: number; body: string };

interface Row { request_hash: string; state: 'in_progress' | 'done'; status: number | null; response: string | null; created_at: number }

export function idemBegin(scope: string, key: string, method: string, path: string, hash: string): IdemStart {
  return tx(() => {
    const t = now();
    run('DELETE FROM idempotency_keys WHERE created_at < ?', t - IDEMPOTENCY_TTL_MS);
    const row = one<Row>('SELECT request_hash, state, status, response, created_at FROM idempotency_keys WHERE scope = ? AND key = ?', scope, key);
    if (!row) {
      run("INSERT INTO idempotency_keys(scope, key, method, path, request_hash, state, created_at) VALUES(?,?,?,?,?,'in_progress',?)", scope, key, method, path, hash, t);
      return { kind: 'run' } as const;
    }
    if (row.request_hash !== hash) throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request. Use a new key for a new action.');
    if (row.state === 'done') return { kind: 'replay', status: row.status!, body: row.response! } as const;
    if (t - row.created_at < IDEMPOTENCY_STALE_MS) throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'The first attempt of this request is still being processed. Try again in a moment.');
    run('UPDATE idempotency_keys SET created_at = ? WHERE scope = ? AND key = ?', t, scope, key); // taken over from a request that never finished
    return { kind: 'run' } as const;
  });
}

export function idemFinish(scope: string, key: string, status: number, body: string): void {
  run("UPDATE idempotency_keys SET state = 'done', status = ?, response = ?, completed_at = ? WHERE scope = ? AND key = ?", status, body, now(), scope, key);
}

/** The request failed: forget the key so the same retry runs again. */
export function idemAbandon(scope: string, key: string): void {
  run("DELETE FROM idempotency_keys WHERE scope = ? AND key = ? AND state = 'in_progress'", scope, key);
}
