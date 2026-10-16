// Every refund waits here for the super admin before any money moves.
import { useState } from 'react';
import { post, useApi, inr, fmtDateTime } from '../../lib';
import { ErrorBox, Loading, Table, useToast } from '../../ui';
import { Panel, errText } from './common';

export function RefundApprovals() {
  const [d, e, reload] = useApi<{ items: any[] }>('/api/admin/refunds');
  const [busy, setBusy] = useState<string | null>(null); const toast = useToast();
  if (e) return <ErrorBox msg={e} />;
  if (!d) return <Loading h={120} />;
  const act = async (id: string, path: string, body: object, msg: string) => { setBusy(id); try { await post(`/api/admin/refunds/${id}/${path}`, body); toast(msg); reload(); } catch (x) { toast(errText(x)); } finally { setBusy(null); } };
  const decline = (id: string) => { const reason = window.prompt('Why is this refund declined?'); if (reason?.trim()) act(id, 'decline', { reason: reason.trim() }, 'Declined'); };
  return (
    <Panel title="Refunds waiting for you" note="Nothing is paid back until you authorise it. Online refunds are sent within a minute of approval; UPI refunds are then paid by staff and marked done.">
      <Table rows={d.items} empty="No refunds are waiting." cols={[
        { head: 'Asked', cell: (r) => fmtDateTime(r.createdAt) },
        { head: 'Amount', cell: (r) => inr(r.amountPaise, 2), num: true },
        { head: 'How', cell: (r) => (r.mode === 'gateway' ? 'Back to the card or UPI via Razorpay' : 'Paid by hand') },
        { head: 'Reason', cell: (r) => r.reason ?? '' },
        { head: '', cell: (r) => <div className="row" style={{ gap: 6 }}><button className="btn sm primary" disabled={busy === r.id} onClick={() => act(r.id, 'approve', {}, 'Authorised')}>Authorise</button><button className="btn sm ghost" disabled={busy === r.id} onClick={() => decline(r.id)}>Decline</button></div> },
      ]} />
    </Panel>
  );
}
