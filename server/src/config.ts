import { join } from 'node:path';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  webDir: string;
  /** The website people visit (on Wix): https://dajicricket.com. Used in links inside messages. */
  publicUrl: string;
  /** Where this API is reachable from the internet, e.g. https://api.dajicricket.com. Razorpay webhooks and the Wix widgets call it. */
  apiUrl: string;
  /** Sites allowed to put the web app in an iframe (CSP frame-ancestors). Empty = only itself. */
  frameAncestors: string[];
  isLocal: boolean;
  /** A CDN address that serves the photos, videos and background films (deploy/CDN.md), e.g. https://d1abcd.cloudfront.net. Empty = this server serves them. */
  mediaCdn: string;
  demoMode: boolean;
  /** Phone number and WhatsApp code sign-up and sign-in. Off until the WhatsApp OTP template is approved in Meta (Facebook Developer); set OTP_SIGNIN=on to switch it back on. */
  otpSignIn: boolean;
  jwtSecret: string;
  jwtTtlDays: number;
  corsOrigins: string[] | '*';
  trustProxy: boolean;
  rateLimit: boolean;
  requireStaffTerms: boolean;
  log: boolean;
  razorpay: { keyId: string; keySecret: string; webhookSecret: string; apiUrl: string };
  yodlee: {
    apiUrl: string;
    fastLinkUrl: string;
    clientId: string;
    secret: string;
    adminLoginName: string;
    privateKeyPem: string;
    issuer: string;
    keyId: string;
    webhookSecret: string;
    /** FastLink configuration name published in Yodlee's Configuration Tool. */
    configName: string;
    /** Sandbox only: the one test user Yodlee gives you. Blank everywhere else. */
    userLogin: string;
  };
  /** Daily snapshot of the database (and uploaded files) at 03:15 IST. `dir` is where snapshots go; copy them off the server too. */
  backup: { enabled: boolean; keep: number; dir: string; passphrase: string; s3: { bucket: string; region: string; keyId: string; secret: string; prefix: string } };
  /** Encrypts 2-step sign-in secrets in the database (src/vault.ts). Keep a copy somewhere safe: without it they cannot be read. */
  fieldKey: string;
  sweepIntervalSeconds: number;
  /** Ask AI. The built-in answerer needs nothing; a Claude key adds free-form questions. */
  /** WhatsApp Business Cloud API (Meta), used to send sign-in codes. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID to switch it on. */
  whatsapp: { token: string; phoneId: string; otpTemplate: string; alertTemplate: string; lang: string; apiUrl: string };
  /** MSG91 text-message sign-in codes: the back-up when WhatsApp is not set up or fails. Needs a DLT-approved OTP template in MSG91. */
  msg91: { authKey: string; templateId: string; apiUrl: string };
  /** Email through Gmail SMTP with an App Password. The address defaults to the ground's own Gmail; GMAIL_APP_PASSWORD switches sending on. */
  email: { user: string; appPassword: string; fromName: string; host: string; port: number; tls: boolean };
  ai: { apiKey: string; model: string; apiUrl: string; mode: 'builtin' | 'auto' | 'claude'; limitPerHour: number; timeoutMs: number };
  /** Sign in with Microsoft in the phone apps (src/microsoft.ts). Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET from the Entra app registration to switch it on. */
  microsoft: { clientId: string; clientSecret: string; tenant: string; loginUrl: string };
}

export const DEV_SECRET = 'dev-only-secret-change-me-dev-only-secret';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function parsePublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`PUBLIC_URL is not a valid URL: ${raw}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('PUBLIC_URL must start with http:// or https://');
  return u;
}

function parseOrigin(name: string, raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error(`${name} is not a valid URL: ${raw}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`${name} must start with http:// or https://`);
  return u.origin;
}

/** https://dajicricket.com ⇄ https://www.dajicricket.com. Null for localhost or IP hosts. */
export function wwwSibling(u: URL): string | null {
  if (LOCAL_HOSTS.has(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return null;
  const host = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
  return `${u.protocol}//${host}${u.port ? ':' + u.port : ''}`;
}

/** https://dajicricket.com or https://www.dajicricket.com → https://api.dajicricket.com. Localhost and IPs keep their own origin. */
export function defaultApiUrl(u: URL): string {
  if (LOCAL_HOSTS.has(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return u.origin;
  return `${u.protocol}//api.${u.hostname.replace(/^www\./, '')}`;
}

/**
 * Is `origin` in the allow list? Entries are exact origins, or `https://*.wixsite.com`, which matches any
 * sub-domain (one or more labels) of that host over the same scheme, but not the bare domain itself.
 */
export function originAllowed(list: readonly string[] | '*', origin: string | undefined): boolean {
  if (list === '*') return true;
  if (!origin) return false;
  let o: URL;
  try { o = new URL(origin); } catch { return false; }
  if (o.origin !== origin) return false; // "https://x.com/path" or "null" are not origins
  for (const entry of list) {
    if (entry === origin) return true;
    const m = /^(https?):\/\/\*\.([^/*:]+)$/.exec(entry);
    if (m && o.protocol === `${m[1]}:` && o.hostname.endsWith(`.${m[2]}`) && o.hostname.length > m[2]!.length + 1) return true;
  }
  return false;
}

const truthy = (v: string | undefined, dflt: boolean): boolean =>
  v === undefined || v === '' ? dflt : /^(1|true|yes|on)$/i.test(v.trim());

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const publicUrl = parsePublicUrl(env.PUBLIC_URL || 'http://localhost:4000');
  const isLocal = LOCAL_HOSTS.has(publicUrl.hostname);
  const dataDir = env.DATA_DIR || join(process.cwd(), 'data');
  const secret = env.JWT_SECRET || '';
  if (!isLocal && secret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters when PUBLIC_URL is not localhost');
  }
  const origin = publicUrl.origin;
  const sib = wwwSibling(publicUrl);
  const corsRaw = env.CORS_ORIGINS;
  const corsOrigins: string[] | '*' = corsRaw
    ? corsRaw.trim() === '*' ? '*' : corsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : isLocal ? '*' : [origin, ...(sib ? [sib] : [])];
  const apiRaw = env.API_URL?.trim();
  const apiUrl = apiRaw ? parseOrigin('API_URL', apiRaw) : defaultApiUrl(publicUrl);
  const frameAncestors = env.FRAME_ANCESTORS !== undefined && env.FRAME_ANCESTORS.trim() !== ''
    ? env.FRAME_ANCESTORS.split(',').map((s) => s.trim()).filter(Boolean)
    : isLocal ? [] : [origin, ...(sib ? [sib] : [])];
  return {
    port: Number(env.PORT ?? 4000),
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbPath: env.DB_PATH || join(dataDir, 'daji.db'),
    webDir: env.WEB_DIR || join(process.cwd(), '..', 'web', 'public'),
    publicUrl: origin,
    apiUrl,
    frameAncestors,
    isLocal,
    mediaCdn: env.MEDIA_CDN?.trim() ? parseOrigin('MEDIA_CDN', env.MEDIA_CDN.trim()) : '',
    demoMode: truthy(env.DEMO_MODE, isLocal),
    otpSignIn: truthy(env.OTP_SIGNIN, false),
    jwtSecret: secret || DEV_SECRET,
    jwtTtlDays: Number(env.JWT_TTL_DAYS ?? 30),
    corsOrigins,
    trustProxy: truthy(env.TRUST_PROXY, false),
    rateLimit: truthy(env.RATE_LIMIT, true),
    requireStaffTerms: truthy(env.REQUIRE_STAFF_TERMS, true),
    log: truthy(env.LOG, true),
    razorpay: {
      keyId: env.RAZORPAY_KEY_ID || '',
      keySecret: env.RAZORPAY_KEY_SECRET || '',
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
      apiUrl: (env.RAZORPAY_API_URL || 'https://api.razorpay.com').replace(/\/+$/, ''),
    },
    yodlee: {
      apiUrl: (env.YODLEE_API_URL || '').replace(/\/+$/, ''),
      fastLinkUrl: env.YODLEE_FASTLINK_URL || '',
      clientId: env.YODLEE_CLIENT_ID || '',
      secret: env.YODLEE_SECRET || '',
      adminLoginName: env.YODLEE_ADMIN_LOGIN || '',
      privateKeyPem: (env.YODLEE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      issuer: env.YODLEE_ISSUER || '',
      keyId: env.YODLEE_KEY_ID || '',
      webhookSecret: env.YODLEE_WEBHOOK_SECRET || '',
      configName: env.YODLEE_CONFIG_NAME || '',
      userLogin: env.YODLEE_USER_LOGIN || '',
    },
    backup: { enabled: truthy(env.BACKUP_ENABLED, !isLocal), keep: Math.max(1, Math.floor(Number(env.BACKUP_KEEP ?? 14)) || 14), dir: env.BACKUP_DIR || join(dataDir, 'backups'), passphrase: env.BACKUP_PASSPHRASE || '', s3: { bucket: env.BACKUP_S3_BUCKET || '', region: env.BACKUP_S3_REGION || 'ap-south-1', keyId: env.BACKUP_S3_KEY_ID || '', secret: env.BACKUP_S3_SECRET || '', prefix: (env.BACKUP_S3_PREFIX || 'daji-backups').replace(/^\/+|\/+$/g, '') } },
    fieldKey: env.FIELD_KEY || '',
    sweepIntervalSeconds: Number(env.SWEEP_INTERVAL_SECONDS ?? 60),
    whatsapp: {
      token: env.WHATSAPP_TOKEN || '',
      phoneId: env.WHATSAPP_PHONE_ID || '',
      otpTemplate: env.WHATSAPP_OTP_TEMPLATE || 'daji_otp',
      alertTemplate: env.WHATSAPP_ALERT_TEMPLATE || 'daji_enquiry_alert',
      lang: env.WHATSAPP_LANG || 'en',
      apiUrl: (env.WHATSAPP_API_URL || 'https://graph.facebook.com/v21.0').replace(/\/+$/, ''),
    },
    msg91: {
      authKey: env.MSG91_AUTH_KEY || '',
      templateId: env.MSG91_TEMPLATE_ID || '',
      apiUrl: (env.MSG91_API_URL || 'https://control.msg91.com/api/v5').replace(/\/+$/, ''),
    },
    email: {
      user: env.GMAIL_USER || 'dajicricket@gmail.com',
      appPassword: (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
      fromName: env.EMAIL_FROM_NAME || 'Daji Cricket Ground',
      host: env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(env.SMTP_PORT || 465),
      tls: truthy(env.SMTP_TLS, true),
    },
    ai: {
      apiKey: env.ANTHROPIC_API_KEY || '',
      model: env.AI_MODEL || 'claude-haiku-5-5',
      apiUrl: (env.ANTHROPIC_API_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
      mode: aiMode(env.AI_MODE),
      limitPerHour: Math.max(1, Number(env.AI_LIMIT_PER_HOUR ?? 30) || 30),
      timeoutMs: Math.max(1000, Number(env.AI_TIMEOUT_MS ?? 25000) || 25000),
    },
    microsoft: {
      clientId: env.MICROSOFT_CLIENT_ID || '',
      clientSecret: env.MICROSOFT_CLIENT_SECRET || '',
      tenant: env.MICROSOFT_TENANT || 'common',
      loginUrl: (env.MICROSOFT_LOGIN_URL || 'https://login.microsoftonline.com').replace(/\/+$/, ''),
    },
  };
}

function aiMode(v: string | undefined): 'builtin' | 'auto' | 'claude' {
  const m = (v ?? 'auto').trim().toLowerCase();
  if (m === 'builtin' || m === 'auto' || m === 'claude') return m;
  throw new Error(`AI_MODE must be builtin, auto or claude (got "${v}")`);
}

export const razorpayConfigured = (c: Config): boolean => !!(c.razorpay.keyId && c.razorpay.keySecret);
export const aiConfigured = (c: Config): boolean => !!c.ai.apiKey;
export const yodleeConfigured = (c: Config): boolean =>
  !!(c.yodlee.apiUrl && c.yodlee.clientId && (c.yodlee.secret || (c.yodlee.privateKeyPem && c.yodlee.issuer)));

export function configWarnings(c: Config): string[] {
  const w: string[] = [];
  if (!c.isLocal && c.demoMode) w.push('DEMO_MODE is on for a real domain: demo accounts and the fake payment gateway are active. Turn it off.');
  if (!c.isLocal && !c.trustProxy) w.push('TRUST_PROXY is off: behind Caddy every client will look like one IP. Set TRUST_PROXY=1 when using the bundled Caddyfile.');
  if (!c.isLocal && !c.publicUrl.startsWith('https://')) w.push('PUBLIC_URL is not https://.');
  if (!razorpayConfigured(c) && !c.demoMode) w.push('Razorpay keys are not set: online payments will fail until RAZORPAY_KEY_ID/SECRET are configured (or switch Razorpay OFF in admin settings).');
  if (razorpayConfigured(c) && !c.razorpay.webhookSecret) w.push('RAZORPAY_WEBHOOK_SECRET is not set: payment webhooks will be rejected.');
  if (!c.isLocal && !c.apiUrl.startsWith('https://')) w.push('API_URL is not https://: Wix pages are https and the browser will block calls to an http API.');
  if (c.ai.mode === 'claude' && !c.ai.apiKey) w.push('AI_MODE=claude but ANTHROPIC_API_KEY is not set: Ask AI will use the built-in answerer only.');
  if (!c.isLocal && !c.demoMode && !(c.whatsapp.token && c.whatsapp.phoneId) && !(c.msg91.authKey && c.msg91.templateId)) w.push('Neither WhatsApp (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID) nor MSG91 (MSG91_AUTH_KEY, MSG91_TEMPLATE_ID) is set up: sign-in codes cannot be sent, so customers can only sign in with email and password.');
  if (c.corsOrigins === '*' && !c.isLocal) w.push('CORS is open to every origin.');
  if (!c.isLocal && c.fieldKey.length < 24) w.push('FIELD_KEY is not set (at least 24 characters): 2-step sign-in secrets are stored unencrypted.');
  if (!c.isLocal && c.backup.enabled && !c.backup.s3.bucket) w.push('BACKUP_S3_BUCKET is not set: backups stay on the same disk as the database. Set the BACKUP_S3_* settings (needs BACKUP_PASSPHRASE) to copy each backup off the server.');
  if (!c.isLocal && c.backup.enabled && !c.backup.passphrase) w.push('BACKUP_PASSPHRASE is not set: backups are stored unencrypted. Set it, and keep a copy of it away from the server.');
  return w;
}
