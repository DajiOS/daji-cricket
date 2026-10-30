import { formatPaise } from '@daji/shared';
import { now } from '../clock.ts';
import { addDays, dayOfWeek, istDate, istMidnight, monthRange, timeOfDay, DAY } from '../time.ts';
import { addMonths, niceDay, niceRange, parseRange, type Span } from './dates.ts';
import * as T from './tools.ts';
import { rulesIn } from '../lawUpdates.ts';
import { many, one } from '../db.ts';
import { hasPermission } from '../auth.ts';
import { careerOf, leaders } from '../playerStats.ts';
import { fantasyOverview } from '../fantasy.ts';
import { nameKey } from '../matches.ts';

// The built-in answerer: reads a question, works out what is being asked and for which dates, asks the software through
// the same tools as the Reports tab, and writes the answer in plain words. No outside service is involved.
// Every answer says which dates and which basis it used, so a wrong reading is easy to spot.

export type Intent =
  | 'help' | 'pnl' | 'revenue' | 'expenses' | 'profit' | 'collections' | 'account_balance' | 'balance_sheet' | 'gst' | 'uncategorised'
  | 'bookings' | 'upcoming' | 'outstanding' | 'awaiting' | 'no_shows' | 'cancellations' | 'utilisation' | 'credits' | 'refunds' | 'customers' | 'approvals_waiting' | 'approvals_why' | 'approvals_report' | 'compliance' | 'waitlist' | 'checkins' | 'fixtures' | 'auctions' | 'sheet' | 'player_stats' | 'fantasy' | 'server' | 'branches' | 'cash' | 'site_report' | 'unknown';

export interface Detail { label: string; text: string }
export interface Period { from: string; to: string; label: string }
export interface OpenReport { tab: 'reports' | 'bookings' | 'contacts' | 'accounts'; report?: string; params?: Record<string, string> }
export interface Built {
  intent: Intent;
  answer: string;
  details: Detail[];
  understood: string;
  period: Period | null;
  open: OpenReport | null;
  notes: string[];
  suggestions: string[];
}

const RULES: [Intent, RegExp][] = [
  ['site_report', /\b(site reports?|daily reports?|daily site|day on (the )?site|what happened (on|at) (the )?site)\b/],
  ['cash', /\b(cash in hand|cash balance|cash float|cash advances?|petty cash|supervisor('?s)? cash|wallet|cash (he|she|they|i) (holds?|has|have)|cash count)\b/],
  ['branches', /\bbranch(es)?\b|\bprojects?\b.*\b(office|house)\b|\b(office|house)\b.*\bprojects?\b|which projects/],
  ['fantasy', /\bfantasy\b|\bdream ?11\b/],
  ['player_stats', /\b(top|most|leading|highest|best)\b.*\b(runs?|run.?scorers?|scorers?|wickets?|wicket.?takers?|catch(es)?|batters?|batsm[ae]n|bowlers?|fielders?)\b|\b(player|career|batting|bowling|cricket) (stats|statistics|records?|averages?)\b|\b(stats|record|average) (for|of)\b|\bhow many (runs|wickets|catches)\b|\bleader ?boards?\b/],
  ['fixtures', /\bfixtures?\b|\btournaments?\b|\bnext match(es)?\b|\bmatch (schedule|times?)\b/],
  ['help', /\b(help|what can you|what (can|do|should) i ask|examples?|how does (this|it) work|what (do|can) you (do|know))\b/],
  ['balance_sheet', /balance ?sheet|\bassets\b|liabilit|net worth|\bequity\b|what (do )?(we|i) own/],
  ['pnl', /profit (and|&|n|\/) ?loss|\bp ?(&|and|n|\/) ?l\b|\bpnl\b|income statement|how (much )?(did|do|have) (we|i) (make|made|earn|earned|do|done)|how are we doing|how.?s (the )?business|how is (the )?business|financial summary|financial position/],
  ['approvals_why', /why (cant|cannot|am i not|do i not|wont|isnt)\b.*\b(sign|approve|approval)|\b(cant|cannot|unable to|not able to) (i )?(sign|approve)\b|why.* (greyed|disabled|locked)/],
  ['approvals_report', /(how many|report|summary|history|stats|statistics)\b.*\b(approvals?|sign.?offs?|signed off|sent back)|\b(approvals?|sign.?offs?) (report|summary|history)\b/],
  ['approvals_waiting', /\b(whom|who)\b.*\b(waiting|holding|pending)|(waiting|pending|stuck|open|outstanding) (on|for)? ?(whom|who|which)\b|\bapprovals?\b|sign.?offs?|waiting (for|on) (my )?(sign|approval)|bills? (waiting|pending)|pay ?roll (waiting|pending)|(discounts?|waivers?|expenses?|refunds?) (waiting|pending) (for |on )?(sign|approv)/],
  ['auctions', /\bauctions?\b|player (draft|auction)|\bsquads?\b|\bipl.?style\b|hosting deposits?|(tournament|host).{0,20}deposits?|deposit waivers?|hosted tournaments?/],
  ['server', /\bservers?\b|\blightsail\b|\bssh\b|\buptime\b|disk (space|full|usage)|(is|was) the (site|website|app) (up|down|working)|coding console/],
  ['sheet', /spread ?sheets?|\bexcel\b|google sheets?|shared sheet|\bthe sheet\b|sheet (sync|link)|requests? from the sheet|sheet requests?/],
  ['waitlist', /wait.?list|waiting list|on the list for|standing (request|booking)s?/],
  ['checkins', /^(?!.*\b(staff|employees?|team members?|attendance)\b).*\b(check(ed)?[ -]?ins?|team lists?|who played|players? (came|turned up))\b/],
  ['compliance', /complian|\blaws?\b|legal (rules?|updates?|changes?)|regulat|\bpolic(y|ies) (check|changes?|updates?)|statutory|rules? (are |is )?(due|overdue|past|to review)|review dates?|law.?change|\b(dpdp|cert.?in|esic?|professional tax)\b/],
  ['awaiting', /awaiting|to verify|verification|waiting for (me|us|approval|verification)|payments? (to|waiting|pending) (verify|check|approv)|upi (proof|screenshot)s?/],
  ['outstanding', /outstanding|\bowe[ds]?\b|\bdues?\b|unpaid|pending (payment|balance|amount|dues)|to collect|receivables?|balance (due|pending|remaining|left|owed)|yet to (pay|collect)|hasn.?t paid|haven.?t paid|not (yet )?paid|who (still )?owes/],
  ['refunds', /refund/],
  ['credits', /\bcredits?\b|wallet/],
  ['no_shows', /no[- ]?shows?|(did not|didn.?t|never) (turn|show|come)/],
  ['cancellations', /cancel/],
  ['utilisation', /utili[sz]ation|occupancy|how busy|busiest|capacity|fill rate|how (full|booked)|how well booked/],
  ['gst', /\bgst\b|\btax(es)?\b/],
  ['uncategorised', /uncategori[sz]ed|unclassified|not categori[sz]ed|needs? (categor|review)/],
  ['account_balance', /(bank|account|cash)s?( in hand| in the bank| on hand)?\s*balances?|balances? (in|of|at|on)( my| our| the)? (bank|account|accounts|cash)|how much (money|cash)|money in( the)? bank|cash (in hand|at hand|on hand)|\bbalances?\b/],
  ['profit', /profit|surplus|margin|net (income|earnings)|bottom line|\bloss\b/],
  ['expenses', /expens|spend|spent|spending|costs?\b|\bbills?\b|outgo|paid out|payments made|outflow/],
  ['collections', /collect(ed|ion|ions)?\b|received|receipts?|came in|money in\b|takings|cash in\b/],
  ['revenue', /revenue|income|turnover|sales\b|earnings?|earned|gross|top line/],
  ['upcoming', /on (the )?books|booked (ahead|in advance)|in the pipeline|upcoming|who(.?s| is| are) (playing|coming|booked)|what(.?s| is) (booked|coming|on|scheduled|next)|next (booking|session|match|game|slot)s?|\bagenda\b|\bschedule/],
  ['customers', /customers?|players?|\bpeople\b|\bmembers?\b|\bclients?\b/],
  ['bookings', /bookings?|sessions?|\bslots?\b|matches|games|reservations?|hours (booked|played)/],
];

const ON_BOOKS = /on (the )?books|booked (ahead|in advance)|in the pipeline/;
const PRIORITY: Intent[] = ['help', 'site_report', 'cash', 'branches', 'server', 'auctions', 'fantasy', 'player_stats', 'waitlist', 'checkins', 'approvals_why', 'approvals_report', 'approvals_waiting', 'sheet', 'compliance', 'balance_sheet', 'pnl', 'awaiting', 'outstanding', 'refunds', 'credits', 'no_shows', 'cancellations', 'utilisation', 'gst', 'uncategorised', 'account_balance', 'profit', 'expenses', 'collections', 'revenue', 'fixtures', 'upcoming', 'customers', 'bookings'];

/** Lower-case and tidy. Email addresses are dropped first, so "asha@example.com" is not mistaken for the word "example". */
const normalise = (q: string): string => q.toLowerCase().replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/g, ' ').replace(/['’`]/g, '').replace(/\s+/g, ' ').trim();

export function classify(question: string): { intent: Intent; matched: Intent[] } {
  const t = normalise(question);
  const matched = RULES.filter(([, re]) => re.test(t)).map(([i]) => i);
  if (!matched.length) return { intent: 'unknown', matched };
  const money = matched.filter((i) => i === 'revenue' || i === 'expenses' || i === 'profit' || i === 'pnl');
  if (money.length >= 2) return { intent: 'pnl', matched };
  // "payments waiting for approval" means the UPI proofs, not the Approvals page
  const paymentTalk = /payments?|upi|proof|screenshot/.test(t) && !/\b(bills?|pay ?roll|pay ?run|sign.?offs?)\b/.test(t);
  const intent = PRIORITY.find((i) => matched.includes(i) && !(i === 'approvals_waiting' && paymentTalk && matched.includes('awaiting')))!;
  return { intent, matched };
}

// ---------------------------------------------------------------- small helpers

const R = (p: number): string => formatPaise(p);
const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
const describe = (s: Span): string => {
  const r = niceRange(s.from, s.to);
  return s.label === r || /^\d/.test(s.label) ? r : `${s.label} (${r})`;
};
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** "in October 2026", "this month so far", "on 14 Oct 2026": the period as it reads after a verb. */
const inP = (s: Span): string => {
  if (s.from === s.to) return /^(today|yesterday|tomorrow)$/.test(s.label) ? s.label : `on ${niceDay(s.from)}`;
  if (/^(this|last|next) /.test(s.label)) return describe(s);
  return `in ${describe(s)}`;
};
/** What to compare a period with: the same days of the previous month for "this month so far", else the same length just before. */
function comparisonSpan(p: Span): Span {
  const m = monthRange(p.from.slice(0, 7))!;
  if (p.from.endsWith('-01') && p.to <= m.to) {
    const pm = monthRange(addMonths(p.from, -1).slice(0, 7))!;
    const to = p.to === m.to ? pm.to : `${pm.from.slice(0, 7)}-${String(Math.min(Number(p.to.slice(8, 10)), Number(pm.to.slice(8, 10)))).padStart(2, '0')}`;
    return { from: pm.from, to, label: niceRange(pm.from, to) };
  }
  const days = Math.round((istMidnight(p.to) - istMidnight(p.from)) / DAY) + 1;
  const from = addDays(p.from, -days), to = addDays(p.from, -1);
  return { from, to, label: niceRange(from, to) };
}
const pctChange = (cur: number, prev: number): string | null => {
  if (prev === 0) return null;
  const v = Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
  return v === 0 ? 'the same' : `${Math.abs(v)}% ${v > 0 ? 'higher' : 'lower'}`;
};
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STOP = new Set(['daji', 'cricket', 'ground', 'the', 'and']);

/** The ground the question names ("main turf", "the nets"), if exactly one. */
export function groundIn(question: string, list: { id: string; name: string }[]): { id: string; name: string } | null {
  const t = normalise(question);
  const words = (s: string) => normalise(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const hits = list.filter((g) => {
    if (t.includes(normalise(g.name))) return true;
    const mine = words(g.name);
    const others = new Set(list.filter((o) => o.id !== g.id).flatMap((o) => words(o.name)));
    const distinct = mine.filter((w) => !others.has(w));
    return distinct.some((w) => new RegExp(`\\b${w}s?\\b`).test(t));
  });
  return hits.length === 1 ? hits[0]! : null;
}

/** Rows whose name the question mentions ("electricity", "canteen"), so "how much on repairs" answers about repairs. */
function focusRows<Row extends { name: string }>(question: string, rows: Row[]): Row[] {
  const t = normalise(question);
  const GENERIC = new Set(['other', 'income', 'expenses', 'expense', 'fees', 'booking', 'bookings', 'money', 'received']);
  return rows.filter((r) => normalise(r.name).split(/[^a-z]+/).some((w) => w.length >= 4 && !GENERIC.has(w) && new RegExp(`\\b${w}`).test(t)));
}

const NAMES: Record<Intent, string> = {
  help: 'Help', pnl: 'Profit and loss', revenue: 'Revenue', expenses: 'Expenses', profit: 'Profit', collections: 'Money received', account_balance: 'Account balances', balance_sheet: 'Balance sheet',
  gst: 'GST', uncategorised: 'Uncategorised transactions', bookings: 'Bookings', upcoming: 'Upcoming sessions', outstanding: 'Money owed', awaiting: 'Payments to verify', approvals_waiting: 'Approvals waiting', approvals_why: 'Why you can or cannot sign', approvals_report: 'Approvals decided', compliance: 'Compliance register', waitlist: 'Waitlist', checkins: 'Check-ins at the ground', fixtures: 'Tournament fixtures', player_stats: 'Player records', fantasy: 'Fantasy cricket', sheet: 'Shared spreadsheet', server: 'Server status', branches: 'Branches and projects', cash: 'Supervisor cash', site_report: 'Daily site report', auctions: 'Auction tournaments', no_shows: 'No-shows',
  cancellations: 'Cancellations', utilisation: 'Utilisation', credits: 'Account credit', refunds: 'Refunds', customers: 'Customers', unknown: 'Not understood',
};

export const EXAMPLES = {
  reports: ['What was the revenue for the past 37 days?', 'What is my account balance?', 'What was our profit last month?', 'How much did we spend on electricity this financial year?', 'Compare this month with last month', 'Show the balance sheet'],
  bookings: ['Who is on the Sunday waitlist?', 'Who checked in today?', 'How many bookings did we have last week?', "What's booked for tomorrow?", 'Who still owes us money?', 'How busy was the cricket ground in September?', 'How many no-shows this month?', 'How much account credit do customers hold?'],
  customers: ['How many new customers played this month?'],
  compliance: ['Which compliance rules are due for review?', 'Any law updates waiting?'],
  tournaments: ['Which auction tournaments are running?', 'How is the fantasy contest going?'],
};

// ---------------------------------------------------------------- the answerer

export interface AskInput { question: string; ctx: T.Ctx }

const PAST_INTENTS = new Set<Intent>(['pnl', 'revenue', 'expenses', 'profit', 'collections', 'gst', 'customers', 'no_shows', 'cancellations', 'refunds']);

export function answerBuiltin(input: AskInput): Built {
  const { question, ctx } = input;
  const today = istDate(now());
  const { intent } = classify(question);
  const base = (i: Intent, answer: string, extra: Partial<Built> = {}): Built => ({ intent: i, answer, details: [], understood: NAMES[i], period: null, open: null, notes: [], suggestions: [], ...extra });

  if (intent === 'help') return help(ctx);
  if (intent === 'compliance') return complianceAnswer(ctx, question, base);
  if (intent === 'waitlist') return waitlistAnswer(ctx, base);
  if (intent === 'checkins') return checkInsAnswer(ctx, base);
  if (intent === 'sheet') return sheetAnswer(ctx, base);
  if (intent === 'server') return serverAnswer(ctx, base);
  if (intent === 'fixtures') return fixturesAnswer(ctx, base);
  if (intent === 'auctions') return auctionsAnswer(ctx, base);
  if (intent === 'player_stats') return playerStatsAnswer(ctx, question, base);
  if (intent === 'fantasy') return fantasyAnswer(ctx, base);
  if (intent === 'branches') return branchesAnswer(ctx, base);
  if (intent === 'cash') return cashAnswer(ctx, base);
  if (intent === 'site_report') return siteReportAnswer(ctx, question, base);
  if (intent === 'unknown') {
    const lot = [...EXAMPLES.reports, ...EXAMPLES.bookings].filter((_, i) => i % 2 === 0).slice(0, 5);
    return base('unknown', "I'm not sure what you're asking. I can answer questions about revenue, expenses, profit, account balances, bookings, money owed, cancellations and more, for any dates you like.", { suggestions: lot });
  }

  const wantsFuture = intent === 'upcoming' || /\b(upcoming|next|tomorrow|will|coming|booked for|scheduled)\b/.test(normalise(question));
  const parsed = parseRange(question, today, wantsFuture ? 'future' : 'past');
  if (parsed.error) return base(intent, parsed.error, { understood: NAMES[intent] });

  const ground = T.grounds(ctx).length > 1 ? groundIn(question, T.grounds(ctx)) : null;
  const notes: string[] = [];
  const t = normalise(question);
  const compare = /\bcompar|versus|\bvs\b|than (last|the previous|before)|against|change from|up or down|growth|grew|increase|decrease/.test(t);
  const basis: 'accrual' | 'cash' = /cash basis|on a cash|cash accounting/.test(t) ? 'cash' : 'accrual';

  // ---- which dates
  const noRangeDefault = (): Span => {
    const m = today.slice(0, 7);
    // "on the books" means everything booked from today on, however far ahead
    if (intent === 'upcoming' && ON_BOOKS.test(t)) return { from: today, to: addDays(today, 730), label: 'everything booked from today' };
    if (intent === 'upcoming') return { from: today, to: addDays(today, 6), label: 'the next 7 days' };
    if (intent === 'bookings') return { from: `${m}-01`, to: monthEnd(today), label: 'this month' };
    if (intent === 'no_shows' || intent === 'cancellations' || intent === 'utilisation' || intent === 'customers' || intent === 'refunds') return { from: addDays(today, -29), to: today, label: 'the past 30 days' };
    return { from: `${m}-01`, to: today, label: 'this month so far' };
  };
  let span: Span | null = parsed.span;
  let defaulted = false;
  const usesRange = !['account_balance', 'balance_sheet', 'outstanding', 'awaiting', 'credits', 'uncategorised', 'approvals_waiting', 'approvals_why'].includes(intent);
  if (usesRange && !span) { span = noRangeDefault(); defaulted = true; }
  if (span && span.from === '1970-01-01') span = { ...span, from: T.earliestDate(ctx.ownerId) };
  if (span && defaulted) notes.push(`You did not say which dates, so I used ${describe(span)}.`);

  // Money and activity can only have happened by today.
  let future = false;
  if (span && PAST_INTENTS.has(intent)) {
    if (span.from > today) future = true;
    else if (span.to > today) span = { from: span.from, to: today, label: `${span.label} so far` };
  }
  if (span && intent === 'upcoming' && span.to < today) { notes.push(`${describe(span)} is already over, so this shows what happened then.`); }
  if (span && intent === 'upcoming' && span.from < today && span.to >= today) span = { ...span, from: today };

  const period: Period | null = span ? { from: span.from, to: span.to, label: span.label } : null;
  const understood = (...bits: string[]) => [NAMES[intent], ...(span ? [describe(span)] : []), ...bits].join(' · ');
  const done = (answer: string, extra: Partial<Built> = {}): Built => ({ intent, answer, details: [], understood: understood(), period, open: null, notes, suggestions: [], ...extra });
  const p = span!;

  switch (intent) {
    case 'revenue': case 'expenses': case 'profit': case 'pnl': {
      T.need(ctx, 'reports'); // money answers need "Can see revenue" as well as a reports permission
      if (future) return futureMoney(ctx, intent, p, done);
      if (ground && intent === 'revenue') return groundRevenue(ctx, ground, p, done);
      if (ground) notes.push(`Expenses and other income are not recorded per ground, so this is for all of your grounds.`);
      const r = T.pnl(ctx, { from: p.from, to: p.to, basis });
      const prevSpan = compare ? comparisonSpan(p) : null;
      const prev = prevSpan ? T.pnl(ctx, { from: prevSpan.from, to: prevSpan.to, basis }) : null;
      const open: OpenReport = { tab: 'reports', report: 'pnl', params: { from: p.from, to: p.to, basis, ...(compare ? { compare: '1' } : {}) } };
      const bookingsIncome = r.revenue.find((x) => x.code === 'booking_income')?.paise ?? 0;
      const kept = r.revenue.find((x) => x.code === 'forfeited_income')?.paise ?? 0;
      const other = r.revenuePaise - bookingsIncome - kept;
      if (basis === 'accrual') notes.push('Booking income is counted on the day each session was played, not the day it was paid for.');
      if (prev && prev.uncategorisedTransactions > 0) notes.push('The comparison period also has bank transactions that are not categorised yet.');
      else notes.push('Cash basis: booking money counted on the day it was received, less refunds.');
      if (r.uncategorisedTransactions > 0) notes.push(`${count(r.uncategorisedTransactions, 'bank transaction')} ${r.uncategorisedTransactions === 1 ? 'is' : 'are'} not categorised yet, so expenses and other income may be incomplete.`);
      const pick = (x: { revenuePaise: number; expensesPaise: number; netProfitPaise: number }) => (intent === 'expenses' ? x.expensesPaise : intent === 'profit' ? x.netProfitPaise : x.revenuePaise);
      const vs = prev ? pctChange(pick(r), pick(prev)) : null;
      const before = prev && prevSpan ? ` For comparison, ${niceRange(prevSpan.from, prevSpan.to)} ${intent === 'pnl' ? `had revenue ${R(prev.revenuePaise)} and profit ${R(prev.netProfitPaise)}` : `was ${R(pick(prev))}`}${vs ? `, so this period is ${vs}` : ''}.` : '';
      const lines = (rows: typeof r.revenue) => rows.filter((x) => x.paise !== 0).map((x) => ({ label: x.name, text: R(x.paise) }));
      if (intent === 'revenue') {
        const f = focusRows(question, r.revenue);
        if (f.length) return done(`${f.map((x) => `${x.name}: ${R(x.paise)}`).join('; ')} ${inP(p)}.`, { open, details: lines(f), understood: understood(basis), notes });
        const parts = [bookingsIncome ? `${R(bookingsIncome)} from sessions played` : '', kept ? `${R(kept)} from advances kept (no-shows and late cancellations)` : '', other ? `${R(other)} from other income` : ''].filter(Boolean);
        return done(`Revenue for ${describe(p)} was ${R(r.revenuePaise)}${parts.length > 1 ? `: ${parts.join(', ')}` : ''}.${before}`, { open, details: lines(r.revenue), understood: understood(basis === 'cash' ? 'cash basis' : 'counted when sessions are played'), suggestions: ['What were the expenses over the same period?', 'Compare with the previous period'] });
      }
      if (intent === 'expenses') {
        const f = focusRows(question, r.expenses);
        if (f.length) return done(`${f.map((x) => `${x.name}: ${R(x.paise)}`).join('; ')} ${inP(p)}.`, { open, details: lines(f), understood: understood(), notes });
        const top = r.expenses.filter((x) => x.paise > 0).slice(0, 3).map((x) => `${x.name} ${R(x.paise)}`);
        return done(`Expenses for ${describe(p)} were ${R(r.expensesPaise)}${top.length ? `. The biggest: ${top.join(', ')}` : ''}.${before}`, { open, details: lines(r.expenses), understood: understood(), suggestions: ['What was the profit over the same period?'] });
      }
      if (intent === 'profit') {
        return done(`${r.netProfitPaise >= 0 ? 'Profit' : 'Loss'} for ${describe(p)} was ${R(Math.abs(r.netProfitPaise))}: revenue ${R(r.revenuePaise)} minus expenses ${R(r.expensesPaise)}${r.marginPercent !== null ? ` (a margin of ${r.marginPercent}%)` : ''}.${before}`,
          { open, details: [{ label: 'Revenue', text: R(r.revenuePaise) }, { label: 'Expenses', text: R(r.expensesPaise) }, { label: r.netProfitPaise >= 0 ? 'Profit' : 'Loss', text: R(Math.abs(r.netProfitPaise)) }], understood: understood(basis === 'cash' ? 'cash basis' : 'counted when sessions are played') });
      }
      return done(`For ${describe(p)}: revenue ${R(r.revenuePaise)}, expenses ${R(r.expensesPaise)}, ${r.netProfitPaise >= 0 ? 'profit' : 'loss'} ${R(Math.abs(r.netProfitPaise))}${r.marginPercent !== null ? ` (${r.marginPercent}% margin)` : ''}.${before}`,
        { open, details: [{ label: 'Booking income', text: R(bookingsIncome) }, ...(kept ? [{ label: 'Advances kept', text: R(kept) }] : []), ...(other ? [{ label: 'Other income', text: R(other) }] : []), { label: 'Total revenue', text: R(r.revenuePaise) }, { label: 'Total expenses', text: R(r.expensesPaise) }, { label: r.netProfitPaise >= 0 ? 'Profit' : 'Loss', text: R(Math.abs(r.netProfitPaise)) }], understood: understood(basis === 'cash' ? 'cash basis' : 'counted when sessions are played') });
    }

    case 'collections': {
      if (future) return done(`${cap(describe(p))} has not happened yet, so no money has been received for it.`);
      const c = T.collections(ctx, p);
      return done(`You received ${R(c.totalReceivedPaise)} ${inP(p)}: ${R(c.bookingMoneyReceivedPaise)} from booking payments (after refunds)${c.otherIncomePaise ? ` and ${R(c.otherIncomePaise)} from other income` : ''}.`,
        { open: { tab: 'reports', report: 'pnl', params: { from: p.from, to: p.to, basis: 'cash' } }, details: [{ label: 'Booking payments, after refunds', text: R(c.bookingMoneyReceivedPaise) }, { label: 'Other income', text: R(c.otherIncomePaise) }], understood: understood('cash basis'),
          notes: [...notes, 'This is money that arrived in the period, including advances for sessions that are still to come. It is not the same as revenue, which counts a session when it is played.'] });
    }

    case 'account_balance': {
      const asOf = span && span.to < today ? span.to : undefined;
      const a = T.accounts(ctx, { asOf });
      const when = a.asOf === today ? '' : ` on ${niceDay(a.asOf)}`;
      const open: OpenReport = { tab: 'accounts' };
      if (!a.accounts.length) return base('account_balance', `You have not added a bank or cash account yet, so there is no balance to show. Add one under Reports → Accounts and record its opening balance.${a.heldForCustomersPaise > 0 ? ` For now, ${R(a.heldForCustomersPaise)} of what customers have paid is held for them (advances for sessions not yet played, and account credit).` : ''}`, { open, understood: NAMES.account_balance });
      const held = a.heldForCustomersPaise;
      return base('account_balance', `Your ${a.accounts.length === 1 ? 'account holds' : 'accounts hold'} ${R(a.totalPaise)}${when}${a.accounts.length > 1 ? ` in total: ${a.accounts.map((x) => `${x.name} ${R(x.balancePaise)}`).join(', ')}` : ` (${a.accounts[0]!.name})`}.`, {
        open, details: a.accounts.map((x) => ({ label: x.name, text: R(x.balancePaise) })), period: asOf ? { from: asOf, to: asOf, label: niceDay(asOf) } : null, understood: `Account balances · ${asOf ? 'as at ' + niceDay(asOf) : 'right now'}`,
        notes: held > 0 ? [`${R(held)} of the money you have received is held for customers (advances for sessions not yet played, and account credit), so it is not all free to spend.`] : [],
      });
    }

    case 'balance_sheet': {
      const asOf = span && span.to < today ? span.to : today;
      const b = T.balance(ctx, { asOf });
      return base('balance_sheet', `As at ${niceDay(asOf)} you have ${R(b.totalAssetsPaise)} in assets, owe ${R(b.totalLiabilitiesPaise)}, and the owner's equity is ${R(b.totalEquityPaise)}.`, {
        open: { tab: 'reports', report: 'balance-sheet', params: { asOf } }, period: { from: asOf, to: asOf, label: niceDay(asOf) }, understood: `Balance sheet · as at ${niceDay(asOf)}`,
        details: [{ label: 'Cash and bank', text: R(b.cashAndBankPaise) }, { label: 'Customers owe you', text: R(b.customersOweYouPaise) }, { label: 'Held for sessions not yet played', text: R(b.customerAdvancesPaise) }, { label: 'Account credit owed to customers', text: R(b.customerCreditsPaise) }, { label: 'GST payable', text: R(b.gstPayablePaise) }],
        notes: b.uncategorisedTransactions ? [`${count(b.uncategorisedTransactions, 'bank transaction')} not categorised yet.`] : [],
      });
    }

    case 'gst': {
      if (future) return done(`${cap(describe(p))} has not happened yet.`);
      const g = T.gst(ctx, p);
      if (g.percent === 0) return done('GST is not set up. Prices are treated as having no GST in them. You can set the rate under Reports → Settings.', { open: { tab: 'reports', report: 'settings' } });
      return done(`GST at ${g.percent}% on sessions played ${inP(p)} comes to ${R(g.gstOnSessionsPlayedPaise)}. Right now you owe ${R(g.gstPayableNowPaise)} in total.`, { open: { tab: 'reports', report: 'balance-sheet', params: { asOf: today } }, notes: [...notes, 'Prices are treated as already including GST.'] });
    }

    case 'uncategorised': {
      const u = T.uncategorised(ctx);
      return base('uncategorised', u.count ? `${count(u.count, 'bank transaction')} (${R(u.totalPaise)} in total) ${u.count === 1 ? 'is' : 'are'} not categorised yet.` : 'Every bank transaction is categorised.', { open: { tab: 'accounts', params: { categorised: 'no' } } });
    }

    case 'outstanding': {
      const o = T.outstanding(ctx);
      const parts = [`customers owe ${R(o.playedNotFullyPaid.amountPaise)} for ${count(o.playedNotFullyPaid.bookings, 'session')} already played`, `${R(o.upcomingBalanceToCollect.amountPaise)} is still to collect on ${count(o.upcomingBalanceToCollect.bookings, 'upcoming booking')}`];
      const extra = o.paymentsAwaitingVerification.count ? ` ${count(o.paymentsAwaitingVerification.count, 'payment')} worth ${R(o.paymentsAwaitingVerification.amountPaise)} ${o.paymentsAwaitingVerification.count === 1 ? 'is' : 'are'} waiting for you to verify.` : '';
      return base('outstanding', `Right now ${parts.join(', and ')}.${extra}`, {
        open: { tab: 'reports', report: 'schedule/past' }, understood: 'Money owed · right now',
        details: [{ label: 'Owed for sessions already played', text: R(o.playedNotFullyPaid.amountPaise) }, { label: 'Balance on upcoming bookings', text: R(o.upcomingBalanceToCollect.amountPaise) }, { label: 'Payments waiting to be verified', text: R(o.paymentsAwaitingVerification.amountPaise) }],
      });
    }

    case 'approvals_waiting': {
      const w = T.approvalsWaiting(ctx);
      if (!w.items.length) return base(intent, 'Nothing is waiting for a sign-off right now.', { open: { tab: 'accounts' } });
      return base(intent, `${count(w.waiting, 'item')} ${w.waiting === 1 ? 'is' : 'are'} waiting for a sign-off.`, {
        details: w.items.slice(0, 8).map((i) => ({ label: `${i.title} (${i.kind})`, text: `${R(i.amountPaise)} · waiting on ${i.waitingOn} · step ${Math.min(i.stepsDone + 1, i.stepsTotal)} of ${i.stepsTotal}${i.youCanSign ? ' · you can sign this' : ''}` })),
        suggestions: ["Why can't I sign the first one?"], notes: ['This is the same list as the Approvals page.'],
      });
    }

    case 'approvals_why': {
      const w = T.whyCantISign(ctx, { text: '' });
      const named = w.matches.length > 1 ? (T.whyCantISign(ctx, { text: titleHint(question, w.matches.map((m) => m.title)) }).matches) : w.matches;
      const hit = named.length ? named : w.matches;
      if (!hit.length) return base(intent, 'Nothing is waiting for a sign-off, so there is nothing to sign right now.');
      return base(intent, hit.length === 1 ? (hit[0]!.canSign ? `You can sign "${hit[0]!.title}" now.` : `You cannot sign "${hit[0]!.title}" yet: ${hit[0]!.reason}.`) : `${count(hit.length, 'item')} are waiting. Here is whether you can sign each.`, {
        details: hit.map((m) => ({ label: m.title, text: `${m.canSign ? 'You can sign this' : m.reason ?? 'You cannot sign this'} · waiting on ${m.waitingOn ?? 'nobody'}` })),
        notes: [hit[0]!.rule],
      });
    }

    case 'approvals_report': {
      const d = T.approvalsDecided(ctx, { from: p.from, to: p.to });
      const rows = Object.entries(d.decisions);
      const total = rows.reduce((a, [, n]) => a + n, 0);
      return done(total ? `In ${describe(p)}, ${count(total, 'approval step')} ${total === 1 ? 'was' : 'were'} recorded.` : `No approval decisions were recorded in ${describe(p)}.`, { details: rows.map(([k, n]) => ({ label: k.replace('.', ' · '), text: String(n) })) });
    }

    case 'awaiting': {
      const o = T.outstanding(ctx);
      const a = o.paymentsAwaitingVerification;
      return base('awaiting', a.count ? `${count(a.count, 'payment')} worth ${R(a.amountPaise)} ${a.count === 1 ? 'is' : 'are'} waiting for you to verify.` : 'No payments are waiting to be verified.', { open: { tab: 'bookings', report: 'payments' } });
    }

    case 'credits': {
      const c = T.credits(ctx);
      return base('credits', c.outstandingPaise ? `Customers hold ${R(c.outstandingPaise)} of account credit across ${count(c.customersHoldingCredit, 'person', 'people')}; ${R(c.expiringWithin30DaysPaise)} of it expires within 30 days.` : 'No customer holds any account credit right now.', { understood: 'Account credit · right now' });
    }

    case 'refunds': {
      const f = T.refunds(ctx, p);
      return done(`${f.stillToSend.count ? `${count(f.stillToSend.count, 'refund')} worth ${R(f.stillToSend.amountPaise)} ${f.stillToSend.count === 1 ? 'is' : 'are'} still to send. ` : 'No refunds are waiting to be sent. '}In ${describe(p)} you refunded ${count(f.refundedInPeriod.count, 'booking')} totalling ${R(f.refundedInPeriod.amountPaise)}.`,
        { details: [{ label: 'Still to send', text: R(f.stillToSend.amountPaise) }, { label: 'Refunded in the period', text: R(f.refundedInPeriod.amountPaise) }] });
    }

    case 'utilisation': {
      const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000);
      if (days > 366) return done('Utilisation covers at most 366 days at a time. Try a shorter period.');
      const u = T.utilisation(ctx, p);
      const rows = ground ? u.grounds.filter((g) => g.groundId === ground.id) : u.grounds;
      const booked = rows.reduce((s, g) => s + g.bookedSlots, 0), avail = rows.reduce((s, g) => s + g.availableSlots, 0);
      if (!avail) return done('There are no open slots to measure in that period.');
      const pct = Math.round((booked / avail) * 1000) / 10;
      return done(`${ground ? ground.name : 'Your grounds'} ${ground ? 'was' : 'were'} ${pct}% booked (${booked.toLocaleString('en-IN')} of ${avail.toLocaleString('en-IN')} slots) ${inP(p)}.`,
        { details: rows.map((g) => ({ label: g.ground, text: `${g.utilisationPercent}% (${g.bookedSlots} of ${g.availableSlots} slots)` })), notes: [...notes, 'Counts confirmed, completed and no-show bookings against every open slot.'] });
    }

    case 'customers': {
      if (future) return done(`${cap(describe(p))} has not happened yet.`);
      const c = T.customers(ctx, p);
      return done(`${count(c.playedInPeriod, 'person', 'people')} played ${inP(p)}, ${c.firstTimeInPeriod} of them for the first time. In all, ${count(c.haveEverPlayed, 'person', 'people')} have played; ${c.canEmail} can be emailed and ${c.canWhatsapp} reached on WhatsApp.`, { open: { tab: 'contacts' } });
    }

    case 'no_shows': case 'cancellations': {
      if (future) return done(`${cap(describe(p))} has not happened yet.`);
      const b = T.bookings(ctx, { from: p.from, to: p.to, groundId: ground?.id });
      const where = ground ? ` at ${ground.name}` : '';
      if (intent === 'no_shows') {
        return done(b.noShows.count ? `${count(b.noShows.count, 'no-show')}${where} ${inP(p)}; you kept ${R(b.noShows.advanceKeptPaise)} of their advances.` : `There were no no-shows${where} ${inP(p)}.`, { open: { tab: 'reports', report: 'schedule/past', params: { from: p.from, to: p.to } } });
      }
      const c = b.cancellations;
      return done(c.count ? `${count(c.count, 'booking')} ${c.count === 1 ? 'was' : 'were'} cancelled${where} ${inP(p)}: ${c.inTime} in time (${R(c.refundedPaise)} refunded) and ${c.late} late (${R(c.creditGivenPaise)} turned into credit, ${R(c.advanceKeptPaise)} kept).` : `Nothing was cancelled${where} ${inP(p)}.`,
        { open: { tab: 'reports', report: 'schedule/past', params: { from: p.from, to: p.to } }, notes: [...notes, 'A cancellation is counted on the day it was cancelled, not the day of the session.'] });
    }

    case 'upcoming': case 'bookings': {
      const b = T.bookings(ctx, { from: p.from, to: p.to, groundId: ground?.id });
      const where = ground ? ` at ${ground.name}` : '';
      const bits: string[] = [];
      if (b.played.sessions) bits.push(`${count(b.played.sessions, 'session')} played (${count(b.played.slots, 'slot')})`);
      if (b.noShows.count) bits.push(`${count(b.noShows.count, 'no-show')}`);
      if (b.cancellations.count) bits.push(`${count(b.cancellations.count, 'cancellation')}`);
      // asked what is ahead: what is still to come leads, cancellations follow
      if (b.upcoming.bookings) bits[intent === 'upcoming' ? 'unshift' : 'push'](`${count(b.upcoming.bookings, 'booking')} still to come (${count(b.upcoming.slots, 'slot')}, worth ${R(b.upcoming.valuePaise)}, ${R(b.upcoming.toCollectPaise)} still to collect)`);
      const open: OpenReport = { tab: 'reports', report: p.to >= today && b.upcoming.bookings ? 'schedule/future' : 'schedule/past', params: { from: p.from, to: p.to } };
      const details: Detail[] = [];
      if (b.upcoming.bookings && b.upcoming.bookings <= 8 || intent === 'upcoming') {
        const u = T.upcoming(ctx, { from: p.from, to: p.to, groundId: ground?.id, limit: 8 }, true);
        for (const s of u.sessions) details.push({ label: `${DOW[dayOfWeek(s.date)]} ${niceDay(s.date, false)}, ${s.start}–${s.end}`, text: `${s.ground}${s.customer ? ` · ${s.customer}` : ''} · ${R(s.totalPaise)}${s.toCollectPaise ? ` (${R(s.toCollectPaise)} to collect)` : ' (paid)'}` });
        if (u.total > u.sessions.length) notes.push(`Showing the first ${u.sessions.length} of ${u.total}.`);
      }
      if (!bits.length) return done(`I found no bookings${where} for ${describe(p)}.`, { open });
      // a list of cancellations alone does not answer "how many bookings": say first that none are live
      if (!b.played.sessions && !b.noShows.count && !b.upcoming.bookings) return done(`No bookings${where} are live for ${describe(p)}. ${cap(count(b.cancellations.count, 'booking'))} ${b.cancellations.count === 1 ? 'was' : 'were'} cancelled.`, { open, understood: understood() });
      const multi = !ground && b.byGround.length > 1;
      if (multi && !details.length) for (const g of b.byGround) details.push({ label: g.groundName, text: `${g.played} played, ${g.upcoming} coming up` });
      return done(`For ${describe(p)}${where}: ${bits.join('; ')}.`, { open, details, understood: understood(), suggestions: ['Who still owes us money?', 'How busy were the grounds then?'] });
    }

    default:
      return base('unknown', "I couldn't work that one out.");
  }
}

function monthEnd(date: string): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return `${date.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Revenue-type questions about dates that have not happened: nothing is earned yet, but sessions may be booked. */
function futureMoney(ctx: T.Ctx, intent: Intent, p: Span, done: (a: string, e?: Partial<Built>) => Built): Built {
  if (!T.can(ctx, 'bookings')) return done(`${cap(describe(p))} has not happened yet, so there is nothing to report.`);
  const b = T.bookings(ctx, { from: p.from, to: p.to });
  const what = intent === 'expenses' ? 'expenses' : intent === 'profit' ? 'profit' : 'revenue';
  const booked = b.upcoming.bookings ? ` ${count(b.upcoming.bookings, 'booking')} ${b.upcoming.bookings === 1 ? 'is' : 'are'} already confirmed, worth ${R(b.upcoming.valuePaise)} (${R(b.upcoming.paidPaise)} paid so far).` : ' No bookings are confirmed for it yet.';
  return done(`${cap(describe(p))} has not happened yet, so there is no ${what} to report: income is counted when a session is played.${booked}`, { open: { tab: 'reports', report: 'schedule/future', params: { from: p.from, to: p.to } } });
}

function groundRevenue(ctx: T.Ctx, g: { id: string; name: string }, p: Span, done: (a: string, e?: Partial<Built>) => Built): Built {
  if (!T.can(ctx, 'bookings')) return done(`I can only break revenue down by ground for people who can see bookings.`);
  const b = T.bookings(ctx, { from: p.from, to: p.to, groundId: g.id });
  const row = b.byGround.find((x) => x.groundId === g.id);
  const earned = row?.earnedPaise ?? 0;
  return done(`${g.name} earned ${R(earned)} from bookings ${inP(p)} (${count(b.played.sessions, 'session')} played).`, {
    open: { tab: 'reports', report: 'schedule/past', params: { from: p.from, to: p.to, groundId: g.id } }, notes: ['This is booking income only. Other income, such as canteen sales, is not recorded per ground.'],
    details: [{ label: 'Price of sessions played', text: R(b.played.valuePaise) }, { label: 'Advances kept', text: R(b.noShows.advanceKeptPaise + b.cancellations.advanceKeptPaise) }],
  });
}

/** Picks the words of the question that name one waiting item, so "why can't I sign the Acme bill" finds it. */
function titleHint(question: string, titles: string[]): string {
  const t = normalise(question);
  return titles.find((x) => t.includes(x.toLowerCase())) ?? titles.map((x) => x.toLowerCase().split(/\s+/).find((w) => w.length > 3 && t.includes(w)) ?? '').find(Boolean) ?? '';
}

/** The compliance register in words: what is overdue, what law updates wait for a look, and the last changes recorded. */
function complianceAnswer(ctx: T.Ctx, question: string, base: (i: Intent, answer: string, extra?: Partial<Built>) => Built): Built {
  if (!T.can(ctx, 'compliance')) return base('compliance', 'Only the owner can see the compliance register.');
  const c = T.compliance(ctx);
  const t = normalise(question);
  const asked = new Set(rulesIn(question));
  const named = c.rules.filter((r) => asked.has(r.code) || t.includes(r.title.toLowerCase()));
  const notes = ['This is the same register as Settings › Compliance. A check runs every day.'];
  if (c.lastCheck) notes.push(`Last check: ${niceDay(c.lastCheck.ranOn)}.`);
  if (c.feed && !c.feed.ok) notes.push(`The law updates feed could not be read on ${niceDay(c.feed.lastReadOn)}: ${c.feed.message}`);
  else if (!c.feed) notes.push('No law updates feed has been read yet; updates added by hand still show here.');
  if (named.length) {
    return base('compliance', named.map((r) => `${r.title} (${r.law}): ${r.rule} The software uses ${r.enforcedAs}. Next review ${niceDay(r.nextReviewOn)}, ${r.status}.`).join(' '), {
      details: named.map((r) => ({ label: r.title, text: `Last reviewed ${niceDay(r.lastReviewedOn)} · ${r.where}` })), notes,
    });
  }
  if (/law|update|news|change|policy|polic/.test(t) && !/review|due|overdue/.test(t)) {
    const head = c.lawUpdatesWaiting ? `${count(c.lawUpdatesWaiting, 'law update')} ${c.lawUpdatesWaiting === 1 ? 'is' : 'are'} waiting for a look.` : 'No law updates are waiting for a look.';
    const last = c.recentLawChanges[0];
    return base('compliance', `${head}${last ? ` The last change recorded was on ${niceDay(last.changedOn)}: ${last.summary}.` : ''}`, {
      details: c.lawUpdates.map((a) => ({ label: `${niceDay(a.publishedOn)} · ${a.from}`, text: `${a.title}${a.rules.length ? ` (rules: ${a.rules.join(', ')})` : ''}` })), notes,
      suggestions: ['Which compliance rules are due for review?'],
    });
  }
  const due = c.rules.filter((r) => r.status !== 'up to date').sort((a, b) => a.nextReviewOn.localeCompare(b.nextReviewOn));
  const head = c.overdue ? `${count(c.overdue, 'rule')} ${c.overdue === 1 ? 'is' : 'are'} past the review date` : 'Every rule is reviewed on time';
  const soon = c.dueWithin30Days ? `${count(c.dueWithin30Days, 'more rule', 'more rules')} ${c.dueWithin30Days === 1 ? 'is' : 'are'} due in the next 30 days` : 'none is due in the next 30 days';
  return base('compliance', `${head}, and ${soon}. ${c.lawUpdatesWaiting ? `${count(c.lawUpdatesWaiting, 'law update')} ${c.lawUpdatesWaiting === 1 ? 'is' : 'are'} waiting for a look.` : 'No law updates are waiting.'}`, {
    details: due.slice(0, 10).map((r) => ({ label: r.title, text: `${r.status} · next review ${niceDay(r.nextReviewOn)}` })), notes,
    suggestions: ['Any law updates waiting?'],
  });
}

function auctionsAnswer(ctx: T.Ctx, base: (i: Intent, answer: string, extra?: Partial<Built>) => Built): Built {
  if (!T.can(ctx, 'tournaments')) return base('auctions', 'You do not have access to the tournaments. Ask the owner to give you the "manage_matches" permission.');
  const a = T.auctionTournaments(ctx);
  if (!a.count) return base('auctions', 'No customer has hosted a tournament yet.');
  const bits = [`${count(a.count, 'tournament')} ${a.count === 1 ? 'has' : 'have'} been hosted by customers.`];
  if (a.running) bits.push(`${count(a.running, 'auction')} ${a.running === 1 ? 'is' : 'are'} running now.`);
  if (a.signingUp) bits.push(`${a.signingUp} ${a.signingUp === 1 ? 'is' : 'are'} taking player sign-ups.`);
  if (a.depositsHeldPaise) bits.push(`${R(a.depositsHeldPaise)} in hosting deposits is held, to give back when the tournaments end.`);
  if (a.depositsDuePaise) bits.push(`${R(a.depositsDuePaise)} in hosting deposits is still due.`);
  if (a.waiverRequestsWaiting) bits.push(`${count(a.waiverRequestsWaiting, 'deposit waiver request')} ${a.waiverRequestsWaiting === 1 ? 'is' : 'are'} waiting for the owner.`);
  return base('auctions', bits.join(' '), {
    details: a.items.slice(0, 8).map((i) => ({ label: i.name, text: `${i.status} · ${i.kind} · host ${i.host} · ${niceDay(i.from)} to ${niceDay(i.to)} · ${count(i.teams, 'team')}${i.kind === 'player auction' ? `, ${count(i.players, 'player')} signed up, ${i.sold} picked` : ''}${i.depositDuePaise ? ` · deposit ${R(i.depositDuePaise)} due` : i.depositWaived ? ' · deposit waived' : i.depositHeldPaise ? ` · deposit ${R(i.depositHeldPaise)} held` : ''}${i.waiverWaiting ? ' · waiver request waiting' : ''}${i.hidden ? ' · hidden by staff' : ''}` })),
    notes: ['Auction purses and bids are points, never money. The hosting deposit is real money: it is recorded, refunded or kept from Tournaments on the Desk.'],
  });
}

/** Today's check-ins in words: how many of the players on team lists checked in, by phone or by staff (counts and names for those who may see bookings). */
function checkInsAnswer(ctx: T.Ctx, base: (i: Intent, answer: string, extra?: Partial<Built>) => Built): Built {
  if (!T.can(ctx, 'bookings') || !hasPermission(ctx.user, 'manage_bookings')) return base('checkins', 'You do not have access to team lists. Ask the owner to give you the "manage_bookings" permission.');
  const c = T.checkIns(ctx, true);
  const notes = ['A game counts toward a player\'s waitlist tier only when they checked in at the ground on their own phone, or staff checked them in. Guests (no profile) never count.'];
  if (!c.games) return base('checkins', 'No games with a team list today.', { notes, open: { tab: 'bookings' } });
  const head = `${c.checkedIn} of ${count(c.players, 'player')} checked in today across ${count(c.games, 'game')}${c.guests ? ` (${count(c.guests, 'guest')} without a profile)` : ''}.`;
  const tail = `${c.byStaff ? ` ${c.byStaff} checked in by staff.` : ''}${c.undone ? ` ${count(c.undone, 'check-in')} undone by staff.` : ''}`;
  return base('checkins', head + tail, {
    details: (c.list ?? []).slice(0, 15).map((p) => ({ label: p.name, text: `${p.ref}, ${p.ground}: ${p.undone ? 'check-in undone' : p.checkedIn ? `checked in${p.via === 'staff' ? ' by staff' : ''}` : 'not checked in'}${p.guest ? ', guest' : ''}` })),
    notes, open: { tab: 'bookings' },
  });
}

/** The waitlist in words: how many wait and for which day, the session offered now, and who (for those who may see customers). */
function waitlistAnswer(ctx: T.Ctx, base: (i: Intent, answer: string, extra?: Partial<Built>) => Built): Built {
  if (!T.can(ctx, 'bookings') || !hasPermission(ctx.user, 'manage_bookings')) return base('waitlist', 'You do not have access to the waitlist. Ask the owner to give you the "manage_bookings" permission.');
  const w = T.waitlist(ctx, true);
  const notes = [`A session still free ${w.confirmHours} hours before it starts is offered to everyone waiting for that day; the first to accept takes it. ${w.tierPriority ? `Players with the most games hear first, ${w.waveMinutes} minutes ahead of the next group.` : 'Everyone hears at once.'}`];
  if (!w.switchedOn) notes.unshift('The waitlist is switched off in Settings, so nobody new can join and nothing is offered.');
  if (!w.waiting && !w.offers.length) return base('waitlist', `Nobody is on the ${w.name} waitlist.`, { notes, open: { tab: 'bookings', report: 'waitlist' } });
  const next = w.byDate[0];
  const head = `${count(w.waiting, 'person is', 'people are')} on the ${w.name} waitlist${next ? `, ${count(next.people, 'person', 'people')} for ${niceDay(next.date)}` : ''}.`;
  const offer = w.offers.find((o) => o.status.startsWith('offered'));
  const taken = w.offers.find((o) => o.status === 'accepted');
  const tail = offer ? ` ${offer.session} on ${niceDay(offer.date)} (${offer.time}) is offered to them now; ${count(offer.peopleTold, 'person has', 'people have')} been told.` : taken ? ` ${taken.session} on ${niceDay(taken.date)} has been accepted${taken.acceptedBy ? ` by ${taken.acceptedBy}` : ''}.` : '';
  return base('waitlist', head + tail, {
    details: w.people.slice(0, 12).map((p) => ({ label: p.name ?? p.session, text: `${p.ground}, ${niceDay(p.nextDate)}, ${p.status}${p.weeksRolled ? `, moved on ${count(p.weeksRolled, 'week')}` : ''}, ${count(p.gamesPlayed, 'game')} played${p.tier ? ` (${p.tier})` : ''}` })),
    notes, open: { tab: 'bookings', report: 'waitlist' },
  });
}

/** The shared spreadsheet in words: what is linked, the last send and read, and the booking requests from it still to look at. */
function sheetAnswer(ctx: T.Ctx, base: (i: Intent, answer: string, extra?: Partial<Built>) => Built): Built {
  if (!T.can(ctx, 'bookings')) return base('sheet', 'You do not have access to bookings, so I cannot tell you about the shared spreadsheet. Ask the owner for the "manage_bookings" permission.');
  const s = T.sheet(ctx);
  const at = (ms: number): string => `${niceDay(istDate(ms))} at ${timeOfDay(ms)}`;
  const linked = s.linked ? `The shared spreadsheet is ${s.kind}${s.fileName ? ` (${s.fileName})` : ''}` : s.kind === 'download and upload' ? 'No Excel or Google sheet is linked; the shared spreadsheet works by download and upload' : `${s.kind} is chosen but no sheet is linked yet`;
  const sent = s.lastSend ? ` It was last sent ${at(s.lastSend.at)}${s.lastSend.ok ? '' : `, and that failed: ${s.lastSend.message}`}.` : ' Nothing has been sent yet.';
  const read = s.lastRead ? ` It was last read ${at(s.lastRead.at)}${s.lastRead.ok ? '' : `, and that failed: ${s.lastRead.message}`}.` : s.readsBookingRequests ? ' Booking requests have not been read from it yet.' : '';
  const waiting = s.readsBookingRequests ? ` ${s.requestsWaiting ? `${count(s.requestsWaiting, 'booking request')} from the sheet ${s.requestsWaiting === 1 ? 'is' : 'are'} waiting for review` : 'No booking requests from the sheet are waiting'}${s.requestsWithProblems ? `, and ${count(s.requestsWithProblems, 'row')} ${s.requestsWithProblems === 1 ? 'has' : 'have'} problems to fix in the sheet` : ''}.` : '';
  const notes = ['This is the same as Settings › Connections, Shared spreadsheet. Rows from the sheet only become bookings when the team books them.'];
  if (s.problem) notes.push(`Problem: ${s.problem}`);
  if (s.sends.length) notes.push(`Daji sends: ${s.sends.join(', ')}.`);
  return base('sheet', `${linked}.${sent}${read}${waiting}`, {
    details: s.rows.map((r) => ({ label: `Line ${r.line} · ${r.status}`, text: [r.date, r.start, r.ground, 'name' in r ? r.name : null].filter(Boolean).join(' · ') + (r.problems.length ? ` (${r.problems.join('; ')})` : '') })), notes,
  });
}

/** Settings › Server in words, for the owner: healthy or not, what needs a look, and what the SSH button opens. */
function serverAnswer(ctx: T.Ctx, base: (i: Intent, answer: string, extra?: Partial<Built>) => Built): Built {
  if (ctx.user.role !== 'owner' && ctx.user.role !== 'super_admin') return base('server', 'Only the owner can see the server status. It is under Settings › Server.');
  if (!ctx.cfg) return base('server', 'The server status is not available here. Open Settings › Server.');
  const s = T.server(ctx);
  const at = (iso: string | null): string => (iso ? `${niceDay(istDate(Date.parse(iso)))} at ${timeOfDay(Date.parse(iso))}` : 'never');
  const head = s.healthy ? `The server is up and the database is readable${s.warnings.length ? `, but ${count(s.warnings.length, 'thing needs', 'things need')} a look` : ''}.` : 'The server is answering, but the database could not be read.';
  return base('server', `${head} It has been running ${s.upHours} hours; memory is ${s.memoryUsedPercent}% used${s.diskUsedPercent == null ? '' : ` and the disk ${s.diskUsedPercent}% full (${s.diskFreeGb} GB free)`}. The last backup was ${at(s.backups.lastAt)}.`, {
    details: [
      ...s.warnings.map((w) => ({ label: 'Needs a look', text: w })),
      { label: 'Version', text: s.version }, { label: 'Environment', text: `${s.environment}${s.demoMode ? ' (demo mode on)' : ''}` },
      { label: 'Off-site copy', text: at(s.backups.lastOffsiteCopyAt) }, { label: 'SSH button', text: s.sshButton }, { label: 'AI coding console', text: s.codingConsole },
    ],
    notes: ['This is the same as Settings › Server. I only read the status; I cannot open a terminal or change the server.'],
  });
}

function help(ctx: T.Ctx): Built {
  const lot = [...(T.can(ctx, 'reports') ? EXAMPLES.reports : []), ...(T.can(ctx, 'bookings') ? EXAMPLES.bookings : []), ...(T.can(ctx, 'customers') ? EXAMPLES.customers : []), ...(T.can(ctx, 'compliance') ? EXAMPLES.compliance : []), ...(T.can(ctx, 'tournaments') ? EXAMPLES.tournaments : [])];
  return {
    intent: 'help', answer: 'Ask me about your money or your bookings in plain words, for any dates: "past 37 days", "last month", "in September", "from 1 Oct to 14 Oct". I read the same figures as the Reports tab and tell you which dates I used.',
    details: [], understood: 'Help', period: null, open: null, notes: ['I only read figures; I never change anything.'], suggestions: lot,
  };
}

/** The next tournament fixtures, from Matches & tournaments: who plays whom, when and where, and whether the ground time is blocked. */
function fixturesAnswer(ctx: T.Ctx, base: (i: Intent, answer: string, extra?: Partial<Built>) => Built): Built {
  if (!hasPermission(ctx.user, 'manage_matches')) return base('fixtures', 'You do not have access to tournaments. Ask the owner to give you the "manage_matches" permission.');
  const rows = many<{ tname: string; a: string; b: string; starts_at: number; ground: string | null; block_until: number | null; round: number }>(
    `SELECT t.name tname, ta.name a, tb.name b, f.starts_at, g.name ground, f.block_until, f.round
       FROM tournament_fixtures f JOIN tournaments t ON t.id = f.tournament_id JOIN tournament_teams ta ON ta.id = f.team_a_id JOIN tournament_teams tb ON tb.id = f.team_b_id
       LEFT JOIN grounds g ON g.id = f.ground_id
      WHERE f.owner_id = ? AND f.deleted_at IS NULL AND t.deleted_at IS NULL AND f.outcome IS NULL AND f.starts_at >= ?
      ORDER BY f.starts_at LIMIT 10`, ctx.ownerId, now());
  const unscheduled = one<{ n: number }>('SELECT COUNT(*) n FROM tournament_fixtures f JOIN tournaments t ON t.id = f.tournament_id WHERE f.owner_id = ? AND f.deleted_at IS NULL AND t.deleted_at IS NULL AND f.outcome IS NULL AND f.starts_at IS NULL', ctx.ownerId)!.n;
  const notes = unscheduled ? [`${count(unscheduled, 'fixture')} still ${unscheduled === 1 ? 'has' : 'have'} no date.`] : [];
  if (!rows.length) return base('fixtures', 'No tournament fixtures are coming up.', { notes });
  const when = (ms: number) => `${niceDay(istDate(ms))} ${new Date(ms + 330 * 60000).toISOString().slice(11, 16)}`;
  const first = rows[0]!;
  return base('fixtures', `${count(rows.length, 'fixture')} coming up${rows.length === 10 ? ' (the next 10)' : ''}. Next: ${first.a} v ${first.b} (${first.tname}) on ${when(first.starts_at)}${first.ground ? ` at ${first.ground}` : ''}.`, {
    details: rows.map((r) => ({ label: `${when(r.starts_at)}`, text: `${r.a} v ${r.b} · ${r.tname}, round ${r.round}${r.ground ? ` · ${r.ground}` : ''}${r.block_until ? ' · ground blocked' : ''}` })), notes,
  });
}

/**
 * Player records (career batting, bowling, fielding) from finished matches scored at this business, for those who score matches or may see
 * customers. Names are the ones on the scorecards. A player named in the question gets their own record; otherwise the leaders.
 */
function playerStatsAnswer(ctx: T.Ctx, question: string, base: (i: Intent, answer: string, extra?: Partial<Built>) => Built): Built {
  if (!hasPermission(ctx.user, 'manage_matches') && !hasPermission(ctx.user, 'view_customers')) return base('player_stats', 'You do not have access to player records. Ask the owner to give you the "manage_matches" permission.');
  const all = leaders(ctx.ownerId, 1000);
  const l = { ...all, runs: all.runs.slice(0, 5), wickets: all.wickets.slice(0, 5), fielding: all.fielding.slice(0, 5) };
  const notes = ['Built from the ball by ball score of finished matches. Only players in a squad linked to their Daji profile have a record; guests have none.'];
  if (!l.players) return base('player_stats', 'No player records yet. Add squads to a match (from a booking\'s team list or by mobile number) and score it to the end, and the records build themselves.', { notes });
  const t = normalise(question);
  const named = [...new Map([...all.runs, ...all.wickets, ...all.fielding].map((x) => [x.userId, x])).values()].filter((x) => new RegExp(`\\b${nameKey(x.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t));
  if (named.length === 1) {
    const p = named[0]!;
    const c = careerOf(p.userId, ctx.ownerId);
    const b = c.career.batting, w = c.career.bowling, f = c.career.fielding;
    return base('player_stats', `${p.name}: ${count(c.career.matches, 'match', 'matches')}, ${count(b.runs, 'run')} in ${count(b.innings, 'innings', 'innings')}${b.highest ? ` (highest ${b.highest}${b.average !== null ? `, average ${b.average}` : ''}${b.strikeRate !== null ? `, strike rate ${b.strikeRate}` : ''})` : ''}, ${count(w.wickets, 'wicket')}${w.best ? ` (best ${w.best}${w.economy !== null ? `, economy ${w.economy}` : ''})` : ''}, ${count(f.catches, 'catch', 'catches')}, ${count(f.runOuts, 'run out')} and ${count(f.stumpings, 'stumping')}.`, {
      details: c.matches.slice(0, 8).map((m) => ({ label: `${niceDay(istDate(m.date))} v ${m.opponent}`, text: m.summary })), notes,
    });
  }
  const top = (xs: typeof l.runs, f: (x: (typeof l.runs)[number]) => string) => xs.length ? xs.map((x, i) => `${i + 1}. ${x.name} ${f(x)}`).join('; ') : 'nobody yet';
  const r0 = l.runs[0], w0 = l.wickets[0];
  const head = `${count(l.players, 'player')} with a record from ${count(l.matches, 'finished match', 'finished matches')}.${r0 ? ` Most runs: ${r0.name}, ${count(r0.runs, 'run')}.` : ''}${w0 ? ` Most wickets: ${w0.name}, ${count(w0.wickets, 'wicket')}.` : ''}`;
  return base('player_stats', head, {
    details: [
      { label: 'Most runs', text: top(l.runs, (x) => `${x.runs} (HS ${x.highest ?? '-'})`) },
      { label: 'Most wickets', text: top(l.wickets, (x) => `${x.wickets} (best ${x.best ?? '-'})`) },
      { label: 'Most dismissals in the field', text: top(l.fielding, (x) => `${x.dismissals}`) },
    ], notes, suggestions: r0 ? [`Stats for ${r0.name}`] : [],
  });
}

/**
 * Fantasy cricket (fantasy.ts) at this business, for those who run matches: the contests, teams entered, the latest contest's top teams and
 * the season table. Team names are the ones players chose; a player's own name is never given. Free to play: there is no money in it.
 */
function fantasyAnswer(ctx: T.Ctx, base: (i: Intent, answer: string, extra?: Partial<Built>) => Built): Built {
  if (!hasPermission(ctx.user, 'manage_matches')) return base('fantasy', 'You do not have access to fantasy contests. Ask the owner to give you the "manage_matches" permission.');
  const f = fantasyOverview(ctx.ownerId, true);
  const notes = ['Free to play: points only, no entry fee and no prize. Points come from the ball by ball score.'];
  if (!f.contests) return base('fantasy', 'No fantasy contests yet. Open one from Fixtures, Fantasy, on a public match that has both squads, before its first ball.', { notes, open: null });
  const head = `${count(f.contests, 'contest')}: ${f.open} open, ${f.live} under way and ${f.finished} finished, with ${count(f.teamsEntered, 'team')} entered.`;
  const details = [
    ...(f.latest ? [{ label: `${f.latest.match} (${f.latest.state})`, text: f.latest.top.length ? f.latest.top.map((x) => `${x.rank}. ${x.teamName} ${x.points}`).join('; ') : `${count(f.latest.teams, 'team')} entered` }] : []),
    { label: 'Season table', text: f.season.top.length ? f.season.top.map((x) => `${x.rank}. ${x.teamName} ${x.points} (${count(x.contests, 'contest')})`).join('; ') : 'No finished contests yet' },
  ];
  return base('fantasy', head, { details, notes });
}

/**
 * The branches of this business (areas.ts) the asker may see, with their projects and open and overdue jobs: the same as the task
 * board shows. A restricted branch the asker was not given is not mentioned. Names only; no people and no money.
 */
function branchesAnswer(ctx: T.Ctx, base: (i: Intent, answer: string, extra?: Partial<Built>) => Built): Built {
  if (!hasPermission(ctx.user, 'manage_tasks')) return base('branches', 'You do not have access to the projects. Ask the owner to give you the "manage_tasks" permission.');
  const b = T.branches(ctx);
  if (!b.branches.length) return base('branches', b.notInABranch.length ? `This business has no branches set up. It has ${count(b.notInABranch.length, 'project')}.` : 'This business has no branches or projects set up.');
  const line = (ps: { name: string; openJobs: number; overdueJobs: number }[]) => ps.length ? ps.map((p) => `${p.name}: ${count(p.openJobs, 'open job')}${p.overdueJobs ? `, ${p.overdueJobs} overdue` : ''}`).join('; ') : 'No projects';
  const details = [...b.branches.map((a) => ({ label: a.name, text: line(a.projects) })), ...(b.notInABranch.length ? [{ label: 'Not in a branch', text: line(b.notInABranch) }] : [])];
  return base('branches', `${count(b.branches.length, 'branch', 'branches')} you can see: ${b.branches.map((a) => a.name).join(', ')}.`, { details });
}

/**
 * Supervisor Cash (cashbook.ts): what each person who holds the business's cash should have in hand, what waits for sign-off,
 * receipts missing and uncertain spends, and the last count. The owner hears about everyone, a team member about their own cash.
 */
function cashAnswer(ctx: T.Ctx, base: (i: Intent, answer: string, extra?: Partial<Built>) => Built): Built {
  const c = T.cash(ctx);
  if (!c.available) return base('cash', c.why!);
  if (!c.holders!.length) return base('cash', 'No cash has been handed out in this business yet.');
  const details = c.holders!.map((h) => ({
    label: h.name ?? 'Team member',
    text: [`Should have ${R(h.expectedInHandPaise)} in hand (${R(h.confirmedInHandPaise)} counting only signed-off spends)`,
      h.spendsWaitingForSignOff ? `${count(h.spendsWaitingForSignOff, 'spend')} of ${R(h.waitingPaise)} waiting for sign-off` : 'nothing waiting for sign-off',
      ...(h.spendsWithoutReceipt ? [`${count(h.spendsWithoutReceipt, 'spend')} without a receipt`] : []),
      ...(h.uncertainSpends ? [`${count(h.uncertainSpends, 'uncertain spend')}`] : []),
      h.lastCount ? `last count ${R(h.lastCount.countedPaise)}, ${h.lastCount.differencePaise === 0 ? 'matching' : h.lastCount.differencePaise < 0 ? `${R(-h.lastCount.differencePaise)} short` : `${R(h.lastCount.differencePaise)} over`}` : 'not counted yet',
    ].join('; ') + '.',
  }));
  const waiting = c.holders!.reduce((n, h) => n + h.spendsWaitingForSignOff, 0);
  const head = c.holders!.length === 1
    ? `${c.holders![0]!.name ?? 'You'} should have ${R(c.holders![0]!.expectedInHandPaise)} in hand.`
    : `${count(c.holders!.length, 'person holds', 'people hold')} cash for this business; ${count(waiting, 'spend')} waiting for sign-off.`;
  return base('cash', head, { details, notes: ['These cash records are not posted to the books.'] });
}

/**
 * The daily site report (taskwork.ts): today's, or yesterday's when asked. The same jobs the task board shows the asker. Proof counts
 * are only fresh camera photos; reference pictures and files are counted apart and never called proof.
 */
function siteReportAnswer(ctx: T.Ctx, question: string, base: (i: Intent, answer: string, extra?: Partial<Built>) => Built): Built {
  const today = istDate(now());
  const date = /\byesterday\b/i.test(question) ? addDays(today, -1) : today;
  const r = T.siteReport(ctx, date, null);
  if (!r.found) return base('site_report', r.why!);
  const day = date === today ? 'today' : 'yesterday';
  const details = [
    ...(r.finished!.length ? [{ label: 'Finished', text: r.finished!.map((f) => `${f.title}${f.by ? ` (${f.by})` : ''}, ${count(f.proofPhotos, 'proof photo')}${f.signedOff ? ', signed off' : ''}`).join('; ') }] : []),
    ...(r.started!.length ? [{ label: 'Started', text: r.started!.join('; ') }] : []),
    ...(r.raisedRequests!.length ? [{ label: 'Requests raised', text: r.raisedRequests!.map((x) => `${x.title}${x.by ? ` (${x.by})` : ''}`).join('; ') }] : []),
    ...(r.overdue!.length ? [{ label: 'Overdue', text: r.overdue!.map((x) => x.title).join('; ') }] : []),
    ...r.notes!.map((n) => ({ label: `Note from ${n.by ?? 'the team'}`, text: [n.workers !== null ? `${count(n.workers, 'person', 'people')} working` : null, n.note, n.problems ? `Problems: ${n.problems}` : null].filter(Boolean).join('. ') })),
  ];
  const head = `On the site ${day}: ${count(r.finished!.length, 'job')} finished, ${count(r.started!.length, 'job')} started, ${count(r.overdue!.length, 'job')} overdue, and ${count(r.notes!.length, 'note')} from the team.`;
  return base('site_report', head, { details, notes: r.references ? [`${count(r.references, 'reference file')} added. References explain a job; they are not proof.`] : [] });
}
