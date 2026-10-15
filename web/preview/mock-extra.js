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
