import type { Config } from './config.ts';
import { many, one, run } from './db.ts';
import { now } from './clock.ts';
import { HttpError } from './errors.ts';
import type { Provider } from './notifications.ts';

/** Expo push tokens look like ExponentPushToken[xxxx] (or ExpoPushToken[xxxx]). */
export const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/;

/** Remembers a phone for a person. A token that was on someone else's account (a shared phone) moves to this one. */
export function saveToken(userId: string, token: string, platform: string | null): void {
  if (!EXPO_TOKEN.test(token)) throw new HttpError(400, 'VALIDATION_FAILED', 'That does not look like a push token', { fields: [{ field: 'token', message: 'Must be an Expo push token' }] });
  const t = now();
  run('INSERT INTO push_tokens(token, user_id, platform, created_at, updated_at) VALUES(?,?,?,?,?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at', token, userId, platform, t, t);
}
export function removeToken(userId: string, token: string): void { run('DELETE FROM push_tokens WHERE user_id = ? AND token = ?', userId, token); }
export const tokensOf = (userId: string): string[] => many<{ token: string }>('SELECT token FROM push_tokens WHERE user_id = ?', userId).map((r) => r.token);

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** Sends push notifications through Expo's push service to every phone the person has signed in on. */
export function expoPushProvider(cfg: Config, fetchImpl: Fetch = fetch as unknown as Fetch): Provider {
  void cfg;
  return async (m) => {
    const tokens = tokensOf(m.userId);
    if (!tokens.length) return { ok: false, error: 'no device registered' };
    const res = await fetchImpl('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify(tokens.map((to) => ({ to, title: m.subject ?? 'Daji Cricket Ground', body: m.body, sound: 'default', channelId: 'bookings', data: { bookingId: m.bookingId ?? null, kind: m.template } }))),
    });
    if (!res.ok) return { ok: false, error: `expo ${res.status}` };
    const out = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
    let sent = 0;
    (out?.data ?? []).forEach((r, i) => {
      if (r.status === 'ok') sent++;
      else if (r.details?.error === 'DeviceNotRegistered' && tokens[i]) run('DELETE FROM push_tokens WHERE token = ?', tokens[i]!);
    });
    return sent > 0 ? { ok: true } : { ok: false, error: 'no device accepted it' };
  };
}

export const hasDevice = (userId: string): boolean => !!one('SELECT 1 FROM push_tokens WHERE user_id = ? LIMIT 1', userId);
