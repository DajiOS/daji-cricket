import { useState } from 'react';
import { Chip, ErrorBox, Stat, Table, useToast } from '../../ui';
import { fmtDateTime, inr, patch } from '../../lib';
import { API, type Detail, type Team } from './shared';

/** Entry fees: who has paid, who owes, and a quick way to record a payment. */
export function FeesTab({ d, reload }: { d: Detail; reload: () => void }) {
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const [ref, setRef] = useState<Record<string, string>>({});
  const f = d.fees, t = d.tournament;
  async function set(x: Team, paid: boolean) {
    setErr(null);
    try { await patch(`${API}/${t.id}/teams/${x.id}`, { feePaid: paid, paymentRef: paid ? ref[x.id] ?? '' : '' }); toast(paid ? 'Payment recorded' : 'Marked as unpaid'); reload(); }
    catch (e: any) { setErr(e.message); }
  }
  const pct = f.expectedPaise ? (f.collectedPaise / f.expectedPaise) * 100 : 0;
  return (
    <div className="stack">
      <div className="grid g4">
        <Stat label="Collected" value={inr(f.collectedPaise)} foot={`${f.paidTeams} of ${f.teams} teams`} meter={pct} />
        <Stat label="Still to collect" value={inr(f.pendingPaise)} foot={`${f.unpaidTeams} teams owe`} />
        <Stat label="Expected" value={inr(f.expectedPaise)} foot={`${inr(t.entryFeePaise)} per team`} />
        <Stat label="Collection" value={`${Math.round(pct)}%`} />
      </div>
      <div className="card">
        <div className="card-head"><h3>Entry fees by team</h3></div>
        <div className="card-pad" style={{ paddingBottom: err ? undefined : 0 }}><ErrorBox msg={err} /></div>
        <Table rows={d.teams} empty="No teams yet."
          cols={[
            { head: 'Team', cell: (x) => <b>{x.name}</b> },
            { head: 'Status', cell: (x) => x.feePaid ? <Chip tone="good">Paid</Chip> : <Chip tone="warn">Due</Chip> },
            { head: 'Reference', cell: (x) => x.feePaid ? x.paymentRef || <span className="muted">—</span> : <input className="inp" style={{ minWidth: 150 }} placeholder="UPI ref (optional)" value={ref[x.id] ?? ''} onChange={(e) => setRef((s) => ({ ...s, [x.id]: e.target.value }))} /> },
            { head: 'Received', cell: (x) => (x.paidAt ? fmtDateTime(x.paidAt) : <span className="muted">—</span>) },
            { head: 'Amount', num: true, cell: () => inr(t.entryFeePaise) },
            { head: '', num: true, cell: (x) => x.feePaid ? <button className="btn sm ghost" onClick={() => set(x, false)}>Mark unpaid</button> : <button className="btn sm primary" onClick={() => set(x, true)}>Mark paid</button> },
          ]} />
      </div>
    </div>
  );
}
