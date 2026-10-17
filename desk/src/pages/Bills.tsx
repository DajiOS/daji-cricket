import { useState } from 'react';
import { useApi, qs, inr, fmtDate, go } from '../lib';
import { PageHead, Stat, Tabs, Empty, ErrorBox, Loading, Icon, Filters, DateInput } from '../ui';
import { BillChip, DueText, type Bill, type Stats } from '../parts/bills/common';
import { BillForm } from '../parts/bills/BillForm';
import { BillDetail } from '../parts/bills/BillDetail';
import { VendorsTab } from '../parts/bills/VendorsTab';

const n = (c?: number) => `${c ?? 0} ${c === 1 ? 'bill' : 'bills'}`;
type View = 'bills' | 'vendors';
const FILTERS: [string, string][] = [['', 'All'], ['pending_approval', 'Awaiting approval'], ['approved', 'To pay'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['draft,rejected', 'Drafts and rejected']];

export default function Bills({ sub }: { sub: string }) {
  const id = sub.replace(/^\//, '').split('/')[0] ?? '';
  if (id && id !== 'vendors') return <BillDetail id={id} />;
  return <BillList view={id === 'vendors' ? 'vendors' : 'bills'} />;
}

function BillList({ view }: { view: View }) {
  const [f, setF] = useState(''); const [q, setQ] = useState(''); const [week, setWeek] = useState(false); const [cat, setCat] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [form, setForm] = useState<{ vendorId?: string } | null>(null);
  const query = qs({ status: f === 'overdue' ? '' : f, overdue: f === 'overdue' ? 1 : '', dueWeek: week ? 1 : '', q });
  const [data, err, reload] = useApi<{ items: Bill[]; stats: Stats }>(view === 'bills' ? `/api/accounting/bills${query}` : null, [view]);
  const [statsOnly] = useApi<{ items: Bill[]; stats: Stats }>(view === 'vendors' ? '/api/accounting/bills?limit=1' : null, [view]);
  const st = (data ?? statsOnly)?.stats;
  const shown = (data?.items ?? []).filter((b) => (!cat || (b.categoryName ?? 'No category') === cat) && (!from || b.billDate >= from) && (!to || b.billDate <= to));
  return (
    <div className="stack">
      <PageHead eyebrow="Money out" title="Bills" lede="Vendor bills from entry to approval to payment. Whoever enters a bill cannot approve it, unless they are the owner.">
        <button className="btn primary" onClick={() => setForm({})}><Icon name="plus" />Enter bill</button>
      </PageHead>
      <div className="grid g4">
        <Stat label="Overdue" value={<span className={st?.overdueCount ? 'bills-bad' : ''}>{inr(st?.overduePaise)}</span>} foot={n(st?.overdueCount)} />
        <Stat label="Due this week" value={inr(st?.dueWeekPaise)} foot={n(st?.dueWeekCount)} />
        <Stat label="Awaiting approval" value={inr(st?.pendingPaise)} foot={n(st?.pendingCount)} />
        <Stat label="Paid this month" value={inr(st?.paidMonthPaise)} foot={`${inr(st?.approvedPaise)} approved, unpaid`} />
      </div>
      <Tabs<View> value={view} onChange={(v) => go(v === 'vendors' ? '/bills/vendors' : '/bills')} items={[['bills', 'Bills'], ['vendors', 'Vendors']]} label="Section" />
      {view === 'vendors' ? <VendorsTab onBill={(vendorId) => setForm({ vendorId })} /> : (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Tabs value={f} onChange={setF} items={FILTERS} label="Bill status" />
            <div className="row">
              <input className="inp bills-search" placeholder="Search vendor, bill no, notes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bills" />
              <Filters active={(week ? 1 : 0) + (cat ? 1 : 0) + (from || to ? 1 : 0)}>
                <label className="row small muted" style={{ gap: 6 }}><input type="checkbox" checked={week} onChange={(e) => setWeek(e.target.checked)} />Due in 7 days</label>
                <select className="inp" style={{ width: 170 }} aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Any category</option>{[...new Set((data?.items ?? []).map((b) => b.categoryName ?? 'No category'))].sort().map((c) => <option key={c} value={c}>{c}</option>)}</select>
                <DateInput className="inp" style={{ width: 140 }} aria-label="Bills from" value={from} onChange={(e) => setFrom(e.target.value)} />
                <DateInput className="inp" style={{ width: 140 }} aria-label="Bills to" value={to} onChange={(e) => setTo(e.target.value)} />
              </Filters>
            </div>
          </div>
          <ErrorBox msg={err} />
          <div className="card">
            {!data ? <div className="card-pad"><Loading /></div> : (
              !shown.length ? <Empty>{f || q || week || cat || from || to ? 'No bills match these filters.' : 'No bills yet. Enter the first one to start the approval flow.'}</Empty> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Vendor</th><th className="hide-sm">Due</th><th className="num">Amount</th><th className="hide-sm">Status</th></tr></thead>
                <tbody>{shown.map((b) => (
                  <tr key={b.id} className="click" onClick={() => go(`/bills/${b.id}`)}>
                    <td className="bills-vendor"><div className="strong">{b.vendorName}</div>
                      <div className="small faint">{b.billNo ? `${b.billNo} · ` : ''}{b.categoryName ?? 'No category'} · {fmtDate(b.billDate)}</div>
                      <div className="small faint">Entered by {b.createdByName ?? 'unknown'}</div>
                      <div className="bills-sm-only"><BillChip s={b.status} /><DueText b={b} /></div></td>
                    <td className="hide-sm"><DueText b={b} /></td>
                    <td className="num strong">{inr(b.amountPaise)}</td>
                    <td className="hide-sm"><BillChip s={b.status} /></td>
                  </tr>))}</tbody>
              </table></div>))}
          </div>
        </>)}
      {form && <BillForm vendorId={form.vendorId} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); reload(); go(`/bills/${id}`); }} />}
    </div>
  );
}
