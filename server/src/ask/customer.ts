import { formatPaise, formatPhone, type Booking } from '@daji/shared';
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
import { isUiLanguageQuestion, uiLanguageAnswer } from '../uiLanguage.ts';
import { customerAuctionFacts, editableHosted, rulesWordsOf } from '../auction.ts';
import { draftRuleChange, rulesInWords } from '../auctionRules.ts';
import { myWaitlist, tierFor } from '../waitlist.ts';
import { myCricket } from '../playerStats.ts';
import { listForPlayer, myFantasy } from '../fantasy.ts';
import { mainSiteBusinessId } from '../businesses.ts';

// Ask AI for customers. It answers from the signed-in customer's own bookings and credit, and from the public details
// of the grounds (prices, hours, free slots, directions, the cancellation rules). It never reads anyone else's data
// and never leaves the server. Customers get the built-in answerer only.

export interface CustomerAnswer {
  question: string;
  answer: string;
  details: { label: string; text: string }[];
  /** A page the customer can open to act on the answer. */
  open: 'bookings' | 'book' | 'contact' | 'auction' | 'fantasy' | null;
  /** The auction the answer is about, when open is 'auction'. */
  auctionId?: string;
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
  'Was I picked in the auction?',
  'Am I on the Sunday waitlist?',
  'How many games have I played?',
  'What is my batting average?',
  'How is my fantasy team doing?',
];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const RULES: [string, RegExp][] = [
  ['help', /\b(help|what can you|what (can|do|should) i ask|examples?)\b/],
  ['fantasy', /\bfantasy\b|\bdream ?11\b|ફેન્ટસી|फैंटसी|फैंटेसी/],
  ['auction', /\bauctions?\b|\bsquads?\b|\bpurse\b|\bbid(s|ding)?\b|(was|am|have) i (been )?(picked|sold|bought|selected)|which team (picked|bought|got|has) me|who (picked|bought) me|base price/],
  ['games', /how many games|games (have i|i have|i've) played|games? played|my tier|which tier|what tier|check.?in|kitne (match|game)|કેટલી મેચ|कितने मैच/],
  ['cricket', /\b(career|cricket|my) (stats|statistics|record)\b|\bmy stats\b|\bbatting\b|\bbowling\b|\baverage\b|strike rate|\beconomy\b|how many (runs|wickets|catches|sixes|fours)|\bmy (runs|wickets|catches|highest|best)\b|highest score|best (score|figures)|centur(y|ies)|fift(y|ies)|\bducks?\b|stumpings?|કેટલા રન|કેટલી વિકેટ|कितने रन|कितने विकेट/],
  ['waitlist', /wait.?list|waiting list|on the list|my (place|turn|request)|વેઇટિંગ|વેટિંગ|वेटिंग|प्रतीक्षा/],
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
  if (isUiLanguageQuestion(question)) return out(uiLanguageAnswer(user.id), { intent: 'screen_language' });
  if (intent === 'auction') return auctionAnswer(user, question, today, out);

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
    case 'games': {
      // games the customer played (checked in at the ground), their tier and the next one; their own numbers only
      const w = myWaitlist(user);
      const tiers = [...w.settings.tiers].sort((a, b) => a.minGames - b.minGames);
      const next = tiers.find((t) => t.minGames > w.games);
      const bits = [`You have played ${w.games} ${w.games === 1 ? 'game' : 'games'} here in the last 12 months.`];
      const tier = tierFor(w.games).tier;
      bits.push(tier ? `That makes you ${tier}.` : 'You are not in a tier yet.');
      if (next) bits.push(`${next.minGames - w.games} more to reach ${next.name} (${next.minGames} games).`);
      bits.push('A game counts when you check in at the ground in the Daji app on your own phone (unlock, selfie, location), or the ground staff check you in. The person who booked adds you to the team list with your mobile number.');
      return out(bits.join(' '), { details: tiers.slice().reverse().map((t) => ({ label: t.name, text: `${t.minGames} games or more` })) });
    }
    case 'fantasy': {
      // the customer's own fantasy teams and the contests open to join; picking a team is done on the Fantasy screen, never here
      const mine = myFantasy(user);
      const open = listForPlayer(user).items.filter((c) => c.state === 'open' && !c.mine);
      const bits: string[] = [];
      if (!mine.items.length) bits.push('You have not picked a fantasy team yet.');
      else {
        const last = mine.items[0]!;
        bits.push(`Your team ${last.teamName} in ${last.match} has ${last.points} ${last.points === 1 ? 'point' : 'points'}${last.rank ? `, ${last.rank} of ${last.teams}` : last.state === 'open' ? ' so far: the contest has not locked yet' : ''}${last.removed ? ' (the ground removed this team)' : ''}.`);
        if (mine.wins || mine.totalPoints) bits.push(`In finished contests you have ${mine.totalPoints} points${mine.wins ? ` and ${mine.wins} ${mine.wins === 1 ? 'win' : 'wins'}` : ''}.`);
      }
      bits.push(open.length ? `${open.length} ${open.length === 1 ? 'contest is' : 'contests are'} open to join.` : 'No contest is open to join right now.');
      bits.push('Fantasy is free to play: points only, no entry fee and no prize.');
      return out(bits.join(' '), { details: mine.items.slice(0, 5).map((x) => ({ label: `${x.match} · ${x.teamName}`, text: `${x.points} points${x.rank ? `, place ${x.rank} of ${x.teams}` : ''}` })), open: 'fantasy' });
    }
    case 'cricket': {
      // the customer's own career record, from finished matches where they are in a squad linked to their profile
      const r = myCricket(user);
      const c = r.career, b = c.batting, w = c.bowling, f = c.fielding;
      if (!c.matches) return out('You have no scored matches on your record yet. A match goes on your record when the scorer has you in a squad linked to your Daji profile (the ground adds you by your mobile number, or from your booking\'s team list) and the match is finished.');
      const bits = [`In ${c.matches} ${c.matches === 1 ? 'match' : 'matches'} you have scored ${b.runs} ${b.runs === 1 ? 'run' : 'runs'} in ${b.innings} ${b.innings === 1 ? 'innings' : 'innings'}${b.highest ? ` (highest ${b.highest}${b.average !== null ? `, average ${b.average}` : ''}${b.strikeRate !== null ? `, strike rate ${b.strikeRate}` : ''})` : ''}`];
      bits.push(`and taken ${w.wickets} ${w.wickets === 1 ? 'wicket' : 'wickets'}${w.best ? ` (best ${w.best}${w.economy !== null ? `, economy ${w.economy}` : ''})` : ''}.`);
      if (f.catches || f.runOuts || f.stumpings) bits.push(`In the field: ${f.catches} ${f.catches === 1 ? 'catch' : 'catches'}, ${f.runOuts} run ${f.runOuts === 1 ? 'out' : 'outs'}, ${f.stumpings} ${f.stumpings === 1 ? 'stumping' : 'stumpings'}.`);
      return out(bits.join(' '), { details: r.matches.slice(0, 5).map((m) => ({ label: `${niceDay(istDate(m.date))} v ${m.opponent}`, text: m.summary })), open: 'bookings' });
    }
    case 'waitlist': {
      // the customer's own requests only, and how the waitlist works; accepting is done on the Waitlist screen, never here
      const w = myWaitlist(user);
      if (!w.settings.enabled) return out(`The ${w.settings.name} waitlist is not open at the moment. Book a free slot, or call ${s.contactName} on ${formatPhone(s.contactPhone)}.`, { open: 'book' });
      const how = `A session still free ${w.settings.confirmHours} hours before it starts is offered to everyone waiting for that day, and the first to accept gets it; otherwise you move to the next week, for up to a year.`;
      const live = w.entries.filter((e) => e.status === 'waiting' || e.status === 'won');
      const offer = w.offers.find((o) => !o.yours);
      const bits: string[] = [];
      if (offer) bits.push(`${offer.session} at ${offer.groundName} on ${niceDay(offer.date)} (${offer.time}) is free for you now. Open My bookings › Waitlist to accept it before someone else does.`);
      if (!live.length) bits.push(`You are not on the ${w.settings.name} waitlist. You can join it from My bookings › Waitlist.`);
      else bits.push(live.length === 1 ? `You are on the waitlist for ${live[0]!.session} at ${live[0]!.groundName}, for ${niceDay(live[0]!.nextDate)}.` : `You are on the waitlist for ${live.length} sessions.`);
      if (w.tier) bits.push(`You have played ${w.games} ${w.games === 1 ? 'game' : 'games'} here in the last 12 months, so you are ${w.tier} and hear about free sessions early.`);
      bits.push(how);
      return out(bits.join(' '), { details: live.map((e) => ({ label: e.groundName, text: `${e.session}, ${e.status === 'won' ? 'you accepted a slot for' : 'waiting for'} ${niceDay(e.nextDate)}${e.everyWeek ? ', every week' : ''}${e.rollovers ? `, moved on ${e.rollovers} ${e.rollovers === 1 ? 'week' : 'weeks'} so far` : ''}` })), open: 'bookings' });
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
      return out(`Call or write to ${s.contactName}: ${formatPhone(s.contactPhone)}${s.contactEmail ? `, ${s.contactEmail}` : ''}.`, { open: 'contact' });
    default:
      return out('I can answer questions about your own bookings and credit, and about the grounds: prices, opening times, free slots and directions. I cannot make or change a booking, take or confirm a payment, or waive or refund anything, so use the booking panel or My bookings for that.',
        { suggestions: CUSTOMER_EXAMPLES, open: null, intent: 'help' });
  }
}

const CHANGE_WORDS = /\b(change|make|set|increase|decrease|raise|lower|reduce|put|switch|turn|add (a |this )?(house )?rule|update|instead)\b/;

/**
 * Auction tournaments. A host asking to change the rules gets Platform AI's draft, which is not saved: they confirm it on
 * the auction page. Points only; anything about money is refused by the same draft rules.
 */
function auctionAnswer(user: UserRow, question: string, today: string, out: (answer: string, extra?: Partial<CustomerAnswer>) => CustomerAnswer): CustomerAnswer {
  if (!getSettings().auctionTournamentsEnabled) return out('Auction tournaments are switched off for now. Please call the ground.', { intent: 'auction' });
  const q = question.toLowerCase();
  const editable = editableHosted(user);
  const named = <T extends { name: string }>(list: T[]): T | null => list.find((a) => q.includes(a.name.toLowerCase())) ?? (list.length === 1 ? list[0]! : null);
  if (CHANGE_WORDS.test(q) && editable.length) {
    const a = named(editable);
    if (!a) return out(`You host ${editable.length} auctions that can still change. Say which one, for example "${editable[0]!.name}: purse 20,000".`, { open: 'auction', intent: 'auction_rules_draft' });
    const d = draftRuleChange(a.rules, question.replace(new RegExp(a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ''), today);
    if (!d.rules) return out(d.message!, { open: 'auction', auctionId: a.id, intent: d.refused ? 'payment_boundary' : 'auction_rules_draft' });
    return out(`Here is the change I drafted for ${a.name}. Nothing is saved yet: open the auction and confirm it.`, {
      details: d.changes.map((c) => ({ label: c.label, text: `${c.from} → ${c.to}` })), open: 'auction', auctionId: a.id, intent: 'auction_rules_draft',
    });
  }
  const f = customerAuctionFacts(user);
  if (/\brules?\b|how does (the |an )?auction work|how (do|does) (the )?(bidding|auction)/.test(q)) {
    const pool = [...f.hosting, ...f.playing, ...f.teamsYouOwn, ...f.open];
    const a = pool.find((x) => q.includes(x.name.toLowerCase())) ?? pool[0];
    if (!a) return out('Every auction starts from these rules, and the host can change them before the bidding starts.', { details: rulesInWords(f.defaults).map((t, i) => ({ label: String(i + 1), text: t })), open: 'auction', intent: 'auction_rules' });
    return out(`The rules for ${a.name}:`, { details: rulesWordsOf(a.id).map((t, i) => ({ label: String(i + 1), text: t })), open: 'auction', auctionId: a.id, intent: 'auction_rules' });
  }
  const details: { label: string; text: string }[] = [];
  for (const p of f.picks) details.push({ label: p.name, text: p.result === 'sold' ? `Picked by ${p.team} for ${p.points?.toLocaleString('en-IN')} points` : p.result === 'unsold' ? 'Not picked yet' : p.status === 'registration' ? 'Signed up; the bidding has not started' : p.status === 'live' ? 'Waiting for your turn in the bidding' : 'Not picked' });
  for (const h of f.hosting.filter((x) => x.status === 'registration' || x.status === 'live')) details.push({ label: `${h.name} (you host)`, text: `${h.statusText} · ${h.teams} teams · ${h.players} players signed up` });
  for (const t of f.teamsYouOwn.filter((x) => x.status !== 'cancelled')) details.push({ label: `${t.name} (you own a team)`, text: t.statusText });
  const sold = f.picks.filter((p) => p.result === 'sold');
  const join = f.open.filter((a) => a.signUpOpen && !a.youPlay);
  const answer = sold.length ? `You were picked by ${sold[0]!.team} for ${sold[0]!.points?.toLocaleString('en-IN')} points in ${sold[0]!.name}.`
    : f.picks.length ? `You are signed up for ${f.picks.length} ${f.picks.length === 1 ? 'auction' : 'auctions'}.`
      : join.length ? `${join.length} ${join.length === 1 ? 'auction is' : 'auctions are'} open for players to sign up: ${join.slice(0, 3).map((a) => a.name).join(', ')}.`
        : 'There is no auction open for sign-up right now. You can host one from the Auctions page.';
  return out(`${answer}${join.length && f.picks.length ? ` ${join.length} more ${join.length === 1 ? 'is' : 'are'} open to join.` : ''} Points are not money: nothing is paid for a player.`, { details: details.slice(0, 8), open: 'auction', ...(f.picks[0] ? { auctionId: f.picks[0].auction_id } : join[0] ? { auctionId: join[0].id } : {}) });
}
