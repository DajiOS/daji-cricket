import type { Harness } from './helpers.ts';

let n = 0;

/** Register a new customer account through the public API and return their token. */
export async function register(h: Harness, name: string, phone: string, extra: Record<string, unknown> = {}): Promise<string> {
  n++;
  const r = await h.post('/api/auth/register', { name, phone, email: `user${n}.${phone}@example.test`, password: 'Passw0rd!x', ...extra });
  if (r.status !== 201 && r.status !== 200) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}
