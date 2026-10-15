// The report list and one report at a time, each with period controls, print and export.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, go, inr, fmtDate, todayISO, addDaysISO, useApi } from '../../lib';
import { Field, Icon, ErrorBox, Loading, Empty, Tabs } from '../../ui';
import { Grid, Money, GRow, ExportBar, Section, Note, monthAdd, lastDayOf, fyStart } from './kit';

interface Def { id: string; name: string; sec: string; kind?: string; tab?: string; range?: boolean; basis?: boolean; compare?: boolean; pct?: boolean; fy?: boolean; asOf?: boolean; days?: number; future?: boolean; path?: (q: Q) => string; file?: string }
interface Q { from: string; to: string; basis: string }
const REPORTS: Def[] = [
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
  { id: 'past', name: 'Sessions played', sec: 'Bookings', kind: 'sched', range: true, path: (q) => `/api/accounting/reports/schedule/past?from=${q.from}&to=${q.to}`, file: 'sessions-played' },
  { id: 'future', name: 'Upcoming bookings', sec: 'Bookings', kind: 'sched', future: true, path: () => '/api/accounting/reports/schedule/future?', file: 'upcoming-bookings' },
  { id: 'gst', name: 'GST Summary', sec: 'Taxes, budgets and assets', tab: 'gst' },
  { id: 'budget', name: 'Budget against actual', sec: 'Taxes, budgets and assets', tab: 'budget' },
  { id: 'assets', name: 'Fixed Asset Register', sec: 'Taxes, budgets and assets', tab: 'assets' },
];
const SECTIONS = ['Business overview', 'Who owes you', 'Bookings', 'Taxes, budgets and assets'];
const MGMT = ['gst', 'budget', 'assets', 'cashflow', 'audit', 'past', 'future'];

const favs = {
  get(): string[] { try { return JSON.parse(localStorage.getItem('daji.reportFavs') || '[]'); } catch { return []; } },
  set(l: string[]) { try { localStorage.setItem('daji.reportFavs', JSON.stringify(l)); } catch { /* storage blocked */ } },
};

export function Reports({ id }: { id?: string }) {
  const def = REPORTS.find((r) => r.id === id);
  useEffect(() => { if (def?.tab) go('/accounting/' + def.tab); }, [def]);
  if (def && !def.tab) return <Viewer def={def} />;
  return <Catalog />;
}

function Catalog() {
  const [tab, setTab] = useState<'standard' | 'mgmt'>('standard'); const [q, setQ] = useState(''); const [mine, setMine] = useState(favs.get());
  const [shut, setShut] = useState<string[]>([]);
  const list = REPORTS.filter((r) => (tab === 'mgmt' ? MGMT.includes(r.id) : true) && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())));
  const toggle = (id: string) => { const n = mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id]; favs.set(n); setMine(n); };
  const block = (title: string, rs: Def[]) => !rs.length ? null : (
    <div className="card" key={title}>
      <button className="bk-fold" aria-expanded={!shut.includes(title)} onClick={() => setShut(shut.includes(title) ? shut.filter((x) => x !== title) : [...shut, title])}>
        <span style={{ transform: shut.includes(title) ? 'rotate(0)' : 'rotate(90deg)', display: 'inline-flex' }}><Icon name="chevron" size={16} /></span><b>{title}</b></button>
      {!shut.includes(title) && <div className="bk-reps">{rs.map((r) => (
        <div className="bk-rep" key={r.id}>
          <a href={'#/accounting/' + (r.tab || 'reports/' + r.id)}>{r.name}</a>
          <button className={'bk-star' + (mine.includes(r.id) ? ' on' : '')} aria-pressed={mine.includes(r.id)} aria-label={mine.includes(r.id) ? 'Remove from favorites' : 'Add to favorites'} onClick={() => toggle(r.id)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill={mine.includes(r.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg></button>
        </div>))}</div>}
    </div>);
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Tabs value={tab} onChange={setTab} items={[['standard', 'Standard reports'], ['mgmt', 'Management reports']]} />
        <input className="inp" style={{ maxWidth: 320 }} type="search" placeholder="Type report name here" aria-label="Find a report" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {block('Favorites', list.filter((r) => mine.includes(r.id)))}
      {SECTIONS.map((s) => block(s, list.filter((r) => r.sec === s)))}
      {!list.length && <Empty>No report has that name.</Empty>}
    </div>
  );
}

function Viewer({ def }: { def: Def }) {
  const t = todayISO();
  const [preset, setPreset] = useState(def.fy ? 'fy' : def.days ? 'custom' : 'month');
  const [from, setFrom] = useState(def.fy ? fyStart() : def.days ? addDaysISO(t, -def.days) : t.slice(0, 8) + '01');
  const [to, setTo] = useState(t);
  const [basis, setBasis] = useState('accrual');
  const [account, setAccount] = useState('');
  const [accts, setAccts] = useState<any[]>([]);
  useEffect(() => { if (def.kind === 'ledger') api('/api/accounting/journal-accounts').then((r) => setAccts(r.items)).catch(() => {}); }, []);
  const applyPreset = (v: string) => {
    setPreset(v); const m = t.slice(0, 7);
    if (v === 'month') { setFrom(m + '-01'); setTo(t); } else if (v === 'last') { const lm = monthAdd(m, -1); setFrom(lm + '-01'); setTo(lastDayOf(lm)); }
    else if (v === 'fy') { setFrom(fyStart()); setTo(t); } else if (v === 'lastfy') { const s = fyStart(); setFrom(`${Number(s.slice(0, 4)) - 1}-04-01`); setTo(`${s.slice(0, 4)}-03-31`); }
  };
  const q: Q = { from, to: def.asOf && to > t ? t : to, basis };
  const path = (): string => {
    if (def.path) return def.path(q);
    if (def.kind === 'pnl') return `/api/accounting/reports/pnl?from=${q.from}&to=${q.to}&basis=${q.basis}` + (def.compare ? '&compare=1' : '');
    if (def.kind === 'bs') return `/api/accounting/reports/balance-sheet?asOf=${q.to}`;
    if (def.kind === 'tb') return `/api/accounting/reports/trial-balance?asOf=${q.to}`;
    if (def.kind === 'ledger') return `/api/accounting/reports/ledger?account=${encodeURIComponent(account)}&from=${q.from}&to=${q.to}`;
    return '';
  };
  const file = () => `${def.file || def.id}-${def.asOf ? q.to : q.from + '-to-' + q.to}`;
  const invalid = def.range && (!from || !to || to < from) ? 'Choose a start date that is not after the end date.' : def.kind === 'ledger' && !account ? 'Choose an account.' : null;
  const p = invalid ? null : path();
  const [r, e] = useApi<any>(p);
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row"><a className="btn sm ghost no-print" href="#/accounting/reports"><Icon name="back" />Reports</a><h2 style={{ fontSize: 22 }}>{def.name}</h2></div>
        <ExportBar path={() => path()} name={file} />
      </div>
      <div className="card"><div className="card-pad no-print"><div className="form-grid bk-ctl">
        {def.range && <Field label="Period"><select className="inp" value={preset} onChange={(e) => applyPreset(e.target.value)}><option value="month">This month</option><option value="last">Last month</option><option value="fy">This financial year</option><option value="lastfy">Last financial year</option><option value="custom">Custom</option></select></Field>}
        {def.range && <Field label="From"><input className="inp" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }} /></Field>}
        {(def.range || def.asOf) && <Field label={def.asOf ? 'As of' : 'To'}><input className="inp" type="date" value={to} onChange={(e) => { setTo(e.target.value); if (def.range) setPreset('custom'); }} /></Field>}
        {def.basis && <Field label="Basis"><select className="inp" value={basis} onChange={(e) => setBasis(e.target.value)}><option value="accrual">Accrual (sessions played)</option><option value="cash">Cash (money received)</option></select></Field>}
        {def.kind === 'ledger' && <Field label="Account"><select className="inp" value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Choose an account</option>{accts.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</select></Field>}
      </div></div>
        <div className={def.range || def.asOf || def.kind === 'ledger' ? 'bk-rep-body' : ''}>
          {invalid ? <Empty>{invalid}</Empty> : e ? <ErrorBox msg={e} /> : !r ? <Loading h={260} /> : <Body def={def} r={r} />}
        </div></div>
    </div>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <p className="muted small" style={{ margin: '0 0 12px' }}>{children}</p>;
const Notes = ({ n }: { n?: string[] }) => <>{(n || []).map((x, i) => <Hint key={i}>{x}</Hint>)}</>;
const Pad = ({ children }: { children: ReactNode }) => <div className="card-pad">{children}</div>;

function Body({ def, r }: { def: Def; r: any }) {
  if (def.kind === 'pnl') return <Pnl p={r} def={def} />;
  if (def.kind === 'bs') return <Pad><Hint>As of {fmtDate(r.asOf)}. {r.balanced ? 'Assets equal liabilities plus equity.' : `Out of balance by ${inr(r.differencePaise)}.`}</Hint><Grid heads={['', 'Amount']} nums={[1]} rows={sectionRows([['Assets', r.assets], ['Liabilities', r.liabilities], ['Equity', r.equity]])} /><Notes n={r.notes} /></Pad>;
  if (def.kind === 'tb') {
    const rows: (GRow | any[])[] = r.rows.map((x: any) => [x.name, x.type, x.debitPaise ? inr(x.debitPaise) : '', x.creditPaise ? inr(x.creditPaise) : '']);
    rows.push({ cls: 'sub', cells: ['Total', '', inr(r.totalDebitPaise), inr(r.totalCreditPaise)] });
    return <Pad><Hint>As of {fmtDate(r.asOf)}. {r.balanced ? 'Debits equal credits.' : 'Debits and credits differ.'}</Hint><Grid heads={['Account', 'Type', 'Debit', 'Credit']} nums={[2, 3]} rows={rows} /></Pad>;
  }
  if (def.kind === 'ledger') {
    const rows: (GRow | any[])[] = [{ cls: 'grp', cells: ['', 'Opening balance', '', '', <Money p={r.openingPaise} />] }];
    for (const e of r.entries) rows.push([fmtDate(e.date), e.description || e.memo || '', e.debitPaise ? inr(e.debitPaise) : '', e.creditPaise ? inr(e.creditPaise) : '', <Money p={e.balancePaise} />]);
    rows.push({ cls: 'net', cells: ['', 'Closing balance', '', '', <Money p={r.closingPaise} />] });
    return <Pad><Hint>{r.account.name}: {fmtDate(r.range.from)} to {fmtDate(r.range.to)}</Hint><Grid heads={['Date', 'Description', 'Debit', 'Credit', 'Balance']} nums={[2, 3, 4]} rows={rows} /></Pad>;
  }
  if (def.kind === 'sched') {
    const sm = r.summary || {}; const note = r.summary && 'bookings' in sm ? `${sm.bookings} bookings, ${inr(sm.valuePaise)} in total, ${inr(sm.paidPaise)} paid, ${inr(sm.duePaise)} still due.` : '';
    return <Pad><Hint>{fmtDate(r.range.from)} to {fmtDate(r.range.to)}. {note}</Hint>
      <Grid heads={['Date', 'Time', 'Ref', 'Customer', 'Ground', 'Status', 'Total', 'Paid', 'Due']} nums={[6, 7, 8]} empty="No bookings in this period."
        rows={r.items.map((x: any) => [fmtDate(x.date), `${x.startTime} – ${x.endTime}`, x.ref, x.customerName, x.groundName, String(x.kind).replace(/_/g, ' '), inr(x.totalPaise), inr(x.paidPaise), inr(x.duePaise)])} />
      {r.total > r.items.length && <Hint>Showing {r.items.length} of {r.total}. Download for the full list.</Hint>}<Notes n={r.notes} /></Pad>;
  }
  return <GenericTable r={r} />;
}

/** Any {columns, rows, notes} report from the server. Amounts arrive in paise. */
export function GenericTable({ r }: { r: any }) {
  const nums = r.columns.map((c: any, i: number) => (c.money ? i : -1)).filter((i: number) => i >= 0);
  const rows: GRow[] = r.rows.map((x: any) => ({ cls: x.kind === 'head' ? 'grp' : x.kind === 'sub' ? 'sub' : x.kind === 'net' ? 'net' : undefined, cells: x.cells.map((v: any, i: number) => (v === null || v === '' ? '' : r.columns[i].money && typeof v === 'number' ? <Money p={v} /> : String(v))) }));
  return <Pad><Hint>{r.sub}</Hint><Grid heads={r.columns.map((c: any) => c.label)} nums={nums} rows={rows} empty="Nothing to show for this period." /><Notes n={r.notes} /></Pad>;
}

function sectionRows(parts: [string, any][]): GRow[] {
  const rows: GRow[] = [];
  for (const [title, sec] of parts) {
    rows.push({ cls: 'grp', cells: [title, ''] });
    for (const g of sec.groups) { rows.push({ cls: 'grp2', cells: [g.name, ''] }); for (const r of g.rows) rows.push({ cells: [r.name, <Money p={r.paise} />] }); rows.push({ cls: 'sub', cells: [`Total ${g.name.toLowerCase()}`, <Money p={g.totalPaise} />] }); }
    rows.push({ cls: 'sub', cells: [`Total ${title.toLowerCase()}`, <Money p={sec.totalPaise} />] });
  }
  return rows;
}

/** Profit and loss: plain, with the earlier period beside it, or each line as a share of total income. */
function Pnl({ p, def }: { p: any; def: Def }) {
  const cmp = !!def.compare && p.previous, pct = !!def.pct, inc = p.revenue.totalPaise;
  const share = (v: number) => (inc ? `${(Math.round((v / inc) * 1000) / 10).toFixed(1)}%` : '');
  const extra = (v: number, prev?: number) => [...(pct ? [share(v)] : []), ...(cmp ? [<Money p={prev || 0} />, <Money p={v - (prev || 0)} />] : [])];
  const blank = cmp ? ['', ''] : [];
  const rows: GRow[] = [];
  const part = (title: string, sec: any) => {
    rows.push({ cls: 'grp', cells: [title, '', ...(pct ? [''] : []), ...blank] });
    for (const g of sec.groups) {
      rows.push({ cls: 'grp2', cells: [g.name, '', ...(pct ? [''] : []), ...blank] });
      for (const r of g.rows) rows.push({ cells: [r.name, <Money p={r.paise} />, ...extra(r.paise, r.previousPaise)] });
      rows.push({ cls: 'sub', cells: [`Total ${g.name.toLowerCase()}`, <Money p={g.totalPaise} />, ...extra(g.totalPaise, g.previousTotalPaise)] });
    }
    rows.push({ cls: 'sub', cells: [`Total ${title.toLowerCase()}`, <Money p={sec.totalPaise} />, ...extra(sec.totalPaise, sec.previousTotalPaise)] });
  };
  part('Revenue', p.revenue); part('Expenses', p.expenses);
  rows.push({ cls: 'net', cells: ['Net profit', <Money p={p.netProfitPaise} />, ...extra(p.netProfitPaise, p.previousNetProfitPaise)] });
  const heads = ['', 'Amount', ...(pct ? ['% of income'] : []), ...(cmp ? [`Before: ${fmtDate(p.previous.range.from)} to ${fmtDate(p.previous.range.to)}`, 'Change'] : [])];
  return <Pad><Hint>{fmtDate(p.range.from)} to {fmtDate(p.range.to)}, {p.basis} basis{p.marginPercent !== null ? `. Margin ${p.marginPercent}%` : ''}</Hint>
    <Grid heads={heads} nums={heads.map((_, i) => i).filter((i) => i > 0)} rows={rows} />
    {p.uncategorised.count > 0 && <div className="err" style={{ margin: '12px 0' }}>{p.uncategorised.count} bank transactions in this period have no category yet, so the profit is not complete.</div>}<Notes n={p.notes} /></Pad>;
}
