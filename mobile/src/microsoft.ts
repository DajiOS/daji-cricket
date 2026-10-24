import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { API_URL, api, setToken } from './api';
import type { User } from './types';
import { ADMIN_APP } from './variant';

// Sign in with Microsoft. The server does the talking to Microsoft (server/src/microsoft.ts); the app opens it in the phone's own
// browser sheet, gets back a one-time ticket on its own link (dajicricket:// or dajiadmin://) and swaps it, with a secret only this
// app knows, for a normal sign-in. Microsoft only signs in people who already have an account with the same email.
const SCHEME = ADMIN_APP ? 'dajiadmin' : 'dajicricket';
const b64url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export type MicrosoftResult = { token: string; user: User } | { needCode: true; finish: (code: string) => Promise<{ token: string; user: User }> } | null;

/** Null when the person closed the sheet. Throws with a sentence to show when Microsoft or the server said no. */
export async function signInWithMicrosoft(): Promise<MicrosoftResult> {
  const verifier = Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
  const challenge = b64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
  const back = `${SCHEME}://auth/microsoft`;
  const r = await WebBrowser.openAuthSessionAsync(`${API_URL}/api/auth/microsoft/start?app=${SCHEME}&challenge=${challenge}`, back);
  if (r.type !== 'success') return null;
  const q = new URLSearchParams(r.url.split('?')[1] ?? '');
  const error = q.get('error'); if (error) throw new Error(error);
  const ticket = q.get('ticket'); if (!ticket) throw new Error('Microsoft sign-in did not finish. Try again.');
  const redeem = async (code?: string) => {
    const s = await api<{ token: string; user: User }>('/api/auth/microsoft/redeem', { method: 'POST', body: { ticket, verifier, ...(code ? { code } : {}) } });
    await setToken(s.token);
    return s;
  };
  try { return await redeem(); } catch (e: any) {
    if (e.code === 'MFA_REQUIRED') return { needCode: true, finish: (code: string) => redeem(code.trim()) };
    throw e;
  }
}
