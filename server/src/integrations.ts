import type { Config } from './config.ts';
import { many, run, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { audit } from './audit.ts';
import type { UserRow } from './auth.ts';
import { checkLogin, mailOptions } from './gmail.ts';

/**
 * Every outside service the platform talks to is described once here: which settings it needs (by name, never their values),
 * whether they are all present, and, where there is a safe way to check, a live test. A future service is one more registerIntegration() call
 * (plus its settings in config.ts); it then shows up in the software owner's Services page with its status and a Test button.
 */
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
export interface TestResult { ok: boolean; message: string }
export interface Integration {
  id: string; name: string; what: string; setup: string;
  /** Names of the settings that must all be present. */
  env: string[];
  have: (cfg: Config) => Record<string, boolean>;
  /** A live check that costs nothing and changes nothing. Leave out when there is no such thing. */
  test?: (cfg: Config, f: Fetch) => Promise<TestResult>;
  /** Set when the service is not built into the platform yet. */
  notBuilt?: string;
}
export interface IntegrationStatus { id: string; name: string; what: string; setup: string; status: 'ready' | 'partial' | 'missing' | 'not_built'; missing: string[]; canTest: boolean; lastTest: { ok: boolean; message: string; at: number } | null; note: string | null }

registerSchema('integrations-1', `CREATE TABLE integration_tests (integration_id TEXT PRIMARY KEY, ok INTEGER NOT NULL, message TEXT NOT NULL, at INTEGER NOT NULL);`);

const REGISTRY: Integration[] = [];
export function registerIntegration(i: Integration): void { const at = REGISTRY.findIndex((x) => x.id === i.id); if (at >= 0) REGISTRY[at] = i; else REGISTRY.push(i); }
export const integrationIds = (): string[] => REGISTRY.map((i) => i.id);

const snip = (t: string): string => { try { const j = JSON.parse(t); return String(j?.error?.message ?? j?.error?.description ?? j?.message ?? '').slice(0, 160); } catch { return t.slice(0, 120); } };

registerIntegration({
  id: 'whatsapp', name: 'WhatsApp (Meta Cloud API)', what: 'Sign-in codes by WhatsApp, the first choice.',
  setup: 'Create a Meta Business account, add a phone number, get an approved Authentication template named daji_otp, then put the token and phone number ID in the server settings.',
  env: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID'],
  have: (c) => ({ WHATSAPP_TOKEN: !!c.whatsapp.token, WHATSAPP_PHONE_ID: !!c.whatsapp.phoneId }),
  test: async (c, f) => {
    const r = await f(`${c.whatsapp.apiUrl}/${encodeURIComponent(c.whatsapp.phoneId)}?fields=display_phone_number,verified_name`, { method: 'GET', headers: { Authorization: `Bearer ${c.whatsapp.token}` }, signal: AbortSignal.timeout(10_000) });
    const t = await r.text();
    if (!r.ok) return { ok: false, message: `Meta refused the token or phone number ID (${r.status}). ${snip(t)}`.trim() };
    let name = ''; try { const j = JSON.parse(t); name = `${j.verified_name ?? ''} ${j.display_phone_number ?? ''}`.trim(); } catch { /* ignore */ }
    return { ok: true, message: `Connected${name ? ' as ' + name : ''}.` };
  },
});
registerIntegration({
  id: 'msg91', name: 'MSG91', what: 'Text message sign-in codes, the backup for WhatsApp.',
  setup: 'Create an MSG91 account, register the DLT template for the code message, then put the Auth Key and Template ID in the server settings.',
  env: ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID'],
  have: (c) => ({ MSG91_AUTH_KEY: !!c.msg91.authKey, MSG91_TEMPLATE_ID: !!c.msg91.templateId }),
  // MSG91 has no free "check my key" call, and a real test costs a message, so only the settings are checked here.
});
registerIntegration({
  id: 'razorpay', name: 'Razorpay', what: 'Online card and UPI payments, and refunds.',
  setup: 'Create a Razorpay account (test mode first), copy the Key ID and Key Secret, and add a webhook to /api/webhooks/razorpay with the same secret.',
  env: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
  have: (c) => ({ RAZORPAY_KEY_ID: !!c.razorpay.keyId, RAZORPAY_KEY_SECRET: !!c.razorpay.keySecret, RAZORPAY_WEBHOOK_SECRET: !!c.razorpay.webhookSecret }),
  test: async (c, f) => {
    const auth = 'Basic ' + Buffer.from(`${c.razorpay.keyId}:${c.razorpay.keySecret}`).toString('base64');
    const r = await f(`${c.razorpay.apiUrl}/v1/orders?count=1`, { method: 'GET', headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { ok: false, message: `Razorpay refused the keys (${r.status}). ${snip(await r.text())}`.trim() };
    return { ok: true, message: `Keys accepted (${c.razorpay.keyId.startsWith('rzp_live') ? 'live' : 'test'} mode).` };
  },
});
registerIntegration({
  id: 'yodlee', name: 'Yodlee (bank feed)', what: 'Connects bank accounts and brings in new transactions by themselves.',
  setup: 'In Platform, Bank connection, enter the Yodlee API address, FastLink address, issuer and private key, then add the webhook address shown there in Yodlee.',
  env: ['YODLEE_API_URL', 'YODLEE_FASTLINK_URL', 'YODLEE_ISSUER', 'YODLEE_PRIVATE_KEY'],
  have: (c) => ({ YODLEE_API_URL: !!c.yodlee.apiUrl, YODLEE_FASTLINK_URL: !!c.yodlee.fastLinkUrl, YODLEE_ISSUER: !!c.yodlee.issuer, YODLEE_PRIVATE_KEY: !!c.yodlee.privateKeyPem }),
  test: async (c) => (await import('./yodleeSettings.ts')).testYodlee(c),
});
registerIntegration({
  id: 'expo', name: 'Expo push notifications', what: 'Alerts to the owner\'s and customers\' phones from the mobile app.',
  setup: 'Create an Expo account, build the app with EAS, and set its project ID in the app. No server setting is needed; a phone registers itself when someone signs in.',
  env: [], have: () => ({}),
});
registerIntegration({
  id: 'claude', name: 'Claude (Ask AI)', what: 'Answers questions in the owner desk when the built-in answerer cannot.',
  setup: 'Create an Anthropic API key and put it in ANTHROPIC_API_KEY. Set AI_MODE to auto or claude.',
  env: ['ANTHROPIC_API_KEY'],
  have: (c) => ({ ANTHROPIC_API_KEY: !!c.ai.apiKey }),
  test: async (c, f) => {
    const r = await f(`${c.ai.apiUrl}/v1/messages`, { method: 'POST', headers: { 'x-api-key': c.ai.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: c.ai.model, max_tokens: 5, messages: [{ role: 'user', content: 'Say OK' }] }), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { ok: false, message: `Anthropic refused the request (${r.status}). ${snip(await r.text())}`.trim() };
    return { ok: true, message: `Key accepted (model ${c.ai.model}).` };
  },
});
registerIntegration({
  id: 'website', name: 'Website (Wix)', what: 'The public site at dajicricket.com talking to this server.',
  setup: 'Add https://dajicricket.com and https://www.dajicricket.com to CORS_ORIGINS so the website may call the API, and set PUBLIC_URL to the API address.',
  env: ['CORS_ORIGINS'],
  have: (c) => ({ CORS_ORIGINS: c.corsOrigins === '*' || c.corsOrigins.some((o) => /dajicricket\.com$/i.test(o)) }),
});
registerIntegration({
  id: 'email', name: 'Email (Gmail)', what: 'Booking emails to customers, sent from dajicricket@gmail.com.',
  setup: 'In the Google account dajicricket@gmail.com turn on 2-Step Verification, then create an App Password (Google Account > Security > App passwords). Put it in GMAIL_APP_PASSWORD (spaces do not matter). GMAIL_USER defaults to dajicricket@gmail.com. Gmail allows about 500 emails a day from a normal account.',
  env: ['GMAIL_APP_PASSWORD'],
  have: (c) => ({ GMAIL_APP_PASSWORD: !!c.email.appPassword }),
  test: async (c) => {
    try { await checkLogin(mailOptions(c)); return { ok: true, message: `Signed in to Gmail as ${c.email.user}. Nothing was sent.` }; }
    catch (e) { return { ok: false, message: String((e as Error).message).slice(0, 200) }; }
  },
});

export function integrationStatuses(cfg: Config): IntegrationStatus[] {
  const tests = new Map(many<{ integration_id: string; ok: number; message: string; at: number }>('SELECT * FROM integration_tests').map((t) => [t.integration_id, t]));
  return REGISTRY.map((i) => {
    const have = i.have(cfg), missing = i.env.filter((k) => !have[k]);
    const status: IntegrationStatus['status'] = i.notBuilt ? 'not_built' : !i.env.length ? 'ready' : missing.length === 0 ? 'ready' : missing.length === i.env.length ? 'missing' : 'partial';
    const t = tests.get(i.id);
    return { id: i.id, name: i.name, what: i.what, setup: i.setup, status, missing, canTest: !!i.test && !i.notBuilt && missing.length === 0, lastTest: t ? { ok: !!t.ok, message: t.message, at: t.at } : null, note: i.notBuilt ?? null };
  });
}

export async function testIntegration(cfg: Config, u: UserRow, id: string, f: Fetch = fetch as unknown as Fetch): Promise<TestResult> {
  const i = REGISTRY.find((x) => x.id === id);
  if (!i) return { ok: false, message: 'Unknown service.' };
  if (!i.test) return { ok: false, message: 'There is no safe automatic test for this one. Use it once for real and watch for errors.' };
  const have = i.have(cfg), missing = i.env.filter((k) => !have[k]);
  if (missing.length) return { ok: false, message: `Not set up yet. Missing: ${missing.join(', ')}.` };
  let res: TestResult;
  try { res = await i.test(cfg, f); } catch (e) { res = { ok: false, message: `Could not reach the service: ${(e as Error).message}`.slice(0, 200) }; }
  run('INSERT INTO integration_tests(integration_id, ok, message, at) VALUES (?,?,?,?) ON CONFLICT(integration_id) DO UPDATE SET ok = excluded.ok, message = excluded.message, at = excluded.at', id, res.ok ? 1 : 0, res.message, now());
  audit({ id: u.id, role: u.role }, 'integration.test', 'integration', id, { ok: res.ok });
  return res;
}
