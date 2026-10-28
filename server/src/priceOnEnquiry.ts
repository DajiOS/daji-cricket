// Prices on enquiry (Settings › Booking): customers see free slots but no prices, and ask for the price of a slot instead of paying for it online.
// The prices the owner set are kept and still used by the desk; only what customers are shown, and how they ask, changes. Staff screens are untouched.
import { getSettings } from './settings.ts';
import { HttpError } from './errors.ts';
import { registerSchema } from './db.ts';

// the slot a pricing enquiry is about, so the desk can quote it and turn it into a booking without asking again.
// Sunny Patel switched prices on enquiry on for Daji (28 Oct 2026); this release turns it on once, and the owner can switch it off in Settings › Booking.
registerSchema('prices-on-enquiry-1', `ALTER TABLE enquiries ADD COLUMN preferred_time TEXT; ALTER TABLE enquiries ADD COLUMN preferred_slots INTEGER; ALTER TABLE enquiries ADD COLUMN preferred_label TEXT;
INSERT OR IGNORE INTO settings(key, value, updated_at, updated_by) VALUES('pricesOnEnquiry', 'true', 0, NULL);`);

/** Prices are hidden from this caller: a visitor or a customer while the setting is on. */
export const pricesHidden = (user: { role: string } | null | undefined): boolean => !!getSettings().pricesOnEnquiry && (!user || user.role === 'customer');

const PRICE_KEYS = new Set(['pricePaise', 'fullPricePaise', 'weekendPricePaise', 'eveningSurchargePaise', 'totalPaise', 'advancePaise', 'payNowPaise', 'dueNowPaise', 'discountPaise']);

/** A copy with every price taken out (null), and the free-text price note too, for a caller who must not see prices. */
export function withoutPrices<T>(x: T): T {
  if (Array.isArray(x)) return x.map(withoutPrices) as T;
  if (!x || typeof x !== 'object') return x;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x)) out[k] = PRICE_KEYS.has(k) || k === 'ratesNote' ? null : withoutPrices(v);
  out.priceOnEnquiry = true;
  return out as T;
}

export const pricesFor = <T>(user: { role: string } | null | undefined, x: T): T => (pricesHidden(user) ? withoutPrices(x) : x);

/** An online booking by a customer is refused while prices are on enquiry: the slot goes to the ground as a pricing enquiry instead. */
export function refuseOnlineBooking(user: { role: string } | null | undefined): void {
  if (pricesHidden(user)) throw new HttpError(409, 'PRICE_ON_ENQUIRY', 'Prices are given on enquiry. Send an enquiry for this slot and the ground will reply with the price.');
}
