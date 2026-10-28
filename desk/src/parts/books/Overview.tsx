// The accounting home screen (cards and charts) and the books review, which is the top of Reconcile.
import { useState } from 'react';
import { api, go, inr, inrShort, fmtDate, todayISO, useApi } from '../../lib';
import { Stat, Chip, ErrorBox, Loading, Empty } from '../../ui';
import { Grid, Money, Section, Note, monthName, monthAdd } from './kit';

const COLORS = ['var(--strong)', 'var(--i-blue)', 'var(--i-green)', 'var(--i-amber)', 'var(--i-violet)', 'var(--muted)'];

function Donut({ parts }: { parts: { name: string; v: number }[] }) {
  const total = parts.reduce((s, p) => s + p.v, 0), R = 42, C = 2 * Math.PI * R; let off = 0;
  return (
    <div className="bk-donut">
      <svg viewBox="0 0 120 120" width="132" height="132" role="img" aria-label="Spending by group">
        <circle cx="60" cy="60" r={R} fill="none" stroke="#222830" strokeWidth="16" />
        {parts.map((p, i) => { if (!total || p.v <= 0) return null; const len = (p.v / total) * C; const el = <circle key={i} cx="60" cy="60" r={R} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" />; off += len; return el; })}
      </svg>
      <ul>{parts.slice(0, 5).map((p, i) => <li key={p.name}><i style={{ background: COLORS[i % COLORS.length] }} /><span>{p.name}</span><b>{inr(p.v)}</b></li>)}</ul>
    </div>
  );
}

function Bars({ labels, values }: { labels: string[]; values: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 420, H = 190, L = 44, B = 26, T = 14, max = Math.max(...values, 1), slot = (W - L - 6) / values.length;
  const ticks = [0, 0.5, 1];
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue by month" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => { const y = T + (H - T - B) * (1 - t); return <g key={t}><line x1={L} x2={W - 6} y1={y} y2={y} stroke="#262c33" /><text x={L - 6} y={y + 4} textAnchor="end" fontSize="10.5" fill="#7d7566">{inrShort(max * t)}</text></g>; })}
        {values.map((v, i) => { const h = Math.max(2, (Math.max(v, 0) / max) * (H - T - B)), x = L + slot * i + slot * 0.2, w = slot * 0.6;
          return <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={L + slot * i} y={T} width={slot} height={H - T - B} fill="transparent" />
            <rect x={x} y={H - B - h} width={w} height={h} rx="3" fill={hover === i ? 'var(--link)' : 'var(--strong)'} />
            <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize="11" fill={hover === i ? 'var(--link)' : 'var(--muted)'}>{labels[i]}</text>
            {hover === i && <text x={x + w / 2} y={H - B - h - 6} textAnchor="middle" fontSize="11" fill="#e8e2d3" fontWeight="700">{inrShort(v)}</text>}
          </g>; })}
      </svg>
    </div>
  );
}

const Pair = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="bk-li"><span className="muted">{k}</span><b className="strong">{v}</b></div>;
const Link = ({ to, children }: { to: string; children: React.ReactNode }) => <a href={'#' + to} className="bk-link" onClick={(e) => { e.preventDefault(); go(to); }}>{children}</a>;

export function Overview() {
  const t = todayISO(), m = t.slice(0, 7), label = monthName(m);
  const [o, e1] = useApi<any>('/api/accounting/overview');
  const [p, e2] = useApi<any>(`/api/accounting/reports/pnl?month=${m}&compare=1`);
  const [per, e3] = useApi<any>(`/api/accounting/reports/pnl-periods?from=${monthAdd(m, -5)}-01&to=${t}&by=month`);
  const [bal, e4] = useApi<any>(`/api/accounting/reports/customer-balances?asOf=${t}`);
  const err = e1 || e2 || e3 || e4;
  if (err) return <ErrorBox msg={err} />;
  if (!o || !p || !per || !bal) return <Loading h={420} />;

  const rev = p.revenue.totalPaise, exp = p.expenses.totalPaise, net = p.netProfitPaise, prev = p.previousNetProfitPaise;
  const change = prev ? Math.round(((net - prev) / Math.abs(prev)) * 100) : null, top = Math.max(rev, exp, 1);
  const groups = p.expenses.groups.map((g: any) => ({ name: g.name, v: g.totalPaise })).sort((a: any, b: any) => b.v - a.v);
  const sub = bal.rows.find((r: any) => r.kind === 'sub'), owed = sub ? sub.cells[sub.cells.length - 1] : 0, recent = sub ? sub.cells[3] : 0, older = owed - recent, scale = Math.max(owed, 1);
  const revRow = per.rows.find((r: any) => r.kind === 'sub');
  const labels = per.columns.slice(1, -1).map((c: any) => c.label.slice(0, 3)), vals = revRow ? revRow.cells.slice(1, -1) : [];
  const fy = o.financialYearToDate;
  const bar = (name: string, v: number, cls: string) => <div className="bk-bar"><div className="bk-bar-l"><b>{inr(v)}</b><span>{name}</span></div><div className="bk-bar-t"><i className={cls} style={{ width: `${Math.max(2, Math.round((Math.max(v, 0) / top) * 100))}%` }} /></div></div>;

  return (
    <div className="stack">
      <div className="grid g4 bk-kpis">
        <Stat label={`Revenue · ${label}`} value={inr(rev)} />
        <Stat label="Expenses" value={inr(exp)} />
        <Stat label="Net profit" value={<span style={net < 0 ? { color: 'var(--bad)' } : undefined}>{net < 0 ? '−' : ''}{inr(Math.abs(net))}</span>} />
        <Stat label="Cash and bank" value={inr(o.cashAndBankPaise)} foot={`${inr(owed)} owed by customers`} />
      </div>
      {o.empty && <Section title="Getting started"><p className="muted" style={{ margin: 0 }}>Add your bank account under Setup, then load a statement under Bank import. Booking income appears here by itself.</p></Section>}
      <div className="grid g3 bk-cards">
        <Section title="Profit and loss" aside={<span className="muted small">{label}</span>}>
          <div className="muted small">Net profit for {label}</div>
          <div className={'bk-big' + (net < 0 ? ' neg' : '')}>{net < 0 ? '−' : ''}{inr(Math.abs(net))}</div>
          {change === null ? <div className="muted small">No earlier month to compare with</div> : <div className={'bk-chg ' + (change >= 0 ? 'up' : 'down')}>{change >= 0 ? '▲ Up ' : '▼ Down '}{Math.abs(change)}%<span className="muted"> from last month</span></div>}
          {bar('Revenue', rev, 'g')}{bar('Expenses', exp, 'o')}
          {p.uncategorised.count ? <Link to="/transactions/pending">Categorise {p.uncategorised.count} transactions</Link> : <Link to="/accounting/reports/pnl">Open the profit and loss</Link>}
        </Section>
        <Section title="Expenses" aside={<span className="muted small">{label}</span>}>
          <div className="muted small">Spending in {label}</div>
          <div className="bk-big">{inr(exp)}</div>
          {groups.length ? <Donut parts={groups.slice(0, 6)} /> : <Empty>No expenses recorded this month.</Empty>}
          <Link to="/transactions/pending">{o.uncategorised.count ? `Categorise ${o.uncategorised.count} transactions` : 'Open transactions'}</Link>
        </Section>
        <Section title="Customers" aside={<span className="muted small">As of today</span>}>
          <div className="muted small">Played sessions not fully paid</div>
          <div className="bk-big">{inr(owed)}</div>
          <div className="bk-split"><i className="o" style={{ width: `${Math.round((older / scale) * 100)}%` }} /><i className="n" style={{ width: `${Math.round((recent / scale) * 100)}%` }} /></div>
          <div className="legend" style={{ marginTop: 8 }}><span><i style={{ background: 'var(--i-amber)' }} />Over 30 days <b className="strong">{inr(older)}</b></span><span><i style={{ background: 'var(--strong)' }} />0 to 30 days <b className="strong">{inr(recent)}</b></span></div>
          <div className="bk-list" style={{ marginTop: 10 }}><Pair k="Advances held for future sessions" v={inr(o.advancesHeldPaise)} /><Pair k="Account credit you owe customers" v={inr(o.accountCreditOwedPaise)} /></div>
          <Link to="/accounting/reports/cb-sum">Customer balance summary</Link>
        </Section>
        <Section title="Bank accounts" aside={<span className="muted small">As of today</span>}>
          <div className="muted small">Total in cash and bank</div>
          <div className="bk-big">{inr(o.cashAndBankPaise)}</div>
          {o.accounts.length ? <div className="bk-list">{o.accounts.map((a: any) => (
            <div key={a.id} className="bk-li"><div><b className="strong">{a.name}</b><div className="muted small">In books {inr(a.balancePaise)}</div></div>
              {a.uncategorised ? <a className="bk-link" href={`#/transactions/pending/${a.id}`}>{a.uncategorised} to review</a> : <Chip tone="good">Reviewed</Chip>}</div>))}</div>
            : <Empty>No bank or cash accounts yet. Add one under Setup.</Empty>}
        </Section>
        <Section title="Revenue" aside={<span className="muted small">Last 6 months</span>}>
          <div className="muted small">Total revenue</div>
          <div className="bk-big">{inr(revRow ? revRow.cells[revRow.cells.length - 1] : 0)}</div>
          {vals.length ? <Bars labels={labels} values={vals} /> : <Empty>Nothing yet.</Empty>}
        </Section>
        <Section title="This financial year" aside={<span className="muted small">{fmtDate(fy.from)} to today</span>}>
          <div className="bk-list"><Pair k="Revenue" v={inr(fy.revenuePaise)} /><Pair k="Expenses" v={inr(fy.expensesPaise)} /><Pair k="Net profit" v={inr(fy.netProfitPaise)} /><Pair k="GST payable" v={inr(o.gstPayablePaise)} /></div>
          {o.lockedMonths.length > 0 && <div className="muted small" style={{ marginTop: 12 }}>Signed off: {o.lockedMonths.map(monthName).join(', ')}</div>}
        </Section>
      </div>
    </div>
  );
}

export function Review() {
  const t = todayISO();
  const [rc, e1] = useApi<any>('/api/accounting/reconcile');
  const [o, e2] = useApi<any>('/api/accounting/overview');
  const [bs, e3] = useApi<any>(`/api/accounting/reports/balance-sheet?asOf=${t}`);
  const [det, e4] = useApi<any>(`/api/accounting/reports/customer-balances?asOf=${t}&view=detail`);
  if (e1 || e2 || e3 || e4) return <ErrorBox msg={e1 || e2 || e3 || e4} />;
  if (!rc || !o || !bs || !det) return <Loading h={320} />;
  const rows = rc.accounts.map((a: any) => { const acc = o.accounts.find((x: any) => x.name === a.name) || {};
    return [<span>{a.name}{a.statementBalancePaise === null && <div className="muted small">No statement balance. Books figures only.</div>}</span>, a.statementBalancePaise === null ? '--' : inr(a.statementBalancePaise), inr(a.booksBalancePaise),
      a.uncategorised ? `${a.uncategorised} transactions` : '--', acc.lastTransactionDate ? fmtDate(acc.lastTransactionDate) : 'None yet',
      a.differencePaise === null ? '' : a.differencePaise === 0 ? <Chip tone="good">Matches</Chip> : <Chip tone="bad">{a.differencePaise < 0 ? '−' : '+'}{inr(Math.abs(a.differencePaise))}</Chip>]; });
  const negatives = [...bs.assets.groups, ...bs.liabilities.groups].flatMap((g: any) => g.rows).filter((r: any) => r.paise < 0);
  const over90 = det.rows.filter((r: any) => r.kind === 'row' && r.cells[8] > 90), over90Paise = over90.reduce((s: number, r: any) => s + r.cells[7], 0);
  const issue = (name: string, big: React.ReactNode, small: string, to?: string) => (
    <div className="bk-issue"><div><b className="strong">{name}</b><div className="muted small">{small}</div></div><div className="row" style={{ gap: 12 }}><span className="bk-issue-n">{big}</span>{to && <Link to={to}>View</Link>}</div></div>);
  return (
    <div className="stack">
      <Section title="Do the books agree with the bank?" pad={false}><div className="card-pad" style={{ paddingBottom: 0 }}><Note>Each account, its last statement balance and what still needs a category.</Note></div>
        <Grid heads={['Account', 'Bank balance', 'In the books', 'Uncategorised', 'Last transaction', 'Check']} nums={[1, 2]} rows={rows} empty="No bank or cash accounts yet." /></Section>
      <Section title="Common issues"><Note>Things that may need your attention.</Note>
        <div className="bk-list">
          {issue('Uncategorised transactions', String(o.uncategorised.count), `${inr(Math.abs(o.uncategorised.amountPaise))} with no category, so profit is incomplete`, '/transactions/pending')}
          {issue('Deposits not matched to a booking', String(rc.unmatchedPayments), 'UPI or bank-transfer payments with no bank deposit yet: match them below')}
          {issue('Customer balances over 90 days', String(over90.length), inr(over90Paise), '/accounting/reports/cb-det')}
          {issue('Negative asset and liability accounts', String(negatives.length), negatives.slice(0, 3).map((r: any) => r.name).join(', ') || 'None', '/accounting/reports/bs')}
          {issue('Account credit owed to customers', inr(o.accountCreditOwedPaise), 'Unused credit and refunds due')}
          {issue('Books balance', bs.balanced ? <Chip tone="good">Yes</Chip> : <Chip tone="bad">No</Chip>, bs.balanced ? 'Assets equal liabilities plus equity' : `Out of balance by ${inr(bs.differencePaise)}`, '/accounting/reports/tb')}
        </div>
      </Section>
    </div>
  );
}
