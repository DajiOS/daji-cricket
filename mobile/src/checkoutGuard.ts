// What the payment window (a WebView showing the provider's checkout) may load, and what it may tell the app. Pure code, tested on the server side.
// The window only ever shows the provider's own pages: an exact host list over https, no sign-in in the address, no odd port. A look-alike such as
// checkout.razorpay.com.evil.example, checkout-razorpay.com or razorpay.com@evil.example is not on the list. What the window reports back is checked for shape
// and for the order it was opened for; it is only a hint to ask the server, which verifies the payment itself. A message is never proof of payment.

export const CHECKOUT_HOSTS: readonly string[] = ['checkout.razorpay.com', 'api.razorpay.com', 'cdn.razorpay.com', 'lumberjack.razorpay.com'];

export function isAllowedCheckoutUrl(raw: string): boolean {
  if (raw === 'about:blank') return true;
  if (raw.includes('\\') || /[\u0000-\u001f\u007f\s]/.test(raw)) return false; // different parsers read a backslash or hidden characters differently; none is ever in a provider address
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  return CHECKOUT_HOSTS.includes(u.hostname.toLowerCase());
}

/** For `originWhitelist`: only the provider's checkout origins. */
export const CHECKOUT_ORIGINS: string[] = CHECKOUT_HOSTS.map((h) => `https://${h}`);

export type CheckoutMessage =
  | { kind: 'dismiss' }
  | { kind: 'paid'; orderId?: string; paymentId: string; signature: string };

/** Reads what the window reported. Returns null for anything that is not exactly the expected shape, or that names a different order than the one the window was opened for. */
export function parseCheckoutMessage(data: unknown, expectedOrderId?: string): CheckoutMessage | null {
  if (typeof data !== 'string' || data.length > 2000) return null;
  let m: any;
  try { m = JSON.parse(data); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const keys = Object.keys(m);
  if (keys.length === 1 && keys[0] === 'dismiss' && m.dismiss === true) return { kind: 'dismiss' };
  if (keys.length !== 1 || keys[0] !== 'ok') return null;
  const ok = m.ok;
  if (!ok || typeof ok !== 'object' || Array.isArray(ok)) return null;
  const allowed = new Set(['orderId', 'paymentId', 'signature']);
  if (Object.keys(ok).some((k) => !allowed.has(k))) return null;
  const { orderId, paymentId, signature } = ok as Record<string, unknown>;
  if (typeof paymentId !== 'string' || !/^pay_[A-Za-z0-9]{6,40}$/.test(paymentId)) return null;
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return null;
  if (orderId !== undefined && (typeof orderId !== 'string' || !/^order_[A-Za-z0-9]{6,40}$/.test(orderId))) return null;
  if (expectedOrderId !== undefined && orderId !== undefined && orderId !== expectedOrderId) return null;
  return { kind: 'paid', ...(orderId ? { orderId } : {}), paymentId, signature };
}
