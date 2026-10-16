import { randomBytes } from 'node:crypto';
import { many, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { audit, type Actor } from './audit.ts';
import { seal, unseal, vaultOn } from './vault.ts';
import { HttpError } from './errors.ts';
import { Validator } from './input.ts';
import type { Config } from './config.ts';
import { yodleeConfigured, yodleeLogin, yodleeToken } from './accounting/feed.ts';

// The software owner's Yodlee keys, kept in the database (secret ones encrypted when FIELD_KEY is set) so they can be changed from the
// screen without editing the server file. A value saved here wins over the same value in the server settings; clearing it falls back.
// The values are never sent back to the browser: only whether each one is set.

registerSchema('yodlee-settings-1', `
CREATE TABLE yodlee_settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
`);

type Y = Config['yodlee'];
const TEXT = ['apiUrl', 'fastLinkUrl', 'clientId', 'adminLoginName', 'issuer', 'keyId'] as const;
const SECRET = ['privateKeyPem', 'secret', 'webhookSecret'] as const;
type Field = (typeof TEXT)[number] | (typeof SECRET)[number];
const ALL: readonly Field[] = [...TEXT, ...SECRET];

const envDefaults = new WeakMap<Config, Y>();

function stored(): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of many<{ name: string; value: string }>('SELECT name, value FROM yodlee_settings')) { try { m.set(r.name, unseal(r.value)); } catch { /* a value that cannot be read is treated as not set */ } }
  return m;
}

/** Puts the saved values on top of the server-settings values. Called when the server starts and after every save. */
export function applyYodleeSettings(cfg: Config): void {
  if (!envDefaults.has(cfg)) envDefaults.set(cfg, { ...cfg.yodlee });
  const base = envDefaults.get(cfg)!, saved = stored();
  const next: Y = { ...base };
  for (const f of ALL) { const v = saved.get(f); if (v) (next as unknown as Record<string, string>)[f] = v; }
  cfg.yodlee = next;
}

export interface YodleeSettingsView {
  fields: Record<string, string>;
  secretsSet: Record<string, boolean>;
  configured: boolean;
  encrypted: boolean;
  webhookUrl: string | null;
  fromServerSettings: string[];
}

export function viewYodleeSettings(cfg: Config): YodleeSettingsView {
  const saved = stored(), y = cfg.yodlee;
  const fields: Record<string, string> = {}; for (const f of TEXT) fields[f] = y[f];
  const secretsSet: Record<string, boolean> = {}; for (const f of SECRET) secretsSet[f] = !!y[f];
  return { fields, secretsSet, configured: yodleeConfigured(cfg) && !!y.fastLinkUrl, encrypted: vaultOn(), fromServerSettings: ALL.filter((f) => !saved.has(f) && !!y[f]),
    webhookUrl: y.webhookSecret ? `${cfg.publicUrl.replace(/\/+$/, '')}/api/webhooks/yodlee?token=${encodeURIComponent(y.webhookSecret)}` : null };
}

const normPem = (s: string): string => {
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(s.replace(/\\n/g, '\n'));
  if (!m) throw new HttpError(400, 'VALIDATION', 'That is not a private key. It should start with -----BEGIN PRIVATE KEY----- and end with -----END PRIVATE KEY-----.');
  const body = m[2]!.replace(/\s+/g, '');
  return `-----BEGIN ${m[1]}-----\n${(body.match(/.{1,64}/g) ?? []).join('\n')}\n-----END ${m[1]}-----\n`;
};

/** Saves what was sent. A blank text value clears that setting (the server-settings value is used again); a blank secret is left alone, so
 * opening the screen and pressing Save never wipes a key. `clear` names secrets to remove on purpose. `generateWebhookSecret` makes a new one. */
export function saveYodleeSettings(cfg: Config, actor: Actor, body: unknown): YodleeSettingsView {
  const v = new Validator(body);
  const set = new Map<string, string>(); const del = new Set<string>();
  for (const f of TEXT) {
    if ((body as Record<string, unknown> | null)?.[f] === '') { del.add(f); continue; }
    const x = v.str(f, { max: 300 }); if (x === undefined) continue;
    if ((f === 'apiUrl' || f === 'fastLinkUrl') && !/^https:\/\/[\w.-]+(:\d+)?(\/[\w./%-]*)?$/i.test(x)) throw new HttpError(400, 'VALIDATION', `${f === 'apiUrl' ? 'The API address' : 'The FastLink address'} must start with https://`);
    set.set(f, f === 'apiUrl' ? x.replace(/\/+$/, '') : x);
  }
  const pem = v.str('privateKeyPem', { max: 8000 }); if (pem) set.set('privateKeyPem', normPem(pem));
  const sec = v.str('secret', { max: 300 }); if (sec) set.set('secret', sec);
  const clearList = Array.isArray((body as { clear?: unknown })?.clear) ? ((body as { clear: unknown[] }).clear.filter((x): x is string => typeof x === 'string' && (SECRET as readonly string[]).includes(x))) : [];
  const gen = (body as { generateWebhookSecret?: unknown })?.generateWebhookSecret === true;
  v.done();
  if (gen) set.set('webhookSecret', randomBytes(24).toString('base64url'));
  for (const c of clearList) del.add(c);
  const t = now();
  for (const [name, value] of set) run('INSERT INTO yodlee_settings(name, value, updated_at, updated_by) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', name, seal(value), t, actor.id);
  for (const name of del) run('DELETE FROM yodlee_settings WHERE name = ?', name);
  audit(actor, 'yodlee.settings', 'yodlee', null, { changed: [...set.keys(), ...[...del].map((d) => '-' + d)] });
  applyYodleeSettings(cfg);
  return viewYodleeSettings(cfg);
}

/** A check that changes nothing: signs a token with the saved key and asks Yodlee for one provider. A 2xx means the keys are accepted. */
export async function testYodlee(cfg: Config, f: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
  const y = cfg.yodlee;
  const missing = [!y.apiUrl && 'API address', !y.privateKeyPem && 'private key', !y.issuer && 'issuer', !y.fastLinkUrl && 'FastLink address'].filter(Boolean);
  if (missing.length) return { ok: false, message: `Not set up yet. Missing: ${missing.join(', ')}.` };
  try {
    const res = await f(`${y.apiUrl}/providers?top=1`, { headers: { 'Api-Version': '1.1', Authorization: `Bearer ${yodleeToken(cfg, yodleeLogin(cfg, 'test'))}`, ...(y.clientId ? { 'Cobrand-Name': y.clientId } : {}) }, signal: AbortSignal.timeout(15_000) });
    if (res.ok) return { ok: true, message: 'Yodlee accepted the keys.' };
    let detail = ''; try { const j = await res.json() as { errorMessage?: string; errorCode?: string }; detail = j.errorMessage || j.errorCode || ''; } catch { /* not JSON */ }
    return { ok: false, message: `Yodlee refused the keys (${res.status}${detail ? ': ' + detail : ''}). Check the issuer, the private key and the API address.` };
  } catch (e) { return { ok: false, message: `Could not reach Yodlee: ${(e as Error).message}`.slice(0, 200) }; }
}
