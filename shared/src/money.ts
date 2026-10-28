// Formatting helpers shared by web and mobile. Money is integer paise.

/** Indian digit grouping: 1234567 -> "12,34,567". */
export function groupIndian(n: number): string {
  const s = String(Math.abs(Math.trunc(n)));
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** 123456 -> "₹1,234.56"; whole rupees drop the decimals unless `always` is set. */
export function formatPaise(paise: number, always = false): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const body = groupIndian(rupees) + (p || always ? `.${String(p).padStart(2, '0')}` : '');
  return `${neg ? '-' : ''}₹${body}`;
}

/** "1234.5" -> 123450. Returns null for anything that is not a plain rupee amount. */
export function rupeesToPaise(input: string | number): number | null {
  const s = String(input).trim().replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [r, p = ''] = s.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
}

/**
 * Every phone number is shown with its country code. Indian numbers are kept as their 10 digits, so they get +91:
 * "7567156000" -> "+91 75671 56000". A number from another country is stored with its own +code ("+447911123456") and shown as it is.
 */
export function formatPhone(phone: string | null | undefined): string {
  const p = (phone ?? '').trim();
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  const m = /^(?:91|0)?(\d{5})(\d{5})$/.exec(d);
  if (m && (!p.startsWith('+') || d.startsWith('91'))) return `+91 ${m[1]} ${m[2]}`;
  return p; // already has its own +code, or is not a phone number we can read
}
