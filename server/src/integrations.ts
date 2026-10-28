import type { Config } from './config.ts';
import { many, run, registerSchema } from './db.ts';
import { HttpError, notFound } from './errors.ts';
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
/** One plain-English step to connect a service, with the page to open when there is one. `{api}` in the text becomes this server's address. */
export interface SetupStep { text: string; link?: { label: string; url: string } }
export interface Integration {
  id: string; name: string; what: string; setup: string;
  /** Numbered steps from nothing to connected, each with its link. Every connection has them (checked by a test). */
  steps: SetupStep[];
  /** Names of the settings that must all be present. */
  env: string[];
  have: (cfg: Config) => Record<string, boolean>;
  /** A live check that costs nothing and changes nothing. Leave out when there is no such thing. */
  test?: (cfg: Config, f: Fetch) => Promise<TestResult>;
  /** Set when the service is not built into the platform yet. */
  notBuilt?: string;
}
export interface IntegrationStatus { id: string; name: string; what: string; setup: string; steps: SetupStep[]; status: 'ready' | 'partial' | 'missing' | 'not_built'; missing: string[]; canTest: boolean; lastTest: { ok: boolean; message: string; at: number } | null; note: string | null;
  /** The owner's own record of the account: who signed up, with what, account names, what is pending. Never keys or passwords. */
  notes: string; notesUpdatedAt: number | null }

registerSchema('integrations-1', `CREATE TABLE integration_tests (integration_id TEXT PRIMARY KEY, ok INTEGER NOT NULL, message TEXT NOT NULL, at INTEGER NOT NULL);`);
registerSchema('integrations-2', `CREATE TABLE integration_notes (integration_id TEXT PRIMARY KEY, notes TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT);`);

/** What was known about each account when the notes were added; shown until the owner saves their own. */
const FIRST_NOTES: Record<string, string> = {
  razorpay: 'Signed up with Google. Account name: Sqinch.',
  email: 'Sending address: dajicricket@gmail.com.',
  whatsapp: 'Business portfolio: Daji Cricket. WhatsApp account: Daji Cricket. Number: +91 75671 56000. System user: daji-website. Phone number ID: 1360655880469676.\nBusiness verification submitted, not approved yet. Templates daji_otp and daji_enquiry_alert pending approval.',
};
const NOTES_MAX = 2000;
/** Keys, tokens and passwords are refused: the notes are for account names and status, and anyone with desk access reads them. */
const SECRET_LIKE: [RegExp, string][] = [
  [/\b(password|passwd|pwd|passcode|secret|api[ _-]?key|auth[ _-]?key|token|app[ _-]?password|private[ _-]?key)\s*[:=-]\s*\S/i, 'a password, key or token after a label'],
  [/-----BEGIN [A-Z ]*KEY-----/, 'a private key'],
  [/\b(rzp_(live|test)_[A-Za-z0-9]{6,}|sk-[A-Za-z0-9_-]{16,}|EAA[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{12,}|AIza[A-Za-z0-9_-]{20,})/, 'an API key or access token'],
  [/\b(?=[A-Za-z0-9_\-]*[A-Za-z])(?=[A-Za-z0-9_\-]*\d)[A-Za-z0-9_\-]{24,}\b/, 'a long code that looks like a key or token'],
  [/\b[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}\b/, 'what looks like a Google app password'],
];
export function saveIntegrationNotes(cfg: Config, u: UserRow, id: string, body: unknown): IntegrationStatus {
  if (!REGISTRY.some((x) => x.id === id)) throw notFound('No such service');
  const notes = (body && typeof body === 'object' ? (body as Record<string, unknown>).notes : undefined);
  const bad = (message: string) => new HttpError(400, 'VALIDATION_FAILED', message, { fields: [{ field: 'notes', message }] });
  if (typeof notes !== 'string') throw bad('Send the notes as text');
  const text = notes.replace(/\r\n/g, '\n').trim();
  if (text.length > NOTES_MAX) throw bad(`Keep the notes under ${NOTES_MAX} characters`);
  const hit = SECRET_LIKE.find(([re]) => re.test(text));
  if (hit) throw bad(`This looks like ${hit[1]}. Keys and passwords never go in the notes: they stay in the server settings only.`);
  run('INSERT INTO integration_notes(integration_id, notes, updated_at, updated_by) VALUES (?,?,?,?) ON CONFLICT(integration_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at, updated_by = excluded.updated_by', id, text, now(), u.id);
  audit({ id: u.id, role: u.role }, 'integration.notes', 'integration', id, { length: text.length });
  return integrationStatuses(cfg).find((x) => x.id === id)!;
}

const REGISTRY: Integration[] = [];
export function registerIntegration(i: Integration): void { const at = REGISTRY.findIndex((x) => x.id === i.id); if (at >= 0) REGISTRY[at] = i; else REGISTRY.push(i); }
export const integrationIds = (): string[] => REGISTRY.map((i) => i.id);

/** The last step of every connection that needs server settings: where they go. Values never go into chat, email or the desk. */
const serverStep = (lines: string): SetupStep => ({ text: `Give the values to whoever looks after the server. They add these lines to deploy/.env on the server and restart it (docker compose up -d): ${lines}. Never paste keys into chat, email or the desk notes. Then come back here and press Test where there is one.` });

const snip = (t: string): string => { try { const j = JSON.parse(t); return String(j?.error?.message ?? j?.error?.description ?? j?.message ?? '').slice(0, 160); } catch { return t.slice(0, 120); } };

registerIntegration({
  id: 'whatsapp', name: 'WhatsApp (Meta Cloud API)', what: 'Sign-in codes by WhatsApp, the first choice.',
  setup: 'Create a Meta Business account, add a phone number, get an approved Authentication template named daji_otp, then put the token and phone number ID in the server settings.',
  steps: [
    { text: 'Open Meta Business Suite and create a business portfolio for Daji Cricket (or open the one you have).', link: { label: 'Meta Business Suite', url: 'https://business.facebook.com/' } },
    { text: 'Create a Meta app of type Business and add the WhatsApp product to it.', link: { label: 'Meta for Developers, My Apps', url: 'https://developers.facebook.com/apps/' } },
    { text: 'In WhatsApp, API Setup, add the ground\'s phone number and verify it with the code Meta sends. Copy the Phone number ID shown there.', link: { label: 'WhatsApp Cloud API, get started', url: 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started' } },
    { text: 'Create a message template of category Authentication named daji_otp and wait for Meta to approve it (usually minutes to a day).', link: { label: 'WhatsApp Manager, message templates', url: 'https://business.facebook.com/wa/manage/message-templates/' } },
    { text: 'In Business settings, Users, System users, add a system user, give it the WhatsApp account and the app, and generate a permanent token with whatsapp_business_messaging and whatsapp_business_management.', link: { label: 'Business settings, System users', url: 'https://business.facebook.com/settings/system-users' } },
    serverStep('WHATSAPP_TOKEN=the system user token and WHATSAPP_PHONE_ID=the phone number ID'),
  ],
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
  id: 'whatsapp-customers', name: 'WhatsApp messages to customers', what: 'Waitlist offers by WhatsApp, only to customers who agreed to WhatsApp messages. App and email messages go out without it.',
  setup: 'Needs the WhatsApp connection above, plus a Utility template approved in Meta Business Manager with one text variable (the message), for example daji_waitlist_offer. Put its name in WHATSAPP_WAITLIST_TEMPLATE. Until then WhatsApp messages are recorded as waiting and nothing else changes.',
  steps: [
    { text: 'Connect WhatsApp (the connection above) first.' },
    { text: 'In WhatsApp Manager, create a message template of category Utility, for example daji_waitlist_offer, with one text variable {{1}} for the message, and wait for approval.', link: { label: 'WhatsApp Manager, message templates', url: 'https://business.facebook.com/wa/manage/message-templates/' } },
    serverStep('WHATSAPP_WAITLIST_TEMPLATE=the template name'),
  ],
  env: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_WAITLIST_TEMPLATE'],
  have: (c) => ({ WHATSAPP_TOKEN: !!c.whatsapp.token, WHATSAPP_PHONE_ID: !!c.whatsapp.phoneId, WHATSAPP_WAITLIST_TEMPLATE: !!c.whatsapp.waitlistTemplate }),
});
registerIntegration({
  id: 'face-match', name: 'Face check at check-in (Amazon Rekognition)', what: 'Each player enrols their face once (with consent); every check-in selfie must match it, so nobody can check in on someone else\'s profile. No face photos are kept: Rekognition keeps a face template, each selfie is checked once and dropped. Roughly one US tenth of a cent (about 10 paise) per enrolment or check-in.',
  setup: 'In the AWS console, create an IAM user with only rekognition:CreateCollection, IndexFaces, SearchFacesByImage and DeleteFaces, and make an access key for it. Put the key id in REKOGNITION_KEY_ID and the secret in REKOGNITION_SECRET. REKOGNITION_REGION defaults to ap-south-1 (Mumbai) so faces stay in India; REKOGNITION_COLLECTION defaults to daji-players and is created on first use. Until then players check in without a face check (location, their own phone and a code to change phones still apply).',
  steps: [
    { text: 'Sign in to Amazon Web Services, or create an account (it needs a card; Rekognition costs about 10 paise per face check).', link: { label: 'AWS sign-in', url: 'https://console.aws.amazon.com/' } },
    { text: 'Open IAM, Users, and create a user named daji-face-check. Do not give it console access.', link: { label: 'IAM users', url: 'https://console.aws.amazon.com/iam/home#/users' } },
    { text: 'Add a permission to that user, choose Create inline policy, JSON, and allow only these actions on all resources: rekognition:CreateCollection, rekognition:IndexFaces, rekognition:SearchFacesByImage and rekognition:DeleteFaces.', link: { label: 'Inline policies, how to', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_manage-attach-detach.html' } },
    { text: 'On the user, open Security credentials, Create access key, choose Application running outside AWS, and copy the Access key ID and the Secret access key (the secret is shown only once).', link: { label: 'Managing access keys', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html' } },
    { text: 'Nothing else to make: Daji creates its face collection (daji-players) in Mumbai (ap-south-1) the first time a player enrols, so faces stay in India.', link: { label: 'Rekognition prices', url: 'https://aws.amazon.com/rekognition/pricing/' } },
    serverStep('REKOGNITION_KEY_ID=the access key ID and REKOGNITION_SECRET=the secret access key'),
  ],
  env: ['REKOGNITION_KEY_ID', 'REKOGNITION_SECRET'],
  have: (c) => ({ REKOGNITION_KEY_ID: !!c.faceMatch.keyId, REKOGNITION_SECRET: !!c.faceMatch.secret }),
});
registerIntegration({
  id: 'msg91', name: 'MSG91', what: 'Text message sign-in codes, the backup for WhatsApp.',
  setup: 'Create an MSG91 account, register the DLT template for the code message, then put the Auth Key and Template ID in the server settings.',
  steps: [
    { text: 'Create an MSG91 account and complete the business details.', link: { label: 'MSG91 sign-up', url: 'https://msg91.com/signup' } },
    { text: 'Register Daji as a sender (entity) and the sign-in code message as a template on a DLT portal, as Indian rules require for text messages. Jio\'s portal is the most used.', link: { label: 'Jio DLT portal', url: 'https://trueconnect.jio.com/' } },
    { text: 'In MSG91, OTP, create a template with the same DLT template ID, and copy its Template ID.', link: { label: 'MSG91 dashboard', url: 'https://control.msg91.com/' } },
    { text: 'In MSG91, open your name, Authkey, and create an Auth Key.', link: { label: 'MSG91 help', url: 'https://docs.msg91.com/' } },
    serverStep('MSG91_AUTH_KEY=the auth key and MSG91_TEMPLATE_ID=the template ID'),
  ],
  env: ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID'],
  have: (c) => ({ MSG91_AUTH_KEY: !!c.msg91.authKey, MSG91_TEMPLATE_ID: !!c.msg91.templateId }),
  // MSG91 has no free "check my key" call, and a real test costs a message, so only the settings are checked here.
});
registerIntegration({
  id: 'razorpay', name: 'Razorpay', what: 'Online card and UPI payments, and refunds.',
  setup: 'Create a Razorpay account (test mode first), copy the Key ID and Key Secret, and add a webhook to /api/webhooks/razorpay with the same secret.',
  steps: [
    { text: 'Sign up for Razorpay and finish the business checks (KYC). You can do the next steps in Test mode first.', link: { label: 'Razorpay sign-up', url: 'https://dashboard.razorpay.com/signup' } },
    { text: 'In the Razorpay dashboard, Account and Settings, API keys, generate a key. Copy the Key ID and Key Secret.', link: { label: 'Razorpay API keys', url: 'https://dashboard.razorpay.com/app/website-app-settings/api-keys' } },
    { text: 'In Account and Settings, Webhooks, add a webhook with the address {api}/api/webhooks/razorpay, choose a secret of your own, and tick the payment, order and refund events.', link: { label: 'Razorpay webhooks', url: 'https://dashboard.razorpay.com/app/webhooks' } },
    serverStep('RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET=the webhook secret you chose'),
  ],
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
  steps: [
    { text: 'Ask Yodlee for an account (start with the free developer sandbox).', link: { label: 'Yodlee developer portal', url: 'https://developer.yodlee.com/' } },
    { text: 'From the Yodlee portal, copy the API address, the FastLink address and the issuer (client) ID, and create an RSA key pair; upload the public key to Yodlee.', link: { label: 'Yodlee developer portal', url: 'https://developer.yodlee.com/' } },
    { text: 'In this desk, open Platform, Bank connection, and enter those values and the private key. They are kept on the server, not in the browser.' },
    { text: 'Copy the webhook address shown on that page into Yodlee so new transactions arrive by themselves.' },
  ],
  env: ['YODLEE_API_URL', 'YODLEE_FASTLINK_URL', 'YODLEE_ISSUER', 'YODLEE_PRIVATE_KEY'],
  have: (c) => ({ YODLEE_API_URL: !!c.yodlee.apiUrl, YODLEE_FASTLINK_URL: !!c.yodlee.fastLinkUrl, YODLEE_ISSUER: !!c.yodlee.issuer, YODLEE_PRIVATE_KEY: !!c.yodlee.privateKeyPem }),
  test: async (c) => (await import('./yodleeSettings.ts')).testYodlee(c),
});
registerIntegration({
  id: 'expo', name: 'Expo push notifications', what: 'Alerts to the owner\'s and customers\' phones from the mobile app.',
  setup: 'Create an Expo account, build the app with EAS, and set its project ID in the app. No server setting is needed; a phone registers itself when someone signs in.',
  steps: [
    { text: 'Create a free Expo account for the business.', link: { label: 'Expo sign-up', url: 'https://expo.dev/signup' } },
    { text: 'Build the Daji app with EAS (whoever builds the app does this once); the build carries the project ID.', link: { label: 'EAS Build, set up', url: 'https://docs.expo.dev/build/setup/' } },
    { text: 'Nothing goes on the server: each phone registers itself when someone signs in to the app and allows notifications.' },
  ],
  env: [], have: () => ({}),
});
registerIntegration({
  id: 'claude', name: 'Claude (Ask AI)', what: 'Answers questions in the owner desk when the built-in answerer cannot, and reads the pages of photos and scans kept in Documents.',
  setup: 'Create an Anthropic API key and put it in ANTHROPIC_API_KEY. Set AI_MODE to auto or claude.',
  steps: [
    { text: 'Create an Anthropic Console account for the business and add a payment method.', link: { label: 'Anthropic Console', url: 'https://console.anthropic.com/' } },
    { text: 'In Settings, API keys, create a key named Daji and copy it (it is shown only once).', link: { label: 'Anthropic API keys', url: 'https://console.anthropic.com/settings/keys' } },
    { text: 'Optionally set a monthly spend limit there, under Limits.', link: { label: 'Anthropic limits', url: 'https://console.anthropic.com/settings/limits' } },
    serverStep('ANTHROPIC_API_KEY=the key and AI_MODE=auto'),
  ],
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
  steps: [
    { text: 'Make sure the Wix site is published at dajicricket.com.', link: { label: 'Wix dashboard', url: 'https://manage.wix.com/' } },
    serverStep('CORS_ORIGINS=https://dajicricket.com https://www.dajicricket.com and PUBLIC_URL=https://dajicricket.com'),
  ],
  env: ['CORS_ORIGINS'],
  have: (c) => ({ CORS_ORIGINS: c.corsOrigins === '*' || c.corsOrigins.some((o) => /dajicricket\.com$/i.test(o)) }),
});
registerIntegration({
  id: 'email', name: 'Email (Gmail)', what: 'Booking emails to customers, sent from dajicricket@gmail.com.',
  setup: 'In the Google account dajicricket@gmail.com turn on 2-Step Verification, then create an App Password (Google Account > Security > App passwords). Put it in GMAIL_APP_PASSWORD (spaces do not matter). GMAIL_USER defaults to dajicricket@gmail.com. Gmail allows about 500 emails a day from a normal account.',
  steps: [
    { text: 'Sign in to Google as dajicricket@gmail.com and turn on 2-Step Verification.', link: { label: 'Google 2-Step Verification', url: 'https://myaccount.google.com/signinoptions/two-step-verification' } },
    { text: 'Open App passwords, create one named Daji, and copy the 16 letters (spaces do not matter).', link: { label: 'Google App passwords', url: 'https://myaccount.google.com/apppasswords' } },
    serverStep('GMAIL_APP_PASSWORD=the 16 letters (GMAIL_USER only if sending from another address)'),
  ],
  env: ['GMAIL_APP_PASSWORD'],
  have: (c) => ({ GMAIL_APP_PASSWORD: !!c.email.appPassword }),
  test: async (c) => {
    try { await checkLogin(mailOptions(c)); return { ok: true, message: `Signed in to Gmail as ${c.email.user}. Nothing was sent.` }; }
    catch (e) { return { ok: false, message: String((e as Error).message).slice(0, 200) }; }
  },
});
registerIntegration({
  id: 'lawfeed', name: 'Law and policy updates', what: 'Brings news of changes in Indian laws, rates and rules into Compliance › Law updates once a day, matched to the rules the software enforces.',
  setup: 'Put the address of one or more RSS, Atom or JSON feeds in LAW_FEED_URL (separate several with spaces), for example a legal-news or CA firm feed, or a government notifications feed. If the service gives you a key, put it in LAW_FEED_TOKEN. Only news that matches a rule in the register is kept unless LAW_FEED_KEEP_ALL is on. Until then, updates can be added by hand on the Compliance page.',
  steps: [
    { text: 'Choose one or more news feeds about Indian law, tax and labour rules, for example the Press Information Bureau feeds or your CA firm\'s feed. Copy each feed address (it usually ends in rss or xml).', link: { label: 'PIB RSS feeds', url: 'https://pib.gov.in/ViewRss.aspx' } },
    serverStep('LAW_FEED_URL=the feed addresses separated by spaces (and LAW_FEED_TOKEN if the feed gave you a key)'),
  ],
  env: ['LAW_FEED_URL'],
  have: (c) => ({ LAW_FEED_URL: c.lawFeed.urls.length > 0 }),
  test: async (c, f) => {
    const { readFeed, rulesIn } = await import('./lawUpdates.ts');
    const parts: string[] = [];
    for (const url of c.lawFeed.urls) {
      try {
        const items = await readFeed(c, url, f);
        parts.push(`${new URL(url).host}: ${items.length} item${items.length === 1 ? '' : 's'}, ${items.filter((i) => i.codes.length || rulesIn(`${i.title} ${i.summary}`).length).length} about a rule on the register`);
      } catch (e) { return { ok: false, message: `${url.slice(0, 80)}: ${(e as Error).message}`.slice(0, 200) }; }
    }
    return { ok: true, message: `Read ${parts.join('; ')}. Nothing was saved.` };
  },
});

export function integrationStatuses(cfg: Config): IntegrationStatus[] {
  const tests = new Map(many<{ integration_id: string; ok: number; message: string; at: number }>('SELECT * FROM integration_tests').map((t) => [t.integration_id, t]));
  const notes = new Map(many<{ integration_id: string; notes: string; updated_at: number }>('SELECT * FROM integration_notes').map((n) => [n.integration_id, n]));
  return REGISTRY.map((i) => {
    const have = i.have(cfg), missing = i.env.filter((k) => !have[k]);
    const status: IntegrationStatus['status'] = i.notBuilt ? 'not_built' : !i.env.length ? 'ready' : missing.length === 0 ? 'ready' : missing.length === i.env.length ? 'missing' : 'partial';
    const t = tests.get(i.id);
    const steps = i.steps.map((st) => ({ ...st, text: st.text.replaceAll('{api}', cfg.apiUrl) }));
    return { id: i.id, name: i.name, what: i.what, setup: i.setup, steps, status, missing, canTest: !!i.test && !i.notBuilt && missing.length === 0, lastTest: t ? { ok: !!t.ok, message: t.message, at: t.at } : null, note: i.notBuilt ?? null,
      notes: notes.get(i.id)?.notes ?? FIRST_NOTES[i.id] ?? '', notesUpdatedAt: notes.get(i.id)?.updated_at ?? null };
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
