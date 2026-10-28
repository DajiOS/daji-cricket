import { formatPaise, type Booking } from '@daji/shared';
import { now } from '../clock.ts';
import type { UserRow } from '../auth.ts';
import { audit } from '../audit.ts';
import { HttpError } from '../errors.ts';
import { getSettings } from '../settings.ts';
import { listBookings } from '../bookings.ts';
import { summary as creditSummary } from '../credits.ts';
import { availability, getGroundOr404, listGrounds, directionsUrl, groundRow } from '../grounds.ts';
import { addDays, dayOfWeek, fmtDateTime, istDate } from '../time.ts';
import { cleanQuestion } from './index.ts';
import { niceDay, parseRange } from './dates.ts';
import { parseBooking } from '../guppiLang.ts';
import { say } from '../guppiText.ts';
import { aiNameAnswer, isNameQuestion } from '../aiNames.ts';
import { mainSiteBusinessId } from '../businesses.ts';

// Ask AI for customers. It answers from the signed-in customer's own bookings and credit, and from the public details
// of the grounds (prices, hours, free slots, directions, the cancellation rules). It never reads anyone else's data
// and never leaves the server. Customers get the built-in answerer only.

export interface CustomerAnswer {
  question: string;
  answer: string;
  details: { label: string; text: string }[];
  /** A page the customer can open to act on the answer. */
  open: 'bookings' | 'book' | 'contact' | null;
  suggestions: string[];
  source: 'builtin';
  intent: string;
}

export const CUSTOMER_EXAMPLES = [
  'When is my next booking?',
  'How much credit do I have?',
  'Is the cricket ground free on Saturday?',
  'What is the cancellation policy?',
  'How much does an evening slot cost?',
  'How do I get there?',
];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const RULES: [string, RegExp][] = [
  ['help', /\b(help|what can you|what (can|do|should) i ask|examples?)\b/],
  ['cancel_policy', /cancel|refund policy|refund rules?|can i get (a|my) refund/],
  ['credit', /\bcredits?\b|wallet|account balance/],
  ['owing', /\bowe\b|\bdue\b|balance (due|pending|left|remaining)|how much (do i|have i to|must i) pay|pending payment|to pay\b/],
  ['next', /next (booking|session|match|game)|upcoming|when (is|are) (my|the next)|my (next|upcoming)|what (do i|have i got) (have )?(booked|coming)/],
  ['history', /past|history|previous|played|how many (bookings?|times|sessions)|\bhow often\b|\ball my (bookings?|sessions?)/],
  ['availability', /available|availability|\bfree\b|\bopen slots?\b|can i book|any slots?|is .* (booked|taken)/],
  ['price', /price|prices|cost|rate|charges?|how much|fees?|per hour|evening|weekend/],
  ['hours', /\bopen\b|opening|closing|\bclose\b|timings?|hours|what time|till when/],
  ['directions', /where|address|directions?|location|map|how (do i|to) (get|reach)|find you/],
  ['contact', /contact|phone|call|number|email|whatsapp|talk to|speak to|reach (you|out)/],
  ['bookings', /bookings?|reservations?|sessions?/],
];

function intentOf(q: string): string {
  const t = q.toLowerCase().replace(/['’`]/g, '').replace(/\s+/g, ' ');
  for (const [i, re] of RULES) if (re.test(t)) return i;
  return 'unknown';
}

/** The date a question is about: today, tomorrow, a weekday (the next one), or any date the reports reader understands. */
function dateIn(q: string, today: string): string | null {
  const t = q.toLowerCase();
  if (/\bday after tomorrow\b/.test(t)) return addDays(today, 2);
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if (/\b(today|tonight|this evening)\b/.test(t)) return today;
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t)) {
      const diff = (i - dayOfWeek(today) + 7) % 7;
      return addDays(today, diff === 0 && /\bnext\b/.test(t) ? 7 : diff);
    }
  }
  const p = parseRange(q, today, 'future');
  return p.span ? p.span.from : null;
}

const hhmm = (t: string): string => t;
// A multi-day booking is one booking: its dates as a range, and the balance across every day
const fmtBooking = (b: Booking): string => b.block
  ? `${b.groundName}, ${niceDay(b.block.fromDate)} to ${niceDay(b.block.toDate)} (${b.block.days} days, ref ${b.ref})`
  : `${b.groundName}, ${fmtDateTime(b.startAt)} (${b.slotCount} ${b.slotCount === 1 ? 'slot' : 'slots'}, ref ${b.ref})`;
const balanceOf = (b: Booking): number => (b.block ? b.block.balancePaise : b.balancePaise);

export function askCustomer(user: UserRow, rawQuestion: unknown, via: 'typed' | 'voice' = 'typed'): CustomerAnswer {
  if (user.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'This assistant is for customers');
  const question = cleanQuestion(rawQuestion);
  const intent = intentOf(question);
  const t = now();
  const today = istDate(t);
  const s = getSettings();
  // the customer assistant speaks for the main website and its app, so it knows only the main site's business's grounds
  const grounds = listGrounds({ ownerId: mainSiteBusinessId() ?? undefined });
  const named = grounds.find((g) => question.toLowerCase().includes(g.name.toLowerCase()))
    ?? grounds.find((g) => g.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !['daji', 'cricket', 'ground'].includes(w)).some((w) => question.toLowerCase().includes(w)))
    ?? null;
  const g0 = named ?? grounds[0] ?? null;
  const out = (answer: string, extra: Partial<CustomerAnswer> = {}): CustomerAnswer => {
    audit({ id: user.id, role: user.role }, 'ask.customer', 'ask', null, { question: question.slice(0, 200), intent, ...(via === 'voice' ? { via } : {}) }, null);
    return { question, answer, details: [], open: null, suggestions: [], source: 'builtin', intent, ...extra };
  };

  // Asked in any language to pay, confirm or mark a payment, or to waive a deposit: the same Daji-native refusal Guppi gives when booking. This assistant only reads.
  const asked = parseBooking(question, today);
  if (asked.flags.payAct || asked.flags.waiver) return out(say(asked.language, asked.flags.waiver ? 'waiver' : 'payAct'), { intent: 'payment_boundary', open: 'bookings' });

  if (isNameQuestion(question)) return out(aiNameAnswer(user.id), { intent: 'assistant_name' });

  switch (intent) {
    case 'next': {
      const up = listBookings({ customerId: user.id, from: today, limit: 50, offset: 0, collapse: true }).items
        .filter((b) => (b.block ? !b.block.cancelled && b.block.toDate >= today : (b.status === 'confirmed' || b.status === 'held') && b.endAt > t)).sort((a, b) => a.startAt - b.startAt);
      if (!up.length) return out('You have no upcoming bookings.', { open: 'book', suggestions: ['Is the cricket ground free on Saturday?'] });
      const [n, ...rest] = up;
      const bits = [`Your next booking is ${fmtBooking(n!)}.`];
      if (n!.status === 'held') bits.push('It is held for you until you pay the advance.');
      else if (balanceOf(n!) > 0) bits.push(`${formatPaise(balanceOf(n!))} is still to pay.`);
      return out(bits.join(' '), { details: rest.slice(0, 5).map((b) => ({ label: 'Then', text: fmtBooking(b) })), open: 'bookings' });
    }
    case 'history':
    case 'bookings': {
      const all = listBookings({ customerId: user.id, limit: 200, offset: 0 }).items;
      const played = all.filter((b) => b.status === 'completed' || (b.status === 'confirmed' && b.endAt <= t));
      // sessions played are counted day by day; what is still to come counts a multi-day booking once
      const up = listBookings({ customerId: user.id, from: today, limit: 200, offset: 0, collapse: true }).items
        .filter((b) => (b.block ? !b.block.cancelled && b.block.toDate >= today : (b.status === 'confirmed' || b.status === 'held') && b.endAt > t));
      const hrs = played.reduce((n, b) => n + b.slotCount, 0);
      if (!all.length) return out('You have not made a booking yet.', { open: 'book' });
      return out(`You have played ${played.length} ${played.length === 1 ? 'session' : 'sessions'} (${hrs} ${hrs === 1 ? 'slot' : 'slots'}) and have ${up.length} upcoming.`,
        { details: played.slice(0, 5).map((b) => ({ label: 'Recent', text: fmtBooking(b) })), open: 'bookings' });
    }
    case 'credit': {
      const c = creditSummary(user.id);
      if (c.balancePaise <= 0) return out('You have no account credit right now.', { open: 'bookings' });
      const soon = c.lots.filter((l) => l.remainingPaise > 0 && !l.expiredAt && l.expiresAt > t).sort((a, b) => a.expiresAt - b.expiresAt)[0];
      return out(`You have ${formatPaise(c.balancePaise)} in account credit.${soon ? ` The earliest part of it expires on ${niceDay(istDate(soon.expiresAt))}.` : ''} Credit can only be used at the ground it came from.`,
        { details: c.byOwner.map((o) => ({ label: o.ownerName, text: formatPaise(o.balancePaise) })), open: 'book' });
    }
    case 'owing': {
      const rows = listBookings({ customerId: user.id, from: today, limit: 100, offset: 0, collapse: true }).items
        .filter((b) => (b.block ? !b.block.cancelled && b.status !== 'held' : b.status === 'confirmed') && balanceOf(b) > 0);
      const held = listBookings({ customerId: user.id, status: 'held', limit: 20, offset: 0, collapse: true }).items;
      if (!rows.length && !held.length) return out('You owe nothing. Every upcoming booking is paid in full.');
      const total = rows.reduce((n, b) => n + balanceOf(b), 0);
      return out(`${rows.length ? `${formatPaise(total)} is still to pay across ${rows.length} upcoming ${rows.length === 1 ? 'booking' : 'bookings'}.` : ''}${held.length ? ` ${held.length} ${held.length === 1 ? 'slot is' : 'slots are'} held until you pay the advance.` : ''}`.trim(),
        { details: [...rows, ...held].slice(0, 6).map((b) => ({ label: b.ref, text: `${b.groundName}, ${b.block ? `${niceDay(b.block.fromDate)} to ${niceDay(b.block.toDate)}` : fmtDateTime(b.startAt)}${b.status === 'held' ? ', held' : `, ${formatPaise(balanceOf(b))} to pay`}` })), open: 'bookings' });
    }
    case 'cancel_policy': {
      const mine = listBookings({ customerId: user.id, from: today, limit: 50, offset: 0 }).items.filter((b) => b.status === 'confirmed' && b.startAt > t).sort((a, b) => a.startAt - b.startAt)[0];
      const rule = `Cancel more than ${s.freeCancelHours} hours before the start and it is free: you can take ${s.cashRefundPercent}% of what you paid back to your original payment method, or keep the full amount as account credit. Inside ${s.freeCancelHours} hours there is no cash refund, but ${s.lateCancelCreditPercent}% of what you paid is added to your account credit, which expires after ${s.creditExpiryDays} days. A no-show gets nothing back.`;
      const free = mine ? (mine.startAt - t) / 3_600_000 > s.freeCancelHours : null;
      return out(rule, { details: mine ? [{ label: 'Your next booking', text: `${fmtBooking(mine)}. ${free ? 'You can still cancel it free.' : 'It is inside the free-cancellation window.'}` }] : [], open: mine ? 'bookings' : null });
    }
    case 'price': {
      const list = named ? [named] : grounds;
      if (!list.length) return out('There are no grounds listed at the moment.');
      if (s.pricesOnEnquiry) return out('Prices are given on enquiry. Pick a free slot on the Book page and send an enquiry for it, and the ground will reply with the price.', { open: 'book' });
      const parts = list.map((g) => {
        const wk = g.weekendPricePaise && g.weekendPricePaise !== g.pricePaise ? `, ${formatPaise(g.weekendPricePaise)} at weekends` : '';
        const ev = g.eveningSurchargePaise ? `, plus ${formatPaise(g.eveningSurchargePaise)} from ${hhmm(g.eveningFrom)}` : '';
        return { label: g.name, text: `${formatPaise(g.pricePaise)} an hour${wk}${ev}` };
      });
      return out(list.length === 1 ? `${list[0]!.name}: ${parts[0]!.text}.` : 'Prices per hour are below. Evening prices apply from the time shown.', { details: list.length === 1 ? [] : parts, open: 'book' });
    }
    case 'hours': {
      if (!g0) return out('There are no grounds listed at the moment.');
      const list = named ? [named] : grounds;
      const same = list.every((g) => g.openTime === list[0]!.openTime && g.closeTime === list[0]!.closeTime);
      return out(same ? `Open every day, ${list[0]!.openTime} to ${list[0]!.closeTime}.` : 'Opening times are below.', { details: same ? [] : list.map((g) => ({ label: g.name, text: `${g.openTime} to ${g.closeTime}` })) });
    }
    case 'availability': {
      if (!g0) return out('There are no grounds listed at the moment.');
      const date = dateIn(question, today);
      if (!date) return out('Tell me the day, for example "Is the cricket ground free on Saturday?" or "any slots tomorrow evening?"', { suggestions: ['Is the main turf free tomorrow?'] });
      if (date < today) return out('That date has passed. Ask about today or a day ahead.');
      const row = groundRow(g0.id)!;
      const slots = availability(getGroundOr404(row.id), date).slots;
      const free = slots.filter((x) => x.state === 'available');
      const eve = /evening|night|after (5|6|7)/.test(question.toLowerCase());
      const pick = eve ? free.filter((x) => x.time >= g0.eveningFrom) : free;
      if (!pick.length) return out(`${g0.name} has no free${eve ? ' evening' : ''} slots on ${niceDay(date)}.`, { open: 'book', suggestions: [`Is ${g0.name} free on ${niceDay(addDays(date, 1), false)}?`] });
      const shown = pick.slice(0, 12).map((x) => x.time).join(', ');
      return out(`${g0.name} has ${pick.length} free ${pick.length === 1 ? 'slot' : 'slots'} on ${niceDay(date)}${eve ? ' in the evening' : ''}: ${shown}${pick.length > 12 ? ' and more' : ''}.${s.pricesOnEnquiry ? ' Pick one on the Book page and send an enquiry for its price.' : ` From ${formatPaise(Math.min(...pick.map((x) => x.pricePaise)))} an hour.`}`, { open: 'book' });
    }
    case 'directions': {
      if (!g0) return out('There are no grounds listed at the moment.');
      const row = groundRow(g0.id)!;
      const url = directionsUrl(row);
      return out(`${g0.name}${g0.area ? `, ${g0.area}` : ''}, ${g0.city}.${g0.address ? ` ${g0.address}.` : ''}${url ? ` Directions: ${url}` : ''}`, { open: 'contact' });
    }
    case 'contact':
      return out(`Call or write to ${s.contactName}: ${s.contactPhone}${s.contactEmail ? `, ${s.contactEmail}` : ''}.`, { open: 'contact' });
    default:
      return out('I can answer questions about your own bookings and credit, and about the grounds: prices, opening times, free slots and directions. I cannot make or change a booking, take or confirm a payment, or waive or refund anything, so use the booking panel or My bookings for that.',
        { suggestions: CUSTOMER_EXAMPLES, open: null, intent: 'help' });
  }
}
