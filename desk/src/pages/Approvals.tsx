import { useState } from 'react';
import { useApi, post, inr, fmtDate, fmtDateTime, go, can } from '../lib';
import { useSession } from '../App';
import { PageHead, Stat, ErrorBox, Loading, Empty, Icon, useToast } from '../ui';
import { DueText, RejectModal, type Bill, type Stats } from '../parts/bills/common';

export default function Approvals({ sub }: { sub: string }) {
  void sub;
  const s = useSession(); const toast = useToast();
  const [q, err, reload] = useApi<{ items: Bill[]; stats: Stats }>('/api/accounting/bills?status=pending_approval');
  const [week] = useApi<{ items: Bill[] }>('/api/accounting/bills?status=approved&dueWeek=1');
  const [rejecting, setRejecting] = useState<Bill | null>(null);
  const boss = s.me.role === 'owner' || s.me.role === 'super_admin';
  const mayDecide = (b: Bill) => can(s.me, 'manage_accounting') && (boss || b.createdBy !== s.me.id);
  const approve = async (b: Bill) => { try { await post(`/api/accounting/bills/${b.id}/approve`); toast(`Approved ${b.vendorName} ${inr(b.amountPaise)}`); reload(); s.refreshCounts(); } catch (e: any) { toast(e.message); } };
  const items = q?.items ?? [];
  const actions = (b: Bill) => mayDecide(b) ? (
    <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
      <button className="btn sm danger" onClick={() => setRejecting(b)}>Reject</button>
      <button className="btn sm primary" onClick={() => approve(b)}><Icon name="check" />Approve</button>
    </div>) : <span className="small muted">You entered this</span>;
  return (
    <div className="stack">
      <PageHead eyebrow="Money out" title="Approvals" lede="Bills waiting for a decision. Approve to release them for payment, or reject with a reason." />
      <ErrorBox msg={err} />
      <div className="grid g3">
        <Stat label="Waiting" value={items.length} foot={inr(q?.stats.pendingPaise)} />
        <Stat label="Overdue bills" value={q?.stats.overdueCount ?? 0} foot={inr(q?.stats.overduePaise)} />
        <Stat label="Approved, ready to pay" value={q?.stats.approvedCount ?? 0} foot={inr(q?.stats.approvedPaise)} />
      </div>
      <div className="card">
        <div className="card-head"><h3>Bills waiting for approval</h3><a href="#/bills" className="small">All bills</a></div>
        {!q ? <div className="card-pad"><Loading /></div> : !items.length ? <Empty>Nothing is waiting. New bills sent for approval show up here.</Empty> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Vendor</th><th className="hide-sm">Entered by</th><th className="hide-sm">Due</th><th className="num">Amount</th><th className="hide-sm" /></tr></thead>
            <tbody>{items.map((b) => (
              <tr key={b.id}>
                <td><a href={`#/bills/${b.id}`} className="strong">{b.vendorName}</a><div className="small faint">{b.billNo ? `${b.billNo} · ` : ''}{b.categoryName ?? 'No category'} · {fmtDate(b.billDate)}</div>
                  <div className="bills-sm-only"><DueText b={b} /></div><div className="bills-sm-only">{actions(b)}</div></td>
                <td className="hide-sm">{b.createdByName ?? '—'}<div className="small faint">{fmtDateTime(b.submittedAt)}</div></td>
                <td className="hide-sm"><DueText b={b} /></td>
                <td className="num strong">{inr(b.amountPaise)}</td>
                <td className="right hide-sm">{actions(b)}</td>
              </tr>))}</tbody>
          </table></div>)}
      </div>
      <div className="card">
        <div className="card-head"><h3>Approved bills due in 7 days</h3></div>
        {!week ? <div className="card-pad"><Loading h={80} /></div> : !week.items.length ? <Empty>No approved bills fall due this week.</Empty> : (
          <div className="tbl-wrap"><table className="tbl"><tbody>{week.items.map((b) => (
            <tr key={b.id} className="click" onClick={() => go(`/bills/${b.id}`)}>
              <td className="strong">{b.vendorName}<div className="small faint">{b.billNo ?? ''}</div></td><td><DueText b={b} /></td><td className="num strong">{inr(b.amountPaise)}</td>
            </tr>))}</tbody></table></div>)}
      </div>
      {rejecting && <RejectModal bill={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); toast('Bill rejected'); reload(); s.refreshCounts(); }} />}
    </div>
  );
}
