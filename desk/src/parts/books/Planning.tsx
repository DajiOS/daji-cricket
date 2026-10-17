// Cash flow, budget against actual, GST summary and fixed assets.
import { useState } from 'react';
import { post, del, inr, fmtDate, thisMonth, useApi, qs } from '../../lib';
import { Field, Chip, ErrorBox, Loading, Icon, DateInput } from '../../ui';
import { Grid, Money, GRow, Section, Note, ExportBar, useAct, monthName } from './kit';
import { BudgetDialog, AssetDialog, DisposeDialog } from './dialogs';

const Hint = ({ children }: { children: React.ReactNode }) => <p className="muted small" style={{ margin: '0 0 12px' }}>{children}</p>;

export function CashFlow() {
  const [month, setMonth] = useState(thisMonth());
  const path = `/api/accounting/reports/cash-flow?month=${month}`;
  const [c, e] = useApi<any>(month ? path : null);
  const rows: GRow[] = [];
  if (c) {
    rows.push({ cls: 'grp', cells: ['Money at the start', <Money p={c.openingPaise} />] });
    const part = (title: string, s: any) => { rows.push({ cls: 'grp2', cells: [title, ''] }); for (const r of s.rows) rows.push({ cells: [r.name, <Money p={r.paise} />] }); rows.push({ cls: 'sub', cells: [`Net from ${title.toLowerCase()}`, <Money p={s.totalPaise} />] }); };
    part('Operating (running the ground)', c.operating); part('Investing (equipment bought)', c.investing); part('Financing (owner money and loans)', c.financing);
    if (c.betweenAccountsPaise) rows.push({ cells: ['Moved between your own accounts', <Money p={c.betweenAccountsPaise} />] });
    if (c.newAccountsOpeningPaise) rows.push({ cells: ['Opening balances of accounts added in the period', <Money p={c.newAccountsOpeningPaise} />] });
    rows.push({ cls: 'net', cells: ['Money at the end', <Money p={c.closingPaise} />] });
  }
  return (
    <Section title="Cash flow statement" aside={<ExportBar path={() => path} name={() => `cash-flow-${month}`} />}>
      <div className="form-grid" style={{ marginBottom: 14 }}><Field label="Month"><input className="inp" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field></div>
      {e ? <ErrorBox msg={e} /> : !c ? <Loading h={200} /> : <>
        <Hint>{fmtDate(c.range.from)} to {fmtDate(c.range.to)}. {c.ties ? 'Ties to the cash and bank on the balance sheet.' : 'Does not tie to the balance sheet; check for edited past entries.'}</Hint>
        <Grid heads={['', 'Amount']} nums={[1]} rows={rows} />{c.notes.map((n: string, i: number) => <Hint key={i}>{n}</Hint>)}</>}
    </Section>
  );
}

const BSTATUS: Record<string, [any, string]> = { ok: ['good', 'On track'], over: ['bad', 'Over'], under: ['mute', 'Under'], unbudgeted: ['mute', 'No budget'] };
export function Budget() {
  const [month, setMonth] = useState(thisMonth()); const [dlg, setDlg] = useState(false);
  const path = `/api/accounting/reports/budget?month=${month}`;
  const [b, e, reload] = useApi<any>(month ? path : null);
  const heads = ['', 'Budget', 'Actual', 'Better / worse', 'Used', ''];
  const rows = (l: any[]) => l.map((r) => [r.name, r.budgetPaise ? inr(r.budgetPaise) : '', inr(r.actualPaise), r.budgetPaise ? <Money p={r.variancePaise} /> : '', r.percentUsed === null ? '' : r.percentUsed + '%', <Chip tone={BSTATUS[r.status]![0]}>{BSTATUS[r.status]![1]}</Chip>]);
  return (
    <Section title="Budget against actual" aside={<><ExportBar path={() => path} name={() => `budget-${month}`} /><button className="btn sm primary" onClick={() => setDlg(true)}>Set monthly budgets</button></>}>
      <div className="form-grid" style={{ marginBottom: 14 }}><Field label="Month"><input className="inp" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field></div>
      {e ? <ErrorBox msg={e} /> : !b ? <Loading h={200} /> : <>
        <Hint>{fmtDate(b.range.from)} to {fmtDate(b.range.to)}. Budget profit {inr(b.totals.budgetProfitPaise)}, actual {inr(b.totals.actualProfitPaise)}.</Hint>
        <div className="eyebrow">Income</div><Grid heads={heads} nums={[1, 2, 3, 4]} rows={rows(b.income)} empty="No income lines." />
        <div className="eyebrow" style={{ marginTop: 16 }}>Expenses</div><Grid heads={heads} nums={[1, 2, 3, 4]} rows={rows(b.expenses)} empty="No expense lines." />
        {b.notes.map((n: string, i: number) => <Hint key={i}>{n}</Hint>)}</>}
      {dlg && <BudgetDialog onClose={() => setDlg(false)} done={reload} />}
    </Section>
  );
}

export function Gst() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const path = '/api/accounting/reports/gst' + (from && to ? qs({ from, to }) : '');
  const [g, e] = useApi<any>(path);
  const rows: GRow[] = g ? g.rows.map((r: any) => ({ cells: [monthName(r.month), inr(r.taxableValuePaise), inr(r.gstCollectedPaise), inr(r.gstPaidPaise), <Money p={r.netPaise} />] })) : [];
  if (g) rows.push({ cls: 'sub', cells: ['Total', inr(g.totals.taxableValuePaise), inr(g.totals.gstCollectedPaise), inr(g.totals.gstPaidPaise), <Money p={g.totals.netPaise} />] });
  return (
    <Section title="GST summary" aside={<ExportBar path={() => path} name={() => 'gst-summary'} />}>
      <div className="form-grid" style={{ marginBottom: 6 }}>
        <Field label="From"><DateInput className="inp" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><DateInput className="inp" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Note>Leave the dates empty for the financial year so far.</Note>
      {e ? <ErrorBox msg={e} /> : !g ? <Loading h={200} /> : <>
        <Hint>{fmtDate(g.range.from)} to {fmtDate(g.range.to)} at {g.percent}%. GST payable at the end: {inr(g.payableAtEndPaise)}.</Hint>
        <Grid heads={['Month', 'Sales before GST', 'GST collected', 'GST paid', 'Net to pay']} nums={[1, 2, 3, 4]} rows={rows} />{g.notes.map((n: string, i: number) => <Hint key={i}>{n}</Hint>)}</>}
    </Section>
  );
}

export function Assets() {
  const act = useAct(); const [dlg, setDlg] = useState<null | 'add' | any>(null);
  const [a, e, reload] = useApi<any>('/api/accounting/assets');
  return (
    <Section title="Fixed assets" aside={<>
      <ExportBar path={() => '/api/accounting/assets'} name={() => 'fixed-assets'} />
      <button className="btn sm" onClick={() => act(() => post('/api/accounting/assets/depreciate', {}).then((r) => { reload(); if (r.skippedLocked?.length) throw new Error('Skipped signed-off months: ' + r.skippedLocked.join(', ')); return r; }), (r) => (r.posted ? `Posted ${r.posted} entr${r.posted === 1 ? 'y' : 'ies'}` : 'Nothing to post'))}>Post depreciation now</button>
      <button className="btn sm primary" onClick={() => setDlg('add')}><Icon name="plus" />Add an asset</button></>}>
      {e ? <ErrorBox msg={e} /> : !a ? <Loading h={200} /> : <>
        <div className="grid g3" style={{ marginBottom: 14 }}>{[['Cost', a.totals.costPaise], ['Depreciated', a.totals.depreciatedPaise], ['Book value', a.totals.bookValuePaise]].map(([l, v]) => <div key={l as string} className="bk-mini"><span>{l}</span><b>{inr(v as number)}</b></div>)}</div>
        <Grid heads={['Asset', 'Cost', 'Depreciated', 'Book value', 'Status', '']} nums={[1, 2, 3]} empty="No assets yet. Add the bowling machine, nets, roller, floodlights."
          rows={a.items.map((x: any) => [<span>{x.name}<div className="muted small">bought {fmtDate(x.purchaseDate)}, {x.lifeMonths} months</div></span>, inr(x.costPaise), inr(x.depreciatedPaise), inr(x.bookValuePaise), <Chip tone={x.status === 'disposed' ? 'mute' : 'good'}>{x.status}</Chip>,
            <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>{x.status !== 'disposed' && <button className="btn sm ghost" onClick={() => setDlg(x)}>Sold or scrapped</button>}{!x.monthsPosted && <button className="btn sm ghost" onClick={() => act(() => del('/api/accounting/assets/' + x.id).then(reload), () => 'Removed')}>Remove</button>}</span>])} />
        <Hint>Depreciation is posted for each finished month automatically. When you buy an asset, categorise the bank payment as "Equipment or asset bought" so it is not counted as an expense.</Hint></>}
      {dlg === 'add' && <AssetDialog onClose={() => setDlg(null)} done={reload} />}
      {dlg && dlg !== 'add' && <DisposeDialog a={dlg} onClose={() => setDlg(null)} done={reload} />}
    </Section>
  );
}
