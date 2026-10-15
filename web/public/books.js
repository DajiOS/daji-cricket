// Daji Cricket Ground: the Books screens (accounting). Plain JavaScript; loaded after app.js, which shares its helpers on window.DAJI.
// Everything is built with h() (no innerHTML), so a bank narration or a customer's name can never become markup.
(() => {
'use strict';
const D = window.DAJI;
if (!D) return;
const { h, clear, api, apiFile, apiDownload, toast, openModal, closeModal, inr, niceDate, todayIst, addDays } = D;

// ------------------------------------------------------------------ small kit

const btn = (label, fn, cls = 'outline sm') => h('button', { class: 'btn ' + cls, type: 'button', onclick: fn }, label);
const fail = (e) => toast((e && e.message) || 'Something went wrong', true);
const fieldBox = (label, control, hint) => h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('div', { class: 'hint', style: 'margin:6px 0 0' }, hint) : null);
const sel = (opts, value, attrs = {}) => { const s = h('select', attrs); for (const [v, l] of opts) s.append(h('option', { value: v, selected: v === value ? true : null }, l)); return s; };
const money = (p) => h('span', { class: 'amt' + (p < 0 ? ' neg' : '') }, (p < 0 ? '−' : '') + inr(Math.abs(p)));
const lastDayOf = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const curMonth = () => todayIst().slice(0, 7);
const monthLabel = (m) => { const [y, mo] = m.split('-').map(Number); return `${D.MON[mo - 1]} ${y}`; };
const rupeesToPaise = (txt) => { const s = String(txt).replace(/[,\s₹]/g, ''); if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null; const neg = s.startsWith('-'); const [w, f = ''] = s.replace('-', '').split('.'); const p = Number(w) * 100 + Number((f + '00').slice(0, 2)); return neg ? -p : p; };

/** A table: `heads` are labels, `nums` are the column numbers shown right-aligned. */
function dt(heads, rows, { nums = [], empty = 'Nothing here yet.' } = {}) {
  if (!rows.length) return h('div', { class: 'empty' }, empty);
  const cell = (c, i, tag = 'td') => h(tag, { class: nums.includes(i) ? 'n' : null }, c);
  return h('div', { class: 'tblwrap' }, h('table', { class: 'dt' },
    h('thead', {}, h('tr', {}, heads.map((x, i) => cell(x, i, 'th')))),
    h('tbody', {}, rows.map((r) => h('tr', { class: r.cls || null }, (r.cells || r).map((c, i) => cell(c, i)))))));
}
const section = (title, ...kids) => h('div', { class: 'box bk-box' }, title ? h('div', { class: 'eyebrow', style: 'margin-bottom:16px' }, title) : null, ...kids);
const bar = (...kids) => h('div', { class: 'bar' }, ...kids);

async function load(pane, fn) {
  clear(pane).append(h('div', { class: 'skeleton' }, 'Loading…'));
  try { const out = await fn(); clear(pane); return out; }
  catch (e) { clear(pane).append(h('div', { class: 'empty' }, e.status === 403 ? 'Your role does not include this part of the books.' : e.message)); return null; }
}

const shared = { accounts: [], categories: [] };
async function loadShared() {
  const [a, c] = await Promise.all([api('/api/accounting/accounts'), api('/api/accounting/categories')]);
  shared.accounts = a.items; shared.categories = c.items;
}
const catOptions = (blank = 'Choose a category') => [['', blank], ...shared.categories.filter((c) => c.kind !== 'booking_receipt').map((c) => [c.id, `${c.group}: ${c.name}`]),
  ...shared.categories.filter((c) => c.kind === 'booking_receipt').map((c) => [c.id, `${c.group}: ${c.name}`])];

// ------------------------------------------------------------------ frame: dark side menu, "+ New", and the page beside it

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) if (k) e.append(k);
  return e;
}
const icon = (d, size = 18) => svgEl('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, ...[].concat(d).map((x) => svgEl('path', { d: x })));
const ICON = {
  print: ['M6 9V3h12v6', 'M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2', 'M7 14h10v7H7z'],
  share: ['M14 3h7v7', 'M21 3l-9 9', 'M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5'],
  chevron: ['M9 6l6 6-6 6'],
  down: ['M6 9l6 6 6-6'],
  home: ['M3 11l9-8 9 8', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  check: ['M9 12l2 2 4-4', 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z'],
  swap: ['M7 7h13l-3-3', 'M17 17H4l3 3'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-8', 'M22 20H2'],
  plan: ['M4 5h16v14H4z', 'M4 10h16', 'M9 5v14'],
  tax: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
  asset: ['M3 9l9-5 9 5', 'M5 9v9h14V9', 'M9 18v-5h6v5'],
  lock: ['M6 11h12v9H6z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  star: ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'],
  dots: ['M12 5v.01', 'M12 12v.01', 'M12 19v.01'],
  plus: ['M12 5v14', 'M5 12h14'],
  back: ['M15 18l-6-6 6-6'],
};

const NAV = [
  { id: 'overview', label: 'Overview', ic: 'home' },
  { id: 'review', label: 'Books review', ic: 'check' },
  { label: 'Transactions', ic: 'swap', kids: [['txns', 'Bank transactions'], ['import', 'Bank import'], ['recon', 'Reconcile'], ['recurring', 'Recurring transactions'], ['journals', 'Journal entries'], ['setup', 'Chart of accounts and rules']] },
  { id: 'reports', label: 'Reports', ic: 'chart' },
  { label: 'Planning', ic: 'plan', kids: [['cashflow', 'Cash flow'], ['budget', 'Budget against actual']] },
  { id: 'gst', label: 'Taxes (GST)', ic: 'tax' },
  { id: 'assets', label: 'Fixed assets', ic: 'asset' },
  { id: 'close', label: 'Month-end', ic: 'lock' },
];
const TITLES = { overview: 'Overview', review: 'Books review', txns: 'Bank transactions', import: 'Bank import', recon: 'Reconcile', recurring: 'Recurring transactions', journals: 'Journal entries', setup: 'Chart of accounts and rules',
  reports: 'Reports', cashflow: 'Cash flow', budget: 'Budget against actual', gst: 'Taxes (GST)', assets: 'Fixed assets', close: 'Month-end' };

let openTab = null;
function goTab(id) { if (openTab) openTab(id); }

function renderBooks(pane) {
  const views = { overview, review, reports: reportsCatalog, txns, import: importer, recon, recurring, journals, close: monthEnd, setup, cashflow, budget, gst, assets };
  const shell = h('div', { class: 'bkx' }), side = h('aside', { class: 'bknav bk-noprint' }), main = h('div', { class: 'bkmain' });
  const title = h('h2', { class: 'bktitle bk-noprint' }), printHead = h('div', { class: 'bkprint-h' }), view = h('div', { class: 'bkview' });
  const buttons = new Map(), groups = [];
  let fly = null, current = 'overview';
  const closeFly = () => { if (fly) { fly.classList.remove('open'); fly = null; } };
  const newMenu = h('div', { class: 'bknew', hidden: true });
  const closeNew = () => { newMenu.hidden = true; };
  const open = (id, quiet) => {
    if (!views[id]) id = 'overview';
    current = id; D.state.booksTab = id; D.deskSub('books', id, quiet);
    for (const [k, b] of buttons) b.classList.toggle('on', k === id);
    for (const [g, ids] of groups) g.classList.toggle('has', ids.includes(id));
    title.textContent = TITLES[id] || '';
    printHead.textContent = `${(D.state.user && (D.state.user.businessName || D.state.user.name)) || 'Daji Cricket Ground'}  ·  ${TITLES[id] || ''}  ·  printed ${niceDate(todayIst())}`;
    closeFly(); closeNew(); clear(view); views[id](view);
    main.scrollIntoView({ block: 'nearest' });
  };
  openTab = open;
  const again = () => open(current, true);

  // + New: the things you add, grouped by what they are
  const item = (label, fn) => h('button', { type: 'button', class: 'bknew-i', onclick: () => { closeNew(); fn(); } }, label);
  const withShared = (fn) => async () => { try { await loadShared(); } catch (e) { return fail(e); } fn(); };
  newMenu.append(
    h('div', { class: 'bknew-c' }, h('b', {}, 'Money'), item('Add a transaction', withShared(() => addTxnDialog(again))), item('Move money between accounts', withShared(() => transferDialog(again))), item('Import a bank statement', () => open('import'))),
    h('div', { class: 'bknew-c' }, h('b', {}, 'Records'), item('Journal entry', () => journalDialog(again)), item('Recurring entry', withShared(() => recDialog(again))), item('Bank or cash account', withShared(() => accountDialog(again))), item('Fixed asset', withShared(() => assetDialog(again)))),
    h('div', { class: 'bknew-c' }, h('b', {}, 'Month'), item('Sign off a month', () => open('close')), item('Set monthly budgets', () => budgetDialog(again)), item('Reconcile deposits', () => open('recon'))),
    h('div', { class: 'bknew-c' }, h('b', {}, 'Reports'), item('Profit and loss', () => { D.state.reportOpen = 'pnl'; open('reports'); }), item('Balance sheet', () => { D.state.reportOpen = 'bs'; open('reports'); }), item('Customer balances', () => { D.state.reportOpen = 'cb-sum'; open('reports'); })));
  const newBtn = h('button', { type: 'button', class: 'bknewbtn', onclick: (e) => { e.stopPropagation(); closeFly(); newMenu.hidden = !newMenu.hidden; } }, icon(ICON.plus, 14), 'New');

  side.append(h('div', { class: 'bkbrand' }, h('span', { class: 'bkdot' }), 'Accounting'), newBtn);
  for (const n of NAV) {
    if (!n.kids) { const b = h('button', { type: 'button', class: 'bkitem', onclick: () => open(n.id) }, h('span', { class: 'bkitem-l' }, icon(ICON[n.ic], 18), n.label)); buttons.set(n.id, b); side.append(b); continue; }
    const panel = h('div', { class: 'bkfly' }, n.kids.map(([id, label]) => { const b = h('button', { type: 'button', class: 'bkflyitem', onclick: () => open(id) }, label); buttons.set(id, b); return b; }));
    const g = h('div', { class: 'bkgroup' },
      h('button', { type: 'button', class: 'bkitem grp', onclick: (e) => { e.stopPropagation(); closeNew(); const was = panel.classList.contains('open'); closeFly(); if (!was) { panel.classList.add('open'); fly = panel; } } }, h('span', { class: 'bkitem-l' }, icon(ICON[n.ic], 18), n.label), icon(ICON.chevron, 16)), panel);
    groups.push([g, n.kids.map((k) => k[0])]); side.append(g);
  }
  const outside = (e) => { if (!shell.isConnected) { document.removeEventListener('click', outside); return; } if (!newMenu.contains(e.target)) closeNew(); if (fly && !fly.contains(e.target)) closeFly(); };
  document.addEventListener('click', outside);

  main.append(title, printHead, view);
  shell.append(side, newMenu, main);
  pane.append(shell);
  open(D.state.booksTab || 'overview', true);
}

/** A white card on the dashboard. */
const card = (title, right, ...kids) => h('div', { class: 'bkcard' }, h('div', { class: 'bkcard-h' }, h('span', {}, title), right ? h('small', {}, right) : null), ...kids);
const monthAdd = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const pctText = (n) => `${Math.abs(n)}%`;

function donut(parts) {
  const total = parts.reduce((s, p) => s + p.v, 0), R = 42, C = 2 * Math.PI * R;
  const COLORS = ['#c9a96b', '#7fb39a', '#d98c5f', '#8a9bd1', '#c46b6b', '#9a9588'];
  const svg = svgEl('svg', { viewBox: '0 0 120 120', width: '132', height: '132', role: 'img', 'aria-label': 'Spending by group' });
  svg.append(svgEl('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: 'rgba(127,127,127,.25)', 'stroke-width': 18 }));
  let off = 0;
  parts.forEach((p, i) => {
    if (!total || p.v <= 0) return;
    const len = (p.v / total) * C;
    svg.append(svgEl('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: COLORS[i % COLORS.length], 'stroke-width': 18, 'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': String(-off), transform: 'rotate(-90 60 60)' }));
    off += len;
  });
  return { svg, color: (i) => COLORS[i % COLORS.length] };
}

function barChart(labels, values) {
  const W = 360, H = 150, pad = 22, max = Math.max(...values, 1), bw = (W - pad * 2) / values.length;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Revenue by month' });
  svg.append(svgEl('line', { x1: pad, y1: H - 24, x2: W - pad, y2: H - 24, stroke: 'rgba(127,127,127,.4)' }));
  values.forEach((v, i) => {
    const hgt = Math.max(2, (Math.max(v, 0) / max) * (H - 54)), x = pad + i * bw + bw * 0.18;
    svg.append(svgEl('rect', { x, y: H - 24 - hgt, width: bw * 0.64, height: hgt, rx: 3, fill: '#c9a96b' }));
    const t = svgEl('text', { x: x + bw * 0.32, y: H - 8, 'text-anchor': 'middle', 'font-size': 10, fill: 'currentColor' }); t.textContent = labels[i]; svg.append(t);
  });
  return svg;
}

// ------------------------------------------------------------------ overview: cards, like a bookkeeper's home screen

async function overview(view) {
  const t = todayIst(), m = curMonth();
  const all = await load(view, () => Promise.all([
    api('/api/accounting/overview'), api(`/api/accounting/reports/pnl?month=${m}&compare=1`),
    api(`/api/accounting/reports/pnl-periods?from=${monthAdd(m, -5)}-01&to=${t}&by=month`), api(`/api/accounting/reports/customer-balances?asOf=${t}`)]));
  if (!all) return;
  const [o, p, per, bal] = all;
  const label = monthLabel(m);

  // profit and loss
  const rev = p.revenue.totalPaise, exp = p.expenses.totalPaise, net = p.netProfitPaise, prev = p.previousNetProfitPaise;
  const change = prev ? Math.round(((net - prev) / Math.abs(prev)) * 100) : null;
  const top = Math.max(rev, exp, 1);
  const barRow = (name, v, cls) => h('div', { class: 'bkbar' }, h('div', { class: 'bkbar-l' }, h('b', {}, inr(v)), h('span', {}, name)), h('div', { class: 'bkbar-t' }, h('i', { class: cls, style: `width:${Math.max(2, Math.round((Math.max(v, 0) / top) * 100))}%` })));
  const pnlCard = card('Profit and loss', label,
    h('div', { class: 'bkmute' }, `Net profit for ${label}`), h('div', { class: 'bkbig' + (net < 0 ? ' neg' : '') }, (net < 0 ? '−' : '') + inr(Math.abs(net))),
    change === null ? h('div', { class: 'bkmute' }, 'No earlier month to compare with') : h('div', { class: 'bkchg ' + (change >= 0 ? 'up' : 'down') }, (change >= 0 ? '▲ Up ' : '▼ Down ') + pctText(change), h('span', {}, ' from last month')),
    barRow('Revenue', rev, 'g'), barRow('Expenses', exp, 'o'),
    p.uncategorised.count ? h('a', { class: 'bklink', href: '#', onclick: (e) => { e.preventDefault(); D.state.txnTab = 'pending'; goTab('txns'); } }, `Categorise ${p.uncategorised.count} transactions`) : h('a', { class: 'bklink', href: '#', onclick: (e) => { e.preventDefault(); D.state.reportOpen = 'pnl'; goTab('reports'); } }, 'Open the profit and loss'));

  // expenses
  const groups = p.expenses.groups.map((g) => ({ name: g.name, v: g.totalPaise })).sort((a, b) => b.v - a.v);
  const dn = donut(groups.slice(0, 6));
  const spendCard = card('Expenses', label, h('div', { class: 'bkmute' }, `Spending in ${label}`), h('div', { class: 'bkbig' }, inr(exp)),
    groups.length ? h('div', { class: 'bkdonut' }, dn.svg, h('ul', {}, groups.slice(0, 5).map((g, i) => h('li', {}, h('i', { style: `background:${dn.color(i)}` }), h('span', {}, g.name), h('b', {}, inr(g.v)))))) : h('div', { class: 'empty' }, 'No expenses recorded this month.'),
    h('a', { class: 'bklink', href: '#', onclick: (e) => { e.preventDefault(); D.state.txnTab = 'pending'; goTab('txns'); } }, o.uncategorised.count ? `Categorise ${o.uncategorised.count} transactions` : 'Open transactions'));

  // what customers owe
  const sub = bal.rows.find((r) => r.kind === 'sub'), owed = sub ? sub.cells[sub.cells.length - 1] : 0;
  const recent = sub ? sub.cells[3] : 0, older = owed - recent, scale = Math.max(owed, 1);
  const owedCard = card('Customers', 'As of today', h('div', { class: 'bkmute' }, 'Played sessions not fully paid'), h('div', { class: 'bkbig' }, inr(owed)),
    h('div', { class: 'bksplit' }, h('i', { class: 'o', style: `width:${Math.round((older / scale) * 100)}%` }), h('i', { class: 'n', style: `width:${Math.round((recent / scale) * 100)}%` })),
    h('div', { class: 'bkleg' }, h('span', {}, h('i', { class: 'o' }), 'Over 30 days  ', h('b', {}, inr(older))), h('span', {}, h('i', { class: 'n' }), '0–30 days  ', h('b', {}, inr(recent)))),
    h('div', { class: 'list bklist' }, h('div', { class: 'li' }, h('span', {}, 'Advances held for future sessions'), h('b', {}, inr(o.advancesHeldPaise))), h('div', { class: 'li' }, h('span', {}, 'Account credit you owe customers'), h('b', {}, inr(o.accountCreditOwedPaise)))),
    h('a', { class: 'bklink', href: '#', onclick: (e) => { e.preventDefault(); D.state.reportOpen = 'cb-sum'; goTab('reports'); } }, 'Customer balance summary'));

  // bank accounts
  const accts = o.accounts.length ? h('div', { class: 'bkaccts' }, o.accounts.map((a) => h('div', { class: 'bkacct' },
    h('span', { class: 'bkico' }, icon(['M3 10l9-6 9 6', 'M5 10v8', 'M9 10v8', 'M15 10v8', 'M19 10v8', 'M3 20h18'], 18)),
    h('div', {}, h('b', {}, a.name), h('div', { class: 'bkmute' }, `In books ${inr(a.balancePaise)}`)),
    a.uncategorised ? h('a', { class: 'bkrev', href: '#', onclick: (e) => { e.preventDefault(); D.state.txnFilter = { accountId: a.id, categorised: 'no' }; D.state.txnTab = 'pending'; goTab('txns'); } }, `${a.uncategorised} to review`) : h('span', { class: 'bkok' }, '✓ Reviewed')))) : h('div', { class: 'empty' }, 'No bank or cash accounts yet. Add one under Chart of accounts and rules.');
  const bankCard = card('Bank accounts', 'As of today', h('div', { class: 'bkmute' }, 'Total in cash and bank'), h('div', { class: 'bkbig' }, inr(o.cashAndBankPaise)), accts);

  // revenue by month
  const revRow = per.rows.find((r) => r.kind === 'sub');
  const labels = per.columns.slice(1, -1).map((c) => c.label.slice(0, 3)), vals = revRow ? revRow.cells.slice(1, -1) : [];
  const trendCard = card('Revenue', 'Last 6 months', h('div', { class: 'bkmute' }, 'Total revenue'), h('div', { class: 'bkbig' }, inr(revRow ? revRow.cells[revRow.cells.length - 1] : 0)), vals.length ? barChart(labels, vals) : h('div', { class: 'empty' }, 'Nothing yet.'));

  // year to date and position
  const fy = o.financialYearToDate;
  const fyCard = card('This financial year', `${niceDate(fy.from)} to today`, h('div', { class: 'list bklist' },
    h('div', { class: 'li' }, h('span', {}, 'Revenue'), h('b', {}, inr(fy.revenuePaise))), h('div', { class: 'li' }, h('span', {}, 'Expenses'), h('b', {}, inr(fy.expensesPaise))),
    h('div', { class: 'li' }, h('span', {}, 'Net profit'), h('b', {}, inr(fy.netProfitPaise))), h('div', { class: 'li' }, h('span', {}, 'GST payable'), h('b', {}, inr(o.gstPayablePaise)))),
    o.lockedMonths.length ? h('div', { class: 'bkmute' }, 'Signed off: ' + o.lockedMonths.map(monthLabel).join(', ')) : null);

  const kp = (name, v, cls) => h('div', { class: 'bkkpi' + (cls ? ' ' + cls : '') }, h('span', {}, name), h('b', {}, (v < 0 ? '−' : '') + inr(Math.abs(v))));
  const strip = h('div', { class: 'bkkpis' }, kp(`Revenue · ${label}`, rev), kp('Expenses', exp), kp('Net profit', net, net < 0 ? 'neg' : 'pos'), kp('Cash and bank', o.cashAndBankPaise), kp('Customers owe you', owed));
  view.append(...[
    strip,
    o.empty ? h('div', { class: 'bkcard' }, h('div', { class: 'bkcard-h' }, h('span', {}, 'Getting started')), h('p', { class: 'bkmute' }, 'Add your bank account under Chart of accounts and rules, then load a statement under Bank import. Booking income appears here by itself.')) : null,
    h('div', { class: 'bkgrid' }, pnlCard, spendCard, owedCard, bankCard, trendCard, fyCard)].filter(Boolean));
}

// ------------------------------------------------------------------ books review: is everything in order?

async function review(view) {
  const t = todayIst();
  const all = await load(view, () => Promise.all([api('/api/accounting/reconcile'), api('/api/accounting/overview'), api(`/api/accounting/reports/balance-sheet?asOf=${t}`), api(`/api/accounting/reports/customer-balances?asOf=${t}&view=detail`)]));
  if (!all) return;
  const [rc, o, bs, det] = all;
  const fold = (title, sub, ...kids) => { const body = h('div', { class: 'bkfold-b' }, ...kids); const head = h('button', { type: 'button', class: 'bkfold-h', 'aria-expanded': 'true', onclick: () => { body.hidden = !body.hidden; head.setAttribute('aria-expanded', String(!body.hidden)); head.classList.toggle('shut', body.hidden); } }, icon(ICON.down, 16), h('b', {}, title)); return h('div', { class: 'bkcard bkfold' }, head, sub ? h('p', { class: 'bkmute' }, sub) : null, body); };
  const bankRows = rc.accounts.map((a) => {
    const acc = o.accounts.find((x) => x.name === a.name) || {};
    return [h('span', {}, a.name, a.statementBalancePaise === null ? h('div', { class: 'bkmute it' }, 'No statement balance. Books figures only.') : null),
      a.statementBalancePaise === null ? '--' : inr(a.statementBalancePaise), inr(a.booksBalancePaise),
      a.uncategorised ? `${a.uncategorised} transactions` : '--', acc.lastTransactionDate ? niceDate(acc.lastTransactionDate) : 'None yet',
      a.differencePaise === null ? '' : a.differencePaise === 0 ? h('span', { class: 'chip ok' }, 'Matches') : h('span', { class: 'chip bad' }, (a.differencePaise < 0 ? '−' : '+') + inr(Math.abs(a.differencePaise)))];
  });
  const negatives = [...bs.assets.groups, ...bs.liabilities.groups].flatMap((g) => g.rows).filter((r) => r.paise < 0);
  const over90 = det.rows.filter((r) => r.kind === 'row' && r.cells[8] > 90), over90Paise = over90.reduce((s, r) => s + r.cells[7], 0);
  const issue = (name, big, small, onClick) => h('div', { class: 'bkissue' }, h('div', {}, h('b', {}, name), small ? h('div', { class: 'bkmute' }, small) : null), h('div', { class: 'bkissue-n' }, big, onClick ? h('a', { href: '#', class: 'bklink', onclick: (e) => { e.preventDefault(); onClick(); } }, 'View') : null));
  view.append(
    fold('Banking activity', 'Do the books agree with the bank? Each account, its last statement balance and what still needs a category.', dt(['Account', 'Bank balance', 'In the books', 'Uncategorised', 'Last transaction', 'Check'], bankRows, { nums: [1, 2], empty: 'No bank or cash accounts yet.' })),
    fold('Common issues', 'Things that may need your attention.', h('div', { class: 'bkissues' },
      issue('Uncategorised transactions', String(o.uncategorised.count), `${inr(Math.abs(o.uncategorised.amountPaise))} with no category, so profit is incomplete`, () => { D.state.txnTab = 'pending'; goTab('txns'); }),
      issue('Deposits not matched to a booking', String(rc.unmatchedPayments), 'UPI or bank-transfer payments with no bank deposit yet', () => goTab('recon')),
      issue('Customer balances over 90 days', String(over90.length), inr(over90Paise), () => { D.state.reportOpen = 'cb-det'; goTab('reports'); }),
      issue('Negative asset and liability accounts', String(negatives.length), negatives.slice(0, 3).map((r) => r.name).join(', ') || 'None', () => { D.state.reportOpen = 'bs'; goTab('reports'); }),
      issue('Account credit owed to customers', inr(o.accountCreditOwedPaise), 'Unused credit and refunds due', null),
      issue('Books balance', bs.balanced ? '✓' : '✗', bs.balanced ? 'Assets equal liabilities plus equity' : `Out of balance by ${inr(bs.differencePaise)}`, () => { D.state.reportOpen = 'tb'; goTab('reports'); })),
      h('div', { class: 'bkactions' }, btn('Chart of accounts', () => goTab('setup'), 'ghost sm'), btn('View reports', () => goTab('reports'), 'outline sm'))));
}


function sectionRows(title, sec, rows) {
  rows.push({ cls: 'grp', cells: [title, ''] });
  for (const g of sec.groups) { rows.push({ cls: 'grp2', cells: [g.name, '']}); for (const r of g.rows) rows.push([r.name, money(r.paise)]); rows.push({ cls: 'sub', cells: [`Total ${g.name.toLowerCase()}`, money(g.totalPaise)] }); }
  rows.push({ cls: 'sub', cells: [`Total ${title.toLowerCase()}`, money(sec.totalPaise)] });
}
function pnlView(p) {
  const rows = []; sectionRows('Revenue', p.revenue, rows); sectionRows('Expenses', p.expenses, rows);
  rows.push({ cls: 'net', cells: ['Net profit', money(p.netProfitPaise)] });
  return h('div', {}, h('p', { class: 'hint' }, `${niceDate(p.range.from)} to ${niceDate(p.range.to)}, ${p.basis} basis` + (p.marginPercent !== null ? `. Margin ${p.marginPercent}%` : '')),
    dt(['', 'Amount'], rows, { nums: [1] }), ...p.notes.map((n) => h('p', { class: 'hint' }, n)));
}
function bsView(b) {
  const rows = []; sectionRows('Assets', b.assets, rows); sectionRows('Liabilities', b.liabilities, rows); sectionRows('Equity', b.equity, rows);
  return h('div', {}, h('p', { class: 'hint' }, `As of ${niceDate(b.asOf)}. ` + (b.balanced ? 'Assets equal liabilities plus equity.' : `Out of balance by ${inr(b.differencePaise)}.`)), dt(['', 'Amount'], rows, { nums: [1] }), ...b.notes.map((n) => h('p', { class: 'hint' }, n)));
}
function tbView(t) {
  const rows = t.rows.map((r) => [r.name, r.type, r.debitPaise ? inr(r.debitPaise) : '', r.creditPaise ? inr(r.creditPaise) : '']);
  rows.push({ cls: 'sub', cells: ['Total', '', inr(t.totalDebitPaise), inr(t.totalCreditPaise)] });
  return h('div', {}, h('p', { class: 'hint' }, `As of ${niceDate(t.asOf)}. ` + (t.balanced ? 'Debits equal credits.' : 'Debits and credits differ.')), dt(['Account', 'Type', 'Debit', 'Credit'], rows, { nums: [2, 3] }));
}

// ------------------------------------------------------------------ print and export (the two icons at the top of a report)

function exportTools(path, name) {
  const menu = h('div', { class: 'bkmenu', hidden: true }, [['pdf', 'PDF'], ['xlsx', 'Excel'], ['csv', 'CSV']].map(([f, l]) => h('button', { type: 'button', onclick: () => {
    menu.hidden = true; const p = path();
    apiDownload(p + (p.includes('?') ? '&' : '?') + 'format=' + f, `${name()}.${f}`).catch(fail);
  } }, l)));
  const wrap = h('div', { class: 'bkexport bk-noprint' },
    h('button', { type: 'button', class: 'bkicon', title: 'Print', 'aria-label': 'Print', onclick: () => { menu.hidden = true; window.print(); } }, icon(ICON.print, 20)),
    h('button', { type: 'button', class: 'bkicon', title: 'Export', 'aria-label': 'Export', 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, icon(ICON.share, 20)), menu);
  const close = () => { if (!wrap.isConnected) { document.removeEventListener('click', close); return; } menu.hidden = true; };
  document.addEventListener('click', close);
  return wrap;
}

// ------------------------------------------------------------------ the report list

const FY_START = () => { const t = todayIst(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)); return `${m >= 4 ? y : y - 1}-04-01`; };
const REPORTS = [
  { id: 'pnl', name: 'Profit and Loss', sec: 'Business overview', kind: 'pnl', range: true, basis: true },
  { id: 'pnl-compare', name: 'Profit and Loss Comparison', sec: 'Business overview', kind: 'pnl', compare: true, range: true, basis: true },
  { id: 'pnl-month', name: 'Profit and Loss by Month', sec: 'Business overview', kind: 'table', range: true, basis: true, fy: true, path: (q) => `/api/accounting/reports/pnl-periods?from=${q.from}&to=${q.to}&by=month&basis=${q.basis}`, file: 'profit-and-loss-by-month' },
  { id: 'pnl-quarter', name: 'Quarterly Profit and Loss Summary', sec: 'Business overview', kind: 'table', range: true, basis: true, fy: true, path: (q) => `/api/accounting/reports/pnl-periods?from=${q.from}&to=${q.to}&by=quarter&basis=${q.basis}`, file: 'profit-and-loss-quarterly' },
  { id: 'pnl-pct', name: 'Profit and Loss as % of total income', sec: 'Business overview', kind: 'pnl', pct: true, range: true, basis: true },
  { id: 'pnl-ytd', name: 'Profit and Loss year-to-date', sec: 'Business overview', kind: 'pnl', range: true, basis: true, fy: true },
  { id: 'bs', name: 'Balance Sheet', sec: 'Business overview', kind: 'bs', asOf: true },
  { id: 'tb', name: 'Trial Balance', sec: 'Business overview', kind: 'tb', asOf: true },
  { id: 'cashflow', name: 'Statement of Cash Flows', sec: 'Business overview', tab: 'cashflow' },
  { id: 'ledger', name: 'General Ledger', sec: 'Business overview', kind: 'ledger', range: true, fy: true },
  { id: 'audit', name: 'Audit Log', sec: 'Business overview', kind: 'table', range: true, days: 30, path: (q) => `/api/accounting/reports/audit-log?from=${q.from}&to=${q.to}`, file: 'audit-log' },
  { id: 'cb-sum', name: 'Customer Balance Summary (aging)', sec: 'Who owes you', kind: 'table', asOf: true, path: (q) => `/api/accounting/reports/customer-balances?asOf=${q.to}`, file: 'customer-balance-summary' },
  { id: 'cb-det', name: 'Customer Balance Detail', sec: 'Who owes you', kind: 'table', asOf: true, path: (q) => `/api/accounting/reports/customer-balances?asOf=${q.to}&view=detail`, file: 'customer-balance-detail' },
  { id: 'past', name: 'Sessions played', sec: 'Bookings', kind: 'sched', range: true, month: true, path: (q) => `/api/accounting/reports/schedule/past?from=${q.from}&to=${q.to}`, file: 'sessions-played' },
  { id: 'future', name: 'Upcoming bookings', sec: 'Bookings', kind: 'sched', future: true, path: () => '/api/accounting/reports/schedule/future?', file: 'upcoming-bookings' },
  { id: 'gst', name: 'GST Summary', sec: 'Taxes, budgets and assets', tab: 'gst' },
  { id: 'budget', name: 'Budget against actual', sec: 'Taxes, budgets and assets', tab: 'budget' },
  { id: 'assets', name: 'Fixed Asset Register', sec: 'Taxes, budgets and assets', tab: 'assets' },
];
const SECTIONS = ['Business overview', 'Who owes you', 'Bookings', 'Taxes, budgets and assets'];

const favs = {
  get() { try { return JSON.parse(localStorage.getItem('daji.reportFavs') || '[]'); } catch { return []; } },
  set(list) { try { localStorage.setItem('daji.reportFavs', JSON.stringify(list)); } catch { /* private window: favourites last until the page closes */ } },
};

function reportsCatalog(view) {
  const open = D.state.reportOpen; D.state.reportOpen = null;
  if (open && REPORTS.some((r) => r.id === open)) return reportViewer(view, REPORTS.find((r) => r.id === open));
  let tab = 'standard'; const q = h('input', { type: 'search', placeholder: 'Type report name here', 'aria-label': 'Find a report' });
  const body = h('div'), tabs = h('div', { class: 'bkseg' });
  const draw = () => {
    clear(body); clear(tabs);
    for (const [id, l] of [['standard', 'Standard reports'], ['mgmt', 'Management reports']]) tabs.append(h('button', { type: 'button', class: id === tab ? 'on' : null, onclick: () => { tab = id; draw(); } }, l));
    const needle = q.value.trim().toLowerCase(), mine = favs.get();
    const list = REPORTS.filter((r) => (tab === 'mgmt' ? ['gst', 'budget', 'assets', 'cashflow', 'audit', 'past', 'future'].includes(r.id) : true) && (!needle || r.name.toLowerCase().includes(needle)));
    const rowOf = (r) => h('div', { class: 'bkrep' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); if (r.tab) goTab(r.tab); else { D.state.reportOpen = r.id; goTab('reports'); } } }, r.name),
      h('button', { type: 'button', class: 'bkstar' + (mine.includes(r.id) ? ' on' : ''), title: mine.includes(r.id) ? 'Remove from favorites' : 'Add to favorites', 'aria-label': 'Favorite', 'aria-pressed': String(mine.includes(r.id)), onclick: () => { favs.set(mine.includes(r.id) ? mine.filter((x) => x !== r.id) : [...mine, r.id]); draw(); } }, icon(ICON.star, 18)));
    const block = (title, rs) => { if (!rs.length) return; const g = h('div', { class: 'bkrep-g' }, rs.map(rowOf)); const head = h('button', { type: 'button', class: 'bkfold-h', onclick: () => { g.hidden = !g.hidden; head.classList.toggle('shut', g.hidden); } }, icon(ICON.down, 16), h('b', {}, title)); body.append(h('div', { class: 'bkcard bkfold' }, head, g)); };
    block('Favorites', list.filter((r) => mine.includes(r.id)));
    for (const s of SECTIONS) block(s, list.filter((r) => r.sec === s));
    if (!list.length) body.append(h('div', { class: 'empty' }, 'No report has that name.'));
  };
  q.addEventListener('input', draw);
  view.append(tabs, h('div', { class: 'bkfind' }, q), body); draw();
}

// ------------------------------------------------------------------ one report

function reportViewer(view, def) {
  if (def.tab) return goTab(def.tab);
  const t = todayIst();
  const preset = sel([['month', 'This month'], ['last', 'Last month'], ['fy', 'This financial year'], ['lastfy', 'Last financial year'], ['custom', 'Custom']], def.fy ? 'fy' : def.days ? 'custom' : 'month');
  const from = h('input', { type: 'date', value: def.fy ? FY_START() : def.days ? addDays(t, -def.days) : t.slice(0, 8) + '01' }), to = h('input', { type: 'date', value: t });
  const basis = sel([['accrual', 'Accrual (sessions played)'], ['cash', 'Cash (money received)']], 'accrual');
  const account = h('select', {});
  const out = h('div');
  const setPreset = () => {
    const v = preset.value, m = curMonth();
    if (v === 'month') { from.value = m + '-01'; to.value = t; }
    else if (v === 'last') { const lm = monthAdd(m, -1); from.value = lm + '-01'; to.value = lastDayOf(lm); }
    else if (v === 'fy') { from.value = FY_START(); to.value = t; }
    else if (v === 'lastfy') { const s = FY_START(); from.value = `${Number(s.slice(0, 4)) - 1}-04-01`; to.value = `${s.slice(0, 4)}-03-31`; }
  };
  const q = () => ({ from: from.value, to: def.asOf ? (to.value > t ? t : to.value) : to.value, basis: basis.value });
  const fileName = () => `${def.file || def.id}-${def.asOf ? q().to : q().from + '-to-' + q().to}`;
  const path = () => {
    const x = q();
    if (def.path) return def.path(x);
    if (def.kind === 'pnl') return `/api/accounting/reports/pnl?from=${x.from}&to=${x.to}&basis=${x.basis}` + (def.compare ? '&compare=1' : '');
    if (def.kind === 'bs') return `/api/accounting/reports/balance-sheet?asOf=${x.to}`;
    if (def.kind === 'tb') return `/api/accounting/reports/trial-balance?asOf=${x.to}`;
    if (def.kind === 'ledger') return `/api/accounting/reports/ledger?account=${encodeURIComponent(account.value)}&from=${x.from}&to=${x.to}`;
    return '';
  };
  const run = async () => {
    if (def.range && (!from.value || !to.value || to.value < from.value)) { clear(out).append(h('div', { class: 'empty' }, 'Choose a start date that is not after the end date.')); return; }
    if (def.kind === 'ledger' && !account.value) { clear(out).append(h('div', { class: 'empty' }, 'Choose an account.')); return; }
    const r = await load(out, () => api(path()));
    if (!r) return;
    const x = def.kind === 'pnl' ? pnlTable(r, def) : def.kind === 'bs' ? bsView(r) : def.kind === 'tb' ? tbView(r) : def.kind === 'table' ? genericTable(r) : def.kind === 'ledger' ? ledgerTable(r) : schedTable(r);
    out.append(x);
  };
  const controls = [];
  if (def.range) controls.push(fieldBox('Period', preset), fieldBox('From', from), fieldBox('To', to));
  if (def.asOf) controls.push(fieldBox('As of', to));
  if (def.basis) controls.push(fieldBox('Basis', basis));
  if (def.kind === 'ledger') controls.push(fieldBox('Account', account));
  const listen = (c, fn) => c.addEventListener('change', fn);
  listen(preset, () => { setPreset(); run(); }); listen(from, () => { preset.value = 'custom'; run(); }); listen(to, () => { if (def.range) preset.value = 'custom'; run(); }); listen(basis, run); listen(account, run);
  const head = h('div', { class: 'bkrephead' }, h('button', { type: 'button', class: 'bkback bk-noprint', onclick: () => goTab('reports') }, icon(ICON.back, 16), 'Reports'), h('h3', {}, def.name),
    def.future || path() ? exportTools(path, fileName) : null);
  view.append(head, h('div', { class: 'bkcard' }, h('div', { class: 'bk-noprint' }, bar(...controls)), out));
  if (def.kind === 'ledger') api('/api/accounting/journal-accounts').then((r) => { for (const a of r.items) account.append(h('option', { value: a.code }, a.name)); run(); }).catch(fail); else run();
}

const num = (p) => money(p);
/** Any {columns, rows, notes} report from the server. Amounts arrive in paise. */
function genericTable(r) {
  const nums = r.columns.map((c, i) => (c.money ? i : -1)).filter((i) => i >= 0);
  const rows = r.rows.map((x) => ({ cls: x.kind === 'head' ? 'grp' : x.kind === 'sub' ? 'sub' : x.kind === 'net' ? 'net' : null, cells: x.cells.map((v, i) => (v === null || v === '' ? '' : r.columns[i].money && typeof v === 'number' ? num(v) : String(v))) }));
  return h('div', {}, h('p', { class: 'hint' }, r.sub), dt(r.columns.map((c) => c.label), rows, { nums, empty: 'Nothing to show for this period.' }), ...r.notes.map((n) => h('p', { class: 'hint' }, n)));
}

/** Profit and loss: plain, with the earlier period beside it, or each line as a share of total income. */
function pnlTable(p, def) {
  const cmp = !!def.compare && p.previous, pct = !!def.pct, inc = p.revenue.totalPaise;
  const share = (v) => (inc ? `${(Math.round((v / inc) * 1000) / 10).toFixed(1)}%` : '');
  const rows = [];
  const part = (title, sec) => {
    rows.push({ cls: 'grp', cells: [title, '', ...(cmp ? ['', ''] : [])] });
    for (const g of sec.groups) {
      rows.push({ cls: 'grp2', cells: [g.name, '', ...(cmp ? ['', ''] : [])] });
      for (const r of g.rows) rows.push([r.name, money(r.paise), ...(pct ? [share(r.paise)] : []), ...(cmp ? [money(r.previousPaise || 0), money(r.paise - (r.previousPaise || 0))] : [])]);
      rows.push({ cls: 'sub', cells: [`Total ${g.name.toLowerCase()}`, money(g.totalPaise), ...(pct ? [share(g.totalPaise)] : []), ...(cmp ? [money(g.previousTotalPaise || 0), money(g.totalPaise - (g.previousTotalPaise || 0))] : [])] });
    }
    rows.push({ cls: 'sub', cells: [`Total ${title.toLowerCase()}`, money(sec.totalPaise), ...(pct ? [share(sec.totalPaise)] : []), ...(cmp ? [money(sec.previousTotalPaise || 0), money(sec.totalPaise - (sec.previousTotalPaise || 0))] : [])] });
  };
  part('Revenue', p.revenue); part('Expenses', p.expenses);
  rows.push({ cls: 'net', cells: ['Net profit', money(p.netProfitPaise), ...(pct ? [share(p.netProfitPaise)] : []), ...(cmp ? [money(p.previousNetProfitPaise || 0), money(p.netProfitPaise - (p.previousNetProfitPaise || 0))] : [])] });
  const heads = ['', 'Amount', ...(pct ? ['% of income'] : []), ...(cmp ? [`Before: ${niceDate(p.previous.range.from)} to ${niceDate(p.previous.range.to)}`, 'Change'] : [])];
  const nums = heads.map((_, i) => i).filter((i) => i > 0);
  return h('div', {}, h('p', { class: 'hint' }, `${niceDate(p.range.from)} to ${niceDate(p.range.to)}, ${p.basis} basis` + (p.marginPercent !== null ? `. Margin ${p.marginPercent}%` : '')),
    dt(heads, rows, { nums }), p.uncategorised.count ? h('p', { class: 'hint err' }, `${p.uncategorised.count} bank transactions in this period have no category yet, so the profit is not complete.`) : null, ...p.notes.map((n) => h('p', { class: 'hint' }, n)));
}

function ledgerTable(l) {
  const rows = [{ cls: 'grp', cells: ['', 'Opening balance', '', '', money(l.openingPaise)] }];
  for (const e of l.entries) rows.push([niceDate(e.date), e.description || e.memo || '', e.debitPaise ? inr(e.debitPaise) : '', e.creditPaise ? inr(e.creditPaise) : '', money(e.balancePaise)]);
  rows.push({ cls: 'net', cells: ['', 'Closing balance', '', '', money(l.closingPaise)] });
  return h('div', {}, h('p', { class: 'hint' }, `${l.account.name}: ${niceDate(l.range.from)} to ${niceDate(l.range.to)}`), dt(['Date', 'Description', 'Debit', 'Credit', 'Balance'], rows, { nums: [2, 3, 4] }));
}

function schedTable(s) {
  const sm = s.summary || {};
  const note = s.summary && 'bookings' in sm ? `${sm.bookings} bookings, ${inr(sm.valuePaise)} in total, ${inr(sm.paidPaise)} paid, ${inr(sm.duePaise)} still due.` : '';
  const rows = s.items.map((r) => [niceDate(r.date), `${r.startTime} – ${r.endTime}`, r.ref, r.customerName, r.groundName, String(r.kind).replace(/_/g, ' '), inr(r.totalPaise), inr(r.paidPaise), inr(r.duePaise)]);
  return h('div', {}, h('p', { class: 'hint' }, `${niceDate(s.range.from)} to ${niceDate(s.range.to)}. ${note}`),
    dt(['Date', 'Time', 'Ref', 'Customer', 'Ground', 'Status', 'Total', 'Paid', 'Due'], rows, { nums: [6, 7, 8], empty: 'No bookings in this period.' }),
    s.total > s.items.length ? h('p', { class: 'hint' }, `Showing ${s.items.length} of ${s.total}. Download for the full list.`) : null, ...(s.notes || []).map((n) => h('p', { class: 'hint' }, n)));
}


// ------------------------------------------------------------------ transactions and receipts

function txns(view) {
  const f = Object.assign({ accountId: '', categorised: '', direction: '', q: '', from: '', to: '' }, D.state.txnFilter || {}); D.state.txnFilter = null;
  // Pending = waiting for a category; Posted = categorised or matched to a booking; All
  let tab = D.state.txnTab || (f.categorised === 'no' ? 'pending' : f.categorised === 'yes' ? 'posted' : 'pending'); D.state.txnTab = null;
  let accountId = f.accountId, offset = 0; const LIMIT = 50;
  const cards = h('div', { class: 'bkacctcards' }), tabs = h('div', { class: 'bkseg' }), list = h('div'), summary = h('div', { class: 'bkmute' });
  const ctl = { q: h('input', { type: 'search', placeholder: 'Search', value: f.q, 'aria-label': 'Search description' }), from: h('input', { type: 'date', value: f.from, 'aria-label': 'From date' }), to: h('input', { type: 'date', value: f.to, 'aria-label': 'To date' }),
    dir: sel([['', 'All transactions'], ['in', 'Money in'], ['out', 'Money out']], f.direction) };
  const status = () => (tab === 'pending' ? 'no' : tab === 'posted' ? 'yes' : '');
  const query = () => { const p = new URLSearchParams({ limit: LIMIT, offset }); const m = { accountId, categorised: status(), direction: ctl.dir.value, q: ctl.q.value.trim(), from: ctl.from.value, to: ctl.to.value }; for (const [k, v] of Object.entries(m)) if (v) p.set(k, v); return p.toString(); };
  const drawCards = () => {
    clear(cards);
    const one = (id, name, balance, n) => h('button', { type: 'button', class: 'bkacctcard' + (accountId === id ? ' on' : ''), onclick: () => { accountId = id; offset = 0; drawCards(); run(); } },
      h('div', { class: 'bkacctcard-t' }, h('span', {}, name), n ? h('em', {}, String(n)) : h('em', { class: 'ok' }, '✓')), h('b', {}, balance));
    cards.append(one('', 'All accounts', inr(shared.accounts.reduce((s, a) => s + a.balancePaise, 0)), shared.accounts.reduce((s, a) => s + a.uncategorised, 0)));
    for (const a of shared.accounts) cards.append(one(a.id, a.name, inr(a.balancePaise), a.uncategorised));
  };
  const drawTabs = () => {
    clear(tabs);
    for (const [id, label] of [['pending', 'Pending'], ['posted', 'Posted'], ['all', 'All']]) tabs.append(h('button', { type: 'button', class: id === tab ? 'on' : null, onclick: () => { tab = id; offset = 0; drawTabs(); run(); } }, label));
  };
  const run = async (reset = true) => {
    if (reset) offset = 0;
    const r = await load(list, () => api('/api/accounting/transactions?' + query()));
    if (!r) return;
    let counts = {};
    try { counts = await api('/api/accounting/attachment-counts', { method: 'POST', body: { entity: 'transaction', ids: r.items.map((t) => t.id) } }); } catch { /* the paperclips are a convenience */ }
    summary.textContent = `${r.total} transaction${r.total === 1 ? '' : 's'}.  Received ${inr(r.moneyInPaise)}  ·  Spent ${inr(Math.abs(r.moneyOutPaise))}`;
    const rows = r.items.map((t) => {
      const cat = t.paymentId ? h('span', { class: 'chip ok' }, 'Matched to a booking') : h('select', { class: 'inl', onchange: async (e) => { try { await api('/api/accounting/transactions/' + t.id, { method: 'PATCH', body: { categoryId: e.target.value || null } }); toast('Saved'); await loadShared(); drawCards(); run(false); } catch (er) { fail(er); } } },
        catOptions('Select category').map(([v, l]) => h('option', { value: v, selected: v === (t.categoryId || '') ? true : null }, l)));
      return [niceDate(t.date), h('span', {}, t.description, t.reference ? h('small', { class: 'mono sub' }, ' ' + t.reference) : null),
        t.amountPaise < 0 ? inr(-t.amountPaise) : '', t.amountPaise > 0 ? inr(t.amountPaise) : '', btn(counts[t.id] ? `Files (${counts[t.id]})` : 'Add file', () => filesDialog('transaction', t.id, t.description, () => run(false)), 'ghost sm'), cat];
    });
    list.append(dt(['Date', 'Bank description', 'Spent', 'Received', 'Receipt', 'Category'], rows, { nums: [2, 3], empty: tab === 'pending' ? 'Nothing is waiting. Every transaction here has a category.' : 'No transactions match.' }),
      bar(btn('Previous', () => { offset = Math.max(0, offset - LIMIT); run(false); }, 'ghost sm'), h('span', { class: 'hint' }, `${r.total ? offset + 1 : 0} to ${Math.min(offset + LIMIT, r.total)} of ${r.total}`), btn('Next', () => { if (offset + LIMIT < r.total) { offset += LIMIT; run(false); } }, 'ghost sm')));
  };
  load(view, loadShared).then((ok) => {
    if (ok === null) return;
    drawCards(); drawTabs();
    for (const c of Object.values(ctl)) c.addEventListener(c.tagName === 'INPUT' && c.type === 'search' ? 'input' : 'change', () => { clearTimeout(txns.t); txns.t = setTimeout(run, 250); });
    view.append(
      bar(h('div', { class: 'dls' }, btn('Add a transaction', () => addTxnDialog(() => loadShared().then(() => { drawCards(); run(); })), 'primary sm'), btn('Move money', () => transferDialog(() => loadShared().then(() => { drawCards(); run(); })), 'outline sm'))),
      cards, tabs,
      h('div', { class: 'bkcard bktable' }, h('div', { class: 'bktool' }, ctl.q, ctl.from, ctl.to, ctl.dir, summary, exportTools(() => '/api/accounting/transactions/export?' + query(), () => 'bank-transactions')), list));
    run();
  });
}


function addTxnDialog(done) {
  const err = h('div', { class: 'fe' });
  const acct = sel(shared.accounts.map((a) => [a.id, a.name]), '');
  const dir = sel([['out', 'Money out (spent)'], ['in', 'Money in (received)']], 'out');
  const date = h('input', { type: 'date', value: todayIst(), max: addDays(todayIst(), 1) }), amt = h('input', { inputmode: 'decimal', placeholder: '2500.00' }), desc = h('input', { placeholder: 'What was it for?' }), cat = sel(catOptions('Decide later'), '');
  const go = async (e) => {
    e.preventDefault(); err.textContent = '';
    const p = rupeesToPaise(amt.value); if (!p || p <= 0) { err.textContent = 'Enter the amount in rupees, like 2500 or 2500.50.'; return; }
    try { await api('/api/accounting/transactions', { method: 'POST', body: { accountId: acct.value, date: date.value, amountPaise: dir.value === 'out' ? -p : p, description: desc.value.trim(), categoryId: cat.value || undefined } }); closeModal(); toast('Added'); done(); }
    catch (er) { err.textContent = er.message; }
  };
  if (!shared.accounts.length) { openModal([h('h3', {}, 'Add a transaction'), h('p', { class: 'hint' }, 'Add a bank or cash account first, under Setup.')]); return; }
  openModal([h('h3', {}, 'Add a transaction'), h('p', { class: 'hint' }, 'For cash spent at the ground or money the bank statement will not show.'),
    h('form', { onsubmit: go }, fieldBox('Account', acct), fieldBox('Type', dir), fieldBox('Date', date), fieldBox('Amount (₹)', amt), fieldBox('Description', desc), fieldBox('Category', cat), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Save'))]);
}

/** The live bank feed: link a books account to its bank account at the provider, then pull new transactions. */
async function feedPanel(box, onAccount) {
  let f; try { f = await api('/api/accounting/feed'); } catch { return; }
  const addBtn = onAccount ? btn('Add a bank account', () => accountDialog(onAccount), 'primary sm') : null;
  if (!f.provider) { box.append(section('Bank feed', h('p', { class: 'hint', style: 'margin:0 0 12px' }, 'Not connected on this server. Until it is, load statements below. When a feed provider is set up, new bank transactions will arrive here by themselves each day.'), addBtn)); return; }
  const rows = f.accounts.map((a) => {
    const ref = h('input', { placeholder: 'Account id at the provider', value: a.providerRef ? a.providerRef.slice(a.providerRef.indexOf(':') + 1) : '' });
    const act = async (fn, msg) => { try { const r = await fn(); toast(msg(r)); clear(box); feedPanel(box, onAccount); } catch (e) { fail(e); } };
    return h('div', { class: 'li', style: 'flex-wrap:wrap;gap:8px' }, h('span', {}, a.name, h('small', { class: 'sub' }, a.lastSyncAt ? ` last pulled ${niceDate(new Date(a.lastSyncAt + 330 * 60000).toISOString().slice(0, 10))}${a.lastOk === false ? ', failed: ' + a.lastMessage : ''}` : '')), ref,
      btn(a.providerRef ? 'Save link' : 'Link', () => act(() => api('/api/accounting/feed/link', { method: 'POST', body: { accountId: a.id, providerRef: ref.value.trim() } }), () => 'Linked'), 'outline sm'),
      a.providerRef ? btn('Pull now', () => act(() => api('/api/accounting/feed/sync', { method: 'POST', body: { accountId: a.id } }), (r) => `${r.rowsNew} new, ${r.rowsDuplicate} already there`), 'primary sm') : null);
  });
  box.append(section(`Bank feed (${f.provider})`, f.provider === 'demo' ? h('p', { class: 'hint' }, 'Demo feed: made-up transactions so you can see how it works.') : null, rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'hint' }, 'Add a bank account first.'), h('div', { style: 'margin-top:12px' }, addBtn)));
}

/** The receipts and documents attached to one transaction or journal entry. */
async function filesDialog(entity, id, title, done) {
  const box = h('div'); const err = h('div', { class: 'fe' });
  const refresh = async () => {
    clear(box);
    try {
      const r = await api(`/api/accounting/attachments?entity=${entity}&id=${encodeURIComponent(id)}`);
      if (!r.items.length) box.append(h('div', { class: 'empty' }, 'No files yet.'));
      for (const a of r.items) box.append(h('div', { class: 'li file' }, h('span', {}, a.filename, h('small', { class: 'sub' }, ` ${(a.sizeBytes / 1024).toFixed(0)} KB`)),
        h('span', { class: 'acts' }, btn('Download', () => apiDownload(`/api/accounting/attachments/${a.id}/file`, a.filename).catch(fail), 'ghost sm'),
          btn('Remove', async () => { try { await api('/api/accounting/attachments/' + a.id, { method: 'DELETE' }); refresh(); done && done(); } catch (e) { fail(e); } }, 'ghost sm'))));
    } catch (e) { box.append(h('div', { class: 'empty' }, e.message)); }
  };
  const pick = h('input', { type: 'file', accept: 'application/pdf,image/png,image/jpeg,image/webp', hidden: true, onchange: async () => {
    const f = pick.files[0]; if (!f) return; err.textContent = '';
    if (f.size > 5 * 1024 * 1024) { err.textContent = 'Files can be at most 5 MB.'; return; }
    try { await apiFile(`/api/accounting/attachments?entity=${entity}&id=${encodeURIComponent(id)}&filename=${encodeURIComponent(f.name)}`, f); pick.value = ''; refresh(); done && done(); toast('File attached'); }
    catch (e) { err.textContent = e.message; }
  } });
  openModal([h('h3', {}, 'Receipts and documents'), h('p', { class: 'hint' }, title), box, err, pick, btn('Attach a PDF or photo', () => pick.click(), 'primary sm'), h('p', { class: 'hint', style: 'margin-top:14px' }, 'PDF, PNG, JPEG or WebP, up to 5 MB each, ten per entry.')]);
  refresh();
}

// ------------------------------------------------------------------ bank statement import

let pendingStatement = null;
function importer(view) {
  const feedBox = h('div'); view.append(feedBox); const rerender = () => { clear(view); importer(view); }; feedPanel(feedBox, rerender);
  const pane = h('div'); view.append(pane);
  load(pane, loadShared).then(() => {
    const banks = shared.accounts;
    const none = !banks.length;
    const acct = sel(banks.length ? banks.map((a) => [a.id, a.name]) : [['', 'No bank account yet']], ''), file = h('input', { type: 'file', accept: '.pdf,.csv,.xlsx,application/pdf,text/csv', style: 'display:none' });
    const pass = h('input', { type: 'password', placeholder: 'PDF password', autocomplete: 'off', style: 'max-width:220px' });
    const passBox = h('div', { hidden: true, style: 'margin-top:12px' }, fieldBox('This PDF is password protected', pass));
    const result = h('div'), history = h('div');
    const drop = h('div', { class: 'dropzone', tabindex: '0', role: 'button', style: 'border:1.5px dashed var(--outline,#555);border-radius:12px;padding:22px;text-align:center;cursor:pointer' },
      h('b', {}, 'Drop a statement here, or click to choose'), h('div', { class: 'hint', style: 'margin-top:4px' }, 'PDF, Excel or CSV. It is read the moment you choose it.'));
    let cur = null, seq = 0;
    const opts = () => (pass.value ? { headers: { 'x-statement-password': pass.value } } : {});
    const url = (f, extra) => `/api/accounting/imports?accountId=${acct.value}&filename=${encodeURIComponent(f.name)}${extra}`;
    const read = async (f) => {
      if (!f) return; cur = f; const mine = ++seq;
      if (none) { pendingStatement = f; clear(result).append(h('p', { class: 'hint' }, 'Add the bank account this statement belongs to, and it will be read straight away.')); accountDialog(rerender); return; }
      if (f.size > 16 * 1024 * 1024) { clear(result).append(h('p', { class: 'hint err' }, 'That file is over 16 MB. Download the statement in smaller periods.')); return; }
      clear(result).append(h('div', { class: 'skeleton' }, `Reading ${f.name}…`));
      try {
        const r = await apiFile(url(f, '&dryRun=1'), f, opts());
        if (mine !== seq) return; passBox.hidden = true; show(f, r);
      } catch (e) {
        if (mine !== seq) return;
        if (e.code === 'PDF_PASSWORD_REQUIRED' || e.code === 'PDF_PASSWORD_WRONG') { passBox.hidden = false; pass.focus(); }
        clear(result).append(h('p', { class: 'hint err' }, e.message), e.code && e.code.startsWith('PDF_PASSWORD') ? btn('Open with this password', () => read(cur), 'primary sm') : null);
      }
    };
    const show = (f, r) => {
      const ok = r.reconcile && r.reconcile.checked > 0 && r.reconcile.mismatched === 0;
      const confirm = h('input', { type: 'checkbox' });
      const go = btn(`Import ${r.rowsNew} new transaction${r.rowsNew === 1 ? '' : 's'}`, () => commit(f, confirm.checked), 'primary');
      if (r.reviewRequired) { go.disabled = true; confirm.onchange = () => { go.disabled = !confirm.checked; }; }
      const tag = { new: 'New', duplicate: 'Already have', locked: 'Month closed' };
      clear(result).append(h('div', { class: 'box inner' },
        h('div', { class: 'eyebrow', style: 'margin-bottom:10px' }, `Preview of ${f.name}. Nothing is saved yet`),
        r.reconcile && r.reconcile.checked ? h('p', { class: ok ? 'hint' : 'hint err', style: 'font-weight:600' }, ok ? `Balance check passed: all ${r.reconcile.checked} rows agree with the balance column.` : `Balance check failed on ${r.reconcile.mismatched} of ${r.reconcile.checked} rows (first at line ${r.reconcile.firstBadLine}).`) : null,
        h('div', { class: 'list' }, h('div', { class: 'li' }, h('span', {}, 'Period'), h('b', {}, r.periodFrom ? `${niceDate(r.periodFrom)} to ${niceDate(r.periodTo)}` : '')),
          h('div', { class: 'li' }, h('span', {}, 'New transactions'), h('b', {}, r.rowsNew)), h('div', { class: 'li' }, h('span', {}, 'Already in your books'), h('b', {}, r.rowsDuplicate)),
          h('div', { class: 'li' }, h('span', {}, 'Lines not read'), h('b', {}, r.rowsSkipped)), h('div', { class: 'li' }, h('span', {}, 'Will be categorised by your rules'), h('b', {}, r.categorisedByRules))),
        ...r.warnings.map((w) => h('p', { class: 'hint err' }, w)),
        dt(['Date', 'Description', 'Amount', 'Balance', ''], r.preview.map((x) => [niceDate(x.date), x.description, money(x.amountPaise), x.balancePaise == null ? '' : money(x.balancePaise), tag[x.status]]), { nums: [2, 3] }),
        r.rowsTotal > r.preview.length ? h('p', { class: 'hint' }, `Showing the first ${r.preview.length} rows. All rows are imported.`) : null,
        r.skipped.length ? h('p', { class: 'hint' }, 'Not read: ' + r.skipped.slice(0, 5).map((s) => `line ${s.line} (${s.reason})`).join(', ') + (r.skipped.length > 5 ? '…' : '')) : null,
        r.reviewRequired ? h('label', { class: 'hint', style: 'display:flex;gap:8px;align-items:center;margin:12px 0' }, confirm, 'I have checked the rows above against my statement') : null,
        r.rowsNew ? go : h('p', { class: 'hint' }, 'Nothing new to import.')));
    };
    const commit = async (f, confirmed) => {
      try {
        const r = await apiFile(url(f, confirmed ? '&confirm=1' : ''), f, opts());
        clear(result).append(h('p', { class: 'hint' }, `Imported ${r.rowsNew} transactions. ${r.autoMatched} UPI or bank payments were matched to bookings automatically.`));
        file.value = ''; pass.value = ''; cur = null; toast('Statement imported'); loadHistory();
      } catch (e) { toast(e.message, true); }
    };
    file.onchange = () => read(file.files[0]);
    drop.onclick = () => file.click();
    drop.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); file.click(); } };
    drop.ondragover = (ev) => { ev.preventDefault(); drop.style.background = 'rgba(255,255,255,.05)'; };
    drop.ondragleave = () => { drop.style.background = ''; };
    drop.ondrop = (ev) => { ev.preventDefault(); drop.style.background = ''; read(ev.dataTransfer.files[0]); };
    acct.onchange = () => { if (cur) read(cur); };
    const loadHistory = async () => {
      clear(history);
      try {
        const r = await api('/api/accounting/imports');
        history.append(dt(['Loaded', 'File', 'Account', 'New', 'Skipped duplicates', ''], r.items.map((i) => [niceDate(new Date(i.createdAt + 330 * 60000).toISOString().slice(0, 10)), i.filename || '', i.accountName, i.rowsNew, i.rowsDuplicate,
          i.undoneAt ? h('span', { class: 'chip' }, 'Undone') : btn('Undo', async () => { try { const x = await api(`/api/accounting/imports/${i.id}/undo`, { method: 'POST', body: {} }); toast(`Removed ${x.removed} transactions`); loadHistory(); } catch (e) { fail(e); } }, 'ghost sm')]), { nums: [3, 4], empty: 'No statements loaded yet.' }));
      } catch (e) { history.append(h('div', { class: 'empty' }, e.message)); }
    };
    pane.append(section('Load a bank statement', h('p', { class: 'hint', style: 'margin:0 0 16px' }, 'For banks with no bank feed: download the statement as PDF, Excel or CSV and drop it here. It is read straight away and checked against the balance column, and you see a preview first. Loading the same lines twice is safe: they are recognised and skipped.'),
      bar(fieldBox('Bank account', acct)), h('div', { style: 'margin-top:12px' }, drop, file), passBox, h('div', { style: 'margin-top:14px' }, result)),
      section('Statements loaded', history));
    loadHistory();
    if (pendingStatement && !none) { const f = pendingStatement; pendingStatement = null; read(f); }
  });
}

// ------------------------------------------------------------------ reconciliation

function recon(view) {
  const pane = h('div'); view.append(pane);
  const run = async () => {
    const r = await load(pane, () => api('/api/accounting/reconcile'));
    if (!r) return;
    const checks = dt(['Account', 'Books say', 'Last statement says', 'Difference', 'Uncategorised'], r.accounts.map((a) => [a.name, inr(a.booksBalancePaise), a.statementBalancePaise === null ? 'No statement balance' : `${inr(a.statementBalancePaise)} on ${niceDate(a.statementDate)}`,
      a.differencePaise === null ? '' : a.differencePaise === 0 ? h('span', { class: 'chip ok' }, 'Matches') : h('span', { class: 'chip bad' }, (a.differencePaise < 0 ? '−' : '+') + inr(Math.abs(a.differencePaise))), a.uncategorised]), { nums: [1, 2, 3, 4], empty: 'No bank accounts yet.' });
    const queue = r.rows.length ? r.rows.map((x) => h('div', { class: 'rec' },
      h('div', { class: 'l' }, h('b', {}, `${inr(x.amountPaise)}  ·  ${niceDate(x.date)}`), h('div', { class: 'sub' }, x.description), h('small', { class: 'sub' }, x.accountName)),
      h('div', { class: 'r' }, x.candidates.length ? x.candidates.map((c) => h('div', { class: 'cand' }, h('span', {}, `${c.customerName || 'Customer'}  ·  ${c.method === 'upi' ? 'UPI' : 'Bank transfer'}  ·  paid ${niceDate(c.paidOn)}`, h('span', { class: 'chip ' + (c.strength === 'utr' ? 'ok' : '') }, c.strength === 'utr' ? 'UTR matches' : 'Same amount')),
        btn('Match', async () => { try { await api(`/api/accounting/transactions/${x.txnId}/match`, { method: 'POST', body: { paymentId: c.paymentId } }); toast('Matched'); run(); } catch (e) { fail(e); } }, 'primary sm'))) : h('span', { class: 'hint' }, 'No booking payment of this amount. It may be a deposit that is not a booking: categorise it under Transactions.')))) :
      [h('div', { class: 'empty' }, 'Every bank deposit is matched or categorised.')];
    pane.append(section('Do the books agree with the bank?', checks),
      section(`Deposits waiting to be matched (${r.rows.length})`, h('p', { class: 'hint', style: 'margin:0 0 14px' }, `${r.unmatchedPayments} UPI or bank-transfer booking payments have no bank deposit yet. Matching is automatic after every statement import when the 12-digit UTR and the amount agree. Anything less certain is shown here for you to confirm.`),
        bar(btn('Run automatic matching', async () => { try { const x = await api('/api/accounting/reconcile/auto', { method: 'POST', body: {} }); toast(`${x.matched} matched, ${x.left} left`); run(); } catch (e) { fail(e); } }, 'primary sm')), ...queue));
  };
  run();
}

// ------------------------------------------------------------------ recurring entries

function recurring(view) {
  const pane = h('div'); view.append(pane);
  const FREQ = { weekly: 'Every week', monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' };
  const run = async () => {
    const r = await load(pane, async () => { await loadShared(); return api('/api/accounting/recurring'); });
    if (!r) return;
    pane.append(section('Recurring entries', h('p', { class: 'hint', style: 'margin:0 0 14px' }, 'Rent, salaries, loan instalments and other regular amounts are posted for you on their due dates. Months you have signed off are never changed.'),
      bar(btn('Add a recurring entry', () => recDialog(run), 'primary sm'), btn('Post what is due now', async () => { try { const x = await api('/api/accounting/recurring/run', { method: 'POST', body: {} }); toast(`${x.posted} posted` + (x.skippedLocked ? `, ${x.skippedLocked} skipped (month signed off)` : '')); run(); } catch (e) { fail(e); } }, 'outline sm')),
      dt(['What', 'Account', 'How often', 'Next', 'Amount', ''], r.items.map((i) => [h('span', {}, i.description, i.active ? null : h('span', { class: 'chip', style: 'margin-left:8px' }, 'Paused')), i.accountName, FREQ[i.frequency], i.nextDate ? niceDate(i.nextDate) : 'Finished', money(i.amountPaise),
        h('span', { class: 'acts' }, btn(i.active ? 'Pause' : 'Resume', async () => { try { await api('/api/accounting/recurring/' + i.id, { method: 'PATCH', body: { active: !i.active } }); run(); } catch (e) { fail(e); } }, 'ghost sm'),
          btn('Delete', async () => { try { await api('/api/accounting/recurring/' + i.id, { method: 'DELETE' }); run(); } catch (e) { fail(e); } }, 'ghost sm'))]), { nums: [4], empty: 'No recurring entries yet.' })));
  };
  run();
}
function recDialog(done) {
  if (!shared.accounts.length) { openModal([h('h3', {}, 'Add a recurring entry'), h('p', { class: 'hint' }, 'Add a bank or cash account first, under Setup.')]); return; }
  const err = h('div', { class: 'fe' });
  const acct = sel(shared.accounts.map((a) => [a.id, a.name]), ''), dir = sel([['out', 'Money out (an expense)'], ['in', 'Money in (income)']], 'out'), desc = h('input', { placeholder: 'Ground rent' }), amt = h('input', { inputmode: 'decimal', placeholder: '25000' });
  const freq = sel([['monthly', 'Every month'], ['weekly', 'Every week'], ['quarterly', 'Every 3 months'], ['yearly', 'Every year']], 'monthly'), start = h('input', { type: 'date', value: todayIst() }), end = h('input', { type: 'date' }), cat = sel(catOptions('Decide later'), '');
  openModal([h('h3', {}, 'Add a recurring entry'), h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const p = rupeesToPaise(amt.value); if (!p || p <= 0) { err.textContent = 'Enter the amount in rupees.'; return; }
    try { await api('/api/accounting/recurring', { method: 'POST', body: { accountId: acct.value, description: desc.value.trim(), amountPaise: dir.value === 'out' ? -p : p, frequency: freq.value, startDate: start.value, endDate: end.value || undefined, categoryId: cat.value || undefined } }); closeModal(); toast('Added'); done(); }
    catch (er) { err.textContent = er.message; }
  } }, fieldBox('Account', acct), fieldBox('Type', dir), fieldBox('What is it?', desc), fieldBox('Amount (₹)', amt), fieldBox('How often', freq), fieldBox('First date', start, 'Dates in the past are posted straight away.'), fieldBox('Last date (optional)', end), fieldBox('Category', cat), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Save'))]);
}

// ------------------------------------------------------------------ journal entries

function journals(view) {
  const pane = h('div'); view.append(pane);
  const run = async () => {
    const r = await load(pane, () => api('/api/accounting/journals?limit=50'));
    if (!r) return;
    pane.append(section('Journal entries', h('p', { class: 'hint', style: 'margin:0 0 14px' }, 'For adjustments an accountant makes: depreciation, an owner putting money in, a correction. Each entry must balance. A wrong entry is voided, never deleted.'),
      bar(btn('New journal entry', () => journalDialog(run), 'primary sm')),
      dt(['Date', 'Memo', 'Lines', 'Total', ''], r.items.map((j) => ({ cls: j.deletedAt ? 'void' : null, cells: [niceDate(j.date), h('span', {}, j.memo, j.deletedAt ? h('span', { class: 'chip bad', style: 'margin-left:8px' }, 'Voided') : null),
        j.lines.map((l) => `${l.accountName} ${l.debitPaise ? 'Dr ' + inr(l.debitPaise) : 'Cr ' + inr(l.creditPaise)}`).join('; '), inr(j.totalPaise),
        h('span', { class: 'acts' }, btn('Files', () => filesDialog('journal', j.id, j.memo), 'ghost sm'), j.deletedAt ? null : btn('Void', () => voidDialog(j, run), 'ghost sm'))] })), { nums: [3], empty: 'No journal entries.' })));
  };
  run();
}
function voidDialog(j, done) {
  const why = h('input', { placeholder: 'Why is it wrong?' }), err = h('div', { class: 'fe' });
  openModal([h('h3', {}, 'Void this entry'), h('p', { class: 'hint' }, j.memo), h('form', { onsubmit: async (e) => { e.preventDefault(); try { await api(`/api/accounting/journals/${j.id}/void`, { method: 'POST', body: { reason: why.value.trim() } }); closeModal(); toast('Voided'); done(); } catch (er) { err.textContent = er.message; } } }, fieldBox('Reason', why), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Void entry'))]);
}
async function journalDialog(done) {
  let accts; try { accts = (await api('/api/accounting/journal-accounts')).items; } catch (e) { fail(e); return; }
  const date = h('input', { type: 'date', value: todayIst() }), memo = h('input', { placeholder: 'What is this adjustment?' }), lines = h('div'), err = h('div', { class: 'fe' }), tot = h('p', { class: 'hint' });
  const rows = [];
  const recalc = () => { const d = rows.reduce((a, r) => a + (rupeesToPaise(r.dr.value || '0') || 0), 0), c = rows.reduce((a, r) => a + (rupeesToPaise(r.cr.value || '0') || 0), 0); tot.textContent = `Debits ${inr(d)}, credits ${inr(c)}` + (d === c && d > 0 ? '. Balanced.' : '. Not balanced yet.'); };
  const add = () => { const r = { ac: sel([['', 'Choose an account'], ...accts.map((a) => [a.code, `${a.group}: ${a.name}`])], ''), dr: h('input', { placeholder: 'Debit ₹', inputmode: 'decimal' }), cr: h('input', { placeholder: 'Credit ₹', inputmode: 'decimal' }) };
    for (const x of [r.dr, r.cr]) x.addEventListener('input', recalc); rows.push(r); lines.append(h('div', { class: 'jl' }, r.ac, r.dr, r.cr)); };
  add(); add();
  openModal([h('h3', {}, 'New journal entry'), h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const ls = []; for (const r of rows) { if (!r.ac.value) continue; const d = rupeesToPaise(r.dr.value || '0') || 0, c = rupeesToPaise(r.cr.value || '0') || 0; ls.push({ account: r.ac.value, debitPaise: d, creditPaise: c }); }
    try { await api('/api/accounting/journals', { method: 'POST', body: { date: date.value, memo: memo.value.trim(), lines: ls } }); closeModal(); toast('Entry saved'); done(); } catch (er) { err.textContent = er.message; }
  } }, fieldBox('Date', date), fieldBox('Memo', memo), lines, btn('Add a line', add, 'ghost sm'), tot, err, h('button', { class: 'btn primary block', type: 'submit' }, 'Save entry'))], { wide: true });
  recalc();
}

// ------------------------------------------------------------------ month-end

function monthEnd(view) {
  const pane = h('div'); view.append(pane);
  const run = async () => {
    const r = await load(pane, () => api('/api/accounting/signoffs'));
    if (!r) return;
    const month = h('input', { type: 'month', value: addDays(curMonth() + '-01', -1).slice(0, 7) }), memo = h('textarea', { placeholder: 'Notes for this month (for you and your accountant)' }), memoMsg = h('span', { class: 'hint' });
    const loadMemo = async () => { try { memo.value = (await api('/api/accounting/memos/' + month.value)).body || ''; } catch { memo.value = ''; } };
    month.addEventListener('change', loadMemo); loadMemo();
    pane.append(section('Sign off a month', h('p', { class: 'hint', style: 'margin:0 0 14px' }, 'Signing off freezes the month: nothing dated in it can be added, changed or imported until you re-open it. The profit and loss at that moment is kept on record.'),
      bar(fieldBox('Month', month), h('div', { class: 'dls' }, btn('Sign off', async () => { try { await api('/api/accounting/signoffs', { method: 'POST', body: { month: month.value } }); toast(`${monthLabel(month.value)} signed off`); run(); } catch (e) { fail(e); } }, 'primary sm'))),
      fieldBox('Month note', memo), bar(btn('Save note', async () => { try { await api('/api/accounting/memos/' + month.value, { method: 'PUT', body: { body: memo.value.trim() } }); memoMsg.textContent = 'Saved'; } catch (e) { fail(e); } }, 'outline sm'), memoMsg)),
      section('Signed-off months', dt(['Month', 'Revenue', 'Expenses', 'Net profit', ''], r.items.map((s) => [monthLabel(s.month), s.revenuePaise === null ? '' : inr(s.revenuePaise), s.expensesPaise === null ? '' : inr(s.expensesPaise), s.netProfitPaise === null ? '' : inr(s.netProfitPaise),
        s.reopenedAt ? h('span', { class: 'chip' }, 'Re-opened') : btn('Re-open', () => reopenDialog(s.month, run), 'ghost sm')]), { nums: [1, 2, 3], empty: 'No months signed off yet.' })));
  };
  run();
}
function reopenDialog(month, done) {
  const why = h('input', { placeholder: 'Why does it need to change?' }), err = h('div', { class: 'fe' });
  openModal([h('h3', {}, `Re-open ${monthLabel(month)}`), h('p', { class: 'hint' }, 'The reason is kept in the audit log.'), h('form', { onsubmit: async (e) => { e.preventDefault(); try { await api('/api/accounting/signoffs/reopen', { method: 'POST', body: { month, reason: why.value.trim() } }); closeModal(); toast('Re-opened'); done(); } catch (er) { err.textContent = er.message; } } }, fieldBox('Reason', why), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Re-open month'))]);
}

// ------------------------------------------------------------------ setup: accounts, rules, GST

function setup(view) {
  const pane = h('div'); view.append(pane);
  const run = async () => {
    const r = await load(pane, async () => { await loadShared(); const [rules, st] = await Promise.all([api('/api/accounting/rules'), api('/api/accounting/settings')]); return { rules: rules.items, st }; });
    if (!r) return;
    const gst = h('input', { type: 'number', min: 0, max: 28, value: r.st.gstPercent });
    pane.append(
      section('Bank and cash accounts', bar(btn('Add an account', () => accountDialog(run), 'primary sm')),
        dt(['Account', 'Kind', 'Balance', 'Transactions', 'Uncategorised'], shared.accounts.map((a) => [a.name + (a.bankName ? `  ·  ${a.bankName}` : ''), a.kind === 'bank' ? 'Bank' : 'Cash', inr(a.balancePaise), a.transactions, a.uncategorised]), { nums: [2, 3, 4], empty: 'No accounts yet.' })),
      section('Rules that categorise bank lines', h('p', { class: 'hint', style: 'margin:0 0 14px' }, 'When a bank line contains the words you choose, it gets the category you choose. Rules run on every import and never override a category you set yourself.'),
        bar(btn('Add a rule', () => ruleDialog(run), 'primary sm'), btn('Apply rules to uncategorised lines', async () => { try { const x = await api('/api/accounting/rules/apply', { method: 'POST', body: {} }); toast(`${x.categorised} of ${x.checked} categorised`); } catch (e) { fail(e); } }, 'outline sm')),
        dt(['When the text', 'Direction', 'Category', ''], r.rules.map((x) => [`${{ contains: 'contains', starts_with: 'starts with', equals: 'is', regex: 'matches' }[x.matchType]} “${x.pattern}”`, { any: 'Either', in: 'Money in', out: 'Money out' }[x.direction], x.categoryName,
          btn('Delete', async () => { try { await api('/api/accounting/rules/' + x.id, { method: 'DELETE' }); run(); } catch (e) { fail(e); } }, 'ghost sm')]), { empty: 'No rules yet.' })),
      section('GST', h('p', { class: 'hint', style: 'margin:0 0 14px' }, 'If your booking prices include GST, enter the rate and the reports separate it. Leave at 0 if you do not charge GST.'),
        bar(fieldBox('GST rate (%)', gst), h('div', { class: 'dls' }, btn('Save', async () => { try { await api('/api/accounting/settings', { method: 'PATCH', body: { gstPercent: Number(gst.value) } }); toast('Saved'); } catch (e) { fail(e); } }, 'primary sm')))));
  };
  run();
}
function accountDialog(done) {
  const err = h('div', { class: 'fe' }), kind = sel([['bank', 'Bank account'], ['cash', 'Cash in hand']], 'bank'), name = h('input', { placeholder: 'HDFC current account' }), bank = h('input', { placeholder: 'HDFC Bank' }), last4 = h('input', { placeholder: '1234', maxlength: 4 }), open = h('input', { inputmode: 'decimal', placeholder: '0' }), od = h('input', { type: 'date' });
  openModal([h('h3', {}, 'Add an account'), h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const op = open.value.trim() ? rupeesToPaise(open.value) : 0; if (op === null) { err.textContent = 'Enter the opening balance in rupees.'; return; }
    try { await api('/api/accounting/accounts', { method: 'POST', body: { kind: kind.value, name: name.value.trim(), bankName: bank.value.trim() || undefined, last4: last4.value.trim() || undefined, openingPaise: op, openingDate: od.value || undefined } }); closeModal(); toast('Account added'); done(); }
    catch (er) { err.textContent = er.message; }
  } }, fieldBox('Kind', kind), fieldBox('Name', name), fieldBox('Bank (optional)', bank), fieldBox('Last 4 digits (optional)', last4), fieldBox('Opening balance (₹)', open, 'What was in the account on the date below.'), fieldBox('Opening balance date', od), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Add account'))]);
}
function ruleDialog(done) {
  const err = h('div', { class: 'fe' }), mt = sel([['contains', 'contains'], ['starts_with', 'starts with'], ['equals', 'is exactly']], 'contains'), pat = h('input', { placeholder: 'ELECTRICITY' }), dir = sel([['any', 'Money in or out'], ['in', 'Money in only'], ['out', 'Money out only']], 'any'), cat = sel(catOptions(), '');
  openModal([h('h3', {}, 'Add a rule'), h('form', { onsubmit: async (e) => { e.preventDefault(); err.textContent = ''; if (!cat.value) { err.textContent = 'Choose a category.'; return; }
    try { await api('/api/accounting/rules', { method: 'POST', body: { field: 'description', matchType: mt.value, pattern: pat.value.trim(), direction: dir.value, categoryId: cat.value } }); closeModal(); toast('Rule added'); done(); } catch (er) { err.textContent = er.message; } } },
    fieldBox('When the bank text', mt), fieldBox('The words', pat), fieldBox('Applies to', dir), fieldBox('Give it the category', cat), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Add rule'))]);
}

// ------------------------------------------------------------------ cash flow, budget, assets, GST, transfers

const dlButtons = (path, name) => exportTools(path, name);

function cashflow(view) {
  const month = h('input', { type: 'month', value: curMonth() }), out = h('div');
  const path = () => `/api/accounting/reports/cash-flow?month=${month.value}`;
  const run = async () => {
    const c = await load(out, () => api(path()));
    if (!c) return;
    const rows = [{ cls: 'grp', cells: ['Money at the start', money(c.openingPaise)] }];
    const part = (title, s) => { rows.push({ cls: 'grp2', cells: [title, ''] }); for (const r of s.rows) rows.push([r.name, money(r.paise)]); rows.push({ cls: 'sub', cells: [`Net from ${title.toLowerCase()}`, money(s.totalPaise)] }); };
    part('Operating (running the ground)', c.operating); part('Investing (equipment bought)', c.investing); part('Financing (owner money and loans)', c.financing);
    if (c.betweenAccountsPaise) rows.push([ 'Moved between your own accounts', money(c.betweenAccountsPaise)]);
    if (c.newAccountsOpeningPaise) rows.push(['Opening balances of accounts added in the period', money(c.newAccountsOpeningPaise)]);
    rows.push({ cls: 'net', cells: ['Money at the end', money(c.closingPaise)] });
    out.append(h('p', { class: 'hint' }, `${niceDate(c.range.from)} to ${niceDate(c.range.to)}. ` + (c.ties ? 'Ties to the cash and bank on the balance sheet.' : 'Does not tie to the balance sheet; check for edited past entries.')),
      dt(['', 'Amount'], rows, { nums: [1] }), ...c.notes.map((n) => h('p', { class: 'hint' }, n)));
  };
  month.addEventListener('change', run);
  view.append(section('Cash flow statement', bar(fieldBox('Month', month), dlButtons(path, () => `cash-flow-${month.value}`)), out)); run();
}

function budget(view) {
  const month = h('input', { type: 'month', value: curMonth() }), out = h('div');
  const path = () => `/api/accounting/reports/budget?month=${month.value}`;
  const run = async () => {
    const b = await load(out, () => api(path()));
    if (!b) return;
    const chip = (s) => h('span', { class: 'chip ' + (s === 'over' ? 'bad' : s === 'ok' ? 'ok' : '') }, { ok: 'On track', over: 'Over', under: 'Under', unbudgeted: 'No budget' }[s]);
    const rows = (list) => list.map((r) => [r.name, r.budgetPaise ? inr(r.budgetPaise) : '', inr(r.actualPaise), r.budgetPaise ? money(r.variancePaise) : '', r.percentUsed === null ? '' : r.percentUsed + '%', chip(r.status)]);
    const heads = ['', 'Budget', 'Actual', 'Better / worse', 'Used', ''];
    const t = b.totals;
    out.append(h('p', { class: 'hint' }, `${niceDate(b.range.from)} to ${niceDate(b.range.to)}. Budget profit ${inr(t.budgetProfitPaise)}, actual ${inr(t.actualProfitPaise)}.`),
      h('div', { class: 'eyebrow', style: 'margin:14px 0 8px' }, 'Income'), dt(heads, rows(b.income), { nums: [1, 2, 3, 4], empty: 'No income lines.' }),
      h('div', { class: 'eyebrow', style: 'margin:14px 0 8px' }, 'Expenses'), dt(heads, rows(b.expenses), { nums: [1, 2, 3, 4], empty: 'No expense lines.' }), ...b.notes.map((n) => h('p', { class: 'hint' }, n)));
  };
  month.addEventListener('change', run);
  view.append(section('Budget against actual', bar(fieldBox('Month', month), btn('Set monthly budgets', () => budgetDialog(run), 'primary sm'), dlButtons(path, () => `budget-${month.value}`)), out)); run();
}

async function budgetDialog(done) {
  let d; try { d = await api('/api/accounting/budgets'); } catch (e) { return fail(e); }
  const cur = new Map(d.items.map((i) => [i.code, i.monthlyPaise])), err = h('div', { class: 'fe' }), inputs = [];
  const box = h('div', { style: 'max-height:55vh;overflow:auto' });
  for (const a of d.available) {
    const i = h('input', { inputmode: 'decimal', placeholder: '0', value: cur.has(a.code) ? String(cur.get(a.code) / 100) : '' });
    inputs.push([a, i]); box.append(fieldBox(`${a.type === 'income' ? 'Income' : 'Expense'}: ${a.name}`, i));
  }
  openModal([h('h3', {}, 'Monthly budgets'), h('p', { class: 'hint' }, 'The amount you expect each month, in rupees. Leave blank for no budget.'), box, err,
    h('button', { class: 'btn primary block', type: 'button', onclick: async () => {
      err.textContent = ''; const items = [];
      for (const [a, i] of inputs) { const t = i.value.trim(); if (!t && !cur.has(a.code)) continue; const p = t ? rupeesToPaise(t) : 0; if (p === null || p < 0) { err.textContent = `Check the amount for ${a.name}.`; return; } if (p !== (cur.get(a.code) || 0)) items.push({ code: a.code, monthlyPaise: p }); }
      if (!items.length) { closeModal(); return; }
      try { await api('/api/accounting/budgets', { method: 'PUT', body: { items } }); closeModal(); toast('Budgets saved'); done(); } catch (er) { err.textContent = er.message; }
    } }, 'Save budgets')]);
}

function assets(view) {
  const out = h('div'), path = () => '/api/accounting/assets';
  const run = async () => {
    const a = await load(out, () => api(path()));
    if (!a) return;
    const rows = a.items.map((x) => [h('span', {}, x.name, h('small', { class: 'sub' }, ` bought ${niceDate(x.purchaseDate)}, ${x.lifeMonths} months`)), inr(x.costPaise), inr(x.depreciatedPaise), inr(x.bookValuePaise), h('span', { class: 'chip' }, x.status),
      h('span', {}, x.status !== 'disposed' ? btn('Sold or scrapped', () => disposeDialog(x, run), 'ghost sm') : null, !x.monthsPosted ? btn('Remove', async () => { try { await api('/api/accounting/assets/' + x.id, { method: 'DELETE' }); toast('Removed'); run(); } catch (e) { fail(e); } }, 'ghost sm') : null)]);
    out.append(h('div', { class: 'kpis' }, ...[['Cost', a.totals.costPaise], ['Depreciated', a.totals.depreciatedPaise], ['Book value', a.totals.bookValuePaise]].map(([l, v]) => h('div', { class: 'kpi' }, h('span', {}, l), h('b', {}, inr(v))))),
      dt(['Asset', 'Cost', 'Depreciated', 'Book value', 'Status', ''], rows, { nums: [1, 2, 3], empty: 'No assets yet. Add the bowling machine, nets, roller, floodlights.' }),
      h('p', { class: 'hint' }, 'Depreciation is posted for each finished month automatically. When you buy an asset, categorise the bank payment as "Equipment or asset bought" so it is not counted as an expense.'));
  };
  view.append(section('Fixed assets', bar(btn('Add an asset', () => assetDialog(run), 'primary sm'),
    btn('Post depreciation now', async () => { try { const r = await api('/api/accounting/assets/depreciate', { method: 'POST', body: {} }); toast(r.posted ? `Posted ${r.posted} entr${r.posted === 1 ? 'y' : 'ies'}` : 'Nothing to post'); if (r.skippedLocked.length) toast('Skipped signed-off months: ' + r.skippedLocked.join(', '), true); run(); } catch (e) { fail(e); } }),
    dlButtons(path, () => 'fixed-assets')), out)); run();
}
function assetDialog(done) {
  const err = h('div', { class: 'fe' }), name = h('input', { placeholder: 'Bowling machine' }), cost = h('input', { inputmode: 'decimal', placeholder: '120000' }), salv = h('input', { inputmode: 'decimal', placeholder: '0' }),
    date = h('input', { type: 'date', value: todayIst(), max: todayIst() }), life = h('input', { inputmode: 'numeric', value: '60' });
  openModal([h('h3', {}, 'Add an asset'), h('form', { onsubmit: async (e) => { e.preventDefault(); err.textContent = '';
    const c = rupeesToPaise(cost.value), s = salv.value.trim() ? rupeesToPaise(salv.value) : 0; if (!c || c <= 0 || s === null) { err.textContent = 'Enter the cost in rupees.'; return; }
    try { await api('/api/accounting/assets', { method: 'POST', body: { name: name.value.trim(), costPaise: c, salvagePaise: s, purchaseDate: date.value, lifeMonths: Number(life.value) } }); closeModal(); toast('Asset added'); done(); } catch (er) { err.textContent = er.message; } } },
    fieldBox('Name', name), fieldBox('Cost (₹)', cost), fieldBox('Value left at the end (₹)', salv), fieldBox('Bought on', date), fieldBox('Useful life (months)', life, '60 months is five years.'), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Save'))]);
}
function disposeDialog(x, done) {
  const err = h('div', { class: 'fe' }), on = h('input', { type: 'date', value: todayIst(), max: todayIst() });
  openModal([h('h3', {}, 'Sold or scrapped'), h('p', { class: 'hint' }, `${x.name}: depreciation stops after this date.`), h('form', { onsubmit: async (e) => { e.preventDefault(); try { await api(`/api/accounting/assets/${x.id}/dispose`, { method: 'POST', body: { disposedOn: on.value } }); closeModal(); toast('Saved'); done(); } catch (er) { err.textContent = er.message; } } },
    fieldBox('Date', on), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Save'))]);
}

function gst(view) {
  const from = h('input', { type: 'date' }), to = h('input', { type: 'date' }), out = h('div');
  const path = () => '/api/accounting/reports/gst' + (from.value && to.value ? `?from=${from.value}&to=${to.value}` : '');
  const run = async () => {
    const g = await load(out, () => api(path()));
    if (!g) return;
    const rows = g.rows.map((r) => [monthLabel(r.month), inr(r.taxableValuePaise), inr(r.gstCollectedPaise), inr(r.gstPaidPaise), money(r.netPaise)]);
    rows.push({ cls: 'sub', cells: ['Total', inr(g.totals.taxableValuePaise), inr(g.totals.gstCollectedPaise), inr(g.totals.gstPaidPaise), money(g.totals.netPaise)] });
    out.append(h('p', { class: 'hint' }, `${niceDate(g.range.from)} to ${niceDate(g.range.to)} at ${g.percent}%. GST payable at the end: ${inr(g.payableAtEndPaise)}.`), dt(['Month', 'Sales before GST', 'GST collected', 'GST paid', 'Net to pay'], rows, { nums: [1, 2, 3, 4] }), ...g.notes.map((n) => h('p', { class: 'hint' }, n)));
  };
  for (const c of [from, to]) c.addEventListener('change', () => { if (!!from.value === !!to.value) run(); });
  view.append(section('GST summary', bar(fieldBox('From', from), fieldBox('To', to), dlButtons(path, () => 'gst-summary')), h('p', { class: 'hint' }, 'Leave the dates empty for the financial year so far.'), out)); run();
}

function transferDialog(done) {
  if (shared.accounts.length < 2) { openModal([h('h3', {}, 'Move money'), h('p', { class: 'hint' }, 'You need at least two accounts (for example the bank and the cash box). Add them under Setup.')]); return; }
  const err = h('div', { class: 'fe' }), opts = shared.accounts.map((a) => [a.id, a.name]);
  const from = sel(opts, opts[0][0]), to = sel(opts, opts[1][0]), date = h('input', { type: 'date', value: todayIst(), max: todayIst() }), amt = h('input', { inputmode: 'decimal', placeholder: '5000' }), note = h('input', { placeholder: 'Optional' });
  openModal([h('h3', {}, 'Move money between accounts'), h('p', { class: 'hint' }, 'Cash taken to the bank, or bank to petty cash. It does not count as income or expense.'), h('form', { onsubmit: async (e) => { e.preventDefault(); err.textContent = '';
    const p = rupeesToPaise(amt.value); if (!p || p <= 0) { err.textContent = 'Enter the amount in rupees.'; return; }
    try { await api('/api/accounting/transfers', { method: 'POST', body: { fromAccountId: from.value, toAccountId: to.value, date: date.value, amountPaise: p, note: note.value.trim() || undefined } }); closeModal(); toast('Moved'); done(); } catch (er) { err.textContent = er.message; } } },
    fieldBox('From', from), fieldBox('To', to), fieldBox('Date', date), fieldBox('Amount (₹)', amt), fieldBox('Note', note), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Move'))]);
}

D.registerDeskTab({ id: 'books', label: 'Accounting', perm: 'view_reports', render: renderBooks });
})();
