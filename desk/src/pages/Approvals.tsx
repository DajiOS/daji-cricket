import { lazy, Suspense, useState } from 'react';
import { useApi, post, inr, fmtDay, can, go } from '../lib';
import { useSession } from '../App';
import { ErrorBox, Loading, useToast } from '../ui';
import { timeRange, errText, type Booking } from '../parts/dash/common';
import type { Bill } from '../parts/bills/common';
const BillsTable = lazy(() => import('./ApprovalsList'));

// Approvals, as in the design: everything waiting on a decision on one stage board (Submitted, Review, Approval, Final sign-off, Done),
// filtered by kind, with the selected item's facts, its sign-off chain and the decision. The old bills table is still at /approvals/bills.
type Kind = 'bill' | 'book' | 'upi';
const K: Record<Kind, { name: string; ink: string; tint: string; href: string }> = {
  bill: { name: 'Bills', ink: '#B86E12', tint: 'var(--t-amber)', href: '/bills' },
  book: { name: 'Booking approvals', ink: 'var(--i-green)', tint: 'var(--t-green)', href: '/bookings/approvals' },
  upi: { name: 'UPI payments', ink: '#0B5F67', tint: 'var(--t-teal)', href: '/bookings/payments' },
};
const ST: [string, string, string, string][] = [
  ['Submitted', 'New in', 'var(--i-blue)', 'var(--t-blue)'], ['Review', 'First check', '#0B5F67', 'var(--t-teal)'],
  ['Approval', 'Manager sign-off', 'var(--i-amber)', 'var(--t-amber)'], ['Final sign-off', 'Ready to pay', 'var(--i-violet)', 'var(--t-violet)'],
  ['Done', 'Paid or confirmed', 'var(--i-green)', 'var(--t-green)'],
];
const CHAIN: Record<Kind, string[]> = {
  bill: ['Entered by the team', 'Approved by someone else', 'Paid'],
  book: ['Customer pays the deposit', 'You approve the booking', 'Session played'],
  upi: ['Customer sends the UPI payment', 'Checked against the bank', 'Booking confirmed'],
};
const RULE: Record<Kind, string> = {
  bill: 'A bill is approved by someone other than the person who entered it. The owner can approve any bill.',
  book: 'The deposit is holding the slot until you approve it.',
  upi: 'Approve only once the money shows in the bank. Rejecting tells the customer it was not received.',
};
interface Pay { id: string; bookingId: string; amountPaise: number; reference: string | null; submittedAt: number | null; createdAt: number }
type Item = { key: string; id: string; k: Kind; stage: number; step: number; title: string; who: string; amount: number | null; since: number | null; bill?: Bill };
const age = (t: number | null) => {
  if (!t) return '—';
  const h = Math.floor((Date.now() - t) / 3600000);
  return h < 1 ? 'Under an hour' : h < 24 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.floor(h / 24)} day${h < 48 ? '' : 's'}`;
};

export default function Approvals({ sub }: { sub: string }) {
  if (sub === 'bills') return <Suspense fallback={<Loading />}><BillsTable sub="" /></Suspense>;
  return <Board />;
}

function Board() {
  const s = useSession(); const toast = useToast();
  const me = s.me;
  const boss = me.role === 'owner' || me.role === 'super_admin';
  const acct = can(me, 'manage_accounting'), books = can(me, 'manage_bookings'), upiOk = can(me, 'verify_payments') || can(me, 'record_payments');
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [v, setV] = useState(0);
  const dep = [s.ownerId, v];
  const [draft] = useApi<{ items: Bill[] }>(acct ? '/api/accounting/bills?status=draft' : null, dep);
  const [pend, err] = useApi<{ items: Bill[] }>(acct ? '/api/accounting/bills?status=pending_approval' : null, dep);
  const [appr] = useApi<{ items: Bill[] }>(acct ? '/api/accounting/bills?status=approved' : null, dep);
  const [paid] = useApi<{ items: Bill[] }>(acct ? '/api/accounting/bills?status=paid' : null, dep);
  const [bks] = useApi<{ items: Booking[] }>(books ? '/api/staff/bookings?approval=pending&limit=100' : null, dep);
  const [pays] = useApi<{ items: Pay[] }>(upiOk ? '/api/staff/payments?status=submitted&limit=50' : null, dep);
  const loaded = (!acct || (draft && pend && appr && paid)) && (!books || bks) && (!upiOk || pays);

  const week = Date.now() - 7 * 86400000;
  const bill = (b: Bill, stage: number, step: number): Item => ({ key: 'b' + b.id, id: b.id, k: 'bill', stage, step, title: `${b.vendorName}${b.billNo ? ' · ' + b.billNo : ''}`, who: b.createdByName ?? '', amount: b.amountPaise, since: stage === 4 ? Date.parse(b.paidDate ?? '') || null : b.submittedAt ?? b.createdAt, bill: b });
  const all: Item[] = [
    ...(draft?.items ?? []).map((b) => bill(b, 0, 0)), ...(pend?.items ?? []).map((b) => bill(b, 2, 1)), ...(appr?.items ?? []).map((b) => bill(b, 3, 2)),
    ...(paid?.items ?? []).filter((b) => (Date.parse(b.paidDate ?? '') || 0) >= week).map((b) => bill(b, 4, 3)),
    ...(bks?.items ?? []).map((b): Item => ({ key: 'k' + b.id, id: b.id, k: 'book', stage: 2, step: 1, title: `${b.customerName} · ${fmtDay(b.date)}`, who: `${b.groundName} · ${timeRange(b)}`, amount: b.paidPaise, since: b.createdAt })),
    ...(pays?.items ?? []).map((p): Item => ({ key: 'u' + p.id, id: p.id, k: 'upi', stage: 1, step: 1, title: `UPI ${inr(p.amountPaise)}${p.reference ? ' · ' + p.reference : ''}`, who: '', amount: p.amountPaise, since: p.submittedAt ?? p.createdAt })),
  ];
  const kinds = (Object.keys(K) as Kind[]).filter((k) => all.some((x) => x.k === k) || (k === 'bill' && acct) || (k === 'book' && books) || (k === 'upi' && upiOk));
  const vis = all.filter((x) => filter === 'all' || x.k === filter);
  const open = all.filter((x) => x.stage < 4);
  const cur = all.find((x) => x.key === sel) ?? vis.find((x) => x.stage < 4) ?? vis[0];
  const canDecide = (x: Item) => (x.k === 'bill' ? x.stage === 2 && acct && (boss || x.bill?.createdBy !== me.id) : x.k === 'book' ? books : upiOk);
  const canSendBack = (x: Item) => x.k !== 'book';

  async function decide(x: Item, yes: boolean) {
    if (!yes && !note.trim()) { setMsg('Write a short note first, so the person knows what to fix.'); return; }
    setBusy(true); setMsg(null);
    try {
      if (x.k === 'bill') await post(`/api/accounting/bills/${x.id}/${yes ? 'approve' : 'reject'}`, yes ? undefined : { reason: note.trim() });
      else if (x.k === 'book') await post(`/api/staff/bookings/${encodeURIComponent(x.id)}/approve`, {});
      else await post(`/api/staff/payments/${encodeURIComponent(x.id)}/verify`, yes ? { approve: true } : { approve: false, reason: note.trim() });
      toast(yes ? 'Approved.' : 'Sent back.'); setNote(''); setSel(null); setV((n) => n + 1); s.refreshCounts();
    } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }

  return (
    <div className="dap">
      <div className="dap-hd">
        <div><span className="eyebrow">Everything waiting on a decision · {s.me.businessName || 'Daji Cricket Ground'}</span><h1>Approvals</h1></div>
        <span className="muted">Waiting on you: {open.filter(canDecide).length} · <a href="#/approvals/bills">Bills table</a></span>
      </div>
      <div role="tablist" className="dtabs">
        <button type="button" role="tab" aria-selected={filter === 'all'} className={`dchip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All · {open.length}</button>
        {kinds.map((k) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={`dchip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{K[k].name} · {open.filter((x) => x.k === k).length}</button>)}
      </div>
      <ErrorBox msg={err} />
      {!loaded ? <Loading h={300} /> : (<>
        <div className="dap-stages">
          {ST.map((st, i) => <span key={st[0]} className={`dap-chev${i === 0 ? ' first' : ''}${i === 4 ? ' last' : ''}`} style={{ background: st[3], color: st[2] }}><b>{st[0]}</b><span>{vis.filter((x) => x.stage === i).length}</span></span>)}
        </div>
        <div className="dap-row">
          <div className="dap-board-wrap">
            <div className="dap-board">
              {ST.map((st, si) => (
                <div key={st[0]} className="dap-col" style={{ background: st[3] }}>
                  <span className="dap-who" style={{ color: st[2] }}>{st[1]}</span>
                  {vis.filter((x) => x.stage === si).map((x) => (
                    <button key={x.key} type="button" className={`dap-card${cur?.key === x.key ? ' on' : ''}`} onClick={() => { setSel(x.key); setMsg(null); }}>
                      <span className="dap-tag" style={{ color: K[x.k].ink, background: K[x.k].tint }}>{K[x.k].name}</span>
                      <b>{x.title}</b>
                      <span className="muted">{[x.amount != null ? inr(x.amount) : '', x.who].filter(Boolean).join(' · ')}</span>
                    </button>))}
                </div>))}
            </div>
            {!all.length && <p className="muted" style={{ margin: '10px 2px' }}>Nothing is waiting for a decision. New bills, bookings to approve and UPI payments to check show here.</p>}
          </div>
          {cur && (
            <aside aria-label="Selected approval" className="dcard dap-panel">
              <span className="dap-tag" style={{ color: K[cur.k].ink, background: K[cur.k].tint }}>{K[cur.k].name}</span>
              <h2>{cur.title}</h2>
              <span className="muted" style={{ fontSize: 14 }}>{[cur.amount != null ? inr(cur.amount) : '', cur.who].filter(Boolean).join(' · ')}</span>
              <div className="dap-facts">
                <div><span>Stage</span><b>{ST[cur.stage]![0]}</b></div>
                <div><span>{cur.stage === 4 ? 'Finished' : 'Waiting'}</span><b>{cur.stage === 4 ? 'Done' : age(cur.since)}</b></div>
              </div>
              <ol aria-label="Approval chain" className="dap-chain">
                {CHAIN[cur.k].map((who, i, arr) => {
                  const done = i < cur.step, now = i === cur.step;
                  return (
                    <li key={who}>
                      <span className="dap-rail"><span className={`dap-mark${done ? ' done' : now ? ' now' : ''}`}>{done ? '✓' : i + 1}</span>{i < arr.length - 1 && <i className={done ? 'done' : ''} />}</span>
                      <span className="dap-step"><b>{who}</b><span className="muted">{done ? 'Done' : now ? 'Waiting now' : 'Not yet'}</span></span>
                    </li>);
                })}
              </ol>
              <span className="dap-rule">{RULE[cur.k]}</span>
              {canDecide(cur) ? (<>
                <div className="field" style={{ margin: 0 }}><label htmlFor="apNote">Note</label><textarea id="apNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
                <div className="dap-acts">
                  <button type="button" className="dap-yes" disabled={busy} onClick={() => decide(cur, true)}>Approve</button>
                  {canSendBack(cur) && <button type="button" className="dap-no" disabled={busy} onClick={() => decide(cur, false)}>Send back</button>}
                  <a href={`#${cur.k === 'bill' ? `/bills/${cur.id}` : cur.k === 'book' ? `/bookings/${cur.id}` : K[cur.k].href}`} className="dap-open">Open</a>
                </div>
              </>) : <button type="button" className="dbtn" onClick={() => go(cur.k === 'bill' ? `/bills/${cur.id}` : K[cur.k].href)}>Open in {K[cur.k].name}</button>}
              {msg && <div className="err" style={{ margin: 0 }}>{msg}</div>}
            </aside>)}
        </div>
      </>)}
    </div>
  );
}
