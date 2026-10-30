import { needsTerms } from './legal.ts';
import { setVaultKey } from './vault.ts';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Role } from '@daji/shared';
import { originAllowed, type Config } from './config.ts';
import { authenticate, type UserRow } from './auth.ts';
import { refuseIfReadOnly } from './readOnly.ts';
import { tenantOfHost } from './businesses.ts';
import { switchTo } from './portfolio.ts';
import { staffSwitchTo } from './areas.ts';
import { acting } from './audit.ts';
import { HttpError, forbidden } from './errors.ts';
import { now } from './clock.ts';
import { serveWeb } from './site.ts';
import { serveLibraryFile } from './library.ts';
import { configureIntake, gateUpload } from './intake.ts';
import { idemAbandon, idemBegin, idemFinish, parseIdempotencyKey, requestHash } from './idempotency.ts';

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: Buffer | string;
  contentType?: string;
}
export const HANDLED = Symbol('handled');

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  ip: string;
  cfg: Config;
  user: UserRow | null;
  /** Who signed in: differs from user only while an owner works in another business of their portfolio (portfolio.ts). */
  realUser?: UserRow | null;
  raw: Buffer;
  /** Parsed JSON body; `{}` when the body is empty. */
  json(): unknown;
}
export type Handler = (c: Ctx) => Reply | Promise<Reply>;

export interface RouteOpts {
  /** 'user' = any signed-in user; a role list restricts to those roles; omitted = public. */
  auth?: 'user' | Role[];
  maxBody?: number;
  /** The handler reads the request itself (a large upload streamed to disk); the body is not buffered. */
  stream?: boolean;
  rate?: 'auth' | 'none';
  /** Honours the `Idempotency-Key` header: a retry with the same key and request gets the first answer back and the action is not repeated. 'required' refuses a request that has no key. */
  idempotent?: boolean | 'required';
  /** The request body is an uploaded file. It is virus-checked (and refused if it fails or cannot be checked) before the handler runs; the name says what the file is for. */
  upload?: string;
}
interface Route { method: string; re: RegExp; keys: string[]; handler: Handler; opts: RouteOpts }

export class Router {
  routes: Route[] = [];
  add(method: string, pattern: string, handler: Handler, opts: RouteOpts = {}): void {
    const keys: string[] = [];
    const re = new RegExp('^' + pattern.replace(/:([A-Za-z]+)/g, (_m, k: string) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler, opts });
  }
  get(p: string, h: Handler, o?: RouteOpts) { this.add('GET', p, h, o); }
  post(p: string, h: Handler, o?: RouteOpts) { this.add('POST', p, h, o); }
  put(p: string, h: Handler, o?: RouteOpts) { this.add('PUT', p, h, o); }
  patch(p: string, h: Handler, o?: RouteOpts) { this.add('PATCH', p, h, o); }
  del(p: string, h: Handler, o?: RouteOpts) { this.add('DELETE', p, h, o); }
  match(method: string, path: string): { route: Route; params: Record<string, string> } | 'method' | null {
    let pathHit = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathHit = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = safeDecode(m[i + 1]!)));
      return { route: r, params };
    }
    return pathHit ? 'method' : null;
  }
}

export function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { throw new HttpError(400, 'BAD_URL', 'The address contains an invalid % sequence'); }
}

export const ok = (body: unknown, status = 200): Reply => ({ status, body });
export const created = (body: unknown): Reply => ({ status: 201, body });
export const noContent = (): Reply => ({ status: 204 });

// ---- rate limiting ----
const buckets = new Map<string, { n: number; reset: number }>();
export function resetRateLimits(): void { buckets.clear(); }
function limited(key: string, max: number, windowMs: number): number {
  const t = now();
  let b = buckets.get(key);
  if (!b || b.reset <= t) {
    if (buckets.size > 20000) for (const [k, v] of buckets) if (v.reset <= t) buckets.delete(k);
    if (buckets.size > 50000) buckets.clear(); // a flood of distinct keys cannot grow memory without limit
    b = { n: 0, reset: t + windowMs };
    buckets.set(key, b);
  }
  b.n++;
  return b.n > max ? Math.ceil((b.reset - t) / 1000) : 0;
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const v = Array.isArray(xff) ? xff.join(',') : xff;
    if (v) {
      const last = v.split(',').map((s) => s.trim()).filter(Boolean).pop();
      if (last) return last;
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const warnedOrigins = new Set<string>();

function corsHeaders(cfg: Config, origin: string | undefined): Record<string, string> {
  const h: Record<string, string> = {};
  if (cfg.corsOrigins === '*') h['Access-Control-Allow-Origin'] = '*';
  else if (origin) {
    h['Vary'] = 'Origin';
    if (originAllowed(cfg.corsOrigins, origin)) h['Access-Control-Allow-Origin'] = origin;
    else if (cfg.log && warnedOrigins.size < 50 && !warnedOrigins.has(origin)) {
      // The usual cause on Wix: the editor or preview runs the widget from an address that is not in CORS_ORIGINS yet.
      warnedOrigins.add(origin);
      console.warn(JSON.stringify({ t: new Date().toISOString(), level: 'warn', msg: `CORS: blocked origin ${origin}. If this is your own site (e.g. the Wix editor or preview), add it to CORS_ORIGINS.` }));
    }
  }
  if (h['Access-Control-Allow-Origin']) {
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, Idempotency-Key, X-Daji-Env, X-Daji-Business';
    h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const len = Number(req.headers['content-length'] ?? 0);
  if (len > limit) throw new HttpError(413, 'BODY_TOO_LARGE', 'The request is too large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, 'BODY_TOO_LARGE', 'The request is too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

/** `Content-Security-Policy: frame-ancestors …` for pages of the web app that Wix embeds in an iframe. */
export function frameAncestorsPolicy(cfg: Config): string {
  return `frame-ancestors 'self'${cfg.frameAncestors.map((a) => ` ${a}`).join('')}`;
}

/**
 * The policy for the website itself: scripts only from this server (no inline scripts, so an injected script cannot run),
 * Razorpay's checkout script and frame, Google Fonts, images from anywhere over https (gallery links), and videos from this
 * server or the media CDN.
 */
export function sitePolicy(cfg: Config): string {
  let fl = ''; try { if (cfg.yodlee.fastLinkUrl) fl = new URL(cfg.yodlee.fastLinkUrl).origin; } catch { /* a bad URL simply adds nothing */ }
  return ["default-src 'self'", "script-src 'self' https://checkout.razorpay.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com',
    "img-src 'self' data: https:", `media-src 'self'${cfg.mediaCdn ? ' ' + cfg.mediaCdn : ''}`, `connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com`, `frame-src https://api.razorpay.com https://checkout.razorpay.com${fl ? ' ' + fl : ''}`,
    "object-src 'none'", "base-uri 'none'", `form-action 'self'${fl ? ' ' + fl : ''}`, frameAncestorsPolicy(cfg)].join('; ');
}

/** `frame` replaces the blanket X-Frame-Options: DENY, which would stop the Wix page from embedding the app. */
function send(res: ServerResponse, r: Reply, extra: Record<string, string>, frame?: string): void {
  const base: Record<string, string> = { ...SECURITY_HEADERS };
  if (frame) { delete base['X-Frame-Options']; base['Content-Security-Policy'] = frame; }
  const headers: Record<string, string> = { ...base, ...extra, ...(r.headers ?? {}) };
  let payload: Buffer | string | undefined;
  if (r.raw !== undefined) {
    payload = r.raw;
    headers['Content-Type'] = r.contentType ?? 'application/octet-stream';
  } else if (r.body !== undefined && r.status !== 204) {
    payload = JSON.stringify(r.body);
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }
  if (payload !== undefined) headers['Content-Length'] = String(Buffer.byteLength(payload));
  res.writeHead(r.status, headers);
  res.end(payload);
}

export function errorBody(e: HttpError) {
  return { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } };
}

export function createApp(cfg: Config, router: Router): Server {
  setVaultKey(cfg.fieldKey);
  configureIntake(cfg);
  const DEFAULT_BODY = 256 * 1024;
  return createServer(async (req, res) => {
    const started = Date.now();
    const ip = clientIp(req, cfg.trustProxy);
    let status = 500;
    let pathForLog = req.url ?? '';
    const cors = corsHeaders(cfg, req.headers.origin as string | undefined);
    try {
      let url: URL;
      try { url = new URL(req.url ?? '/', 'http://x'); } catch { throw new HttpError(400, 'BAD_URL', 'Bad address'); }
      pathForLog = url.pathname;
      const method = (req.method ?? 'GET').toUpperCase();

      if (method === 'OPTIONS') {
        status = 204;
        send(res, { status: 204 }, cors);
        return;
      }

      if (url.pathname.startsWith('/media/') && (method === 'GET' || method === 'HEAD')) {
        if (serveLibraryFile(cfg.dataDir, req, res, url.pathname)) { status = res.statusCode; return; }
      }
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/api') {
        if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET');
        // Validate any % escapes before the static layer sees the path.
        safeDecode(url.pathname);
        // a customer business's own address (its domain, or <slug>.<platform address>) shows only its booking page
        let tenant = false;
        try { tenant = !!tenantOfHost(req.headers.host, cfg.platformHost); } catch { /* no database yet: the main site */ }
        const r = serveWeb(cfg, url, typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined, tenant);
        status = r.status;
        send(res, method === 'HEAD' ? { ...r, raw: undefined, body: undefined } : r, cors, sitePolicy(cfg));
        return;
      }

      const m = router.match(method, url.pathname);
      if (m === null) throw new HttpError(404, 'NOT_FOUND', 'No such endpoint');
      if (m === 'method') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'That method is not allowed here');
      const { route, params } = m;

      // An app or tool that says which system it was built for is refused by any other system: a rehearsal build can never act on the live one, nor the reverse.
      const claimed = req.headers['x-daji-env'];
      if (claimed !== undefined && url.pathname !== '/api/health' && claimed !== cfg.appEnv) {
        throw new HttpError(409, 'ENV_MISMATCH', 'This app was built for a different Daji system than the one it is talking to, so the request was not sent through.', { server: cfg.appEnv });
      }

      if (cfg.rateLimit && route.opts.rate !== 'none') {
        const retry = route.opts.rate === 'auth'
          ? limited(`auth|${ip}`, 20, 60_000)
          : limited(`api|${ip}`, 600, 60_000);
        if (retry) {
          const e = new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.');
          status = 429;
          send(res, { status: 429, body: errorBody(e), headers: { 'Retry-After': String(retry) } }, cors);
          return;
        }
      }

      // If who this is cannot be worked out (the database could not answer), nothing is granted and the client is told to retry: never a 200, never a sign-out.
      let user: UserRow | null;
      try { user = authenticate(cfg, req.headers.authorization); } catch (e) {
        if (cfg.log) console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', path: pathForLog, where: 'authenticate', error: String((e as Error)?.message ?? e) }));
        throw new HttpError(503, 'AUTH_UNAVAILABLE', 'We could not check your access just now. Please try again in a moment.');
      }
      // Portfolio: an owner working in another business of their portfolio (X-Daji-Business) is answered as that business's owner,
      // so every scope check keeps the two businesses apart; their own account, sign-in and profile (/api/me, /api/auth) stay theirs.
      const realUser = user;
      const want = req.headers['x-daji-business'];
      // A team member added to another business's team (areas.ts) switches the same way, and is answered as that business's team member.
      if (user && typeof want === 'string' && want && !/^\/api\/(me|auth)(\/|$)/.test(url.pathname)) {
        if (user.role === 'staff') { if (want !== user.owner_id) user = staffSwitchTo(user, want); }
        else if (want !== user.id) user = switchTo(user, want);
      }
      acting.enterWith(user && realUser && user.id !== realUser.id ? { realId: realUser.id, ownerId: user.id } : undefined);
      const a = route.opts.auth;
      if (a) {
        if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
        if (a !== 'user' && !a.includes(user.role)) throw forbidden();
      }

      // Team members must have accepted the current terms before they use anything else (the terms, sign-out and "who am I" stay open).
      if (cfg.requireStaffTerms && user && user.role === 'staff' && !/^\/api\/(legal\/|auth\/logout|me$)/.test(url.pathname) && needsTerms(user)) {
        throw new HttpError(403, 'TERMS_REQUIRED', 'Please read and accept the team terms of use to continue');
      }

      // A team member marked "Read only" can look at everything their role opens, but every change is refused here.
      if (a) refuseIfReadOnly(user, method, url.pathname);

      const raw = method === 'GET' || method === 'HEAD' || route.opts.stream ? Buffer.alloc(0) : await readBody(req, route.opts.maxBody ?? DEFAULT_BODY);
      if (route.opts.upload) await gateUpload(raw, route.opts.upload, user ? { id: user.id, role: user.role } : null, user ? (user.role === 'staff' ? user.owner_id : user.id) : null);
      let parsed: unknown;
      const ctx: Ctx = {
        req, res, url, params, query: url.searchParams, ip, cfg, user, realUser, raw,
        json() {
          if (parsed !== undefined) return parsed;
          if (raw.length === 0) return (parsed = {});
          try { return (parsed = JSON.parse(raw.toString('utf8'))); } catch { throw new HttpError(400, 'BAD_JSON', 'The request body is not valid JSON'); }
        },
      };
      const idemKey = route.opts.idempotent ? parseIdempotencyKey(req.headers['idempotency-key']) : null;
      if (route.opts.idempotent === 'required' && !idemKey) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header so a retry cannot repeat this action');
      const scope = user ? (realUser && realUser !== user ? `u:${realUser.id}@${user.id}` : `u:${user.id}`) : `ip:${ip}`;
      if (idemKey) {
        const begin = idemBegin(scope, idemKey, method, url.pathname + url.search, requestHash(method, url.pathname + url.search, raw));
        if (begin.kind === 'replay') {
          status = begin.status;
          send(res, { status: begin.status, raw: begin.body, contentType: 'application/json; charset=utf-8', headers: { 'Idempotent-Replayed': 'true' } }, { ...cors, 'Cache-Control': 'no-store' });
          return;
        }
      }
      let out: Reply;
      try { out = await route.handler(ctx); } catch (e) { if (idemKey) idemAbandon(scope, idemKey); throw e; }
      if ((out as unknown) === HANDLED) { if (idemKey) idemAbandon(scope, idemKey); status = res.statusCode; return; }
      if (idemKey) {
        if (out.status >= 200 && out.status < 300 && out.raw === undefined) idemFinish(scope, idemKey, out.status, out.body === undefined ? '' : JSON.stringify(out.body));
        else idemAbandon(scope, idemKey);
      }
      status = out.status;
      send(res, out, { ...cors, 'Cache-Control': 'no-store' });
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof HttpError) {
        status = e.status;
        send(res, { status: e.status, body: errorBody(e) }, { ...cors, 'Cache-Control': 'no-store' });
      } else {
        status = 500;
        if (cfg.log) console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', path: pathForLog, error: String((e as Error)?.stack ?? e) }));
        send(res, { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong on our side' } } }, { ...cors, 'Cache-Control': 'no-store' });
      }
    } finally {
      if (cfg.log && pathForLog !== '/api/health') {
        console.log(JSON.stringify({ t: new Date().toISOString(), method: req.method, path: pathForLog, status, ms: Date.now() - started, ip }));
      }
    }
  });
}
