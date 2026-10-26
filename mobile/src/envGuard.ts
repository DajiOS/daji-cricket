// Which Daji system this build talks to. It is decided once, from the build settings, and checked three ways: the settings must be complete and agree with each other,
// every request names the system it was built for (the server refuses a different one), and the server's own answer to /api/health must name the same system.
// A rehearsal (test) build can therefore never act on the live system, nor a live build on a rehearsal. Pure code, no app libraries, so it is tested on the server side too.

export type ClientEnv = 'live' | 'test' | 'dev';
export interface ClientTarget { appEnv: ClientEnv; apiUrl: string }
export class EnvConfigError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }

/** The hosts that are the live system. A test or dev build may not point at any of these; a live build may point at nothing else. */
export const LIVE_HOSTS: readonly string[] = ['api.dajicricket.com'];
const LIVE_FAMILY = (host: string): boolean => LIVE_HOSTS.includes(host) || host === 'dajicricket.com' || host === 'www.dajicricket.com';
const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

export function resolveTarget(raw: { appEnv?: string; apiUrl?: string }): ClientTarget {
  const appEnv = raw.appEnv;
  if (appEnv !== 'live' && appEnv !== 'test' && appEnv !== 'dev') throw new EnvConfigError('APP_ENV_MISSING', 'This build does not say which Daji system it is for (EXPO_PUBLIC_APP_ENV must be live, test or dev), so it will not connect to anything.');
  if (!raw.apiUrl) throw new EnvConfigError('API_URL_MISSING', 'This build has no server address (EXPO_PUBLIC_API_URL), so it will not connect to anything.');
  let u: URL;
  try { u = new URL(raw.apiUrl); } catch { throw new EnvConfigError('API_URL_INVALID', 'The server address in this build is not a valid address.'); }
  if (u.username || u.password) throw new EnvConfigError('API_URL_INVALID', 'The server address must not contain a sign-in.');
  const host = u.hostname.toLowerCase();
  if (appEnv === 'live') {
    if (u.protocol !== 'https:') throw new EnvConfigError('LIVE_NEEDS_HTTPS', 'A live build only talks to https addresses.');
    if (!LIVE_HOSTS.includes(host) || u.port) throw new EnvConfigError('LIVE_HOST_MISMATCH', `A live build only talks to the live server (${LIVE_HOSTS.join(', ')}).`);
  } else {
    if (LIVE_FAMILY(host)) throw new EnvConfigError('TEST_POINTS_AT_LIVE', `A ${appEnv} build must not point at the live system (${host}).`);
    if (appEnv === 'test' && u.protocol !== 'https:') throw new EnvConfigError('TEST_NEEDS_HTTPS', 'A test build only talks to https addresses.');
    if (appEnv === 'dev' && u.protocol !== 'https:' && !PRIVATE_HOST.test(host)) throw new EnvConfigError('DEV_NEEDS_LOCAL', 'A dev build may use http only for this computer or a private network address.');
  }
  return { appEnv, apiUrl: u.origin };
}

/** Headers every request carries so the server can refuse a request meant for a different system. */
export const envHeaders = (t: ClientTarget): Record<string, string> => ({ 'X-Daji-Env': t.appEnv });

/** Checks the server's /api/health answer against the build. Throws if the server is a different system, or is a live server still in demo mode. */
export function assertServerMatches(t: ClientTarget, health: { env?: unknown; demo?: unknown } | null | undefined): void {
  if (!health || health.env !== t.appEnv) throw new EnvConfigError('ENV_MISMATCH', `This build is for the ${t.appEnv} system but the server says it is ${typeof health?.env === 'string' ? `the ${health.env} system` : 'not identified'}. Nothing was sent.`);
  if (t.appEnv === 'live' && health.demo !== false) throw new EnvConfigError('LIVE_IN_DEMO', 'The live server reports demo mode, so this app will not use it.');
}
