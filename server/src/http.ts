import { setVaultKey } from './vault.ts';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Role } from '@daji/shared';
import { originAllowed, type Config } from './config.ts';
import { authenticate, type UserRow } from './auth.ts';
import { HttpError, forbidden } from './errors.ts';
import { now } from './clock.ts';
import { serveWeb } from './site.ts';

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
  raw: Buffer;
  /** Parsed JSON body; `{}` when the body is empty. */
  json(): unknown;
}
export type Handler = (c: Ctx) => Reply | Promise<Reply>;

export interface RouteOpts {
  /** 'user' = any signed-in user; a role list restricts to those roles; omitted = public. */
  auth?: 'user' | Role[];
  maxBody?: number;
  rate?: 'auth' | 'none';
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
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
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
 * Razorpay's checkout script and frame, Google Fonts, and images from anywhere over https (gallery links).
 */
export function sitePolicy(cfg: Config): string {
  let fl = ''; try { if (cfg.yodlee.fastLinkUrl) fl = new URL(cfg.yodlee.fastLinkUrl).origin; } catch { /* a bad URL simply adds nothing */ }
  return ["default-src 'self'", "script-src 'self' https://checkout.razorpay.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com',
    "img-src 'self' data: https:", `connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com`, `frame-src https://api.razorpay.com https://checkout.razorpay.com${fl ? ' ' + fl : ''}`,
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

      if (!url.pathname.startsWith('/api/') && url.pathname !== '/api') {
        if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET');
        // Validate any % escapes before the static layer sees the path.
        safeDecode(url.pathname);
        const r = serveWeb(cfg, url);
        status = r.status;
        send(res, method === 'HEAD' ? { ...r, raw: undefined, body: undefined } : r, cors, sitePolicy(cfg));
        return;
      }

      const m = router.match(method, url.pathname);
      if (m === null) throw new HttpError(404, 'NOT_FOUND', 'No such endpoint');
      if (m === 'method') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'That method is not allowed here');
      const { route, params } = m;

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

      const user = authenticate(cfg, req.headers.authorization);
      const a = route.opts.auth;
      if (a) {
        if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
        if (a !== 'user' && !a.includes(user.role)) throw forbidden();
      }

      const raw = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readBody(req, route.opts.maxBody ?? DEFAULT_BODY);
      let parsed: unknown;
      const ctx: Ctx = {
        req, res, url, params, query: url.searchParams, ip, cfg, user, raw,
        json() {
          if (parsed !== undefined) return parsed;
          if (raw.length === 0) return (parsed = {});
          try { return (parsed = JSON.parse(raw.toString('utf8'))); } catch { throw new HttpError(400, 'BAD_JSON', 'The request body is not valid JSON'); }
        },
      };
      const out = await route.handler(ctx);
      if ((out as unknown) === HANDLED) { status = res.statusCode; return; }
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
