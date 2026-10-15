// Stand-in for the Daji server, used ONLY by the hosted preview page.
// It answers the same /api routes the website calls, in memory, with sample data. Nothing is saved and nothing leaves the page.
// The real website never loads this file. Build the preview with: python3 web/preview/build_preview.py
(() => {
'use strict';
const SAMPLE = {"config":{"brand":"Daji Cricket Ground","tagline":"Project by Daji Parivar","instagramUrl":"https://www.instagram.com/dajicricketground/","contact":{"name":"Hemanshu Patel","phone":"7567156000","email":"dajicricket@gmail.com"},"academy":{"name":"MP13 Academy","runBy":"Munaf Patel","brand":"MP13","coaches":[{"name":"Munaf Patel","title":"Founder, MP13","bio":"Former India fast bowler and 2011 World Cup winner.","photo":""},{"name":"Rakesh Desai","title":"Head batting coach","bio":"Level 2 coach with 15 years of age-group experience.","photo":""}],"about":"MP13 Academy is associated with Daji Cricket Ground. Munaf Patel runs his academy under MP13."},"razorpayEnabled":true,"razorpayDemo":true,"razorpayKeyId":null,"holdMinutesOnline":15,"holdMinutesUpi":15,"verifyMinutesUpi":120,"creditExpiryDays":90,"freeCancelHours":24,"advanceMode":"percent","advanceValue":50,"fullPaymentWithinHours":24,"demoMode":true,"publicUrl":""},"grounds":[{"id":"gnd_vjlWqEh2Erf9","ownerId":"usr_-EGRksMvuFWe","ownerName":"Daji Cricket Ground","name":"Cricket Ground","slug":"daji-main-turf","city":"Surat","area":null,"address":null,"lat":21.1818855,"lng":72.9134859,"mapUrl":"https://maps.app.goo.gl/Qs2Wivwv76jt9zjG7","directionsUrl":"https://maps.app.goo.gl/Qs2Wivwv76jt9zjG7","description":"Full-size turf wicket with floodlights for evening matches.","facilities":["Floodlights","Changing rooms","Parking","Drinking water","Scoreboard"],"images":[],"surface":"Turf wicket","openTime":"06:00","closeTime":"27:00","slotMinutes":60,"pricePaise":180000,"weekendPricePaise":220000,"eveningSurchargePaise":40000,"eveningFrom":"18:00","maxSlots":8,"minNoticeMinutes":0,"advanceMode":null,"advanceValue":null,"active":true,"formats":[],"winterOpenTime":"07:00","winterCloseTime":"27:00","winterFromMonth":11,"winterToMonth":2,"rates":[{"id":"l-night","label":"Evening hours","ball":"leather","days":[2,3,4,5,6,0],"from":"19:00","to":"27:00","mode":"hourly","pricePaise":350000},{"id":"l-morn","label":"Morning session","ball":"leather","days":[2,3,4,5],"from":"07:00","to":"10:00","mode":"fixed","pricePaise":400000},{"id":"l-day","label":"Day session","ball":"leather","days":[2,3,4,5],"from":"10:00","to":"18:00","mode":"fixed","pricePaise":600000},{"id":"l-wknd","label":"Weekend day","ball":"leather","days":[6,0],"from":"07:00","to":"19:00","mode":"fixed","pricePaise":1500000},{"id":"t-night","label":"Evening hours","ball":"tennis","days":[2,3,4,5,6,0],"from":"19:00","to":"27:00","mode":"hourly","pricePaise":350000},{"id":"t-morn","label":"Morning session","ball":"tennis","days":[2,3,4,5],"from":"07:00","to":"10:00","mode":"fixed","pricePaise":500000},{"id":"t-both","label":"Two-day tournament (Sat + Sun)","ball":"tennis","days":[6],"from":"07:00","to":"23:00","mode":"fixed","pricePaise":15100000,"bundleDays":2},{"id":"t-sat","label":"Saturday tournament","ball":"tennis","days":[6],"from":"07:00","to":"19:00","mode":"fixed","pricePaise":10000000},{"id":"t-sun","label":"Sunday tournament","ball":"tennis","days":[0],"from":"07:00","to":"23:00","mode":"fixed","pricePaise":9000000},{"id":"l-practice","label":"Practice hours","ball":"practice","days":[2,3,4,5,6,0],"from":"07:00","to":"19:00","mode":"hourly","pricePaise":60000}],"closedDays":[1],"ratesNote":"For custom days and reservations please call."}],"adminSettings":{"razorpayEnabled":true,"upiId":"dajicricket@okhdfcbank","upiPayee":"Daji Cricket Ground","contactName":"Hemanshu Patel","contactPhone":"7567156000","contactEmail":"dajicricket@gmail.com","academyName":"MP13 Academy","academyRunBy":"Munaf Patel","academyBrand":"MP13","academyAbout":"MP13 Academy is associated with Daji Cricket Ground. Munaf Patel runs his academy under MP13.","holdMinutesOnline":15,"holdMinutesUpi":15,"verifyMinutesUpi":120,"graceMinutes":10,"maxHoldExtensions":2,"advanceMode":"percent","advanceValue":50,"fullPaymentWithinHours":24,"freeCancelHours":24,"lateCancelCreditPercent":100,"cashRefundPercent":50,"requireApproval":true,"creditExpiryDays":90,"noShowGraceMinutes":30},"askExamples":["What was the revenue for the past 37 days?","What is my account balance?","What was our profit last month?","How much did we spend on electricity this financial year?","Compare this month with last month","Show the balance sheet","How many bookings did we have last week?","What's booked for tomorrow?","Who still owes us money?","How busy was the main turf in September?","How many no-shows this month?","How much account credit do customers hold?","How many new customers played this month?"],"users":{"owner":{"id":"usr_-EGRksMvuFWe","role":"owner","name":"Daji Owner","email":"owner1@daji.test","phone":"9000000002","ownerId":null,"permissions":[],"active":true,"consent":{"email":false,"sms":false,"whatsapp":false,"updatedAt":null},"businessName":"Daji Cricket Ground","upiId":"dajicricket@okhdfcbank","createdAt":1792003854019},"admin":{"id":"usr_4_wK7_cCOseW","role":"super_admin","name":"Platform Admin","email":"admin@daji.test","phone":"9000000001","ownerId":null,"permissions":[],"active":true,"consent":{"email":false,"sms":false,"whatsapp":false,"updatedAt":null},"businessName":null,"upiId":null,"createdAt":1792003853971},"customer":{"id":"usr_qEr4rjoMqW6I","role":"customer","name":"Demo Customer","email":"customer@daji.test","phone":"9876543210","ownerId":null,"permissions":[],"active":true,"consent":{"email":false,"sms":false,"whatsapp":false,"updatedAt":null},"businessName":null,"upiId":null,"createdAt":1792003854159}}};
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

// ---------------------------------------------------------------- books, academy, matches, platform (preview stand-ins)
window.DAJI_PREVIEW = true;
const first = (method, re, fn) => ROUTES.unshift([method, re, fn]);
const staffUser = (c) => { const u = who(c.headers); needRole(u, 'owner', 'staff', 'super_admin'); return u; };
const D0 = istDate(Date.now());
const day = (n) => addDays(D0, n);
const R = (p) => Math.round(p);

// ---- accounts, categories, transactions
const accts = [{ id: 'acc_hdfc', kind: 'bank', name: 'HDFC current account', bankName: 'HDFC Bank', last4: '4521', source: 'manual', openingPaise: 10000000, openingDate: day(-200), balancePaise: 0, transactions: 0, uncategorised: 0, lastTransactionDate: null },
  { id: 'acc_cash', kind: 'cash', name: 'Cash at the ground', bankName: null, last4: null, source: 'manual', openingPaise: 0, openingDate: null, balancePaise: 0, transactions: 0, uncategorised: 0, lastTransactionDate: null }];
const cats = [['cat_upi_booking', 'UPI booking payment', 'booking_receipt', 'Booking receipts'], ['cat_bank_booking', 'Bank-transfer booking payment', 'booking_receipt', 'Booking receipts'], ['cat_electricity', 'Electricity and floodlights', 'expense', 'Utilities'], ['cat_rent', 'Ground rent', 'expense', 'Premises'],
  ['cat_wages', 'Staff wages', 'expense', 'People'], ['cat_equipment', 'Equipment and repairs', 'expense', 'Operations'], ['cat_other_income', 'Other income', 'income', 'Other income'], ['cat_transfer', 'Transfer between accounts', 'transfer', 'Transfers']]
  .map(([id, name, kind, group]) => ({ id, code: id.slice(4), name, kind, group, builtin: true }));
const catName = (id) => (cats.find((c) => c.id === id) || {}).name || null;
const txns = [
  [-1, 'acc_hdfc', 'UPI/CR/412398765401/ROHIT SHARMA', 150000, 'cat_upi_booking', 'match', 'bkg1'], [-2, 'acc_hdfc', 'UPI/CR/412398700112/AMIT PATEL', 150000, null, null], [-3, 'acc_hdfc', 'ELECTRICITY BOARD BILL SEP', -1250000, 'cat_electricity', 'rule'],
  [-5, 'acc_hdfc', 'NEFT-GROUND ROLLER SERVICE', -450000, null, null], [-6, 'acc_hdfc', 'UPI/CR/412398612210/VIKAS JOSHI', 300000, 'cat_upi_booking', 'match', 'bkg2'], [-9, 'acc_hdfc', 'SALARY GROUNDSMAN', -1800000, 'cat_wages', 'rule'],
  [-10, 'acc_hdfc', 'CASH DEPOSIT', 500000, null, null], [-12, 'acc_cash', 'Cricket balls (12)', -360000, 'cat_equipment', 'manual'], [-15, 'acc_hdfc', 'GROUND RENT OCT', -2500000, 'cat_rent', 'rule']]
  .map(([d, a, desc, amt, cat, by, bk], i) => ({ id: 'txn_' + i, accountId: a, date: day(d), amountPaise: amt, description: desc, reference: null, categoryId: cat, categoryBy: by, paymentId: bk ? 'pay_' + bk : null, bookingId: bk || null, note: null, source: 'upload' }));
const files = {}; // transaction id -> [{id, filename...}]
function recomputeAccounts() { for (const a of accts) { const t = txns.filter((x) => x.accountId === a.id); a.transactions = t.length; a.uncategorised = t.filter((x) => !x.categoryId).length; a.balancePaise = a.openingPaise + t.reduce((s, x) => s + x.amountPaise, 0); a.lastTransactionDate = t.map((x) => x.date).sort().pop() || null; } }
recomputeAccounts();
const toTxn = (t) => ({ ...t, accountName: accts.find((a) => a.id === t.accountId).name, categoryName: catName(t.categoryId), categoryKind: (cats.find((c) => c.id === t.categoryId) || {}).kind || null, balancePaise: null, counterparty: null, createdAt: Date.now() });

first('GET', /^\/api\/accounting\/accounts$/, (c) => { staffUser(c); recomputeAccounts(); return { items: accts }; });
first('POST', /^\/api\/accounting\/accounts$/, (c) => { staffUser(c); const b = c.body; if (!b.name || b.name.length < 2) throw bad([{ field: 'name', message: 'Required' }]); const a = { id: uid('acc'), kind: b.kind, name: b.name, bankName: b.bankName || null, last4: b.last4 || null, source: 'manual', openingPaise: b.openingPaise || 0, openingDate: b.openingDate || null, balancePaise: 0, transactions: 0, uncategorised: 0, lastTransactionDate: null }; accts.push(a); recomputeAccounts(); return a; });
first('GET', /^\/api\/accounting\/categories$/, (c) => { staffUser(c); return { items: cats }; });
first('GET', /^\/api\/accounting\/transactions$/, (c) => {
  staffUser(c); const q = c.query; let rows = txns.slice();
  if (q.get('accountId')) rows = rows.filter((t) => t.accountId === q.get('accountId'));
  if (q.get('categorised') === 'no') rows = rows.filter((t) => !t.categoryId); if (q.get('categorised') === 'yes') rows = rows.filter((t) => t.categoryId);
  if (q.get('direction') === 'in') rows = rows.filter((t) => t.amountPaise > 0); if (q.get('direction') === 'out') rows = rows.filter((t) => t.amountPaise < 0);
  if (q.get('q')) rows = rows.filter((t) => t.description.toLowerCase().includes(q.get('q').toLowerCase()));
  if (q.get('from')) rows = rows.filter((t) => t.date >= q.get('from')); if (q.get('to')) rows = rows.filter((t) => t.date <= q.get('to'));
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return { items: rows.map(toTxn), total: rows.length, limit: 50, offset: 0, moneyInPaise: rows.filter((t) => t.amountPaise > 0).reduce((s, t) => s + t.amountPaise, 0), moneyOutPaise: rows.filter((t) => t.amountPaise < 0).reduce((s, t) => s + t.amountPaise, 0) };
});
first('POST', /^\/api\/accounting\/transactions$/, (c) => { staffUser(c); const b = c.body; const t = { id: uid('txn'), accountId: b.accountId, date: b.date, amountPaise: b.amountPaise, description: b.description, reference: null, categoryId: b.categoryId || null, categoryBy: b.categoryId ? 'manual' : null, paymentId: null, bookingId: null, note: null, source: 'manual' }; txns.push(t); recomputeAccounts(); return toTxn(t); });
first('PATCH', /^\/api\/accounting\/transactions\/([^/]+)$/, (c, [, id]) => { staffUser(c); const t = txns.find((x) => x.id === id); if (!t) throw new Err(404, 'NOT_FOUND', 'Transaction not found'); t.categoryId = c.body.categoryId || null; t.categoryBy = t.categoryId ? 'manual' : null; recomputeAccounts(); return toTxn(t); });
first('POST', /^\/api\/accounting\/attachment-counts$/, (c) => { staffUser(c); const o = {}; for (const id of c.body.ids || []) if ((files[id] || []).length) o[id] = files[id].length; return o; });
first('GET', /^\/api\/accounting\/attachments$/, (c) => { staffUser(c); return { items: files[c.query.get('id')] || [] }; });
first('POST', /^\/api\/accounting\/attachments$/, (c) => { staffUser(c); const id = c.query.get('id'); (files[id] = files[id] || []).push({ id: uid('att'), entity: 'transaction', entityId: id, filename: c.query.get('filename') || 'receipt.pdf', mime: 'application/pdf', sizeBytes: 84000, createdAt: Date.now() }); return files[id].slice(-1)[0]; });
first('DELETE', /^\/api\/accounting\/attachments\/([^/]+)$/, (c, [, id]) => { staffUser(c); for (const k of Object.keys(files)) files[k] = files[k].filter((f) => f.id !== id); return { removed: true }; });

// ---- reports
const section = (groups) => ({ groups: groups.map(([name, rows]) => ({ name, rows: rows.map(([n, p]) => ({ code: n, name: n, paise: p })), totalPaise: rows.reduce((s, r) => s + r[1], 0) })), totalPaise: groups.reduce((s, g) => s + g[1].reduce((a, r) => a + r[1], 0), 0) });
function pnl(c) {
  const month = c.query.get('month') || D0.slice(0, 7);
  const rev = section([['Bookings', [['Booking income (sessions played)', 4850000], ['Advances kept: no-shows and late cancellations', 240000]]], ['Other income', [['Other income', 500000]]]]);
  const exp = section([['Utilities', [['Electricity and floodlights', 1250000]]], ['Premises', [['Ground rent', 2500000]]], ['People', [['Staff wages', 1800000]]], ['Operations', [['Equipment and repairs', 360000]]]]);
  return { range: { from: month + '-01', to: month + '-31' }, basis: c.query.get('basis') || 'accrual', revenue: rev, expenses: exp, netProfitPaise: rev.totalPaise - exp.totalPaise, marginPercent: R((rev.totalPaise - exp.totalPaise) * 1000 / rev.totalPaise) / 10,
    previous: null, uncategorised: { count: txns.filter((t) => !t.categoryId).length, amountPaise: 0 }, notes: ['Booking income is counted on the day the session is played, not the day it was paid for.'] };
}
first('GET', /^\/api\/accounting\/reports\/pnl$/, (c) => { staffUser(c); const r = pnl(c); if (c.query.get('compare')) { r.previous = { range: { from: '2026-09-01', to: '2026-09-30' } }; r.previousNetProfitPaise = r.netProfitPaise - 420000; for (const k of ['revenue', 'expenses']) { r[k].previousTotalPaise = Math.round(r[k].totalPaise * 0.92); for (const g of r[k].groups) { g.previousTotalPaise = Math.round(g.totalPaise * 0.92); for (const x of g.rows) x.previousPaise = Math.round(x.paise * 0.92); } } } return r; });
first('GET', /^\/api\/accounting\/reports\/pnl-periods$/, (c) => { staffUser(c); const by = c.query.get('by'); const labels = by === 'quarter' ? ['Apr–Jun 2026', 'Jul–Sep 2026', 'Oct–Dec 2026'] : ['May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026']; const rev = labels.map((_, i) => 4200000 + i * 310000), exp = labels.map((_, i) => 5100000 - (i % 2) * 220000), sum = (a) => a.reduce((x, y) => x + y, 0);
  return { title: by === 'quarter' ? 'Quarterly profit and loss summary' : 'Profit and loss by month', sub: '2026-04-01 to ' + D0 + ', accrual basis', columns: [{ label: '' }, ...labels.map((l) => ({ label: l, money: true })), { label: 'Total', money: true }],
    rows: [{ kind: 'head', cells: ['Revenue', ...labels.map(() => null), null] }, { kind: 'row', cells: ['Bookings: Booking income', ...rev, sum(rev)] }, { kind: 'sub', cells: ['Total revenue', ...rev, sum(rev)] }, { kind: 'head', cells: ['Expenses', ...labels.map(() => null), null] }, { kind: 'row', cells: ['Premises: Ground rent', ...exp, sum(exp)] }, { kind: 'sub', cells: ['Total expenses', ...exp, sum(exp)] }, { kind: 'net', cells: ['Net profit', ...rev.map((v, i) => v - exp[i]), sum(rev) - sum(exp)] }], notes: [] }; });
first('GET', /^\/api\/accounting\/reports\/customer-balances$/, (c) => { staffUser(c); const det = c.query.get('view') === 'detail';
  return det ? { title: 'Customer balance detail', sub: 'As of ' + D0, columns: [{ label: 'Session' }, { label: 'Ref' }, { label: 'Customer' }, { label: 'Phone' }, { label: 'Ground' }, { label: 'Total', money: true }, { label: 'Paid', money: true }, { label: 'Owed', money: true }, { label: 'Days' }], rows: [{ kind: 'row', cells: [day(-12), 'DJ-4821', 'Rohan Mehta', '9876501234', 'Cricket Ground', 600000, 300000, 300000, 12] }, { kind: 'row', cells: [day(-95), 'DJ-3310', 'Karan Shah', '9822011223', 'Practice Nets', 120000, 60000, 60000, 95] }, { kind: 'sub', cells: ['Total owed', '', '', '', '', 720000, 360000, 360000, null] }], notes: [] }
  : { title: 'Customer balance summary (aging)', sub: 'As of ' + D0, columns: [{ label: 'Customer' }, { label: 'Phone' }, { label: 'Sessions' }, { label: '0–30 days', money: true }, { label: '31–60 days', money: true }, { label: '61–90 days', money: true }, { label: 'Over 90 days', money: true }, { label: 'Total owed', money: true }], rows: [{ kind: 'row', cells: ['Rohan Mehta', '9876501234', 1, 300000, 0, 0, 0, 300000] }, { kind: 'row', cells: ['Karan Shah', '9822011223', 1, 0, 0, 0, 60000, 60000] }, { kind: 'sub', cells: ['Total', '', 2, 300000, 0, 0, 60000, 360000] }], notes: ['Counts sessions already played where the customer has not paid in full.'] }; });
first('GET', /^\/api\/accounting\/reports\/audit-log$/, (c) => { staffUser(c); return { title: 'Audit log', sub: 'last 30 days', columns: [{ label: 'When (IST)' }, { label: 'Who' }, { label: 'Action' }, { label: 'Item' }, { label: 'Details' }], rows: [{ kind: 'row', cells: [D0 + ' 09:04', 'Hemanshu Patel', 'academy.coaches.update', 'settings', '{"count":2}'] }], notes: [] }; });
first('GET', /^\/api\/accounting\/reports\/balance-sheet$/, (c) => { staffUser(c); return { asOf: c.query.get('asOf') || D0, financialYear: { from: '2026-04-01', to: '2027-03-31' }, assets: section([['Cash and bank', [['HDFC current account', 7240000], ['Cash at the ground', -360000]]]]), liabilities: section([['Customer money held', [['Advances for future sessions', 1650000], ['Account credit owed', 120000]]]]), equity: section([['Owner’s equity', [['Opening equity', 10000000], ['Profit for the year', -4890000]]]]), totalAssetsPaise: 6880000, totalLiabilitiesPaise: 1770000, totalEquityPaise: 5110000, balanced: true, differencePaise: 0, attention: { uncategorisedCount: 3, uncategorisedPaise: 0 }, notes: [] }; });
first('GET', /^\/api\/accounting\/reports\/trial-balance$/, (c) => { staffUser(c); return { asOf: c.query.get('asOf') || D0, rows: [{ code: 'bank', name: 'HDFC current account', type: 'asset', debitPaise: 7240000, creditPaise: 0 }, { code: 'adv', name: 'Advances for future sessions', type: 'liability', debitPaise: 0, creditPaise: 1650000 }, { code: 'inc', name: 'Booking income', type: 'income', debitPaise: 0, creditPaise: 5590000 }].concat([]), totalDebitPaise: 7240000, totalCreditPaise: 7240000, balanced: true }; });
first('GET', /^\/api\/accounting\/overview$/, (c) => { staffUser(c); recomputeAccounts(); const p = pnl({ query: new URLSearchParams() }); return { asOf: D0, thisMonth: { month: D0.slice(0, 7), from: '', to: '', revenuePaise: p.revenue.totalPaise, expensesPaise: p.expenses.totalPaise, netProfitPaise: p.netProfitPaise }, lastMonth: { month: '', from: '', to: '', revenuePaise: 5200000, expensesPaise: 5400000, netProfitPaise: -200000 },
  financialYearToDate: { from: '2026-04-01', to: D0, revenuePaise: 31200000, expensesPaise: 26900000, netProfitPaise: 4300000 }, cashAndBankPaise: accts.reduce((s, a) => s + a.balancePaise, 0), accounts: accts, advancesHeldPaise: 1650000, accountCreditOwedPaise: 120000, customersOweYouPaise: 450000, gstPayablePaise: 0,
  uncategorised: { count: txns.filter((t) => !t.categoryId).length, amountPaise: -450000 }, balanced: true, lockedMonths: [], empty: false }; });

// ---- statement import, rules, reconciliation
const imports = [];
first('POST', /^\/api\/accounting\/imports$/, (c) => { staffUser(c); const dry = c.query.get('dryRun') === '1'; const r = { importId: dry ? null : uid('imp'), dryRun: dry, filename: c.query.get('filename') || 'statement.csv', rowsTotal: 14, rowsNew: 12, rowsDuplicate: 2, rowsSkipped: 1, periodFrom: day(-20), periodTo: day(-1), categorisedByRules: 7, warnings: [], skipped: [{ line: 18, reason: 'Summary line' }],
  columns: { date: 'Date', description: 'Narration', debit: 'Withdrawal Amt.', credit: 'Deposit Amt.', balance: 'Closing Balance' }, sample: [{ date: day(-2), description: 'UPI/CR/412398700555/NEHA DESAI', amountPaise: 200000 }, { date: day(-3), description: 'EB BILL PAYMENT', amountPaise: -1250000 }, { date: day(-5), description: 'IMPS-TURF SUPPLIES', amountPaise: -380000 }], lockedMonthRows: 0, autoMatched: dry ? 0 : 3 };
  if (!dry) imports.unshift({ id: r.importId, accountId: 'acc_hdfc', accountName: 'HDFC current account', filename: r.filename, kind: 'csv', rowsNew: 12, rowsDuplicate: 2, rowsSkipped: 1, periodFrom: r.periodFrom, periodTo: r.periodTo, createdAt: Date.now(), undoneAt: null }); return r; });
first('GET', /^\/api\/accounting\/imports$/, (c) => { staffUser(c); return { items: imports }; });
first('POST', /^\/api\/accounting\/imports\/([^/]+)\/undo$/, (c, [, id]) => { staffUser(c); const i = imports.find((x) => x.id === id); if (i) i.undoneAt = Date.now(); return { removed: 12 }; });
const rules = [{ id: 'rul_1', name: null, priority: 100, field: 'description', matchType: 'contains', pattern: 'ELECTRICITY', direction: 'out', minPaise: null, maxPaise: null, categoryId: 'cat_electricity', categoryName: 'Electricity and floodlights', active: true }];
first('GET', /^\/api\/accounting\/rules$/, (c) => { staffUser(c); return { items: rules }; });
first('POST', /^\/api\/accounting\/rules$/, (c) => { staffUser(c); const b = c.body; const r = { id: uid('rul'), name: null, priority: 100, field: b.field, matchType: b.matchType, pattern: b.pattern, direction: b.direction, minPaise: null, maxPaise: null, categoryId: b.categoryId, categoryName: catName(b.categoryId), active: true }; rules.push(r); return r; });
first('DELETE', /^\/api\/accounting\/rules\/([^/]+)$/, (c, [, id]) => { staffUser(c); const i = rules.findIndex((r) => r.id === id); if (i >= 0) rules.splice(i, 1); return { removed: true }; });
first('POST', /^\/api\/accounting\/rules\/apply$/, (c) => { staffUser(c); return { categorised: 2, checked: 3 }; });
first('GET', /^\/api\/accounting\/settings$/, (c) => { staffUser(c); return { gstPercent: 0, lockedMonths: [] }; });
first('PATCH', /^\/api\/accounting\/settings$/, (c) => { staffUser(c); return { gstPercent: c.body.gstPercent || 0, lockedMonths: [] }; });
const recon = { rows: [{ txnId: 'txn_1', date: day(-2), description: 'UPI/CR/412398700112/AMIT PATEL', reference: null, amountPaise: 150000, accountName: 'HDFC current account', candidates: [{ paymentId: 'pay_x1', bookingId: 'bkg_x1', customerName: 'Amit Patel', method: 'upi', amountPaise: 150000, reference: '412398700112', paidOn: day(-2), strength: 'utr' }] },
  { txnId: 'txn_6', date: day(-10), description: 'CASH DEPOSIT', reference: null, amountPaise: 500000, accountName: 'HDFC current account', candidates: [] }], unmatchedPayments: 2 };
first('GET', /^\/api\/accounting\/reconcile$/, (c) => { staffUser(c); return { ...recon, accounts: [{ id: 'acc_hdfc', accountId: 'acc_hdfc', name: 'HDFC current account', booksBalancePaise: 7240000, statementBalancePaise: 7240000, statementDate: day(-1), differencePaise: 0, unmatchedCredits: recon.rows.length, uncategorised: txns.filter((t) => !t.categoryId).length }] }; });
first('POST', /^\/api\/accounting\/reconcile\/auto$/, (c) => { staffUser(c); const n = recon.rows.filter((r) => r.candidates.some((x) => x.strength === 'utr')).length; recon.rows = recon.rows.filter((r) => !r.candidates.some((x) => x.strength === 'utr')); return { matched: n, left: recon.rows.length }; });
first('POST', /^\/api\/accounting\/transactions\/([^/]+)\/match$/, (c, [, id]) => { staffUser(c); recon.rows = recon.rows.filter((r) => r.txnId !== id); return { matched: true }; });

// ---- recurring, journals, month-end
const recur = [{ id: 'rec_1', accountId: 'acc_hdfc', accountName: 'HDFC current account', description: 'Ground rent', amountPaise: -2500000, categoryId: 'cat_rent', categoryName: 'Ground rent', frequency: 'monthly', startDate: day(-120), endDate: null, nextDate: day(12), lastRunDate: day(-18), active: true },
  { id: 'rec_2', accountId: 'acc_hdfc', accountName: 'HDFC current account', description: 'Groundsman salary', amountPaise: -1800000, categoryId: 'cat_wages', categoryName: 'Staff wages', frequency: 'monthly', startDate: day(-100), endDate: null, nextDate: day(20), lastRunDate: day(-10), active: true }];
first('GET', /^\/api\/accounting\/recurring$/, (c) => { staffUser(c); return { items: recur }; });
first('POST', /^\/api\/accounting\/recurring$/, (c) => { staffUser(c); const b = c.body; const r = { id: uid('rec'), accountId: b.accountId, accountName: accts.find((a) => a.id === b.accountId).name, description: b.description, amountPaise: b.amountPaise, categoryId: b.categoryId || null, categoryName: catName(b.categoryId), frequency: b.frequency, startDate: b.startDate, endDate: b.endDate || null, nextDate: b.startDate, lastRunDate: null, active: true }; recur.push(r); return r; });
first('PATCH', /^\/api\/accounting\/recurring\/([^/]+)$/, (c, [, id]) => { staffUser(c); const r = recur.find((x) => x.id === id); if (r && c.body.active !== undefined) r.active = c.body.active; return r; });
first('DELETE', /^\/api\/accounting\/recurring\/([^/]+)$/, (c, [, id]) => { staffUser(c); const i = recur.findIndex((r) => r.id === id); if (i >= 0) recur.splice(i, 1); return { removed: true }; });
first('POST', /^\/api\/accounting\/recurring\/run$/, (c) => { staffUser(c); return { posted: 0, skippedLocked: 0 }; });
const journals = [{ id: 'jrn_1', date: day(-30), memo: 'Owner put in working capital', totalPaise: 5000000, createdAt: Date.now(), createdBy: null, deletedAt: null, deleteReason: null, lines: [{ account: 'bank', accountName: 'HDFC current account', debitPaise: 5000000, creditPaise: 0, note: null }, { account: 'equity', accountName: 'Owner’s equity', debitPaise: 0, creditPaise: 5000000, note: null }] }];
first('GET', /^\/api\/accounting\/journal-accounts$/, (c) => { staffUser(c); return { items: [{ code: 'equity', name: 'Owner’s equity', type: 'equity', group: 'Equity' }, { code: 'depreciation', name: 'Depreciation', type: 'expense', group: 'Operations' }, { code: 'equipment', name: 'Equipment', type: 'asset', group: 'Fixed assets' }] }; });
first('GET', /^\/api\/accounting\/journals$/, (c) => { staffUser(c); return { items: journals, total: journals.length, limit: 50, offset: 0 }; });
first('POST', /^\/api\/accounting\/journals$/, (c) => { staffUser(c); const b = c.body; const j = { id: uid('jrn'), date: b.date, memo: b.memo, totalPaise: b.lines.reduce((s, l) => s + l.debitPaise, 0), createdAt: Date.now(), createdBy: null, deletedAt: null, deleteReason: null, lines: b.lines.map((l) => ({ ...l, accountName: l.account, note: null })) }; journals.unshift(j); return j; });
first('POST', /^\/api\/accounting\/journals\/([^/]+)\/void$/, (c, [, id]) => { staffUser(c); const j = journals.find((x) => x.id === id); if (j) { j.deletedAt = Date.now(); j.deleteReason = c.body.reason; } return j; });
const signoffs = [{ month: day(-60).slice(0, 7), signedAt: Date.now() - 40 * 86400000, signedBy: null, reopenedAt: null, reopenReason: null, netProfitPaise: 410000, revenuePaise: 5200000, expensesPaise: 4790000 }];
first('GET', /^\/api\/accounting\/signoffs$/, (c) => { staffUser(c); return { items: signoffs }; });
first('POST', /^\/api\/accounting\/signoffs$/, (c) => { staffUser(c); const s = { month: c.body.month, signedAt: Date.now(), signedBy: null, reopenedAt: null, reopenReason: null, netProfitPaise: 410000, revenuePaise: 5200000, expensesPaise: 4790000 }; signoffs.push(s); return s; });
first('POST', /^\/api\/accounting\/signoffs\/reopen$/, (c) => { staffUser(c); const s = signoffs.find((x) => x.month === c.body.month); if (s) s.reopenedAt = Date.now(); return { month: c.body.month, lockedMonths: [] }; });
first('GET', /^\/api\/accounting\/memos\/([^/]+)$/, (c, [, m]) => { staffUser(c); return { month: m, body: '', updatedAt: null }; });
first('PUT', /^\/api\/accounting\/memos\/([^/]+)$/, (c, [, m]) => { staffUser(c); return { month: m, body: c.body.body || '', updatedAt: Date.now() }; });

// ---- academy
let skillList = ['Batting', 'Bowling', 'Fielding', 'Fitness', 'Discipline'];
const students = [
  { id: 'stu_1', name: 'Aarav Shah', bornOn: '2013-04-12', batch: 'U-14 weekday', guardianName: 'Neha Shah', guardianEmail: 'customer@daji.test', guardianPhone: '9876500011', linked: true, photoConsent: true, videoConsent: false, notes: null, status: 'active', joinedOn: day(-200) },
  { id: 'stu_2', name: 'Ishaan Mehta', bornOn: '2012-09-02', batch: 'U-14 weekday', guardianName: 'Rakesh Mehta', guardianEmail: 'rakesh@example.com', guardianPhone: '9876500022', linked: false, photoConsent: false, videoConsent: false, notes: null, status: 'active', joinedOn: day(-90) },
  { id: 'stu_3', name: 'Diya Patel', bornOn: '2011-01-20', batch: 'U-16 weekend', guardianName: 'Hetal Patel', guardianEmail: null, guardianPhone: '9876500033', linked: false, photoConsent: true, videoConsent: true, notes: null, status: 'active', joinedOn: day(-30) }];
const cards = [{ id: 'apr_1', studentId: 'stu_1', month: D0.slice(0, 7), ratings: [['Batting', 4], ['Bowling', 3], ['Fielding', 5], ['Fitness', 4], ['Discipline', 5]].map(([skill, rating]) => ({ skill, rating })), comment: 'Great focus this month. His straight bat is improving.', published: true, publishedAt: Date.now(), attendance: { sessions: 12, present: 11, percent: 92 } }];
let coachList = [{ name: 'Munaf Patel', title: 'Founder, MP13', bio: 'Former India fast bowler and 2011 World Cup winner.', photo: '' }, { name: 'Rakesh Desai', title: 'Head batting coach', bio: 'Level 2 coach with 15 years of age-group experience.', photo: '' }];
first('GET', /^\/api\/staff\/academy\/coaches$/, (c) => { staffUser(c); return { items: coachList }; });
first('PUT', /^\/api\/staff\/academy\/coaches$/, (c) => { staffUser(c); coachList = c.body.items; return { items: coachList }; });
first('GET', /^\/api\/staff\/academy\/skills$/, (c) => { staffUser(c); return { skills: skillList }; });
first('PUT', /^\/api\/staff\/academy\/skills$/, (c) => { staffUser(c); skillList = c.body.skills; return { skills: skillList }; });
first('GET', /^\/api\/staff\/academy\/students$/, (c) => { staffUser(c); const st = c.query.get('status'), q = (c.query.get('q') || '').toLowerCase(); return { items: students.filter((s) => (!st || s.status === st) && s.name.toLowerCase().includes(q)) }; });
first('POST', /^\/api\/staff\/academy\/students$/, (c) => { staffUser(c); const b = c.body; if (!b.name || b.name.length < 2) throw bad([{ field: 'name', message: 'Required' }]); const s = { id: uid('stu'), name: b.name, bornOn: b.bornOn || null, batch: b.batch || null, guardianName: b.guardianName, guardianEmail: b.guardianEmail || null, guardianPhone: b.guardianPhone || null, linked: false, photoConsent: !!b.photoConsent, videoConsent: !!b.videoConsent, notes: b.notes || null, status: 'active', joinedOn: D0 }; students.push(s); return s; });
first('PATCH', /^\/api\/staff\/academy\/students\/([^/]+)$/, (c, [, id]) => { staffUser(c); const s = students.find((x) => x.id === id); Object.assign(s, c.body); return s; });
first('POST', /^\/api\/staff\/academy\/students\/([^/]+)\/link-guardian$/, (c, [, id]) => { staffUser(c); const s = students.find((x) => x.id === id); s.linked = true; s.guardianEmail = c.body.email; return s; });
first('POST', /^\/api\/staff\/academy\/students\/([^/]+)\/unlink-guardian$/, (c, [, id]) => { staffUser(c); const s = students.find((x) => x.id === id); s.linked = false; return s; });
const marks = {};
first('GET', /^\/api\/staff\/academy\/attendance$/, (c) => { staffUser(c); const d = c.query.get('date'); return { date: d, items: students.filter((x) => x.status === 'active').map((x) => ({ studentId: x.id, name: x.name, present: (marks[d] || {})[x.id] ?? null, note: null })) }; });
first('POST', /^\/api\/staff\/academy\/attendance$/, (c) => { staffUser(c); const m = (marks[c.body.date] = marks[c.body.date] || {}); for (const x of c.body.marks || []) m[x.studentId] = x.present; return { date: c.body.date, saved: (c.body.marks || []).length }; });
first('GET', /^\/api\/staff\/academy\/students\/([^/]+)\/progress$/, (c, [, id]) => { staffUser(c); return { items: cards.filter((x) => x.studentId === id), skills: skillList }; });
first('PUT', /^\/api\/staff\/academy\/students\/([^/]+)\/progress\/([^/]+)$/, (c, [, id, m]) => { staffUser(c); let x = cards.find((k) => k.studentId === id && k.month === m); if (!x) { x = { id: uid('apr'), studentId: id, month: m, published: false, publishedAt: null, attendance: { sessions: 0, present: 0, percent: null } }; cards.push(x); } x.ratings = Object.entries(c.body.ratings).map(([skill, rating]) => ({ skill, rating })); x.comment = c.body.comment || null; return x; });
first('POST', /^\/api\/staff\/academy\/students\/([^/]+)\/progress\/([^/]+)\/publish$/, (c, [, id, m]) => { staffUser(c); const x = cards.find((k) => k.studentId === id && k.month === m); x.published = !!c.body.published; return x; });
first('GET', /^\/api\/me\/children$/, (c) => { const u = who(c.headers); needRole(u, 'customer'); return { items: [{ id: 'stu_1', name: 'Aarav Shah', batch: 'U-14 weekday', academy: 'Daji Cricket Ground', skills: skillList, attendance: { sessions: 12, present: 11, percent: 92 }, cards: cards.filter((x) => x.studentId === 'stu_1' && x.published) }] }; });

// ---- matches (a small real scorer, so the preview behaves like the server)
const matches = [];
const ytId = (u) => { const m = /^https:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|live\/)|youtu\.be\/)([\w-]{11})/.exec(u || ''); return m ? m[1] : null; };
const bat = (m, n) => (n === 1 ? (m.battingFirst === 'a' ? m.teamA : m.teamB) : (m.battingFirst === 'a' ? m.teamB : m.teamA));
function tally(balls) { let runs = 0, w = 0, legal = 0; for (const b of balls) { runs += b.runsBat + b.extraRuns; if (b.wicket) w++; if (b.extraType !== 'wide' && b.extraType !== 'noball') legal++; } return { runs, w, legal }; }
const overs = (l) => `${Math.floor(l / 6)}.${l % 6}`;
function closed(m, balls, n) { const t = tally(balls); if (t.legal >= m.overs * 6 || t.w >= m.playersPerSide - 1) return true; if (n === 2) return t.runs > tally(m.balls.filter((b) => b.innings === 1)).runs; return false; }
function card(m) {
  const inn = [1, 2].filter((n) => n === 1 || m.balls.some((b) => b.innings === 1)).map((n) => {
    const balls = m.balls.filter((b) => b.innings === n), t = tally(balls); const B = new Map(), W = new Map(), ex = { wides: 0, noBalls: 0, byes: 0, legByes: 0, total: 0 };
    for (const b of balls) { const s = B.get(b.batter) || { runs: 0, balls: 0, fours: 0, sixes: 0, out: null }; B.set(b.batter, s); if (b.extraType !== 'wide') s.balls++; s.runs += b.runsBat; if (b.runsBat === 4) s.fours++; if (b.runsBat === 6) s.sixes++;
      if (b.wicket) { const o = B.get(b.outPlayer || b.batter) || { runs: 0, balls: 0, fours: 0, sixes: 0, out: null }; B.set(b.outPlayer || b.batter, o); o.out = `${b.wicketKind} b ${b.bowler}`; }
      const w = W.get(b.bowler) || { legal: 0, runs: 0, wickets: 0 }; W.set(b.bowler, w); if (b.extraType !== 'wide' && b.extraType !== 'noball') w.legal++; w.runs += b.runsBat + (b.extraType === 'wide' || b.extraType === 'noball' ? b.extraRuns : 0); if (b.wicket) w.wickets++;
      if (b.extraType === 'wide') ex.wides += b.extraRuns; else if (b.extraType === 'noball') ex.noBalls += b.extraRuns; else if (b.extraType === 'bye') ex.byes += b.extraRuns; else if (b.extraType === 'legbye') ex.legByes += b.extraRuns; }
    ex.total = ex.wides + ex.noBalls + ex.byes + ex.legByes;
    return { number: n, team: bat(m, n), runs: t.runs, wickets: t.w, overs: overs(t.legal), runRate: t.legal ? R(t.runs / (t.legal / 6) * 100) / 100 : null, closed: closed(m, balls, n), target: n === 2 ? tally(m.balls.filter((b) => b.innings === 1)).runs + 1 : null,
      batting: [...B].map(([name, s]) => ({ name, ...s })), bowling: [...W].map(([name, w]) => ({ name, overs: overs(w.legal), runs: w.runs, wickets: w.wickets, economy: w.legal ? R(w.runs / (w.legal / 6) * 100) / 100 : null })), extras: ex,
      recent: balls.slice(-12).map((b) => (b.wicket ? 'W' : b.extraType === 'wide' ? 'wd' : b.extraType === 'noball' ? 'nb' : b.extraType === 'bye' ? b.extraRuns + 'b' : b.extraType === 'legbye' ? b.extraRuns + 'lb' : String(b.runsBat))) };
  });
  return { match: view(m), innings: inn };
}
const view = (m) => { const { balls, ...r } = m; return { ...r, embedUrl: m.youtubeId ? `https://www.youtube-nocookie.com/embed/${m.youtubeId}` : null }; };
function seedMatch() {
  const m = { id: 'mat_demo', title: 'Sunday friendly', teamA: 'Daji XI', teamB: 'Surat Strikers', overs: 5, playersPerSide: 6, battingFirst: 'a', status: 'live', youtubeId: 'dQw4w9WgXcQ', isPublic: true, scheduledFor: null, result: null, groundId: null, balls: [] };
  [[1, 'Amit', 1], [1, 'Amit', 4], [1, 'Amit', 0], [1, 'Amit', 6], [1, 'Kunal', 2], [1, 'Kunal', 1], [1, 'Kunal', 0, 'W'], [1, 'Rohan', 3], [1, 'Rohan', 1]].forEach(([innings, batter, r, w], i) => m.balls.push({ innings, batter, bowler: 'Zed', runsBat: r, extraType: null, extraRuns: 0, wicket: !!w, wicketKind: w ? 'bowled' : null, outPlayer: null, seq: i }));
  matches.push(m);
}
seedMatch();
const mine = (id) => { const m = matches.find((x) => x.id === id); if (!m) throw new Err(404, 'NOT_FOUND', 'Match not found'); return m; };
first('GET', /^\/api\/staff\/matches$/, (c) => { staffUser(c); return { items: matches.map(view) }; });
first('POST', /^\/api\/staff\/matches$/, (c) => { staffUser(c); const b = c.body; if (b.youtubeUrl && !ytId(b.youtubeUrl)) throw bad([{ field: 'youtubeUrl', message: 'That is not a YouTube link' }]); const m = { id: uid('mat'), title: b.title, teamA: b.teamA, teamB: b.teamB, overs: b.overs, playersPerSide: b.playersPerSide || 11, battingFirst: b.battingFirst || 'a', status: 'scheduled', youtubeId: ytId(b.youtubeUrl), isPublic: b.isPublic !== false, scheduledFor: null, result: null, groundId: null, balls: [] }; matches.unshift(m); return view(m); });
first('PATCH', /^\/api\/staff\/matches\/([^/]+)$/, (c, [, id]) => { staffUser(c); const m = mine(id); const b = c.body; if (b.title) m.title = b.title; if ('youtubeUrl' in b) { if (b.youtubeUrl && !ytId(b.youtubeUrl)) throw bad([{ field: 'youtubeUrl', message: 'That is not a YouTube link' }]); m.youtubeId = ytId(b.youtubeUrl); } if ('isPublic' in b) m.isPublic = !!b.isPublic; return view(m); });
first('GET', /^\/api\/staff\/matches\/([^/]+)$/, (c, [, id]) => { staffUser(c); return card(mine(id)); });
first('POST', /^\/api\/staff\/matches\/([^/]+)\/balls$/, (c, [, id]) => {
  staffUser(c); const m = mine(id), b = c.body; if (m.status === 'completed') throw new Err(409, 'MATCH_COMPLETED', 'This match is finished.');
  if (b.innings === 2 && !closed(m, m.balls.filter((x) => x.innings === 1), 1)) throw new Err(409, 'INNINGS_OPEN', 'The first innings is not over yet');
  const own = m.balls.filter((x) => x.innings === b.innings); if (closed(m, own, b.innings)) throw new Err(409, 'INNINGS_CLOSED', 'This innings is over.');
  let er = b.extraRuns || 0; if (b.extraType === 'wide' || b.extraType === 'noball') er = Math.max(er, 1);
  m.balls.push({ innings: b.innings, batter: b.batter, bowler: b.bowler, runsBat: b.runsBat || 0, extraType: b.extraType || null, extraRuns: b.extraType ? er : 0, wicket: !!b.wicket, wicketKind: b.wicketKind || null, outPlayer: b.outPlayer || null }); m.status = 'live';
  const b2 = m.balls.filter((x) => x.innings === 2); if (b2.length && closed(m, b2, 2)) { const t1 = tally(m.balls.filter((x) => x.innings === 1)), t2 = tally(b2); m.status = 'completed'; m.result = t2.runs > t1.runs ? `${bat(m, 2)} won by ${m.playersPerSide - 1 - t2.w} wickets` : t2.runs === t1.runs ? 'Match tied' : `${bat(m, 1)} won by ${t1.runs - t2.runs} runs`; }
  return card(m); });
first('POST', /^\/api\/staff\/matches\/([^/]+)\/undo$/, (c, [, id]) => { staffUser(c); const m = mine(id); const i = m.balls.map((x) => x.innings).lastIndexOf(c.body.innings); if (i < 0) throw new Err(404, 'NOT_FOUND', 'No balls to undo'); m.balls.splice(i, 1); m.status = 'live'; m.result = null; return card(m); });
first('GET', /^\/api\/matches$/, () => ({ items: matches.filter((m) => m.isPublic && m.status !== 'scheduled').map((m) => ({ ...view(m), summary: card(m).innings.map((i) => `${i.team} ${i.runs}/${i.wickets} (${i.overs})`).join('  ·  ') })) }));
first('GET', /^\/api\/matches\/([^/]+)$/, (c, [, id]) => { const m = mine(id); if (!m.isPublic) throw new Err(404, 'NOT_FOUND', 'Match not found'); return card(m); });

// ---- platform leads
const leads = [{ id: 'led_1', name: 'Ravi Mehta', email: 'ravi@example.com', phone: '9876543210', business: 'Mehta Turf', city: 'Vadodara', grounds: 2, message: 'Two grounds, want online booking and accounts.', status: 'new', note: null, createdAt: Date.now() - 3600000 }];
first('POST', /^\/api\/platform\/leads$/, (c) => { const b = c.body; const f = []; if (!b.name || b.name.length < 2) f.push({ field: 'name', message: 'Required' }); if (!/^\S+@\S+\.\S+$/.test(b.email || '')) f.push({ field: 'email', message: 'Enter a valid email' }); if (!/^\d{10}$/.test(String(b.phone || '').replace(/\D/g, '').slice(-10))) f.push({ field: 'phone', message: 'Enter a 10-digit phone number' }); if (!b.business) f.push({ field: 'business', message: 'Required' }); if (f.length) throw bad(f); leads.unshift({ id: uid('led'), ...b, status: 'new', note: null, createdAt: Date.now() }); return { received: true }; });
first('GET', /^\/api\/admin\/leads$/, (c) => { needRole(who(c.headers), 'super_admin'); return { items: leads }; });
first('PATCH', /^\/api\/admin\/leads\/([^/]+)$/, (c, [, id]) => { needRole(who(c.headers), 'super_admin'); const l = leads.find((x) => x.id === id); if (c.body.status) l.status = c.body.status; return l; });


// ---- customer dashboard and customer Ask AI (sample data)
first('GET', /^\/api\/my\/dashboard$/, (c) => {
  const u = who(c.headers); needRole(u, 'customer');
  const months = []; let y = Number(D0.slice(0, 4)), m = Number(D0.slice(5, 7));
  for (let i = 0; i < 12; i++) { months.unshift(y + '-' + String(m).padStart(2, '0')); m--; if (m === 0) { m = 12; y--; } }
  const spend = [0, 0, 0, 180000, 220000, 0, 360000, 180000, 440000, 220000, 360000, 180000];
  const byMonth = months.map((month, i) => ({ month, sessions: spend[i] ? Math.round(spend[i] / 180000) : 0, spentPaise: spend[i] }));
  const total = spend.reduce((a, b) => a + b, 0);
  return { spentPaise: total, sessions: 15, slots: 17, cancelled: 1, noShows: 0, paidAheadPaise: 90000, upcoming: 1, creditPaise: 0, firstPlayed: day(-300),
    byGround: [{ groundId: 'g1', groundName: 'Cricket Ground', sessions: 11, slots: 12, spentPaise: 220000 * 6, lastPlayed: day(-6) }, { groundId: 'g2', groundName: 'Practice Nets', sessions: 4, slots: 5, spentPaise: total - 220000 * 6, lastPlayed: day(-20) }],
    byMonth, recent: [] };
});
first('GET', /^\/api\/ask\/examples$/, (c) => { needRole(who(c.headers), 'customer'); return { items: ['When is my next booking?', 'How much credit do I have?', 'Is the cricket ground free on Saturday?', 'What is the cancellation policy?'] }; });
first('POST', /^\/api\/ask$/, (c) => { needRole(who(c.headers), 'customer'); return { question: c.body.question, answer: 'This is a preview with sample data, so answers are not real. On the live site this answers from your own bookings and credit and the ground details.', details: [], open: null, suggestions: [], source: 'builtin', intent: 'help' }; });

// ---- accounting additions: cash flow, budget, GST, assets, transfers
{
  const budgets = [{ code: 'exp:electricity', name: 'Electricity', type: 'expense', group: 'Running costs', monthlyPaise: 400000 }, { code: 'exp:groundsman', name: 'Groundsman', type: 'expense', group: 'Staff', monthlyPaise: 1800000 }];
  const assetsList = [{ id: 'ast_1', name: 'Bowling machine', costPaise: 12000000, salvagePaise: 1000000, purchaseDate: day(-200), lifeMonths: 60, monthlyPaise: 183333, disposedOn: null, note: null, depreciatedPaise: 1100000, bookValuePaise: 10900000, monthsPosted: 6, status: 'active' },
    { id: 'ast_2', name: 'Practice nets', costPaise: 6500000, salvagePaise: 0, purchaseDate: day(-20), lifeMonths: 120, monthlyPaise: 54166, disposedOn: null, note: null, depreciatedPaise: 0, bookValuePaise: 6500000, monthsPosted: 0, status: 'active' }];
  const rng = (c) => { const m = c.query.get('month') || D0.slice(0, 7); return { from: m + '-01', to: m + '-28' }; };
  first('GET', /^\/api\/accounting\/reports\/cash-flow$/, (c) => { staffUser(c); return { range: rng(c), openingPaise: 6100000, operating: { rows: [{ code: 'booking_receipts', name: 'Booking money received in the bank', paise: 5590000 }, { code: 'exp:electricity', name: 'Electricity', paise: -420000 }, { code: 'exp:groundsman', name: 'Groundsman', paise: -1800000 }], totalPaise: 3370000 }, investing: { rows: [{ code: 'asset_purchase', name: 'Equipment or asset bought', paise: -6500000 }], totalPaise: -6500000 }, financing: { rows: [{ code: 'owner_capital', name: 'Owner capital', paise: 4000000 }], totalPaise: 4000000 }, betweenAccountsPaise: 0, newAccountsOpeningPaise: 0, netChangePaise: 870000, closingPaise: 6970000, ties: true, notes: ['Built from the money that actually moved in your bank and cash accounts, grouped by the category you gave each transaction.'] }; });
  first('GET', /^\/api\/accounting\/reports\/budget$/, (c) => { staffUser(c); return { range: rng(c), months: 1, income: [], expenses: [{ code: 'exp:electricity', name: 'Electricity', type: 'expense', group: 'Running costs', budgetPaise: 400000, actualPaise: 420000, variancePaise: -20000, percentUsed: 105, status: 'over' }, { code: 'exp:groundsman', name: 'Groundsman', type: 'expense', group: 'Staff', budgetPaise: 1800000, actualPaise: 1800000, variancePaise: 0, percentUsed: 100, status: 'ok' }, { code: 'exp:repairs', name: 'Repairs', type: 'expense', group: 'Running costs', budgetPaise: 0, actualPaise: 75000, variancePaise: -75000, percentUsed: null, status: 'unbudgeted' }], totals: { budgetIncomePaise: 0, actualIncomePaise: 5590000, budgetExpensePaise: 2200000, actualExpensePaise: 2295000, budgetProfitPaise: -2200000, actualProfitPaise: 3295000 }, notes: [] }; });
  first('GET', /^\/api\/accounting\/budgets$/, (c) => { staffUser(c); return { items: budgets, available: [{ code: 'inc:booking', name: 'Booking income', type: 'income', group: 'Income' }, { code: 'exp:electricity', name: 'Electricity', type: 'expense', group: 'Running costs' }, { code: 'exp:groundsman', name: 'Groundsman', type: 'expense', group: 'Staff' }, { code: 'exp:repairs', name: 'Repairs', type: 'expense', group: 'Running costs' }] }; });
  first('PUT', /^\/api\/accounting\/budgets$/, (c) => { staffUser(c); return { items: budgets, available: [] }; });
  first('GET', /^\/api\/accounting\/reports\/gst$/, (c) => { staffUser(c); const rows = [-2, -1, 0].map((n) => ({ month: day(n * 30).slice(0, 7), taxableValuePaise: 4800000, gstCollectedPaise: 864000, gstPaidPaise: 120000, netPaise: 744000 })); return { range: { from: '2026-04-01', to: '2027-03-31' }, percent: 18, rows, totals: { taxableValuePaise: 14400000, gstCollectedPaise: 2592000, gstPaidPaise: 360000, netPaise: 2232000 }, payableAtEndPaise: 1488000, notes: ['GST is taken as included in the booking price.'] }; });
  first('POST', /^\/api\/accounting\/transfers$/, (c) => { staffUser(c); return { reference: 'TRF-1' }; });
  first('GET', /^\/api\/accounting\/assets$/, (c) => { staffUser(c); const live = assetsList.filter((a) => a.status !== 'disposed'); return { items: assetsList, totals: { costPaise: live.reduce((s, a) => s + a.costPaise, 0), depreciatedPaise: live.reduce((s, a) => s + a.depreciatedPaise, 0), bookValuePaise: live.reduce((s, a) => s + a.bookValuePaise, 0) } }; });
  first('POST', /^\/api\/accounting\/assets\/depreciate$/, (c) => { staffUser(c); return { posted: 1, totalPaise: 183333, skippedLocked: [] }; });
  first('POST', /^\/api\/accounting\/assets$/, (c) => { staffUser(c); const b = c.body; const a = { id: 'ast_' + (assetsList.length + 1), name: b.name, costPaise: b.costPaise, salvagePaise: b.salvagePaise || 0, purchaseDate: b.purchaseDate, lifeMonths: b.lifeMonths, monthlyPaise: Math.floor((b.costPaise - (b.salvagePaise || 0)) / b.lifeMonths), disposedOn: null, note: null, depreciatedPaise: 0, bookValuePaise: b.costPaise, monthsPosted: 0, status: 'active' }; assetsList.unshift(a); return a; });
  first('POST', /^\/api\/accounting\/assets\/([^/]+)\/dispose$/, (c, [, id]) => { staffUser(c); const a = assetsList.find((x) => x.id === id); if (a) { a.status = 'disposed'; a.disposedOn = c.body.disposedOn; } return a; });
  first('DELETE', /^\/api\/accounting\/assets\/([^/]+)$/, (c, [, id]) => { staffUser(c); const i = assetsList.findIndex((x) => x.id === id); if (i >= 0) assetsList.splice(i, 1); return { deleted: true }; });
}

// ---- contacts and broadcasts
{
  const people = [['Rohan Mehta', 14, -3, 2520000], ['Kunal Shah', 9, -9, 1620000], ['Imran Khan', 6, -21, 1080000], ['Dev Patel', 3, -48, 540000], ['Nirav Desai', 2, -95, 360000]].map(([name, n, d, paid], i) => ({
    id: 'u' + i, name, phone: '98250' + String(10000 + i * 777).slice(0, 5), email: name.split(' ')[0].toLowerCase() + '@example.com', timesPlayed: n, slotsPlayed: n, firstPlayedAt: Date.now() - 300 * 864e5, lastPlayedAt: Date.now() + d * 864e5, paidPaise: paid, groundIds: ['g1'],
    consent: { email: i % 2 === 0, sms: i < 2, whatsapp: i !== 3 }, reachable: { email: i % 2 === 0, sms: i < 2, whatsapp: i !== 3 } }));
  first('GET', /^\/api\/staff\/contacts$/, (c) => { staffUser(c); const q = (c.query.get('q') || '').toLowerCase(); const items = people.filter((p) => !q || p.name.toLowerCase().includes(q)); return { items, total: items.length, limit: 50, offset: 0, summary: { total: items.length, reachableEmail: items.filter((p) => p.reachable.email).length, reachableWhatsapp: items.filter((p) => p.reachable.whatsapp).length, reachableSms: items.filter((p) => p.reachable.sms).length } }; });
  first('GET', /^\/api\/staff\/broadcast-templates$/, (c) => { staffUser(c); return { items: [{ id: 'closed', title: 'Ground closed on a day', channels: ['email', 'whatsapp', 'sms'], subject: 'Ground closed on <date>', body: 'Hi {name}, the ground will be closed on <date> for <reason>.' }, { id: 'rain', title: 'Rain update', channels: ['email', 'whatsapp', 'sms'], subject: 'Rain update for today', body: 'Hi {name}, because of rain the ground is not playable today.' }] }; });
  first('POST', /^\/api\/staff\/broadcasts\/preview$/, (c) => { staffUser(c); return { channel: c.body.channel, audience: 5, willSend: 3, skipped: { noConsent: 2, noAddress: 0, disabled: 0 }, sample: people.slice(0, 3).map((p) => ({ id: p.id, name: p.name })), preview: { subject: c.body.subject || null, body: String(c.body.body || '').replace('{name}', 'Rohan') + '\n\nReply STOP to opt out.' } }; });
  first('POST', /^\/api\/staff\/broadcasts$/, (c) => { staffUser(c); return { broadcast: { id: 'b1', queued: 3 }, plan: {} }; });
  first('GET', /^\/api\/staff\/broadcasts$/, (c) => { staffUser(c); return { items: [{ id: 'b0', channel: 'whatsapp', subject: null, body: 'Hi {name}, floodlights are fixed. See you on the turf.', createdAt: Date.now() - 6 * 864e5, queued: 5, sent: 5 }] }; });
  first('GET', /^\/api\/staff\/grounds$/, (c) => { staffUser(c); return { items: [{ id: 'g1', name: 'Cricket Ground' }, { id: 'g2', name: 'Practice Nets' }] }; });
}

// ---- bank feed
first('GET', /^\/api\/accounting\/feed$/, (c) => { staffUser(c); recomputeAccounts(); return { provider: 'demo', accounts: accts.filter((a) => a.kind === 'bank').map((a) => ({ id: a.id, name: a.name, providerRef: null, source: 'upload', lastSyncAt: null, lastOk: null, lastMessage: null })) }; });
first('POST', /^\/api\/accounting\/feed\/link$/, (c) => { staffUser(c); return { id: c.body.accountId, providerRef: 'demo:' + c.body.providerRef }; });
first('POST', /^\/api\/accounting\/feed\/sync$/, (c) => { staffUser(c); return { rowsNew: 3, rowsDuplicate: 0, fetched: 3 }; });

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
