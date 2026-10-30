// Work › Cash (cashbook.ts, Sunny 30 Oct 2026): cash the owner hands to a team member (the supervisor) to spend for the business.
// The owner sees everyone who holds cash and hands it out; a holder sees their own cash, enters what they spend with a receipt
// photo (read for them when the AI connection is set up) and counts what is in hand. Every spend waits for the owner on the
// Approvals board. These are the business's own cash records: nothing here is posted to the books.
import { useRef, useState } from 'react';
import { fetchBytes, go, inr, post, sendFile, shrinkPhoto, toPaise, todayISO, fmtDay, useApi } from '../lib';
import { useSession } from '../App';
import { Chip, DateInput, ErrorBox, Field, Loading, Modal, PageHead, Stat, Table, Tabs, useToast } from '../ui';
import { Panel, errText } from '../parts/admin/common';

interface LastCount { countedPaise: number; expectedPaise: number; differencePaise: number; at: number; byName: string | null; note: string | null }
interface Balance { holderId: string; holderName: string | null; givenPaise: number; spentConfirmedPaise: number; spentWaitingPaise: number; expectedPaise: number; confirmedPaise: number; waiting: number; missingReceipts: number; uncertain: number; lastCount: LastCount | null }
interface Entry { id: string; kind: 'advance' | 'return' | 'expense'; amountPaise: number; date: string; description: string; payee: string | null; areaName: string | null; projectName: string | null; hasReceipt: boolean; uncertain: boolean; uncertainNote: string | null; status: 'confirmed' | 'waiting' | 'sent_back' | 'withdrawn'; decidedByName: string | null; decidedNote: string | null; hidden: boolean; hiddenReason: string | null; createdByName: string | null }
interface Draft { amountPaise: number | null; date: string | null; payee: string; description: string; sure: boolean; readable: boolean }

const KIND: Record<Entry['kind'], string> = { advance: 'Cash handed over', return: 'Cash taken back', expense: 'Spent' };
const STATUS: Record<Entry['status'], [Parameters<typeof Chip>[0]['tone'], string]> = { confirmed: ['good', 'Confirmed'], waiting: ['warn', 'Waiting for sign-off'], sent_back: ['bad', 'Sent back'], withdrawn: ['mute', 'Taken back'] };
const key = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const diffWords = (d: number) => (d === 0 ? 'matches' : d < 0 ? `${inr(-d)} short` : `${inr(d)} over`);

export default function Cash() {
  const { me, ownerId } = useSession();
  const boss = me.role !== 'staff';
  const [data, err, reload] = useApi<{ items: Balance[] }>('/api/cash/wallets', [ownerId]);
  const [open, setOpen] = useState<string | null>(null);
  const [giving, setGiving] = useState(false);
  if (err) return <ErrorBox msg={err} />;
  if (!data) return <Loading />;
  const mine = !boss ? data.items[0] ?? null : null;
  const shown = boss ? data.items.find((b) => b.holderId === open) ?? null : mine;
  return (
    <>
      <PageHead eyebrow="Work" title="Cash" lede={boss ? 'Cash you hand to your team to spend for the business. Every spend waits for you on the Approvals board.' : 'The cash you hold for the business. Enter what you spend with the receipt; the owner signs each one.'}>
        {boss && <button className="btn primary" onClick={() => setGiving(true)}>Hand out cash</button>}
        {boss && <button className="btn" onClick={() => go('/approvals/cash')}>Approvals board</button>}
      </PageHead>
      <div className="stack">
        {boss && (
          <Panel title="Who holds cash" note="Cash in hand counts every spend at once; confirmed counts only the ones you signed. These records are not posted to the books.">
            {!data.items.length ? <p className="hint">No one holds cash yet. Hand out cash to start.</p> : (
              <Table rows={data.items} rowKey={(b) => b.holderId} onRow={(b) => setOpen(b.holderId)} cols={[
                { head: 'Person', cell: (b) => <b>{b.holderName}</b> },
                { head: 'Should have', num: true, cell: (b) => inr(b.expectedPaise) },
                { head: 'Confirmed', num: true, cell: (b) => inr(b.confirmedPaise) },
                { head: 'To check', cell: (b) => <span className="row" style={{ flexWrap: 'wrap', gap: 4 }}>{b.waiting > 0 && <Chip tone="warn">{b.waiting} waiting</Chip>}{b.missingReceipts > 0 && <Chip tone="bad">{b.missingReceipts} no receipt</Chip>}{b.uncertain > 0 && <Chip tone="info">{b.uncertain} uncertain</Chip>}{!b.waiting && !b.missingReceipts && !b.uncertain && <Chip tone="good">All clear</Chip>}</span> },
                { head: 'Last count', cell: (b) => (b.lastCount ? `${inr(b.lastCount.countedPaise)}, ${diffWords(b.lastCount.differencePaise)}` : 'Not counted') },
              ]} />)}
          </Panel>
        )}
        {shown ? <Wallet b={shown} boss={boss} onChanged={reload} /> : !boss && <Wallet b={{ holderId: me.id, holderName: me.name, givenPaise: 0, spentConfirmedPaise: 0, spentWaitingPaise: 0, expectedPaise: 0, confirmedPaise: 0, waiting: 0, missingReceipts: 0, uncertain: 0, lastCount: null }} boss={false} onChanged={reload} />}
      </div>
      {giving && <GiveCash onClose={() => setGiving(false)} onDone={() => { setGiving(false); reload(); }} />}
    </>
  );
}

function Wallet({ b, boss, onChanged }: { b: Balance; boss: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [queue, setQueue] = useState<'' | 'waiting' | 'uncertain' | 'no_receipt'>('');
  const [list, err, reload] = useApi<{ items: Entry[]; balance: Balance }>(`/api/cash/wallets/${encodeURIComponent(b.holderId)}/entries${queue ? `?queue=${queue}` : ''}`, [b.holderId, queue]);
  const [modal, setModal] = useState<null | 'spend' | 'count' | 'back'>(null);
  const [hiding, setHiding] = useState<Entry | null>(null);
  const changed = () => { reload(); onChanged(); };
  const bal = list?.balance ?? b;
  const receipt = async (e: Entry) => {
    try { const buf = await fetchBytes(`/api/cash/entries/${encodeURIComponent(e.id)}/receipt`); window.open(URL.createObjectURL(new Blob([buf])), '_blank', 'noopener'); } catch (x) { toast(errText(x)); }
  };
  const attach = async (e: Entry, f: File | undefined) => {
    if (!f) return;
    try { const photo = f.type === 'application/pdf' ? f : await shrinkPhoto(f); await sendFile(`/api/cash/entries/${encodeURIComponent(e.id)}/receipt`, photo, { 'content-type': photo.type || 'image/jpeg' }); toast('Receipt added'); changed(); } catch (x) { toast(errText(x)); }
  };
  const what = (e: Entry) => <span><b className={e.hidden ? 'muted' : ''}>{e.kind === 'expense' ? (e.payee ? `${e.payee} · ${e.description}` : e.description) : `${KIND[e.kind]} · ${e.description}`}</b>
    {(e.areaName || e.projectName) && <span className="muted small"> · {[e.areaName, e.projectName].filter(Boolean).join(' › ')}</span>}
    {e.uncertain && <span className="small"> · <Chip tone="info">Uncertain</Chip>{e.uncertainNote ? ` ${e.uncertainNote}` : ''}</span>}
    {e.decidedNote && <span className="muted small"> · “{e.decidedNote}”{e.decidedByName ? ` (${e.decidedByName})` : ''}</span>}
    {e.hidden && <span className="muted small"> · Hidden: {e.hiddenReason}</span>}</span>;
  const amount = (e: Entry) => `${e.kind === 'advance' ? '+' : '−'}${inr(e.amountPaise)}`;
  const state = (e: Entry) => (e.hidden ? <Chip>Hidden</Chip> : e.kind === 'expense' ? <Chip tone={STATUS[e.status][0]}>{STATUS[e.status][1]}</Chip> : <Chip tone="good">Done</Chip>);
  const receiptCell = (e: Entry) => e.kind !== 'expense' ? null : e.hasReceipt ? <button className="btn ghost sm" onClick={(x) => { x.stopPropagation(); void receipt(e); }}>View receipt</button>
    : (boss || e.status === 'waiting') ? <label className="btn ghost sm">Add receipt<input type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(x) => void attach(e, x.target.files?.[0])} /></label> : <Chip tone="bad">No receipt</Chip>;
  const action = (e: Entry) => e.status === 'waiting' && !e.hidden ? <button className="btn ghost sm" onClick={async () => { try { await post(`/api/cash/expenses/${encodeURIComponent(e.id)}/withdraw`); toast('Taken back'); changed(); } catch (x) { toast(errText(x)); } }}>Take back</button>
    : boss && !e.hidden && e.status !== 'withdrawn' && e.status !== 'sent_back' ? <button className="btn ghost sm" onClick={() => setHiding(e)}>Hide</button> : null;
  return (
    <Panel title={boss ? `${b.holderName}'s cash` : 'Your cash'} actions={<>
      <button className="btn primary sm" onClick={() => setModal('spend')}>{boss ? 'Enter a spend for them' : 'Enter a spend'}</button>
      <button className="btn sm" onClick={() => setModal('count')}>Count the cash</button>
      {boss && <button className="btn ghost sm" onClick={() => setModal('back')}>Take cash back</button>}
    </>}>
      <div className="stack">
        <div className="grid g4 cash-stats">
          <Stat label="Should have in hand" value={inr(bal.expectedPaise)} foot={bal.spentWaitingPaise ? `${inr(bal.spentWaitingPaise)} of spends not signed yet` : 'Every spend is signed'} />
          <Stat label="Confirmed" value={inr(bal.confirmedPaise)} foot="Counting signed spends only" />
          <Stat label="Handed over" value={inr(bal.givenPaise)} foot="Less cash taken back" />
          <Stat label="Last count" value={bal.lastCount ? inr(bal.lastCount.countedPaise) : 'Not counted'} foot={bal.lastCount ? `${diffWords(bal.lastCount.differencePaise)}${bal.lastCount.byName ? ` · ${bal.lastCount.byName}` : ''}` : 'Count the cash in hand now and then'} />
        </div>
        <Tabs label="Show" value={queue} onChange={setQueue} items={[['', 'Everything'], ['waiting', `Waiting (${bal.waiting})`], ['uncertain', `Uncertain (${bal.uncertain})`], ['no_receipt', `No receipt (${bal.missingReceipts})`]]} />
        {err ? <ErrorBox msg={err} /> : !list ? <Loading h={120} /> : (<>
          <div className="hide-sm"><Table rows={list.items} rowKey={(e) => e.id} empty={queue ? 'Nothing here.' : 'Nothing entered yet.'} cols={[
            { head: 'Day', cell: (e) => fmtDay(e.date) },
            { head: 'What', cell: what },
            { head: 'Amount', num: true, cell: amount },
            { head: 'State', cell: state },
            { head: 'Receipt', cell: receiptCell },
            { head: '', cell: action },
          ]} /></div>
          {/* phones: one card per entry, so the receipt and take-back buttons are in reach without scrolling sideways */}
          <div className="cash-list stack">
            {!list.items.length && <p className="hint">{queue ? 'Nothing here.' : 'Nothing entered yet.'}</p>}
            {list.items.map((e) => (
              <div key={e.id} className="card card-pad">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}><b>{amount(e)}</b><span className="muted small">{fmtDay(e.date)}</span></div>
                <div style={{ margin: '6px 0' }}>{what(e)}</div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{state(e)}{receiptCell(e)}{action(e)}</div>
              </div>))}
          </div>
        </>)}
      </div>
      {modal === 'spend' && <Spend holderId={boss ? b.holderId : null} onClose={() => setModal(null)} onDone={() => { setModal(null); changed(); }} />}
      {modal === 'count' && <Count holderId={boss ? b.holderId : null} expected={bal.expectedPaise} onClose={() => setModal(null)} onDone={() => { setModal(null); changed(); }} />}
      {modal === 'back' && <GiveCash holderId={b.holderId} back onClose={() => setModal(null)} onDone={() => { setModal(null); changed(); }} />}
      {hiding && <Hide e={hiding} onClose={() => setHiding(null)} onDone={() => { setHiding(null); changed(); }} />}
    </Panel>
  );
}

/** Hand cash to someone (an advance or a top-up), or take some back. */
function GiveCash({ holderId, back, onClose, onDone }: { holderId?: string; back?: boolean; onClose: () => void; onDone: () => void }) {
  const [people] = useApi<{ items: { id: string; name: string }[] }>(holderId ? null : '/api/cash/people');
  const [who, setWho] = useState(holderId ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState(back ? 'Cash taken back' : 'Cash for the week');
  const [msg, setMsg] = useState<string | null>(null);
  const [k] = useState(key);
  async function save() {
    const p = toPaise(amount);
    if (!who) return setMsg('Pick the person.');
    if (!p || p < 100) return setMsg('Type the amount, at least ₹1.');
    try { await post(back ? '/api/cash/returns' : '/api/cash/advances', { holderId: who, amountPaise: p, date, description: note.trim() || (back ? 'Cash taken back' : 'Cash handed over'), clientKey: k }); onDone(); } catch (e) { setMsg(errText(e)); }
  }
  return (
    <Modal title={back ? 'Take cash back' : 'Hand out cash'} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>{back ? 'Take back' : 'Hand over'}</button></>}>
      <div className="stack">
        {!holderId && <Field label="To" required>{!people ? <Loading h={40} /> : <select className="inp" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Pick a team member</option>{people.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</Field>}
        <Field label="Amount (₹)" required><input className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" /></Field>
        <Field label="Day"><DateInput value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} /></Field>
        <Field label="Note"><input className="inp" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

/** A spend: the receipt photo first (read for you when the AI connection is set up), then the details to check. */
function Spend({ holderId, onClose, onDone }: { holderId: string | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [status] = useApi<{ ocr: boolean }>('/api/cash/status');
  const [areas] = useApi<{ items: { id: string; name: string; archived: boolean }[] }>('/api/areas');
  const [projects] = useApi<{ items: { id: string; name: string; areaId: string | null; status: string }[] }>('/api/projects');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [reading, setReading] = useState(false);
  const [f, setF] = useState({ amount: '', date: todayISO(), payee: '', description: '', areaId: '', projectId: '', uncertain: false, uncertainNote: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [k] = useState(key);
  const file = useRef<HTMLInputElement>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function pick(x: File | undefined) {
    if (!x) return;
    const p = x.type === 'application/pdf' ? x : await shrinkPhoto(x);
    setPhoto(p);
    if (!status?.ocr || x.type === 'application/pdf') return;
    setReading(true);
    try {
      const d = await sendFile<Draft>('/api/cash/receipts/read', p, { 'content-type': p.type || 'image/jpeg' });
      if (!d.readable) { toast('Could not read that receipt. Type the details in.'); return; }
      set({ amount: d.amountPaise ? (d.amountPaise / 100).toFixed(2) : f.amount, date: d.date ?? f.date, payee: d.payee || f.payee, description: d.description || f.description, ...(d.sure ? {} : { uncertain: true, uncertainNote: 'The receipt was hard to read; check the figures.' }) });
      toast(d.sure ? 'Read the receipt. Check the details.' : 'Read the receipt, but not sure of everything. Check the details.');
    } catch (e) { toast(errText(e)); } finally { setReading(false); }
  }
  async function save() {
    const p = toPaise(f.amount);
    if (!p || p < 100) return setMsg('Type the amount spent, at least ₹1.');
    if (f.description.trim().length < 2) return setMsg('Say what it was for.');
    setBusy(true); setMsg(null);
    try {
      const e = await post<{ id: string }>('/api/cash/expenses', { ...(holderId ? { holderId } : {}), amountPaise: p, date: f.date, description: f.description.trim(), payee: f.payee.trim() || undefined, areaId: f.areaId || null, projectId: f.projectId || null, uncertain: f.uncertain, uncertainNote: f.uncertain ? f.uncertainNote.trim() || undefined : undefined, clientKey: k });
      if (photo) { try { await sendFile(`/api/cash/entries/${encodeURIComponent(e.id)}/receipt`, photo, { 'content-type': photo.type || 'image/jpeg' }); } catch (x) { toast(`The spend is saved, but the receipt was not: ${errText(x)} Add it from the list.`); } }
      onDone();
    } catch (x) { setMsg(errText(x)); } finally { setBusy(false); }
  }
  const projs = (projects?.items ?? []).filter((p) => p.status === 'active' && (!f.areaId || p.areaId === f.areaId));
  return (
    <Modal title="Enter a spend" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>{busy ? 'Saving…' : 'Send for sign-off'}</button></>}>
      <div className="stack">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => file.current?.click()}>{photo ? 'Change the receipt photo' : 'Take the receipt photo'}</button>
          <input ref={file} type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          <span className="hint">{reading ? 'Reading the receipt…' : photo ? 'Receipt ready.' : status?.ocr ? 'The details are read from the photo for you to check.' : 'Type the details in. Reading receipts needs the AI connection (Settings › Connections).'}</span>
        </div>
        <div className="grid g2">
          <Field label="Amount (₹)" required><input className="inp" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="250" /></Field>
          <Field label="Day"><DateInput value={f.date} onChange={(e) => set({ date: e.target.value })} max={todayISO()} /></Field>
          <Field label="Paid to"><input className="inp" maxLength={120} value={f.payee} onChange={(e) => set({ payee: e.target.value })} placeholder="Shop or person" /></Field>
          <Field label="For" required><input className="inp" maxLength={200} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Cement bags" /></Field>
          <Field label="Branch"><select className="inp" value={f.areaId} onChange={(e) => set({ areaId: e.target.value, projectId: '' })}><option value="">Not a branch</option>{(areas?.items ?? []).filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Project"><select className="inp" value={f.projectId} onChange={(e) => set({ projectId: e.target.value })}><option value="">No project</option>{projs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.uncertain} onChange={(e) => set({ uncertain: e.target.checked })} /> Not sure of something (the owner looks at it first)</label>
        {f.uncertain && <Field label="What is uncertain"><input className="inp" maxLength={300} value={f.uncertainNote} onChange={(e) => set({ uncertainNote: e.target.value })} /></Field>}
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

function Count({ holderId, expected, onClose, onDone }: { holderId: string | null; expected: number; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    const p = toPaise(amount);
    if (p === null || p < 0) return setMsg('Type the cash counted, in rupees.');
    try { await post('/api/cash/counts', { ...(holderId ? { holderId } : {}), countedPaise: p, note: note.trim() || undefined }); onDone(); } catch (e) { setMsg(errText(e)); }
  }
  return (
    <Modal title="Count the cash" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save the count</button></>}>
      <div className="stack">
        <p className="hint">Count the notes and coins in hand. It is kept beside what should be there ({inr(expected)}), so any difference shows.</p>
        <Field label="Cash counted (₹)" required><input className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Note"><input className="inp" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

function Hide({ e, onClose, onDone }: { e: Entry; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    if (reason.trim().length < 3) return setMsg('Say why it is hidden.');
    try { await post(`/api/cash/entries/${encodeURIComponent(e.id)}/hide`, { reason: reason.trim() }); onDone(); } catch (x) { setMsg(errText(x)); }
  }
  return (
    <Modal title="Hide this entry" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Hide</button></>}>
      <div className="stack">
        <p className="hint">A hidden entry stops counting but stays on file with your reason. Nothing is deleted.</p>
        <Field label="Why" required><input className="inp" maxLength={300} value={reason} onChange={(x) => setReason(x.target.value)} placeholder="Entered twice" /></Field>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}
