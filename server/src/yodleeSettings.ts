import { randomBytes } from 'node:crypto';
import { many, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { audit, type Actor } from './audit.ts';
import { seal, unseal, vaultOn } from './vault.ts';
import { HttpError } from './errors.ts';
import { Validator } from './input.ts';
import type { Config } from './config.ts';
import { yFetch, yodleeConfigured } from './accounting/feed.ts';

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
const TEXT = ['apiUrl', 'fastLinkUrl', 'clientId', 'adminLoginName', 'issuer', 'keyId', 'configName', 'userLogin'] as const;
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

/** A check that changes nothing: signs in the way the saved keys say, and asks Yodlee for one provider. A 2xx means the keys are accepted. */
export async function testYodlee(cfg: Config, f: typeof fetch = fetch): Promise<{ ok: boolean; message: string; ms?: number }> {
  const y = cfg.yodlee, started = Date.now();
  const ccKeys = !!(y.clientId && y.secret), pkKeys = !!(y.privateKeyPem && y.issuer);
  const missing = [!y.apiUrl && 'API address', !ccKeys && !pkKeys && 'client ID and secret (or issuer and private key)', !y.fastLinkUrl && 'FastLink address'].filter(Boolean);
  if (missing.length) return { ok: false, message: `Not set up yet. Missing: ${missing.join(', ')}.` };
  try {
    const res = await yFetch(cfg, y.userLogin || y.adminLoginName || 'daji', '/providers?top=1', {}, f);
    const ms = Date.now() - started;
    if (res.ok) return { ok: true, ms, message: `Yodlee accepted the keys (${ccKeys ? 'client ID and secret' : 'private key'}, ${ms} ms).` };
    let detail = ''; try { const j = await res.json() as { errorMessage?: string; errorCode?: string }; detail = j.errorMessage || j.errorCode || ''; } catch { /* not JSON */ }
    return { ok: false, ms, message: `Yodlee refused the keys (${res.status}${detail ? ': ' + detail : ''}). Check the keys and the API address.` };
  } catch (e) { return { ok: false, message: `Could not use Yodlee: ${(e as Error).message}`.slice(0, 200) }; }
}

export const WEBHOOK_EVENTS = ['REFRESH', 'DATA_UPDATES', 'AUTO_REFRESH_UPDATES'] as const;

/** Tells Yodlee to call this server's webhook address for each event. A subscription that already exists is updated instead. */
export async function subscribeYodleeWebhooks(cfg: Config, f: typeof fetch = fetch): Promise<{ ok: boolean; message: string; events: { event: string; ok: boolean; message: string }[] }> {
  const view = viewYodleeSettings(cfg);
  if (!yodleeConfigured(cfg)) return { ok: false, message: 'Set up the Yodlee keys first.', events: [] };
  if (!view.webhookUrl) return { ok: false, message: 'Make the webhook address first.', events: [] };
  if (!/^https:\/\//i.test(view.webhookUrl)) return { ok: false, message: 'Yodlee only calls https addresses. Set the public address of this server (PUBLIC_URL) to your https domain first.', events: [] };
  const events: { event: string; ok: boolean; message: string }[] = [];
  const body = JSON.stringify({ event: { callbackUrl: view.webhookUrl } });
  for (const ev of WEBHOOK_EVENTS) {
    try {
      const path = `/configs/notifications/events/${ev}`, login = cfg.yodlee.adminLoginName || 'daji';
      let res = await yFetch(cfg, login, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, f);
      if (!res.ok && res.status !== 201) res = await yFetch(cfg, login, path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }, f);
      let detail = ''; if (!res.ok) { try { const j = await res.json() as { errorMessage?: string; errorCode?: string }; detail = j.errorMessage || j.errorCode || ''; } catch { /* not JSON */ } }
      events.push({ event: ev, ok: res.ok, message: res.ok ? 'Subscribed' : `Yodlee said ${res.status}${detail ? ': ' + detail : ''}. Webhooks are only enabled after the Yodlee contract is signed.` });
    } catch (e) { events.push({ event: ev, ok: false, message: String((e as Error).message).slice(0, 160) }); }
  }
  const ok = events.every((e) => e.ok);
  return { ok, message: ok ? 'Instant updates are on: Yodlee will call this server when a bank has new data.' : events.find((e) => !e.ok)!.message, events };
}
