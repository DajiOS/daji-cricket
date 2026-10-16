import { createHash, createHmac } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { now } from './clock.ts';
import type { Config } from './config.ts';

// Copies a finished, encrypted snapshot to an S3 bucket so that losing the server's disk does not lose the backups. Plain (unencrypted) snapshots are never
// uploaded. The result is written next to the snapshot (offsite.json) and shown with the backup. Built to AWS's published SigV4 rules; no live bucket was
// available, so it is exercised only against a stand-in server.

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const hmac = (k: Buffer | string, s: string): Buffer => createHmac('sha256', k).update(s).digest();
const enc = (s: string): string => s.split('/').map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');

export function signS3Put(o: { host: string; path: string; body: Buffer; region: string; accessKey: string; secret: string; amzDate: string }): { headers: Record<string, string> } {
  const payload = sha(o.body), day = o.amzDate.slice(0, 8), scope = `${day}/${o.region}/s3/aws4_request`;
  const hdr: Record<string, string> = { host: o.host, 'x-amz-content-sha256': payload, 'x-amz-date': o.amzDate };
  const names = Object.keys(hdr).sort();
  const canon = ['PUT', enc(o.path), '', names.map((n) => `${n}:${hdr[n]}\n`).join(''), names.join(';'), payload].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + o.secret, day), o.region), 's3'), 'aws4_request');
  const sig = createHmac('sha256', key).update(['AWS4-HMAC-SHA256', o.amzDate, scope, sha(canon)].join('\n')).digest('hex');
  return { headers: { 'x-amz-content-sha256': payload, 'x-amz-date': o.amzDate, Authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` } };
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.isFile() && e.name !== 'offsite.json' ? [join(dir, e.name)] : []));
}

/** Uploads every file of one snapshot. `endpoint` is for tests. Never throws: the outcome is recorded in offsite.json. */
export async function uploadSnapshot(cfg: Config, name: string, f: typeof fetch = fetch, endpoint?: string): Promise<{ ok: boolean; message: string }> {
  const s = cfg.backup.s3, dir = join(cfg.backup.dir, name);
  const record = (ok: boolean, message: string) => { try { writeFileSync(join(dir, 'offsite.json'), JSON.stringify({ at: now(), ok, message })); } catch { /* the snapshot stands */ } return { ok, message }; };
  if (!s.bucket || !s.keyId || !s.secret) return record(false, 'Offsite copy is not set up.');
  if (!cfg.backup.passphrase) return record(false, 'Not uploaded: the backup is not encrypted (set BACKUP_PASSPHRASE).');
  try {
    const host = `${s.bucket}.s3.${s.region}.amazonaws.com`;
    let n = 0;
    for (const file of files(dir)) {
      const body = readFileSync(file), rel = relative(dir, file).split('\\').join('/');
      const path = `/${s.prefix}/${name}/${rel}`;
      const amzDate = new Date(now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const { headers } = signS3Put({ host, path, body, region: s.region, accessKey: s.keyId, secret: s.secret, amzDate });
      const res = await f(`${endpoint ?? `https://${host}`}${enc(path)}`, { method: 'PUT', headers: headers, body, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) return record(false, `The bucket answered ${res.status} for ${rel}. Check the key and the bucket name.`);
      n++;
    }
    return record(true, `${n} files copied to ${s.bucket}.`);
  } catch (e) { return record(false, (e as Error).message); }
}
