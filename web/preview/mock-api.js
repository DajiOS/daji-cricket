// Stand-in for the Daji server, used ONLY by the hosted preview page.
// It answers the same /api routes the website calls, in memory, with sample data. Nothing is saved and nothing leaves the page.
// The real website never loads this file. Build the preview with: python3 web/preview/build_preview.py
(() => {
'use strict';
const SAMPLE = /*SAMPLE*/null;
const IST = 330 * 60000;
const HOUR = 3600000;
const pad = (n) => String(n).padStart(2, '0');
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);
const mins = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
// Opening hours for a date: winter (Nov-Feb) may differ from summer, and a closing time such as 27:00 means 3 am the next morning.
const hoursOf = (g, date) => { const m = Number(date.slice(5, 7)), w = g.winterOpenTime && g.winterCloseTime && (m >= (g.winterFromMonth || 11) || m <= (g.winterToMonth || 2)); return [mins(w ? g.winterOpenTime : g.openTime), mins(w ? g.winterCloseTime : g.closeTime)]; };
const wrapT = (x) => `${pad(Math.floor(x / 60) % 24)}:${pad(x % 60)}`;
// a slot's start instant: times before the opening time belong to the early hours after midnight
const atG = (g, date, hhmm) => { let m = mins(hhmm); if (m < hoursOf(g, date)[0]) m += 1440; return at(date, '00:00') + m * 60000; };
const inr = (p) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 12);
const refCode = () => 'DJ-' + Math.random().toString(36).slice(2, 8).toUpperCase();

class Err { constructor(status, code, message, details) { this.status = status; this.code = code; this.message = message; this.details = details; } }
const bad = (fields) => new Err(400, 'VALIDATION_FAILED', 'Some fields are not valid', { fields });

// ---------------------------------------------------------------- people
const owner = SAMPLE.users.owner;
const PEOPLE = {
  'customer@daji.test': { pw: 'Customer@12345', user: SAMPLE.users.customer },
  'owner1@daji.test': { pw: 'Owner@12345', user: owner },
  'staff1@daji.test': { pw: 'Staff@12345', user: { ...owner, id: 'usr_demo_staff', role: 'staff', name: 'Ground Staff', email: 'staff1@daji.test', phone: '9000000004', ownerId: owner.id, permissions: ['manage_bookings', 'verify_payments', 'record_payments', 'manage_enquiries', 'view_customers'], businessName: null, upiId: null } },
  'admin@daji.test': { pw: 'Admin@12345', user: SAMPLE.users.admin },
};
const tokenFor = (email) => 'preview.' + btoa(email);
const emailFrom = (token) => { try { return atob(String(token).replace(/^preview\./, '')); } catch { return null; } };

// ---------------------------------------------------------------- bookings, in memory
const grounds = SAMPLE.grounds;
const groundById = (id) => grounds.find((g) => g.id === id);
const bookings = [];
const lots = []; // account credit
const customerId = SAMPLE.users.customer.id;

function makeBooking({ ground, date, startTime, slots, status, paid = 0, source = 'online', who = SAMPLE.users.customer, notes = null, format = null, total: totalIn = null, startAt: startIn = null, endAt: endIn = null }) {
  const startAt = startIn ?? atG(ground, date, startTime);
  const total = totalIn ?? (format ? ((sessionsOf(ground, date, format).find((x) => wrapT(x.m) === startTime) || {}).price ?? formatPrice(format, date)) : priceSlots(ground, date, startTime, slots));
  const b = {
    id: uid('bkg'), ref: refCode(), groundId: ground.id, groundName: ground.name, ownerId: ground.ownerId,
    customerId: who.id, customerName: who.name, customerPhone: who.phone || '9876543210',
    date, startAt, endAt: endIn ?? startAt + slots * ground.slotMinutes * 60000, slotCount: slots, formatLabel: format ? format.label : null, ball: format ? format.ball : null, status, source,
    totalPaise: total, advancePaise: advance(ground, total, startAt), paidPaise: paid, balancePaise: Math.max(total - paid, 0),
    holdExpiresAt: null, needsReview: false, cancelKind: null, approval: 'approved', cancelledByOwner: false, resolution: null, cancelReason: null, refundPaise: 0, creditPaise: 0, cancelledAt: null,
    confirmedAt: status === 'confirmed' || status === 'completed' ? Date.now() : null, players: null, notes, createdAt: Date.now(),
  };
  bookings.push(b);
  return b;
}

// price list: hourly and fixed-session prices by ball, weekday and time (same rules as the server)
const dowOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const isClosed = (g, date) => (g.closedDays || []).includes(dowOf(date));
const hm = (ms) => new Date(ms + 19800000).toISOString().slice(11, 16);
function ruleWin(g, date, rule) {
  const out = [], days = rule.mode === 'fixed' ? rule.bundleDays || 1 : 1;
  for (let d = 0; d < days; d++) { const day = addDays(date, d); if (isClosed(g, day)) return null; const base = at(day, '00:00'); for (let m = mins(rule.from); m < mins(rule.to); m += g.slotMinutes) out.push(base + m * 60000); }
  return out;
}
// a fixed session already under way is sold for the hours left, at a share of the price rounded up to the next 50 rupees
function fixedShare(g, w, rule) {
  const now = Date.now(), starts = w.filter((x) => x > now && x >= now + (g.minNoticeMinutes || 0) * 60000);
  const pro = starts.length > 0 && starts.length < w.length;
  return { starts, pro, price: pro ? Math.min(rule.pricePaise, Math.ceil(rule.pricePaise * starts.length / w.length / 5000) * 5000) : rule.pricePaise };
}
function slotState(g, date, start, seeded = true) {
  const end = start + g.slotMinutes * 60000, b = bookings.find((x) => x.groundId === g.id && live(x) && (x.starts ? x.starts.some((t) => t < end && t + g.slotMinutes * 60000 > start) : x.startAt < end && x.endAt > start));
  if (end <= Date.now()) return 'past';
  if (b) return b.status === 'held' ? 'held' : 'booked';
  return seeded && seededBooked(g, istDate(start), hm(start)) ? 'booked' : 'available';
}
function rateOptions(g, date) {
  if (isClosed(g, date)) return [];
  const out = [];
  for (const r of g.rates || []) {
    if (!r.days.includes(dowOf(date))) continue;
    const w = ruleWin(g, date, r); if (!w) continue;
    const base = { ruleId: r.id, label: r.label, ball: r.ball, mode: r.mode, start: w[0], end: w[w.length - 1] + g.slotMinutes * 60000, time: hm(w[0]), endTime: hm(w[w.length - 1] + g.slotMinutes * 60000), pricePaise: r.pricePaise, bundleDays: r.bundleDays || 1 };
    if (r.mode === 'fixed') {
      const sh = fixedShare(g, w, r), use = sh.pro ? sh.starts : w, st = use.map((x) => slotState(g, date, x, false)), state = ['booked', 'held', 'blocked', 'past'].find((x) => st.includes(x)) || 'available';
      out.push(sh.pro ? { ...base, start: use[0], time: hm(use[0]), pricePaise: sh.price, state, proRated: true, fullPricePaise: r.pricePaise, hoursLeft: use.length * g.slotMinutes / 60 } : { ...base, state });
    }
    else { const per = Math.round(r.pricePaise * g.slotMinutes / 60), slots = w.map((x) => ({ start: x, end: x + g.slotMinutes * 60000, time: hm(x), pricePaise: per, state: slotState(g, date, x) })); out.push({ ...base, state: slots.some((x) => x.state === 'available') ? 'available' : slots[0].state, slots }); }
  }
  const rank = { combo: 0, leather: 1, tennis: 2, practice: 3 };
  return out.sort((a, b) => (a.ball === b.ball ? a.start - b.start : rank[a.ball] - rank[b.ball]));
}
function sessionsOf(g, date, f) {
  if (isClosed(g, date)) return [];
  const out = [];
  const [open, close] = hoursOf(g, date);
  for (let m = open; m + f.minutes <= close; m += f.minutes) out.push({ m, price: formatPrice(f, date) });
  return out;
}
const formatPrice = (f, date) => { const dow = new Date(date + 'T00:00:00Z').getUTCDay(); return (dow === 0 || dow === 6) && f.weekendPricePaise != null ? f.weekendPricePaise : f.pricePaise; };
function formatAvail(g, date, slots) {
  return (g.formats || []).map((f) => {
    const windows = [];
    for (const { m, price } of sessionsOf(g, date, f)) {
      const t = wrapT, start = at(date, '00:00') + m * 60000, end = start + f.minutes * 60000;
      const inside = slots.filter((s) => s.start >= start && s.start < end), states = inside.map((s) => s.state);
      const worst = ['booked', 'held', 'blocked', 'past'].find((x) => states.includes(x)) || 'available';
      windows.push({ start, end, time: t(m), endTime: t(m + f.minutes), pricePaise: price, state: worst });
    }
    return { formatId: f.id, windows };
  });
}
function slotTimes(g, date) {
  const out = []; if (date && isClosed(g, date)) return out; const [open, close] = hoursOf(g, date || '2026-07-01');
  for (let m = open; m + g.slotMinutes <= close; m += g.slotMinutes) out.push(wrapT(m));
  return out;
}
function slotPrice(g, date, time) {
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  const weekend = dow === 0 || dow === 6;
  let p = weekend && g.weekendPricePaise ? g.weekendPricePaise : g.pricePaise;
  if (g.eveningSurchargePaise && (time >= g.eveningFrom || time < wrapT(hoursOf(g, date)[0]))) p += g.eveningSurchargePaise;
  return p;
}
function priceSlots(g, date, startTime, n) {
  const times = slotTimes(g, date); const i = times.indexOf(startTime); let t = 0;
  for (let k = 0; k < n; k++) t += slotPrice(g, date, times[i + k]);
  return t;
}
function advance(g, total, startAt) {
  const c = SAMPLE.config;
  if (startAt - Date.now() <= c.fullPaymentWithinHours * HOUR) return total;
  return Math.min(Math.max(Math.ceil((total * c.advanceValue) / 100), 100), total);
}
const live = (b) => b.status === 'confirmed' || b.status === 'completed' || (b.status === 'held' && b.holdExpiresAt > Date.now());
/** A few slots are already taken, the same way every time you open a day, so the grid looks like a real ground. */
function seededBooked(g, date, time) {
  let h = 2166136261;
  for (const ch of g.id + date + time) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100 < (time >= '17:00' && time <= '21:00' ? 34 : 14);
}

function availability(g, date) {
  const today = istDate(Date.now());
  const slots = slotTimes(g, date).map((time) => {
    const start = atG(g, date, time), end = start + g.slotMinutes * 60000;
    let state = 'available';
    if (end <= Date.now() || date < today) state = 'past';
    else if (bookings.some((b) => b.groundId === g.id && live(b) && b.startAt < end && b.endAt > start)) state = bookings.find((b) => b.groundId === g.id && live(b) && b.startAt < end && b.endAt > start).status === 'held' ? 'held' : 'booked';
    else if (seededBooked(g, date, time)) state = 'booked';
    return { start, end, time, pricePaise: slotPrice(g, date, time), state };
  });
  return { groundId: g.id, date, slots, formats: formatAvail(g, date, slots), ...((g.rates || []).length ? { rates: rateOptions(g, date) } : {}), ...(isClosed(g, date) ? { closed: true } : {}) };
}

function seed() {
  const today = istDate(Date.now());
  const g0 = grounds[0], g1 = grounds[1] || grounds[0];
  // sample future bookings sit midweek so weekend tournaments start out free
  let mid = 3; while (![2, 3, 4].includes(dowOf(addDays(today, mid)))) mid++;
  makeBooking({ ground: g0, date: addDays(today, 12 * -1), startTime: '19:00', slots: 2, status: 'completed', paid: priceSlots(g0, addDays(today, -12), '19:00', 2) });
  makeBooking({ ground: g0, date: addDays(today, mid), startTime: '19:00', slots: 2, status: 'confirmed', paid: Math.ceil(priceSlots(g0, addDays(today, mid), '19:00', 2) / 2) });
  makeBooking({ ground: g1, date: addDays(today, mid + 7), startTime: '07:00', slots: 1, status: 'confirmed', paid: Math.ceil(priceSlots(g1, addDays(today, mid + 7), '07:00', 1) / 2) });
  // one booking waiting for the owner's approval, and one the ground cancelled that the customer has to decide about
  const wk = (() => { let d = 4; while (![2, 3, 4].includes(dowOf(addDays(today, d)))) d++; return d; })();
  const pend = makeBooking({ ground: g0, date: addDays(today, wk), startTime: '20:00', slots: 1, status: 'confirmed', paid: 175000, who: { id: 'usr_sample_3', name: 'Imran Patel', phone: '9824011122' } });
  pend.approval = 'pending';
  const gone = makeBooking({ ground: g0, date: addDays(today, wk + 3), startTime: '19:00', slots: 2, status: 'cancelled', paid: 350000 });
  Object.assign(gone, { cancelKind: 'free', cancelledByOwner: true, resolution: 'awaiting', cancelledAt: Date.now() - 3600000, cancelReason: 'The ground will be closed for pitch repairs that evening. We are sorry for the trouble.' });
  // today's sessions for the owner desk, in the future part of the day so they read as upcoming
  const now = new Date(Date.now() + IST); const hr = now.getUTCHours();
  const later = (h) => `${pad(Math.min(Math.max(h, hr + 1, 19), 22))}:00`;
  const t1 = later(hr + 1), t2 = later(hr + 3);
  const other = { id: 'usr_sample_1', name: 'Rahul Desai', phone: '9898012345' }, other2 = { id: 'usr_sample_2', name: 'Kiran Shah', phone: '9825054321' };
  makeBooking({ ground: g0, date: today, startTime: t1, slots: 2, status: 'confirmed', paid: 200000, who: other });
  if (t2 !== t1) makeBooking({ ground: g1, date: today, startTime: t2, slots: 1, status: 'confirmed', paid: 30000, who: other2 });
}
seed();

// ---------------------------------------------------------------- sample figures for the owner desk
const money = { revenue: 18640000, expenses: 6215000 };
function pnl(month) {
  const from = month + '-01', last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  return {
    range: { from, to: `${month}-${pad(last)}` }, basis: 'accrual',
    revenue: { groups: [{ label: 'Booking income', totalPaise: money.revenue }], totalPaise: money.revenue },
    expenses: { groups: [{ label: 'Electricity', totalPaise: 2480000 }, { label: 'Groundsman and staff', totalPaise: 2800000 }, { label: 'Repairs', totalPaise: 935000 }], totalPaise: money.expenses },
    netProfitPaise: money.revenue - money.expenses, marginPercent: 66.7, previous: null, uncategorised: { count: 3, amountPaise: 410000 },
    notes: ['Booking income is counted on the day the session is played, not the day it was paid for.'],
  };
}
function ask(q) {
  const t = q.toLowerCase(), today = istDate(Date.now());
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = (d) => `${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]}`;
  const base = { question: q, details: [], source: 'builtin', verified: true, notes: ['Sample answer from the preview. The real site answers from your own books.'], suggestions: ['What was our profit last month?', 'What is my account balance?'] };
  const m = /(\d+)\s*days?/.exec(t);
  if (/revenue|income|earn/.test(t)) {
    const n = m ? Math.min(+m[1], 365) : 37, from = addDays(today, -n + 1);
    const amt = Math.round((money.revenue / 31) * n / 100) * 100;
    return { ...base, intent: 'revenue', answer: `Revenue for the past ${n} days (${label(from)} to ${label(today)} ${today.slice(0, 4)}) was ${inr(amt)}.`, understood: `Revenue · the past ${n} days · counted when sessions are played` };
  }
  if (/profit/.test(t)) return { ...base, intent: 'profit', answer: `Net profit last month was ${inr(money.revenue - money.expenses)} on revenue of ${inr(money.revenue)}.`, details: [{ label: 'Revenue', text: inr(money.revenue) }, { label: 'Expenses', text: inr(money.expenses) }], understood: 'Profit and Loss · last month' };
  if (/balance|bank/.test(t)) return { ...base, intent: 'balance', answer: `Your bank and cash balances add up to ${inr(41258000)}.`, details: [{ label: 'HDFC current account', text: inr(38120000) }, { label: 'Cash at the ground', text: inr(3138000) }], understood: 'Balance sheet · bank and cash today' };
  if (/electric|spend|expense/.test(t)) return { ...base, intent: 'expense', answer: `Electricity this financial year was ${inr(14820000)}.`, understood: 'Expenses · Electricity · this financial year' };
  if (/compare/.test(t)) return { ...base, intent: 'compare', answer: `This month revenue is ${inr(money.revenue)}, up 12% on last month (${inr(16640000)}).`, understood: 'Revenue · this month against last month' };
  return { ...base, intent: 'help', answer: 'In this preview I can answer a few sample questions. Try one of the suggestions below.', understood: null, notes: [], suggestions: SAMPLE.askExamples.slice(0, 4) };
}

// ---------------------------------------------------------------- the routes
const tile = (i) => {
  const hues = ['#c9a96b', '#2c7a5b', '#b8805c', '#8eadd0', '#e6d09f', '#9a7d44', '#6dbb96'];
  const c = hues[i % hues.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#1a1f1c'/><stop offset='1' stop-color='#0a0c0b'/></linearGradient></defs><rect width='400' height='400' fill='url(#g)'/><ellipse cx='200' cy='235' rx='150' ry='62' fill='none' stroke='${c}' stroke-opacity='.55' stroke-width='3'/><rect x='186' y='150' width='28' height='170' rx='6' fill='${c}' fill-opacity='.22'/><circle cx='${110 + i * 28}' cy='${120 + (i % 3) * 20}' r='16' fill='${c}'/><text x='200' y='372' text-anchor='middle' font-family='sans-serif' font-size='15' letter-spacing='4' fill='${c}' fill-opacity='.8'>SAMPLE PHOTO ${i + 1}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
};
const closedMap = { ground: new Set(), practice: new Set(), academy: new Set() };
const closedList = () => Object.entries(closedMap).flatMap(([scope, set]) => [...set].map((date) => ({ date, scope, reason: null }))).sort((a, b) => (a.date + a.scope).localeCompare(b.date + b.scope));
const closedOut = () => ({ ground: [...closedMap.ground].sort(), practice: [...closedMap.practice].sort(), academy: [...closedMap.academy].sort() });
const settings = { autoDebitEnabled: true, autoDebitHoursBefore: 24, bookingsOpenFrom: '2026-11-14', bookingsCloseFrom: '2027-06-01', ...SAMPLE.adminSettings, instagramUrl: 'https://www.instagram.com/', galleryImages: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(tile) };
const backups = [{ name: istDate(Date.now()) + '_031500', createdAt: Date.now() - 20 * HOUR, date: istDate(Date.now()), reason: 'scheduled', dbBytes: 434176, files: 0, filesBytes: 0, integrity: 'ok' }];

function who(headers) {
  const h = headers.authorization || headers.Authorization || '';
  const email = emailFrom(h.replace(/^Bearer\s+/i, ''));
  const p = email && PEOPLE[email];
  if (!p) throw new Err(401, 'UNAUTHENTICATED', 'Please sign in');
  return p.user;
}
const needRole = (u, ...roles) => { if (!roles.includes(u.role)) throw new Err(403, 'FORBIDDEN', 'Your role does not include this'); };
const credit = () => lots.reduce((n, l) => n + l.remainingPaise, 0);
const myBookings = () => bookings.filter((b) => b.customerId === customerId).sort((a, b) => b.startAt - a.startAt);

function expire() {
  for (const b of bookings) if (b.status === 'held' && b.holdExpiresAt && b.holdExpiresAt <= Date.now()) { b.status = 'expired'; if (b.seriesIndex === 0) for (const x of bookings) if (x.seriesId === b.seriesId && x._sibling && x.status === 'held') x.status = 'expired'; }
}

function cancelPreview(b) {
  const hrs = Math.round(((b.startAt - Date.now()) / HOUR) * 10) / 10;
  if (b.status === 'held') return { bookingId: b.id, kind: 'free', hoursBeforeStart: hrs, paidPaise: 0, refundPaise: 0, creditPaise: 0, retainedPaise: 0, message: 'Free cancellation. Nothing was paid.' };
  if (hrs >= SAMPLE.config.freeCancelHours) { const back = Math.floor(b.paidPaise / 2); return { bookingId: b.id, kind: 'free', hoursBeforeStart: hrs, paidPaise: b.paidPaise, refundPaise: back, creditPaise: 0, retainedPaise: b.paidPaise - back, creditOptionPaise: b.paidPaise, cashRefundPercent: 50, message: `Free cancellation. Refund to your payment method: ${inr(back)} (50% of ${inr(b.paidPaise)}). Or keep the full ${inr(b.paidPaise)} as account credit for a future booking.` }; }
  return { bookingId: b.id, kind: 'late', hoursBeforeStart: hrs, paidPaise: b.paidPaise, refundPaise: 0, creditPaise: 0, retainedPaise: b.paidPaise, message: `This is inside the free cancellation window, so the advance of ${inr(b.paidPaise)} is kept.` };
}

const ROUTES = [];
const route = (method, re, fn) => ROUTES.push([method, re, fn]);

route('GET', /^\/api\/config$/, () => ({ ...SAMPLE.config, bookingsOpenFrom: settings.bookingsOpenFrom, bookingsCloseFrom: settings.bookingsCloseFrom, closedDates: closedOut(), autoDebitEnabled: !!settings.autoDebitEnabled, autoDebitHoursBefore: settings.autoDebitHoursBefore || 24, instagramUrl: settings.instagramUrl || null, gallery: settings.galleryImages }));
route('GET', /^\/api\/grounds$/, () => ({ items: grounds }));
route('GET', /^\/api\/grounds\/([^/]+)\/availability$/, (c, [, id]) => {
  const g = groundById(decodeURIComponent(id)); if (!g) throw new Err(404, 'NOT_FOUND', 'Ground not found');
  const date = c.query.get('date'); if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw bad([{ field: 'date', message: 'Use YYYY-MM-DD' }]);
  expire(); return availability(g, date);
});
route('POST', /^\/api\/auth\/login$/, (c) => {
  const idf = String(c.body.identifier || c.body.email || '').trim().toLowerCase(), digits = idf.replace(/\D/g, '').slice(-10);
  const p = PEOPLE[idf] || (digits.length === 10 ? Object.values(PEOPLE).find((x) => String(x.user.phone || '').replace(/\D/g, '').slice(-10) === digits) : null);
  if (!p || p.pw !== c.body.password) throw new Err(401, 'INVALID_LOGIN', 'Email, mobile number or password is not right');
  return { token: tokenFor(Object.keys(PEOPLE).find((k) => PEOPLE[k] === p)), user: p.user };
});
route('POST', /^\/api\/auth\/register$/, (c) => {
  const b = c.body, f = [];
  if (b.firstName) { b.name = `${cap(b.firstName)} ${cap(b.lastName || '')}`.trim(); } else if (!b.name || b.name.trim().length < 2) f.push({ field: 'name', message: 'At least 2 characters' });
  if (b.phone && !/^[6-9]\d{9}$/.test(String(b.phone || '').replace(/\D/g, '').slice(-10))) f.push({ field: 'phone', message: 'Enter a 10 digit mobile number' });
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(b.email || '')) f.push({ field: 'email', message: 'Enter a valid email' });
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(b.password || '')) f.push({ field: 'password', message: 'At least 8 characters with a capital letter, a small letter and a number' });
  if (f.length) throw bad(f);
  const email = b.email.trim().toLowerCase();
  if (PEOPLE[email]) throw new Err(409, 'EMAIL_TAKEN', 'An account with this email already exists');
  const user = { ...SAMPLE.users.customer, id: customerId, name: b.name.trim(), firstName: b.name.trim().split(' ')[0], lastName: b.name.trim().split(' ').slice(1).join(' '), email, phone: b.phone || null };
  PEOPLE[email] = { pw: b.password, user };
  return { token: tokenFor(email), user };
});
// phone and one-time code (the preview always uses 123456)
const cap = (t) => String(t || '').trim().replace(/\s+/g, ' ').replace(/(^|[\s'’-])(\p{L})/gu, (_m, a, c) => a + c.toUpperCase());
route('POST', /^\/api\/auth\/otp\/request$/, (c) => {
  if (!/^[6-9]\d{9}$/.test(String(c.body.phone || '').replace(/\D/g, '').slice(-10))) throw bad([{ field: 'phone', message: 'Enter a 10 digit mobile number' }]);
  return { sent: true, expiresInSeconds: 600, devCode: '123456' };
});
route('POST', /^\/api\/auth\/otp\/verify$/, (c) => {
  const b = c.body, phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
  if (b.code !== '123456') throw new Err(400, 'OTP_INVALID', 'That code is not right. Check the message and try again.');
  const key = Object.keys(PEOPLE).find((k) => PEOPLE[k].user.role === 'customer' && String(PEOPLE[k].user.phone || '').slice(-10) === phone);
  if (key) return { token: tokenFor(key), user: PEOPLE[key].user, created: false };
  if (!b.firstName || !b.lastName) throw new Err(400, 'NAME_REQUIRED', 'There is no account for this number yet. Add your first and last name to create one.', { fields: [{ field: 'firstName', message: 'Required' }] });
  const k = 'phone:' + phone, first = cap(b.firstName), last = cap(b.lastName);
  PEOPLE[k] = { pw: null, user: { ...SAMPLE.users.customer, id: customerId, name: `${first} ${last}`, firstName: first, lastName: last, email: null, phone } };
  return { token: tokenFor(k), user: PEOPLE[k].user, created: true };
});
const services = [
  { id: 'svc_msg91', name: 'MSG91', purpose: 'Text message sign-in codes (backup for WhatsApp)', accountEmail: 'sqinchmoney@gmail.com', phone: null, loginUrl: 'https://msg91.com', status: 'account_created', notes: 'Account opened with this email. Still to do: add the DLT template and get the Auth Key.', updatedAt: Date.now() },
  { id: 'svc_whatsapp', name: 'WhatsApp Business (Meta)', purpose: 'Sign-in codes by WhatsApp, first choice', accountEmail: null, phone: null, loginUrl: 'https://business.facebook.com', status: 'not_started', notes: 'Needs a Meta Business account, a phone number and an approved Authentication template named daji_otp.', updatedAt: Date.now() },
  { id: 'svc_razorpay', name: 'Razorpay', purpose: 'Online card and UPI payments', accountEmail: null, phone: null, loginUrl: 'https://dashboard.razorpay.com', status: 'not_started', notes: 'Test mode first; switch to live once the business is verified.', updatedAt: Date.now() },
  { id: 'svc_wix', name: 'Wix', purpose: 'The public website, dajicricket.com', accountEmail: null, phone: null, loginUrl: 'https://manage.wix.com', status: 'not_started', notes: null, updatedAt: Date.now() },
  { id: 'svc_expo', name: 'Expo', purpose: 'The mobile app and its push notifications', accountEmail: null, phone: null, loginUrl: 'https://expo.dev', status: 'not_started', notes: null, updatedAt: Date.now() },
];
const CONNS = [
  { id: 'whatsapp', name: 'WhatsApp (Meta Cloud API)', what: 'Sign-in codes by WhatsApp, the first choice.', setup: 'Create a Meta Business account, add a phone number, get an approved Authentication template named daji_otp, then put the token and phone number ID in the server settings.', status: 'missing', missing: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID'], canTest: false, lastTest: null, note: null },
  { id: 'msg91', name: 'MSG91', what: 'Text message sign-in codes, the backup for WhatsApp.', setup: 'Create an MSG91 account, register the DLT template for the code message, then put the Auth Key and Template ID in the server settings.', status: 'missing', missing: ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID'], canTest: false, lastTest: null, note: null },
  { id: 'razorpay', name: 'Razorpay', what: 'Online card and UPI payments, and refunds.', setup: 'Create a Razorpay account (test mode first), copy the Key ID and Key Secret, and add a webhook to /api/webhooks/razorpay with the same secret.', status: 'ready', missing: [], canTest: true, lastTest: null, note: null },
  { id: 'expo', name: 'Expo push notifications', what: "Alerts to the owner's and customers' phones from the mobile app.", setup: '', status: 'ready', missing: [], canTest: false, lastTest: null, note: null },
  { id: 'claude', name: 'Claude (Ask AI)', what: 'Answers questions in the owner desk when the built-in answerer cannot.', setup: 'Create an Anthropic API key and put it in ANTHROPIC_API_KEY. Set AI_MODE to auto or claude.', status: 'missing', missing: ['ANTHROPIC_API_KEY'], canTest: false, lastTest: null, note: null },
  { id: 'website', name: 'Website (Wix)', what: 'The public site at dajicricket.com talking to this server.', setup: 'Add https://dajicricket.com and https://www.dajicricket.com to CORS_ORIGINS.', status: 'partial', missing: ['CORS_ORIGINS'], canTest: false, lastTest: null, note: null },
  { id: 'email', name: 'Email (Gmail)', what: 'Booking emails to customers, sent from dajicricket@gmail.com.', setup: 'Turn on 2-Step Verification for dajicricket@gmail.com, create an App Password and put it in GMAIL_APP_PASSWORD.', status: 'missing', missing: ['GMAIL_APP_PASSWORD'], canTest: false, lastTest: null },
];
route('GET', /^\/api\/admin\/closed-dates$/, (c) => { needRole(who(c.headers), 'owner', 'super_admin'); return { items: closedList() }; });
route('POST', /^\/api\/admin\/closed-dates$/, (c) => { needRole(who(c.headers), 'owner', 'super_admin'); const sc = c.body.scopes || ['ground', 'practice', 'academy']; for (const d of c.body.dates || []) for (const k of sc) { if (c.body.closed) closedMap[k].add(d); else closedMap[k].delete(d); } return { changed: (c.body.dates || []).length * sc.length, items: closedList() }; });
route('GET', /^\/api\/admin\/integrations$/, (c) => { needRole(who(c.headers), 'owner', 'super_admin'); return { items: CONNS.map((x) => ({ ...x })) }; });
route('POST', /^\/api\/admin\/integrations\/([^/]+)\/test$/, (c, [, id]) => { needRole(who(c.headers), 'owner', 'super_admin'); const x = CONNS.find((k) => k.id === decodeURIComponent(id)); const r = { ok: true, message: 'Keys accepted (test mode). This is sample data.' }; if (x) x.lastTest = { ...r, at: Date.now() }; return r; });
route('GET', /^\/api\/admin\/services$/, (c) => { needRole(who(c.headers), 'owner', 'super_admin'); return { items: services.map((s) => ({ ...s })) }; });
route('POST', /^\/api\/admin\/services$/, (c) => { needRole(who(c.headers), 'owner', 'super_admin'); if (!c.body.name || c.body.name.trim().length < 2) throw bad([{ field: 'name', message: 'At least 2 characters' }]); const s = { id: uid('svc'), name: c.body.name.trim(), purpose: c.body.purpose || null, accountEmail: c.body.accountEmail || null, phone: c.body.phone || null, loginUrl: c.body.loginUrl || null, status: c.body.status || 'not_started', notes: c.body.notes || null, updatedAt: Date.now() }; services.push(s); return { ...s }; });
route('PATCH', /^\/api\/admin\/services\/([^/]+)$/, (c, [, id]) => { needRole(who(c.headers), 'owner', 'super_admin'); const s = services.find((x) => x.id === decodeURIComponent(id)); if (!s) throw new Err(404, 'NOT_FOUND', 'Service not found'); for (const k of ['name', 'purpose', 'accountEmail', 'phone', 'loginUrl', 'status', 'notes']) if (k in c.body) s[k] = c.body[k] || null; s.updatedAt = Date.now(); return { ...s }; });
route('DELETE', /^\/api\/admin\/services\/([^/]+)$/, (c, [, id]) => { needRole(who(c.headers), 'owner', 'super_admin'); const i = services.findIndex((x) => x.id === decodeURIComponent(id)); if (i >= 0) services.splice(i, 1); return { removed: true }; });
route('GET', /^\/api\/admin\/users$/, (c) => {
  needRole(who(c.headers), 'owner', 'super_admin');
  const q = (c.query.get('q') || '').toLowerCase(), role = c.query.get('role');
  const all = Object.values(PEOPLE).map((p) => p.user).filter((u, i, a) => a.findIndex((x) => x.id === u.id && x.email === u.email) === i)
    .map((u) => ({ firstName: (u.name || '').split(' ')[0], lastName: (u.name || '').split(' ').slice(1).join(' '), active: true, ...u }))
    .filter((u) => (!role || u.role === role) && (!q || [u.name, u.email, u.phone].some((x) => String(x || '').toLowerCase().includes(q))));
  const off = Number(c.query.get('offset') || 0), lim = Number(c.query.get('limit') || 25);
  return { items: all.slice(off, off + lim), total: all.length, limit: lim, offset: off };
});
route('PATCH', /^\/api\/admin\/users\/([^/]+)$/, (c, [, id]) => {
  needRole(who(c.headers), 'owner', 'super_admin');
  const e = Object.values(PEOPLE).find((p) => p.user.id === decodeURIComponent(id)); if (!e) throw new Err(404, 'NOT_FOUND', 'User not found');
  const u = e.user, b = c.body;
  if (b.firstName !== undefined) u.firstName = cap(b.firstName); if (b.lastName !== undefined) u.lastName = cap(b.lastName);
  if (b.firstName !== undefined || b.lastName !== undefined) u.name = [u.firstName, u.lastName].filter(Boolean).join(' ');
  if (b.phone) u.phone = b.phone; if (b.email) u.email = b.email; if (b.active !== undefined) u.active = !!b.active;
  return { ...u };
});
route('GET', /^\/api\/me$/, (c) => ({ user: who(c.headers) }));
route('GET', /^\/api\/credits$/, (c) => { who(c.headers); return { balancePaise: credit(), byOwner: credit() ? [{ ownerId: owner.id, ownerName: 'Daji Cricket Ground', balancePaise: credit() }] : [], lots, ledger: [] }; });

const promos = [
  { id: 'promo_1', code: 'WELCOME10', label: 'First booking', kind: 'percent', value: 10, maxDiscountPaise: 50000, minTotalPaise: 0, validFrom: null, validTo: null, usageLimit: null, perCustomerLimit: 1, groundId: null, ownerId: null, active: true, used: 3, createdAt: Date.now() - 9 * 86400000 },
];
function promoEval(code, total) {
  const p = promos.find((x) => x.code === String(code || '').trim().toUpperCase());
  if (!p || !p.active) throw new Err(400, 'PROMO_INVALID', 'That promo code is not valid.');
  if (p.usageLimit && p.used >= p.usageLimit) throw new Err(400, 'PROMO_INVALID', 'That promo code has been fully used.');
  if (total < p.minTotalPaise) throw new Err(400, 'PROMO_INVALID', 'This code needs a bigger booking.');
  let d = p.kind === 'percent' ? Math.floor(total * p.value / 100) : p.value;
  if (p.maxDiscountPaise) d = Math.min(d, p.maxDiscountPaise);
  return { p, d: Math.min(d, total) };
}
function applyPromo(bk, code, g) {
  if (!code) return;
  const { p, d } = promoEval(code, bk.totalPaise);
  bk.totalPaise -= d; bk.discountPaise = d; bk.promoCode = p.code; bk.advancePaise = advance(g, bk.totalPaise, bk.startAt); bk.balancePaise = bk.totalPaise - bk.paidPaise; p.used++;
}
route('POST', /^\/api\/promo\/check$/, (c) => {
  who(c.headers);
  const { p, d } = promoEval(c.body.promoCode, Number(c.body.total) || 0);
  return { code: p.code, label: p.label, discountPaise: d, totalPaise: Number(c.body.total) - d, fullPricePaise: Number(c.body.total) };
});
route('GET', /^\/api\/staff\/promos$/, (c) => { needRole(who(c.headers), 'owner', 'super_admin'); return { items: promos.map((p) => ({ ...p })) }; });
route('POST', /^\/api\/staff\/promos$/, (c) => {
  needRole(who(c.headers), 'owner', 'super_admin');
  const b = c.body, n = b.auto ? Math.min(Number(b.count) || 1, 50) : 1, items = [];
  const al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < n; i++) {
    let code = String(b.code || '').trim().toUpperCase();
    if (b.auto) { code = (b.prefix ? String(b.prefix).toUpperCase() + '-' : '') + Array.from({ length: 6 }, () => al[Math.floor(Math.random() * al.length)]).join(''); }
    if (code.length < 3) throw bad([{ field: 'code', message: 'At least 3 characters' }]);
    if (promos.some((x) => x.code === code)) throw new Err(409, 'PROMO_EXISTS', 'That code already exists. Choose another.');
    if (b.kind === 'percent' && b.value > 100) throw bad([{ field: 'value', message: '1 to 100' }]);
    const p = { id: uid('promo'), code, label: b.label || null, kind: b.kind, value: b.value, maxDiscountPaise: b.maxDiscountPaise || null, minTotalPaise: b.minTotalPaise || 0, validFrom: b.validFrom || null, validTo: b.validTo || null, usageLimit: b.oneTime ? 1 : b.usageLimit || null, perCustomerLimit: 1, groundId: null, ownerId: null, active: true, used: 0, createdAt: Date.now() };
    promos.unshift(p); items.push({ ...p });
  }
  return { items };
});
route('POST', /^\/api\/staff\/promos\/([^/]+)\/active$/, (c, [, id]) => {
  needRole(who(c.headers), 'owner', 'super_admin');
  const p = promos.find((x) => x.id === decodeURIComponent(id)); if (!p) throw new Err(404, 'NOT_FOUND', 'Promo code not found');
  p.active = !!c.body.active; return { ...p };
});

const holdBase = (c) => {
  const u = who(c.headers); needRole(u, 'customer'); expire();
  const b = c.body, g = groundById(b.groundId);
  if (!g) throw new Err(404, 'NOT_FOUND', 'Ground not found');
  if (settings.bookingsOpenFrom && b.date < settings.bookingsOpenFrom) throw new Err(409, 'NOT_OPEN_YET', 'Online bookings open on ' + settings.bookingsOpenFrom + '. Please pick that day or later.');
  if (closedMap[(g.formats || []).find((f) => f.id === b.formatId)?.ball === 'practice' ? 'practice' : 'ground'].has(b.date)) throw new Err(409, 'DATE_CLOSED', 'Online booking is switched off for that day. Please pick another day, or call us.');
  if (settings.bookingsCloseFrom && b.date >= settings.bookingsCloseFrom) throw new Err(409, 'BOOKINGS_CLOSED', 'Bookings are closed from that date for now. Please pick an earlier day, or call us.');
  if (b.ruleId) {
    const rule = (g.rates || []).find((r) => r.id === b.ruleId);
    if (!rule) throw new Err(400, 'UNKNOWN_RATE', 'That price is not offered at this ground');
    if (isClosed(g, b.date)) throw new Err(409, 'CLOSED_DAY', 'The ground is closed that day. Please pick another day.');
    if (!rule.days.includes(dowOf(b.date))) throw new Err(400, 'RATE_NOT_ON_DAY', rule.label + ' is not offered on that day');
    const w = ruleWin(g, b.date, rule); if (!w) throw new Err(409, 'CLOSED_DAY', 'That runs over a day the ground is closed');
    let starts = w, total = rule.pricePaise;
    if (rule.mode === 'fixed') { const sh = fixedShare(g, w, rule); if (sh.pro) { starts = sh.starts; total = sh.price; } }
    if (rule.mode === 'hourly') { const n = Number(b.slots || 1), i0 = w.findIndex((x) => hm(x) === b.startTime); if (i0 < 0 || i0 + n > w.length || n > g.maxSlots) throw new Err(400, 'INVALID_SLOT', 'Those hours are outside ' + rule.label); starts = w.slice(i0, i0 + n); total = n * Math.round(rule.pricePaise * g.slotMinutes / 60); }
    if (starts.some((x) => slotState(g, b.date, x, rule.mode === 'hourly') !== 'available')) throw new Err(409, 'SLOT_TAKEN', 'One of those hours was just taken. Please choose again.');
    const bk = makeBooking({ ground: g, date: b.date, startTime: b.startTime, slots: starts.length, status: 'held', format: { label: rule.label, ball: rule.ball }, total, startAt: starts[0], endAt: starts[starts.length - 1] + g.slotMinutes * 60000 });
    bk.starts = starts; applyPromo(bk, b.promoCode, g);
    bk.holdExpiresAt = Date.now() + SAMPLE.config.holdMinutesOnline * 60000; bk.customerId = customerId; bk.customerName = u.name; bk.customerPhone = u.phone || '9876543210';
    bk._orderId = 'order_preview_' + Math.random().toString(16).slice(2, 12); bk._due = bk.advancePaise;
    return { booking: { ...bk }, payment: { mode: 'razorpay', amountPaise: bk.advancePaise, paymentId: uid('pay'), razorpay: { keyId: 'rzp_test_preview', orderId: bk._orderId, demo: true } }, creditAppliedPaise: 0 };
  }
  const a = availability(g, b.date), times = a.slots.map((s) => s.time), i = times.indexOf(b.startTime);
  const fmt = b.formatId ? (g.formats || []).find((f) => f.id === b.formatId) : null;
  if (b.formatId && !fmt) throw new Err(400, 'UNKNOWN_FORMAT', 'That way of playing is not offered at this ground');
  if (!fmt && g.formats && g.formats.length) throw new Err(400, 'FORMAT_REQUIRED', 'Choose the ball and the match length first');
  const n = fmt ? fmt.minutes / g.slotMinutes : Number(b.slots);
  if (i < 0 || !(n >= 1) || (!fmt && n > g.maxSlots)) throw bad([{ field: 'slots', message: `Choose 1 to ${g.maxSlots} slots` }]);
  const picked = a.slots.slice(i, i + n);
  if (picked.length !== n || picked.some((s) => s.state !== 'available')) throw new Err(409, 'SLOT_TAKEN', 'One of those slots was just taken. Please choose again.');
  const bk = makeBooking({ ground: g, date: b.date, startTime: b.startTime, slots: n, status: 'held', format: fmt });
  applyPromo(bk, b.promoCode, g);
  bk.holdExpiresAt = Date.now() + SAMPLE.config.holdMinutesOnline * 60000;
  bk.customerId = customerId; bk.customerName = u.name; bk.customerPhone = u.phone || '9876543210';
  let applied = 0;
  if (b.useCredit && credit() > 0) {
    applied = Math.min(credit(), bk.advancePaise);
    let left = applied; for (const l of lots) { const t = Math.min(l.remainingPaise, left); l.remainingPaise -= t; left -= t; }
    bk.paidPaise = applied; bk.balancePaise = bk.totalPaise - applied;
  }
  const due = bk.advancePaise - applied;
  if (due <= 0) { bk.status = 'confirmed'; bk.approval = 'pending'; bk.holdExpiresAt = null; bk.confirmedAt = Date.now(); return { booking: { ...bk }, payment: { mode: 'none', amountPaise: 0, paymentId: null, razorpay: null }, creditAppliedPaise: applied }; }
  bk._orderId = 'order_preview_' + Math.random().toString(16).slice(2, 12);
  bk._due = due;
  return { booking: { ...bk }, payment: { mode: 'razorpay', amountPaise: due, paymentId: uid('pay'), razorpay: { keyId: 'rzp_test_preview', orderId: bk._orderId, demo: true } }, creditAppliedPaise: applied };
};

// ---- repeat bookings: the first date is held and paid; the others are reserved with it
const REP_MAX = { daily: 60, weekly: 52, monthly: 12, yearly: 3 };
function repeatDates(first, f, n) {
  const [y, m, d] = first.split('-').map(Number), out = [];
  for (let i = 0; i < n; i++) {
    let t;
    if (f === 'daily' || f === 'weekly') t = new Date(Date.UTC(y, m - 1, d + i * (f === 'daily' ? 1 : 7)));
    else { const tot = (f === 'monthly' ? i : i * 12) + (m - 1), yy = y + Math.floor(tot / 12), mm = tot % 12; t = new Date(Date.UTC(yy, mm, Math.min(d, new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()))); }
    out.push(t.toISOString().slice(0, 10));
  }
  return out;
}
route('POST', /^\/api\/bookings$/, (c) => {
  const r = c.body.repeat;
  if (r && (!REP_MAX[r.frequency] || !(r.count >= 2) || r.count > REP_MAX[r.frequency])) throw new Err(400, 'VALIDATION_FAILED', r && REP_MAX[r.frequency] ? `A ${r.frequency} booking can repeat up to ${REP_MAX[r.frequency]} times` : 'Check the repeat option');
  const res = holdBase(c);
  if (!r) return res;
  const first = bookings.find((x) => x.id === res.booking.id), g = groundById(c.body.groundId), sid = uid('ser');
  first.seriesId = sid; first.seriesIndex = 0;
  const skipped = []; let created = 1, idx = 0;
  for (const date of repeatDates(c.body.date, r.frequency, r.count).slice(1)) {
    idx++;
    const closed = closedMap.ground.has(date) || (settings.bookingsCloseFrom && date >= settings.bookingsCloseFrom);
    if (closed) { skipped.push({ date, reason: 'Online booking is switched off that day' }); continue; }
    const shift = (new Date(date + 'T00:00:00Z') - new Date(c.body.date + 'T00:00:00Z'));
    const sib = makeBooking({ ground: g, date, startTime: c.body.startTime, slots: first.slotCount, status: 'held', format: first.formatLabel ? { label: first.formatLabel, ball: first.ball } : null, total: first.totalPaise, startAt: first.startAt + shift, endAt: first.endAt + shift });
    sib.advancePaise = 0; sib.holdExpiresAt = null; sib.customerId = first.customerId; sib.customerName = first.customerName; sib.customerPhone = first.customerPhone; sib.seriesId = sid; sib.seriesIndex = idx; sib._sibling = true;
    created++;
  }
  return { ...res, series: { id: sid, frequency: r.frequency, created, skipped } };
});
route('GET', /^\/api\/bookings\/([^/]+)\/series$/, (c, [, id]) => {
  who(c.headers); const b = bookings.find((x) => x.id === id); if (!b) throw new Err(404, 'NOT_FOUND', 'Booking not found');
  if (!b.seriesId) return { series: null };
  return { series: { id: b.seriesId, frequency: 'weekly', requested: 0, bookings: bookings.filter((x) => x.seriesId === b.seriesId).map((x) => ({ id: x.id, ref: x.ref, date: x.date, status: x.status, totalPaise: x.totalPaise, paidPaise: x.paidPaise })) } };
});
route('POST', /^\/api\/bookings\/([^/]+)\/cancel-series$/, (c, [, id]) => {
  who(c.headers); const b = bookings.find((x) => x.id === id); if (!b || !b.seriesId) throw new Err(400, 'NOT_A_SERIES', 'This booking does not repeat');
  let cancelled = 0, kept = 0;
  for (const x of bookings.filter((y) => y.seriesId === b.seriesId && (y.status === 'held' || y.status === 'confirmed') && y.startAt > Date.now())) { if (x.paidPaise > 0) { kept++; continue; } x.status = 'cancelled'; x.cancelKind = 'free'; cancelled++; }
  return { cancelled, kept };
});

// ---- auto-debit
const mandate = { status: 'none', maxAmountPaise: null, since: null };
route('GET', /^\/api\/autodebit$/, (c) => { who(c.headers); return { ...mandate, enabled: !!settings.autoDebitEnabled, hoursBefore: settings.autoDebitHoursBefore || 24, limits: { min: 10000, max: 1500000, default: 500000 } }; });
route('POST', /^\/api\/autodebit\/start$/, (c) => {
  needRole(who(c.headers), 'customer'); if (!settings.autoDebitEnabled) throw new Err(409, 'AUTODEBIT_OFF', 'Auto-debit is not switched on yet');
  const m = c.body.maxAmountPaise || 500000; if (m < 10000 || m > 1500000) throw new Err(400, 'VALIDATION_FAILED', 'The most charged at once must be between ₹100 and ₹15,000');
  mandate._pending = m; return { mandateId: uid('mdt'), razorpay: { keyId: 'rzp_test_preview', orderId: 'order_preview_mandate', customerId: 'cust_preview', demo: true, amountPaise: 100, recurring: true } };
});
route('POST', /^\/api\/autodebit\/confirm$/, (c) => { who(c.headers); Object.assign(mandate, { status: 'active', maxAmountPaise: mandate._pending || 500000, since: Date.now() }); return { ...mandate, enabled: true, hoursBefore: settings.autoDebitHoursBefore || 24 }; });
route('DELETE', /^\/api\/autodebit$/, (c) => { who(c.headers); Object.assign(mandate, { status: 'none', maxAmountPaise: null, since: null }); return { ...mandate, enabled: true, hoursBefore: settings.autoDebitHoursBefore || 24 }; });
route('POST', /^\/api\/gateway\/demo\/pay$/, (c) => {
  who(c.headers);
  const bk = bookings.find((x) => x._orderId === c.body.orderId); if (!bk) throw new Err(404, 'NOT_FOUND', 'Order not found');
  if (c.body.outcome !== 'success') throw new Err(402, 'PAYMENT_DECLINED', 'The demo card was declined');
  return { orderId: bk._orderId, paymentId: uid('pay_demo'), signature: 'preview-signature' };
});
route('POST', /^\/api\/payments\/razorpay\/verify$/, (c) => {
  who(c.headers);
  const bk = bookings.find((x) => x._orderId === c.body.orderId); if (!bk) throw new Err(404, 'NOT_FOUND', 'Order not found');
  if (bk.status === 'expired') throw new Err(409, 'HOLD_EXPIRED', 'This hold ran out before the payment arrived');
  bk.status = 'confirmed'; bk.approval = 'pending'; bk.holdExpiresAt = null; bk.confirmedAt = Date.now();
  bk.paidPaise += bk._due; bk.balancePaise = bk.totalPaise - bk.paidPaise;
  if (bk.seriesId) for (const x of bookings.filter((y) => y.seriesId === bk.seriesId && y._sibling && y.status === 'held')) { x.status = 'confirmed'; x.approval = 'pending'; x.confirmedAt = Date.now(); }
  return { outcome: 'confirmed', booking: { ...bk } };
});
route('GET', /^\/api\/bookings$/, (c) => { const u = who(c.headers); needRole(u, 'customer'); expire(); return { items: myBookings().map((b) => ({ ...b })), total: myBookings().length }; });
route('GET', /^\/api\/bookings\/([^/]+)\/cancel-preview$/, (c, [, id]) => {
  who(c.headers); const b = bookings.find((x) => x.id === decodeURIComponent(id)); if (!b) throw new Err(404, 'NOT_FOUND', 'Booking not found');
  return cancelPreview(b);
});
route('POST', /^\/api\/bookings\/([^/]+)\/cancel$/, (c, [, id]) => {
  who(c.headers); const b = bookings.find((x) => x.id === decodeURIComponent(id)); if (!b) throw new Err(404, 'NOT_FOUND', 'Booking not found');
  const pv = cancelPreview(b);
  const toCredit = pv.kind === 'free' && pv.paidPaise > 0 && c.body.prefer === 'credit';
  b.status = 'cancelled'; b.cancelledAt = Date.now(); b.cancelKind = pv.kind === 'free' ? 'free' : pv.kind;
  b.refundPaise = pv.kind === 'free' && !toCredit ? pv.refundPaise : 0; b.creditPaise = toCredit ? pv.paidPaise : 0;
  if (toCredit) lots.push({ id: uid('lot'), ownerId: owner.id, amountPaise: pv.paidPaise, remainingPaise: pv.paidPaise, source: 'cancellation', bookingId: b.id, issuedAt: Date.now(), expiresAt: Date.now() + SAMPLE.config.creditExpiryDays * 86400000, expiredAt: null });
  const outcome = { ...pv, refundPaise: b.refundPaise, creditPaise: b.creditPaise, message: toCredit ? `Free cancellation. ${inr(pv.paidPaise)} goes to your account credit.` : pv.message };
  return { booking: { ...b }, outcome };
});
// The ground approves a paid booking, or cancels it with an explanation; the customer then chooses refund, credit or another slot.
route('GET', /^\/api\/staff\/bookings$/, (c) => {
  const u = who(c.headers); needRole(u, 'owner', 'staff', 'super_admin'); expire();
  const q = c.query || new URLSearchParams();
  let items = bookings.filter((b) => b.ownerId === owner.id);
  if (q.get && q.get('approval') === 'pending') items = items.filter((b) => b.status === 'confirmed' && b.approval === 'pending');
  items = items.sort((a, b) => b.startAt - a.startAt).map((b) => ({ ...b }));
  return { items, total: items.length, limit: 50, offset: 0 };
});
route('POST', /^\/api\/staff\/bookings\/([^/]+)\/approve$/, (c, [, id]) => {
  const u = who(c.headers); needRole(u, 'owner', 'staff', 'super_admin');
  const b = bookings.find((x) => x.id === decodeURIComponent(id)); if (!b) throw new Err(404, 'NOT_FOUND', 'Booking not found');
  b.approval = 'approved';
  return { booking: { ...b } };
});
route('POST', /^\/api\/staff\/bookings\/([^/]+)\/cancel$/, (c, [, id]) => {
  const u = who(c.headers); needRole(u, 'owner', 'staff', 'super_admin');
  const b = bookings.find((x) => x.id === decodeURIComponent(id)); if (!b) throw new Err(404, 'NOT_FOUND', 'Booking not found');
  const why = String(c.body.reason || '').trim();
  if (b.paidPaise > 0 && why.length < 10) throw new Err(400, 'REASON_REQUIRED', 'Explain to the customer why this booking is being cancelled (at least 10 characters). They will read it.');
  b.status = 'cancelled'; b.cancelledAt = Date.now(); b.cancelKind = 'free'; b.cancelledByOwner = true; b.cancelReason = why; b.cancelOffers = Array.isArray(c.body.offers) && c.body.offers.length ? c.body.offers : ['refund', 'credit']; b.resolution = b.paidPaise > 0 ? 'awaiting' : null; b.refundPaise = 0; b.creditPaise = 0;
  return { booking: { ...b }, outcome: { bookingId: b.id, kind: 'owner', paidPaise: b.paidPaise, refundPaise: 0, creditPaise: 0, retainedPaise: 0, message: 'Cancelled. The customer has been told why and can now choose a full refund, the full amount as account credit, or another slot.' } };
});
route('POST', /^\/api\/bookings\/([^/]+)\/resolve$/, (c, [, id]) => {
  who(c.headers);
  const b = bookings.find((x) => x.id === decodeURIComponent(id)); if (!b) throw new Err(404, 'NOT_FOUND', 'Booking not found');
  if (!b.cancelledByOwner || b.resolution !== 'awaiting') throw new Err(409, 'NOTHING_TO_CHOOSE', 'There is nothing to choose for this booking');
  const choice = c.body.choice;
  if (!(b.cancelOffers || ['refund', 'credit']).includes(choice === 'rebook' ? 'credit' : choice)) throw new Err(409, 'NOT_OFFERED', 'The ground did not offer that option for this booking');
  if (choice === 'refund') { b.refundPaise = b.paidPaise; b.resolution = 'refund'; }
  else if (choice === 'half') { b.refundPaise = Math.round(b.paidPaise * SAMPLE.config.cashRefundPercent / 100); b.resolution = 'half'; }
  else { b.creditPaise = b.paidPaise; b.resolution = 'credit'; lots.push({ id: uid('lot'), ownerId: owner.id, amountPaise: b.paidPaise, remainingPaise: b.paidPaise, source: 'restore', bookingId: b.id, issuedAt: Date.now(), expiresAt: Date.now() + SAMPLE.config.creditExpiryDays * 86400000, expiredAt: null }); }
  return { booking: { ...b }, refundPaise: b.refundPaise, creditPaise: b.creditPaise, rebook: choice === 'rebook' };
});
route('POST', /^\/api\/me\/push-token(\/remove)?$/, () => ({ saved: true }));
route('POST', /^\/api\/me\/avatar$/, (c) => { const u = who(c.headers); u.avatarUrl = c.body._dataUrl; return { avatarUrl: u.avatarUrl, user: { ...u } }; });
route('DELETE', /^\/api\/me\/avatar$/, (c) => { const u = who(c.headers); u.avatarUrl = null; return { avatarUrl: null }; });
route('PATCH', /^\/api\/me$/, (c) => {
  const u = who(c.headers), b = c.body;
  if (b.name !== undefined) { if (String(b.name).trim().length < 2) throw bad([{ field: 'name', message: 'At least 2 characters' }]); u.name = b.name.trim(); }
  if (b.phone) u.phone = b.phone; if (b.email) u.email = b.email;
  if (u.role === 'owner') { if (b.businessName !== undefined) u.businessName = b.businessName; if (b.upiId !== undefined) u.upiId = b.upiId; }
  return { user: { ...u } };
});
route('POST', /^\/api\/me\/password$/, (c) => {
  const u = who(c.headers), p = PEOPLE[u.email];
  if (!p || p.pw !== c.body.currentPassword) throw new Err(400, 'VALIDATION_FAILED', 'The current password is not right', { fields: [{ field: 'currentPassword', message: 'Not the password' }] });
  if (String(c.body.newPassword || '').length < 8) throw bad([{ field: 'newPassword', message: 'At least 8 characters' }]);
  p.pw = c.body.newPassword; return { token: tokenFor(u.email), user: { ...u } };
});
const PRESETS = {
  admin: { title: 'Admin', permissions: ['manage_bookings', 'verify_payments', 'record_payments', 'manage_enquiries', 'view_customers', 'view_reports', 'manage_academy', 'manage_matches'] },
  general_manager: { title: 'General manager', permissions: ['manage_bookings', 'verify_payments', 'record_payments', 'manage_enquiries', 'manage_grounds', 'view_customers', 'view_reports', 'send_broadcasts', 'manage_academy', 'manage_matches'] },
  coach: { title: 'Coach', permissions: ['manage_academy', 'manage_matches'] },
  front_desk: { title: 'Front desk', permissions: ['manage_bookings', 'verify_payments', 'record_payments', 'manage_enquiries', 'view_customers'] },
  accountant: { title: 'Accountant', permissions: ['view_reports', 'manage_accounting'] },
};
const ALL_PERMS = ['manage_bookings', 'verify_payments', 'record_payments', 'manage_enquiries', 'manage_grounds', 'view_customers', 'view_reports', 'manage_accounting', 'send_broadcasts', 'manage_academy', 'manage_matches', 'manage_tasks'];
const team = [{ ...PEOPLE['staff1@daji.test'].user, active: true }];
route('GET', /^\/api\/staff\/team$/, (c) => { needRole(who(c.headers), 'owner', 'super_admin'); return { items: team.map((t) => ({ ...t })), allPermissions: ALL_PERMS, presets: PRESETS }; });
route('POST', /^\/api\/staff\/team$/, (c) => {
  needRole(who(c.headers), 'owner', 'super_admin'); const b = c.body;
  if (!b.name || b.name.trim().length < 2) throw bad([{ field: 'name', message: 'At least 2 characters' }]);
  if (!/.+@.+/.test(b.email || '')) throw bad([{ field: 'email', message: 'Enter an email' }]);
  const t = { id: uid('usr'), role: 'staff', name: b.name.trim(), email: b.email, phone: b.phone || null, ownerId: owner.id, permissions: [...(PRESETS[b.preset] || PRESETS.admin).permissions], active: true };
  team.push(t); PEOPLE[b.email.toLowerCase()] = { pw: b.password, user: t }; return { ...t };
});
// ---- tasks (the preview reads the camera time out of the picture the same way the server does, in simplified form)
const tasks = [{ id: 'tsk_0', title: 'Roll and water the main pitch', details: 'Two passes with the roller, then water the square.', assignedTo: null, dueDate: istDate(Date.now()), photosRequired: 2, status: 'open', createdAt: Date.now() - 3600000, completedAt: null, completedByName: null, completionNote: null, photos: [] }];
const taskOut = (t) => ({ ...t, assignedName: t.assignedTo ? (team.find((x) => x.id === t.assignedTo) || {}).name || null : null, overdue: t.status === 'open' && !!t.dueDate && t.dueDate < istDate(Date.now()), photos: t.photos.map((p) => ({ ...p })) });
const mgr = (u) => u.role === 'owner' || u.role === 'super_admin' || (u.permissions || []).includes('manage_tasks');
function exifTime(dataUrl) {
  const bin = atob((dataUrl.split(',')[1] || '').slice(0, 90000));
  const m = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})\0/.exec(bin);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 330 * 60000 : null;
}
route('GET', /^\/api\/tasks$/, (c) => { const u = who(c.headers); const st = c.query.get('status'); return { items: tasks.filter((t) => (!st || t.status === st) && (mgr(u) || !t.assignedTo || t.assignedTo === u.id)).map(taskOut) }; });
route('POST', /^\/api\/tasks$/, (c) => {
  const u = who(c.headers); if (!mgr(u)) throw new Err(403, 'FORBIDDEN', 'This needs the "manage_tasks" permission');
  const b = c.body; if (!b.title || b.title.length < 3) throw new Err(400, 'VALIDATION_FAILED', 'Check the form', { fields: [{ field: 'title', message: 'At least 3 characters' }] });
  const t = { id: 'tsk_' + (tasks.length + 1), title: b.title, details: b.details || null, assignedTo: b.assignedTo || null, dueDate: b.dueDate || null, photosRequired: b.photosRequired ?? 1, status: 'open', createdAt: Date.now(), completedAt: null, completedByName: null, completionNote: null, photos: [] };
  tasks.unshift(t); return taskOut(t);
});
route('POST', /^\/api\/tasks\/([^/]+)\/photos$/, (c, [, id]) => {
  const u = who(c.headers), t = tasks.find((x) => x.id === id); if (!t) throw new Err(404, 'NOT_FOUND', 'Task not found');
  const url = c.body._dataUrl || '';
  if (!/^data:image\/jpeg/.test(url)) throw new Err(415, 'NOT_A_CAMERA_PHOTO', 'Take the picture with the camera. Screenshots and saved images cannot be used.');
  const at = exifTime(url);
  if (at === null) throw new Err(422, 'NO_CAMERA_DATA', 'This picture has no camera time in it, so it cannot be used. Take a new one with the camera.');
  const age = Date.now() - at;
  if (age > 5 * 60000) throw new Err(422, 'PHOTO_TOO_OLD', 'This photo was taken ' + Math.max(1, Math.round(age / 60000)) + ' minute(s) ago. Photos must be taken within the last 5 minutes. Take a new one now.');
  if (age < -2 * 60000) throw new Err(422, 'PHOTO_FROM_FUTURE', 'The time on this photo is ahead of the real time. Check the date and time on the phone, then take a new photo.');
  if (tasks.some((x) => x.photos.some((p) => p.url === url))) throw new Err(409, 'PHOTO_ALREADY_USED', 'This photo has already been uploaded. Take a new one.');
  t.photos.push({ id: 'tph_' + Date.now(), url, takenAt: at, uploadedAt: Date.now(), uploadedByName: u.name, note: null, camera: null }); return taskOut(t);
});
route('POST', /^\/api\/tasks\/([^/]+)\/(complete|cancel|reopen)$/, (c, [, id, act]) => {
  const u = who(c.headers), t = tasks.find((x) => x.id === id); if (!t) throw new Err(404, 'NOT_FOUND', 'Task not found');
  if (act !== 'complete' && !mgr(u)) throw new Err(403, 'FORBIDDEN', 'This needs the "manage_tasks" permission');
  if (act === 'complete') { if (t.photos.length < t.photosRequired) throw new Err(409, 'PHOTOS_NEEDED', 'This task needs ' + t.photosRequired + ' photo(s) taken with the camera first (' + t.photos.length + ' added).'); t.status = 'done'; t.completedAt = Date.now(); t.completedByName = u.name; }
  else if (act === 'cancel') t.status = 'cancelled';
  else { t.status = 'open'; t.completedAt = null; t.completedByName = null; }
  return taskOut(t);
});

route('PATCH', /^\/api\/staff\/team\/([^/]+)$/, (c, [, id]) => {
  needRole(who(c.headers), 'owner', 'super_admin'); const t = team.find((x) => x.id === decodeURIComponent(id)); if (!t) throw new Err(404, 'NOT_FOUND', 'Staff member not found');
  if (c.body.permissions) t.permissions = c.body.permissions; if (c.body.active !== undefined) t.active = !!c.body.active; return { ...t };
});
route('GET', /^\/api\/admin\/users$/, (c) => { needRole(who(c.headers), 'owner', 'super_admin'); const role = c.query.get('role'); const items = Object.values(PEOPLE).map((p) => p.user).filter((u) => !role || u.role === role); return { items, total: items.length, limit: 50, offset: 0 }; });
route('POST', /^\/api\/enquiries$/, (c) => {
  const b = c.body, f = [];
  if (!b.groundId) f.push({ field: 'groundId', message: 'Required' });
  if (!b.name || b.name.trim().length < 2) f.push({ field: 'name', message: 'At least 2 characters' });
  if (String(b.phone || '').replace(/\D/g, '').length < 10) f.push({ field: 'phone', message: 'Enter a 10 digit mobile number' });
  if (!b.message || b.message.trim().length < 5) f.push({ field: 'message', message: 'Tell us a little more' });
  if (f.length) throw bad(f);
  return { id: uid('enq'), status: 'new' };
});

// owner and staff
// ---- payments to check and recording a payment (for the phone app's team screens)
const subPays = [{ id: 'pay_demo1', bookingId: 'x', method: 'upi', status: 'submitted', purpose: 'advance', amountPaise: 150000, reference: '428811903372' }];
route('GET', /^\/api\/staff\/payments$/, (c) => { needRole(who(c.headers), 'owner', 'staff', 'super_admin'); const st = c.query.get('status'); return { items: subPays.filter((p) => !st || p.status === st).map((p) => ({ ...p })), total: subPays.length, limit: 50, offset: 0 }; });
route('POST', /^\/api\/staff\/payments\/([^/]+)\/verify$/, (c, [, id]) => { needRole(who(c.headers), 'owner', 'staff', 'super_admin'); const p = subPays.find((x) => x.id === decodeURIComponent(id)); if (!p) throw new Err(404, 'NOT_FOUND', 'Payment not found'); p.status = c.body.approve ? 'captured' : 'rejected'; subPays.splice(subPays.indexOf(p), 1); return { payment: { ...p } }; });
route('POST', /^\/api\/staff\/bookings\/([^/]+)\/payments$/, (c, [, id]) => { needRole(who(c.headers), 'owner', 'staff', 'super_admin'); const b = bookings.find((x) => x.id === decodeURIComponent(id)); if (!b) throw new Err(404, 'NOT_FOUND', 'Booking not found'); b.paidPaise += c.body.amountPaise; b.balancePaise = Math.max(0, b.totalPaise - b.paidPaise); return { booking: { ...b } }; });
route('POST', /^\/api\/staff\/bookings\/([^/]+)\/no-show$/, (c, [, id]) => { needRole(who(c.headers), 'owner', 'staff', 'super_admin'); const b = bookings.find((x) => x.id === decodeURIComponent(id)); if (!b) throw new Err(404, 'NOT_FOUND', 'Booking not found'); b.status = 'no_show'; return { booking: { ...b } }; });
route('GET', /^\/api\/staff\/today$/, (c) => {
  const u = who(c.headers); needRole(u, 'owner', 'staff', 'super_admin'); expire(); const today = istDate(Date.now());
  const items = bookings.filter((b) => b.date === today && b.status === 'confirmed').sort((a, b) => a.startAt - b.startAt);
  return { date: today, bookings: items.map((b) => ({ ...b })), awaitingVerification: 0, needsReview: 1 };
});
route('GET', /^\/api\/accounting\/reports\/pnl$/, (c) => {
  const u = who(c.headers);
  if (u.role === 'staff') throw new Err(403, 'FORBIDDEN', 'Your role does not include the reports.');
  needRole(u, 'owner'); return pnl(c.query.get('month') || istDate(Date.now()).slice(0, 7));
});
route('GET', /^\/api\/staff\/contacts$/, (c) => { const u = who(c.headers); needRole(u, 'owner', 'staff', 'super_admin'); return { items: [], total: 184, limit: 1, offset: 0, summary: { total: 184, reachableEmail: 121, reachableWhatsapp: 87, reachableSms: 64 } }; });
route('GET', /^\/api\/staff\/ask\/examples$/, (c) => { const u = who(c.headers); needRole(u, 'owner', 'staff', 'super_admin'); return { items: SAMPLE.askExamples }; });
route('POST', /^\/api\/staff\/ask$/, (c) => { const u = who(c.headers); needRole(u, 'owner'); return ask(String(c.body.question || '')); });

route('GET', /^\/api\/staff\/grounds$/, (c) => { needRole(who(c.headers), 'owner', 'staff'); return { items: grounds.filter((g) => g.ownerId === owner.id) }; });
route('PATCH', /^\/api\/staff\/grounds\/([^/]+)$/, (c, [, id]) => {
  needRole(who(c.headers), 'owner'); const g = groundById(decodeURIComponent(id)); if (!g) throw new Err(404, 'NOT_FOUND', 'Ground not found');
  const b = c.body;
  if (b.openTime && b.closeTime && mins(b.openTime) >= mins(b.closeTime)) throw bad([{ field: 'closeTime', message: 'Must be after the opening time' }]);
  if (b.slotMinutes !== undefined && b.slotMinutes !== g.slotMinutes && bookings.some((x) => x.groundId === g.id && live(x) && x.endAt > Date.now())) throw new Err(409, 'SLOT_LENGTH_LOCKED', 'The slot length cannot change while there are upcoming bookings or blocked times. Cancel or unblock them first.');
  for (const k of ['ratesNote', 'rates', 'closedDays', 'winterOpenTime', 'winterCloseTime', 'openTime', 'closeTime', 'slotMinutes', 'eveningFrom', 'maxSlots', 'formats']) if (b[k] !== undefined) g[k] = b[k];
  if (b.rates) g.rates = b.rates.map((r, i) => ({ ...r, id: r.id || 'p' + (i + 1) + '-' + Math.random().toString(36).slice(2, 6) }));
  return g;
});

// super admin
route('GET', /^\/api\/admin\/settings$/, (c) => { needRole(who(c.headers), 'owner', 'super_admin'); return { ...settings }; });
route('PUT', /^\/api\/admin\/settings$/, (c) => { needRole(who(c.headers), 'owner', 'super_admin'); Object.assign(settings, c.body); return { ...settings }; });
route('GET', /^\/api\/admin\/backups$/, (c) => { needRole(who(c.headers), 'owner', 'super_admin'); return { enabled: true, at: '03:15', keep: 14, nextAt: at(addDays(istDate(Date.now()), 1), '03:15'), items: [...backups].reverse() }; });
route('POST', /^\/api\/admin\/backups$/, (c) => {
  needRole(who(c.headers), 'owner', 'super_admin'); const t = Date.now(), d = new Date(t + IST).toISOString();
  const item = { name: `${d.slice(0, 10)}_${d.slice(11, 19).replace(/:/g, '')}`, createdAt: t, date: d.slice(0, 10), reason: 'manual', dbBytes: 436224, files: 0, filesBytes: 0, integrity: 'ok' };
  backups.push(item); return item;
});

/*EXTRA*/
// ---------------------------------------------------------------- hook into fetch
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
  const method = (init.method || 'GET').toUpperCase();
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  let body = {}; try { body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : {}; } catch { /* leave empty */ }
  if (init.body instanceof Blob) body = { _dataUrl: await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(init.body); }) };
  const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 160)); // feels like a network call
  for (const [m, re, fn] of ROUTES) {
    if (m !== method) continue;
    const hit = re.exec(url.pathname); if (!hit) continue;
    try { return reply(method === 'POST' && /^\/api\/(bookings|enquiries|admin\/backups)$/.test(url.pathname) ? 201 : 200, fn({ query: url.searchParams, body, headers }, hit)); }
    catch (e) { if (e instanceof Err) return reply(e.status, { error: { code: e.code, message: e.message, details: e.details } }); console.error(e); return reply(500, { error: { code: 'ERROR', message: 'The preview stand-in server hit a problem.' } }); }
  }
  return reply(404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
};
})();
