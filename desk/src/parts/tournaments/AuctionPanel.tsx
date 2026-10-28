// A tournament a customer hosts (server/src/auction.ts), as a player auction or with teams entering directly: its state,
// squads and rules, the hosting deposit (record it, give it back, keep it, or decide a waiver request), and hiding it
// (with a reason the host sees) or showing it again. Purses and bids are points; only the hosting deposit is money.
import { useState } from 'react';
import { Chip, ErrorBox, Field, Modal, Table, useToast } from '../../ui';
import { post, useApi } from '../../lib';
import { useSession } from '../../App';

interface DepositEntry { id: string; kind: 'collect' | 'refund' | 'keep'; amountPaise: number; method: string | null; reason: string | null; reference: string | null; createdAt: number }
export interface DepositState { requiredPaise: number; collectedPaise: number; refundedPaise: number; keptPaise: number; heldPaise: number; waived: boolean; waiver: { id: string; status: string; reason: string; decisionNote: string | null; createdAt: number } | null; claimReference: string | null; settled: boolean; entries: DepositEntry[] }
export interface AuctionSummary { id: string; mode: 'auction' | 'teams'; tournamentId: string; name: string; status: string; statusText: string; hostName: string; teams: number; players: number; sold: number; hidden: boolean; hiddenReason: string | null }
interface TeamState { id: string; name: string; ownerName: string | null; squad: number; spentPoints: number; pursePointsLeft: number; players: { playerId: string; name: string; role: string; points: number }[] }
interface View { auction: AuctionSummary; rulesInWords: string[]; teams: TeamState[]; players: { id: string; name: string; roleText: string; status: string; result: string | null; teamName: string | null; points: number | null }[]; hiddenReason: string | null; deposit: DepositState | null }

export const AUCTIONS = '/api/staff/auctions';
const pts = (n: number) => `${n.toLocaleString('en-IN')} pts`;
const rs = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const KIND_WORDS = { collect: 'Received', refund: 'Given back', keep: 'Kept' } as const;
type Act = 'collect' | 'refund' | 'keep' | 'waive' | 'decline';

/** The auctions at this business by tournament, so the list can mark which tournaments are auctions. */
export function useAuctions() {
  const [d] = useApi<{ items: AuctionSummary[] }>(AUCTIONS);
  return new Map((d?.items ?? []).map((a) => [a.tournamentId, a]));
}

export function AuctionPanel({ auctionId }: { auctionId: string }) {
  const toast = useToast();
  const [v, err, reload] = useApi<View>(`${AUCTIONS}/${auctionId}`);
  const [hide, setHide] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  if (err) return <ErrorBox msg={err} />;
  if (!v) return null;
  const a = v.auction;
  const unhide = async () => { setBusy(null); try { await post(`${AUCTIONS}/${a.id}/unhide`); toast('Shown to players again'); reload(); } catch (e: any) { setBusy(e.message); } };
  const doHide = async () => { setBusy(null); if (reason.trim().length < 3) { setBusy('Say why it is hidden. The host sees the reason.'); return; } try { await post(`${AUCTIONS}/${a.id}/hide`, { reason }); setHide(false); setReason(''); toast('Hidden. The host was told why.'); reload(); } catch (e: any) { setBusy(e.message); } };
  return (
    <div className="card">
      <div className="card-head"><h3>{a.mode === 'teams' ? 'Customer-hosted tournament (teams enter directly)' : 'Player auction'}</h3>
        <span className="row" style={{ gap: 6 }}>{a.hidden ? <Chip tone="bad">Hidden</Chip> : <Chip tone={a.status === 'live' ? 'gold' : a.status === 'completed' ? 'good' : a.status === 'cancelled' ? 'bad' : 'info'}>{a.statusText}</Chip>}
          {a.hidden ? <button className="btn sm" onClick={unhide}>Show again</button> : <button className="btn sm" onClick={() => setHide(true)}>Hide from players</button>}</span></div>
      <div className="card-pad stack">
        {!hide && <ErrorBox msg={busy} />}
        <div className="small muted">Hosted by <b>{a.hostName}</b> · {a.teams} teams{a.mode === 'teams' ? '' : <> · {a.players} players signed up · {a.sold} picked. Purses and bids are points, never money</>}; the host runs it from their own account.</div>
        {v.deposit && <DepositBox auctionId={a.id} status={a.status} d={v.deposit} onDone={reload} />}
        {a.hidden && v.hiddenReason && <div className="small">Hidden because: <b>{v.hiddenReason}</b></div>}
        <Table rows={v.teams} empty="The host has not added teams yet."
          cols={[
            { head: 'Team', cell: (t) => <><b>{t.name}</b>{t.ownerName && <div className="small muted">Owner {t.ownerName}</div>}</> },
            { head: 'Squad', cell: (t) => t.players.length ? t.players.map((p) => `${p.name} (${pts(p.points)})`).join(', ') : <span className="muted">None yet</span> },
            { head: 'Spent', num: true, cell: (t) => pts(t.spentPoints) },
            { head: 'Left', num: true, cell: (t) => pts(t.pursePointsLeft) },
          ]} />
        <details><summary className="small">Rules</summary><ol className="small">{v.rulesInWords.map((r, i) => <li key={i}>{r}</li>)}</ol></details>
      </div>
      {hide && <Modal title="Hide this tournament" onClose={() => setHide(false)} foot={<><button className="btn ghost" onClick={() => setHide(false)}>Keep it</button><button className="btn primary" onClick={doHide}>Hide</button></>}>
        <p className="small muted">Players stop seeing it and the host can no longer change it. The host sees your reason.</p>
        <ErrorBox msg={busy} />
        <Field label="Reason" required><input className="inp" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>}
    </div>
  );
}

/** The hosting deposit: what is due, held, given back or kept, the host's payment reference and any waiver request. */
function DepositBox({ auctionId, status, d, onDone }: { auctionId: string; status: string; d: DepositState; onDone: () => void }) {
  const toast = useToast();
  const { me } = useSession();
  const boss = me.role === 'owner' || me.role === 'super_admin';
  const [act, setAct] = useState<Act | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('upi');
  const [reference, setReference] = useState('');
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const due = d.waived ? 0 : Math.max(0, d.requiredPaise - d.collectedPaise);
  const over = status === 'completed' || status === 'cancelled';
  const open = (k: Act) => { setErr(null); setAct(k); setAmount(String(((k === 'collect' ? due : d.heldPaise) / 100))); setReference(k === 'collect' ? d.claimReference ?? '' : ''); setText(''); };
  const send = async () => {
    setErr(null);
    if (act === 'keep' && text.trim().length < 10) { setErr('Say why the deposit is kept (at least 10 characters). The host sees it.'); return; }
    if (act === 'decline' && !text.trim()) { setErr('Say why the request is turned down. The host sees it.'); return; }
    if ((act === 'collect' || act === 'refund' || act === 'keep') && !(Number(amount) > 0)) { setErr('Enter the amount in rupees.'); return; }
    try {
      if (act === 'waive' || act === 'decline') await post(`${AUCTIONS}/${auctionId}/deposit/waiver`, { approve: act === 'waive', ...(text.trim() ? { note: text.trim() } : {}) });
      else {
        const amountPaise = Math.round(Number(amount) * 100);
        await post(`${AUCTIONS}/${auctionId}/deposit/${act}`, { amountPaise, ...(act === 'keep' ? { reason: text.trim() } : { method }), ...(reference.trim() ? { reference: reference.trim() } : {}) });
      }
      toast(act === 'collect' ? 'Deposit recorded' : act === 'refund' ? 'Deposit given back' : act === 'keep' ? 'Deposit kept. The host was told why.' : act === 'waive' ? 'Deposit waived. The tournament is open to players.' : 'Request turned down. The host was told why.');
      setAct(null); onDone();
    } catch (e: any) { setErr(e.message); }
  };
  const tone = d.waived ? 'info' : d.heldPaise > 0 ? 'gold' : d.settled ? 'good' : 'warn';
  const label = d.requiredPaise === 0 ? 'None needed' : d.waived ? 'Waived' : !d.settled ? `${rs(due)} due` : d.heldPaise > 0 ? `${rs(d.heldPaise)} held` : 'Settled';
  const titles: Record<Act, string> = { collect: 'Record the deposit received', refund: 'Give the deposit back', keep: 'Keep the deposit', waive: 'Waive the deposit', decline: 'Turn down the waiver request' };
  return (
    <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>Hosting deposit</b><Chip tone={tone}>{label}</Chip>
        {due > 0 && <button className="btn sm" onClick={() => open('collect')}>Record received</button>}
        {d.heldPaise > 0 && <button className="btn sm" onClick={() => open('refund')}>Give back</button>}
        {d.heldPaise > 0 && boss && over && <button className="btn sm ghost" onClick={() => open('keep')}>Keep it</button>}
      </div>
      <div className="small muted">Due {rs(d.requiredPaise)} · received {rs(d.collectedPaise)} · given back {rs(d.refundedPaise)} · kept {rs(d.keptPaise)}. Players see the tournament once it is paid or waived. Give it back in full when the tournament ends; keep it only if the matches were not played at the ground or the host cancelled after the auction.</div>
      {d.claimReference && <div className="small">The host says they paid. Reference: <b>{d.claimReference}</b>. Check it arrived, then record it.</div>}
      {d.waiver && <div className="small">Waiver request ({d.waiver.status}): “{d.waiver.reason}”{d.waiver.decisionNote && <> · Note: {d.waiver.decisionNote}</>}
        {d.waiver.status === 'pending' && (boss
          ? <span className="row" style={{ gap: 6, marginTop: 6 }}><button className="btn sm primary" onClick={() => open('waive')}>Waive it</button><button className="btn sm" onClick={() => open('decline')}>Turn down</button></span>
          : <div className="muted">Only the owner can waive a deposit.</div>)}</div>}
      {d.entries.length > 0 && <Table rows={d.entries} rowKey={(e) => e.id}
        cols={[
          { head: 'When', cell: (e) => new Date(e.createdAt).toLocaleDateString('en-IN') },
          { head: 'What', cell: (e) => <>{KIND_WORDS[e.kind]}{e.method && <span className="muted"> · {e.method.toUpperCase()}</span>}{e.reason && <div className="small muted">{e.reason}</div>}</> },
          { head: 'Reference', cell: (e) => e.reference ?? '' },
          { head: 'Amount', num: true, cell: (e) => rs(e.amountPaise) },
        ]} />}
      {act && <Modal title={titles[act]} onClose={() => setAct(null)} foot={<><button className="btn ghost" onClick={() => setAct(null)}>Back</button><button className="btn primary" onClick={send}>Save</button></>}>
        <ErrorBox msg={err} />
        {(act === 'collect' || act === 'refund' || act === 'keep') && <Field label="Amount (₹)" required><input className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
        {(act === 'collect' || act === 'refund') && <Field label="How"><select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}><option value="upi">UPI</option><option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="card">Card</option></select></Field>}
        {(act === 'collect' || act === 'refund') && <Field label="Reference"><input className="inp" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} /></Field>}
        {act === 'keep' && <Field label="Why it is kept (the host sees this)" required hint="Only if the matches were not played at the ground or the host cancelled after the auction."><textarea className="inp" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} /></Field>}
        {act === 'waive' && <Field label="Note to the host"><input className="inp" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} /></Field>}
        {act === 'decline' && <Field label="Why not (the host sees this)" required><input className="inp" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} /></Field>}
      </Modal>}
    </div>
  );
}
