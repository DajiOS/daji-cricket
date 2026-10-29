import { statfsSync } from 'node:fs';
import { freemem, totalmem, loadavg, uptime as osUptime } from 'node:os';
import type { Config } from './config.ts';
import { one, run, registerSchema } from './db.ts';
import { HttpError } from './errors.ts';
import { now } from './clock.ts';
import { audit } from './audit.ts';
import type { UserRow } from './auth.ts';
import { lastOffsiteCopy, listBackups } from './backup.ts';

// Settings › Server: how the server is doing right now, and the owner's way in to it (the ground owner and the software owner, never staff). The SSH button only opens Amazon's own
// browser SSH page for the Lightsail instance; the owner signs in to AWS there. No shell runs inside Daji and no AWS keys are kept here,
// so a stolen desk login can never reach the server. The AI coding console button is the same: a link to where the code is worked on.

registerSchema('server-console-1', `CREATE TABLE server_console (id INTEGER PRIMARY KEY CHECK (id = 1), instance TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT 'ap-south-1', coding_url TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, updated_by TEXT);`);

/** Lightsail regions (https://docs.aws.amazon.com/general/latest/gr/lightsail.html). Mumbai is where the Daji server runs. */
export const LIGHTSAIL_REGIONS: [string, string][] = [
  ['ap-south-1', 'Mumbai'], ['ap-southeast-1', 'Singapore'], ['ap-southeast-2', 'Sydney'], ['ap-southeast-3', 'Jakarta'], ['ap-northeast-1', 'Tokyo'], ['ap-northeast-2', 'Seoul'],
  ['ca-central-1', 'Canada (Central)'], ['eu-central-1', 'Frankfurt'], ['eu-north-1', 'Stockholm'], ['eu-west-1', 'Ireland'], ['eu-west-2', 'London'], ['eu-west-3', 'Paris'],
  ['us-east-1', 'N. Virginia'], ['us-east-2', 'Ohio'], ['us-west-2', 'Oregon'],
];
/** Where the code is worked on with AI when nothing else is saved. */
export const DEFAULT_CODING_URL = 'https://claude.ai/code';
const INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const URL_MAX = 300;

export interface ServerConsole {
  instance: string; region: string; regionName: string; codingUrl: string;
  /** Amazon's browser SSH page for the instance (null until the instance name is saved). */
  sshUrl: string | null;
  /** The instance's page in the Lightsail console (snapshots, networking, metrics). */
  instanceUrl: string | null;
  lightsailHome: string;
  updatedAt: number | null;
  regions: [string, string][];
}

interface Row { instance: string; region: string; coding_url: string; updated_at: number }

export const sshLink = (region: string, instance: string): string => `https://lightsail.aws.amazon.com/ls/remote/${region}/instances/${encodeURIComponent(instance)}/terminal?protocol=ssh`;
export const instanceLink = (region: string, instance: string): string => `https://lightsail.aws.amazon.com/ls/webapp/${region}/instances/${encodeURIComponent(instance)}/connect`;

export function serverConsole(): ServerConsole {
  const r = one<Row>('SELECT instance, region, coding_url, updated_at FROM server_console WHERE id = 1');
  const instance = r?.instance ?? '', region = r?.region || 'ap-south-1';
  return {
    instance, region, regionName: LIGHTSAIL_REGIONS.find(([k]) => k === region)?.[1] ?? region, codingUrl: r?.coding_url || DEFAULT_CODING_URL,
    sshUrl: instance ? sshLink(region, instance) : null, instanceUrl: instance ? instanceLink(region, instance) : null,
    lightsailHome: `https://lightsail.aws.amazon.com/ls/webapp/home/instances`, updatedAt: r?.updated_at ?? null, regions: LIGHTSAIL_REGIONS,
  };
}

export function saveServerConsole(u: UserRow, body: unknown): ServerConsole {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const fields: { field: string; message: string }[] = [];
  const cur = serverConsole();
  let instance = cur.instance, region = cur.region, codingUrl = cur.codingUrl;
  if ('instance' in b) {
    const v = typeof b.instance === 'string' ? b.instance.trim() : null;
    if (v === null || (v !== '' && !INSTANCE_RE.test(v))) fields.push({ field: 'instance', message: 'The instance name as Lightsail shows it: letters, numbers, dots, dashes and underscores, starting with a letter or number' });
    else instance = v;
  }
  if ('region' in b) {
    if (typeof b.region !== 'string' || !LIGHTSAIL_REGIONS.some(([k]) => k === b.region)) fields.push({ field: 'region', message: 'Pick a Lightsail region from the list' });
    else region = b.region;
  }
  if ('codingUrl' in b) {
    const v = typeof b.codingUrl === 'string' ? b.codingUrl.trim() : null;
    if (v === null || (v !== '' && (v.length > URL_MAX || !/^https:\/\/[^\s"'<>]+$/.test(v)))) fields.push({ field: 'codingUrl', message: `A link starting with https:// (up to ${URL_MAX} characters), or empty for ${DEFAULT_CODING_URL}` });
    else codingUrl = v || DEFAULT_CODING_URL;
  }
  if (fields.length) throw new HttpError(400, 'VALIDATION_FAILED', fields[0]!.message, { fields });
  run(`INSERT INTO server_console(id, instance, region, coding_url, updated_at, updated_by) VALUES (1,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET instance = excluded.instance, region = excluded.region, coding_url = excluded.coding_url, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  instance, region, codingUrl === DEFAULT_CODING_URL ? '' : codingUrl, now(), u.id);
  audit({ id: u.id, role: u.role }, 'server_console.update', 'server_console', null, { instance, region, codingUrl });
  return serverConsole();
}

/** Records that the software owner opened the SSH page or the coding console from the desk (the session itself happens at Amazon or Anthropic). */
export function noteServerOpen(u: UserRow, what: unknown): { ok: true } {
  if (what !== 'ssh' && what !== 'coding' && what !== 'lightsail') throw new HttpError(400, 'VALIDATION_FAILED', 'Say which was opened: ssh, coding or lightsail', { fields: [{ field: 'what', message: 'ssh, coding or lightsail' }] });
  audit({ id: u.id, role: u.role }, `server_console.open_${what}`, 'server_console', null, {});
  return { ok: true };
}

export interface ServerStatus {
  at: number; ok: boolean;
  database: 'ok' | 'error';
  env: string; demo: boolean;
  /** The code version the server was started with, or null when the deploy does not record it. */
  version: string | null;
  node: string;
  startedAt: number; upSeconds: number; machineUpSeconds: number;
  memory: { usedMb: number; totalMb: number; serverMb: number; usedPercent: number };
  disk: { freeGb: number; totalGb: number; usedPercent: number } | null;
  load: number[];
  backups: { enabled: boolean; count: number; lastAt: number | null; offsiteAt: number | null };
  warnings: string[];
}

const STARTED = Date.now();
const mb = (n: number) => Math.round(n / 1048576);
const gb = (n: number) => Math.round((n / 1073741824) * 10) / 10;

/** A live look at the server: never a secret, only what an owner needs to tell whether it is healthy. */
export function serverStatus(cfg: Config): ServerStatus {
  let database: 'ok' | 'error' = 'ok';
  try { one('SELECT 1 AS n'); } catch { database = 'error'; }
  const total = totalmem(), free = freemem();
  let disk: ServerStatus['disk'] = null;
  try { const s = statfsSync(cfg.dataDir); const t = s.blocks * s.bsize, f = s.bavail * s.bsize; disk = { freeGb: gb(f), totalGb: gb(t), usedPercent: t ? Math.round(((t - f) / t) * 100) : 0 }; } catch { disk = null; }
  let backups: ServerStatus['backups'] = { enabled: cfg.backup.enabled, count: 0, lastAt: null, offsiteAt: null };
  try { const list = listBackups(cfg); backups = { enabled: cfg.backup.enabled, count: list.length, lastAt: list.reduce<number | null>((m, b) => (m == null || b.createdAt > m ? b.createdAt : m), null), offsiteAt: lastOffsiteCopy(cfg)?.at ?? null }; } catch { /* shown as none */ }
  const memory = { usedMb: mb(total - free), totalMb: mb(total), serverMb: mb(process.memoryUsage().rss), usedPercent: total ? Math.round(((total - free) / total) * 100) : 0 };
  const warnings: string[] = [];
  if (database !== 'ok') warnings.push('The database could not be read. Bookings cannot be served until it is fixed.');
  if (cfg.demoMode) warnings.push('Demo mode is on: demo logins work and online payments are fake.');
  if (disk && disk.usedPercent >= 90) warnings.push(`The disk is ${disk.usedPercent}% full (${disk.freeGb} GB free).`);
  if (memory.usedPercent >= 90) warnings.push(`Memory is ${memory.usedPercent}% used.`);
  if (backups.enabled && (backups.lastAt == null || now() - backups.lastAt > 36 * 3600_000)) warnings.push('No backup in the last 36 hours.');
  if (!backups.enabled) warnings.push('Daily backups are switched off on this server.');
  const t = now();
  return {
    at: t, ok: database === 'ok', database, env: cfg.appEnv, demo: cfg.demoMode, version: process.env.APP_VERSION?.trim() || null, node: process.version,
    startedAt: STARTED, upSeconds: Math.round((Date.now() - STARTED) / 1000), machineUpSeconds: Math.round(osUptime()),
    memory, disk, load: loadavg().map((n) => Math.round(n * 100) / 100), backups, warnings,
  };
}
