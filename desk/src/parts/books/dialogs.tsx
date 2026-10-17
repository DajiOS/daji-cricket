// Dialogs for adding and changing accounting records.
import { useState, useRef, useEffect } from 'react';
import { api, post, put, patch, del, sendFile, download, toPaise, todayISO, addDaysISO, inr, fmtDate } from '../../lib';
import { Field, useForm, useToast, Loading, Empty, Modal, DateInput } from '../../ui';
import { FormModal, CatSelect, type Account, type Category, Money, monthName } from './kit';

const bad = (m: string): never => { throw new Error(m); };

export function AddTxnDialog({ accounts, cats, onClose, done }: { accounts: Account[]; cats: Category[]; onClose: () => void; done: () => void }) {
  const f = useForm({ accountId: accounts[0]?.id ?? '', dir: 'out', date: todayISO(), amount: '', description: '', categoryId: '' });
  if (!accounts.length) return <FormModal title="Add a transaction" onClose={onClose} onSubmit={async () => {}} label="OK"><p className="muted">Add a bank or cash account first (Accounting, Setup, or the bank feed panel on Bank import).</p></FormModal>;
  return (
    <FormModal title="Add a transaction" lede="For cash spent at the ground or money the bank statement will not show." onClose={onClose} onSubmit={async () => {
      const p = toPaise(f.v.amount); if (!p || p <= 0) bad('Enter the amount in rupees, like 2500 or 2500.50.');
      await post('/api/accounting/transactions', { accountId: f.v.accountId, date: f.v.date, amountPaise: f.v.dir === 'out' ? -p! : p, description: f.v.description.trim(), categoryId: f.v.categoryId || undefined }); done();
    }}>
      <div className="form-grid">
        <Field label="Account"><select className="inp" {...f.bind('accountId')}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Type"><select className="inp" {...f.bind('dir')}><option value="out">Money out (spent)</option><option value="in">Money in (received)</option></select></Field>
        <Field label="Date"><DateInput className="inp" max={addDaysISO(todayISO(), 1)} {...f.bind('date')} /></Field>
        <Field label="Amount (₹)"><input className="inp" inputMode="decimal" placeholder="2500.00" {...f.bind('amount')} /></Field>
        <Field label="Description" full><input className="inp" placeholder="What was it for?" {...f.bind('description')} /></Field>
        <Field label="Category" full><CatSelect cats={cats} value={f.v.categoryId} onChange={(v) => f.setV((s) => ({ ...s, categoryId: v }))} blank="Decide later" /></Field>
      </div>
    </FormModal>
  );
}

export function TransferDialog({ accounts, onClose, done }: { accounts: Account[]; onClose: () => void; done: () => void }) {
  const f = useForm({ from: accounts[0]?.id ?? '', to: accounts[1]?.id ?? '', date: todayISO(), amount: '', note: '' });
  if (accounts.length < 2) return <FormModal title="Move money" onClose={onClose} onSubmit={async () => {}} label="OK"><p className="muted">You need at least two accounts (for example the bank and the cash box).</p></FormModal>;
  return (
    <FormModal title="Move money between accounts" lede="Cash taken to the bank, or bank to petty cash. It does not count as income or expense." label="Move" onClose={onClose} onSubmit={async () => {
      const p = toPaise(f.v.amount); if (!p || p <= 0) bad('Enter the amount in rupees.');
      await post('/api/accounting/transfers', { fromAccountId: f.v.from, toAccountId: f.v.to, date: f.v.date, amountPaise: p, note: f.v.note.trim() || undefined }); done();
    }}>
      <div className="form-grid">
        <Field label="From"><select className="inp" {...f.bind('from')}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="To"><select className="inp" {...f.bind('to')}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Date"><DateInput className="inp" max={todayISO()} {...f.bind('date')} /></Field>
        <Field label="Amount (₹)"><input className="inp" inputMode="decimal" placeholder="5000" {...f.bind('amount')} /></Field>
        <Field label="Note" full><input className="inp" placeholder="Optional" {...f.bind('note')} /></Field>
      </div>
    </FormModal>
  );
}

export function AccountDialog({ onClose, done }: { onClose: () => void; done: () => void }) {
  const f = useForm({ kind: 'bank', name: '', bankName: '', last4: '', opening: '', openingDate: '' });
  return (
    <FormModal title="Add an account" label="Add account" onClose={onClose} onSubmit={async () => {
      const op = f.v.opening.trim() ? toPaise(f.v.opening) : 0; if (op === null) bad('Enter the opening balance in rupees.');
      await post('/api/accounting/accounts', { kind: f.v.kind === 'cash' ? 'cash' : 'bank', holds: f.v.kind === 'card' || f.v.kind === 'loan' ? f.v.kind : undefined, name: f.v.name.trim(), bankName: f.v.bankName.trim() || undefined, last4: f.v.last4.trim() || undefined, openingPaise: op, openingDate: f.v.openingDate || undefined }); done();
    }}>
      <div className="form-grid">
        <Field label="Kind"><select className="inp" {...f.bind('kind')}><option value="bank">Bank account</option><option value="card">Credit card</option><option value="loan">Loan</option><option value="cash">Cash in hand</option></select></Field>
        <Field label="Name"><input className="inp" placeholder="HDFC current account" {...f.bind('name')} /></Field>
        <Field label="Bank (optional)"><input className="inp" placeholder="HDFC Bank" {...f.bind('bankName')} /></Field>
        <Field label="Last 4 digits (optional)"><input className="inp" maxLength={4} placeholder="1234" {...f.bind('last4')} /></Field>
        <Field label="Opening balance (₹)" hint={f.v.kind === 'card' || f.v.kind === 'loan' ? 'Enter what is owed as a minus number, for example -25000.' : 'What was in the account on the date below.'}><input className="inp" inputMode="decimal" placeholder="0" {...f.bind('opening')} /></Field>
        <Field label="Opening balance date"><DateInput className="inp" {...f.bind('openingDate')} /></Field>
      </div>
    </FormModal>
  );
}

/** Change a transaction: its category and a note. Hand-typed entries can also be removed. */
export function EditTxnDialog({ t, cats, onClose, done }: { t: any; cats: Category[]; onClose: () => void; done: () => void }) {
  const f = useForm({ categoryId: t.categoryId || '', note: t.note || '' });
  const toast = useToast();
  return (
    <FormModal title="Edit transaction" lede={<>{fmtDate(t.date)} · {t.description} · <Money p={t.amountPaise} /></>} onClose={onClose} onSubmit={async () => {
      await patch('/api/accounting/transactions/' + t.id, { categoryId: f.v.categoryId || null, note: f.v.note.trim() || null }); toast('Saved'); done();
    }} extraFoot={t.source === 'manual' ? <button type="button" className="btn danger" style={{ marginRight: 'auto' }} onClick={async () => { try { await del('/api/accounting/transactions/' + t.id); toast('Removed'); done(); onClose(); } catch (e: any) { toast(e.message); } }}>Remove</button> : undefined}>
      <div className="form-grid">
        <Field label="Category" full><CatSelect cats={cats} value={f.v.categoryId} onChange={(v) => f.setV((s) => ({ ...s, categoryId: v }))} blank="No category yet" /></Field>
        <Field label="Note" full><input className="inp" maxLength={300} placeholder="Optional note for you or your accountant" {...f.bind('note')} /></Field>
      </div>
    </FormModal>
  );
}

/** The receipts and documents attached to one transaction or journal entry. */
export function FilesDialog({ entity, id, title, onClose, done }: { entity: string; id: string; title: string; onClose: () => void; done?: () => void }) {
  const [items, setItems] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null); const toast = useToast();
  const refresh = () => api(`/api/accounting/attachments?entity=${entity}&id=${encodeURIComponent(id)}`).then((r) => setItems(r.items)).catch((e) => setErr(e.message));
  useEffect(() => { refresh(); }, []);
  const upload = async (file?: File) => {
    if (!file) return; setErr(null);
    if (file.size > 5 * 1024 * 1024) return setErr('Files can be at most 5 MB.');
    try { await sendFile(`/api/accounting/attachments?entity=${entity}&id=${encodeURIComponent(id)}&filename=${encodeURIComponent(file.name)}`, file); if (pick.current) pick.current.value = ''; toast('File attached'); refresh(); done?.(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title="Receipts and documents" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Close</button><button className="btn primary" onClick={() => pick.current?.click()}>Attach a PDF or photo</button></>}>
      <p className="muted small" style={{ marginTop: 0 }}>{title}</p>
      {items === null ? <Loading h={80} /> : !items.length ? <Empty>No files yet.</Empty> : (
        <div className="bk-list">{items.map((a) => (
          <div key={a.id} className="bk-li"><span>{a.filename} <span className="muted small">{(a.sizeBytes / 1024).toFixed(0)} KB</span></span>
            <span className="row" style={{ gap: 4 }}>
              <button className="btn sm ghost" onClick={() => download(`/api/accounting/attachments/${a.id}/file`, a.filename).catch((e) => toast(e.message))}>Download</button>
              <button className="btn sm ghost" onClick={async () => { try { await del('/api/accounting/attachments/' + a.id); refresh(); done?.(); } catch (e: any) { toast(e.message); } }}>Remove</button>
            </span></div>))}</div>)}
      <input ref={pick} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0])} />
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      <div className="hint">PDF, PNG, JPEG or WebP, up to 5 MB each, ten per entry.</div>
    </Modal>
  );
}

export function RuleDialog({ cats, onClose, done }: { cats: Category[]; onClose: () => void; done: () => void }) {
  const f = useForm({ matchType: 'contains', pattern: '', direction: 'any', categoryId: '' });
  return (
    <FormModal title="Add a rule" label="Add rule" onClose={onClose} onSubmit={async () => {
      if (!f.v.categoryId) bad('Choose a category.');
      await post('/api/accounting/rules', { field: 'description', matchType: f.v.matchType, pattern: f.v.pattern.trim(), direction: f.v.direction, categoryId: f.v.categoryId }); done();
    }}>
      <div className="form-grid">
        <Field label="When the bank text"><select className="inp" {...f.bind('matchType')}><option value="contains">contains</option><option value="starts_with">starts with</option><option value="equals">is exactly</option></select></Field>
        <Field label="The words"><input className="inp" placeholder="ELECTRICITY" {...f.bind('pattern')} /></Field>
        <Field label="Applies to"><select className="inp" {...f.bind('direction')}><option value="any">Money in or out</option><option value="in">Money in only</option><option value="out">Money out only</option></select></Field>
        <Field label="Give it the category"><CatSelect cats={cats} value={f.v.categoryId} onChange={(v) => f.setV((s) => ({ ...s, categoryId: v }))} blank="Choose a category" /></Field>
      </div>
    </FormModal>
  );
}

export function RecDialog({ accounts, cats, onClose, done }: { accounts: Account[]; cats: Category[]; onClose: () => void; done: () => void }) {
  const f = useForm({ accountId: accounts[0]?.id ?? '', dir: 'out', description: '', amount: '', frequency: 'monthly', startDate: todayISO(), endDate: '', categoryId: '' });
  if (!accounts.length) return <FormModal title="Add a recurring entry" onClose={onClose} onSubmit={async () => {}} label="OK"><p className="muted">Add a bank or cash account first.</p></FormModal>;
  return (
    <FormModal title="Add a recurring entry" onClose={onClose} onSubmit={async () => {
      const p = toPaise(f.v.amount); if (!p || p <= 0) bad('Enter the amount in rupees.');
      await post('/api/accounting/recurring', { accountId: f.v.accountId, description: f.v.description.trim(), amountPaise: f.v.dir === 'out' ? -p! : p, frequency: f.v.frequency, startDate: f.v.startDate, endDate: f.v.endDate || undefined, categoryId: f.v.categoryId || undefined }); done();
    }}>
      <div className="form-grid">
        <Field label="Account"><select className="inp" {...f.bind('accountId')}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Type"><select className="inp" {...f.bind('dir')}><option value="out">Money out (an expense)</option><option value="in">Money in (income)</option></select></Field>
        <Field label="What is it?"><input className="inp" placeholder="Ground rent" {...f.bind('description')} /></Field>
        <Field label="Amount (₹)"><input className="inp" inputMode="decimal" placeholder="25000" {...f.bind('amount')} /></Field>
        <Field label="How often"><select className="inp" {...f.bind('frequency')}><option value="monthly">Every month</option><option value="weekly">Every week</option><option value="quarterly">Every 3 months</option><option value="yearly">Every year</option></select></Field>
        <Field label="First date" hint="Dates in the past are posted straight away."><DateInput className="inp" {...f.bind('startDate')} /></Field>
        <Field label="Last date (optional)"><DateInput className="inp" {...f.bind('endDate')} /></Field>
        <Field label="Category"><CatSelect cats={cats} value={f.v.categoryId} onChange={(v) => f.setV((s) => ({ ...s, categoryId: v }))} blank="Decide later" /></Field>
      </div>
    </FormModal>
  );
}

export function JournalDialog({ onClose, done }: { onClose: () => void; done: () => void }) {
  const [accts, setAccts] = useState<any[]>([]);
  useEffect(() => { api('/api/accounting/journal-accounts').then((r) => setAccts(r.items)).catch(() => {}); }, []);
  const [v, setV] = useState({ date: todayISO(), memo: '' });
  const [lines, setLines] = useState([{ ac: '', dr: '', cr: '' }, { ac: '', dr: '', cr: '' }]);
  const set = (i: number, k: 'ac' | 'dr' | 'cr', val: string) => setLines((l) => l.map((x, j) => (j === i ? { ...x, [k]: val } : x)));
  const d = lines.reduce((a, r) => a + (toPaise(r.dr || '0') || 0), 0), c = lines.reduce((a, r) => a + (toPaise(r.cr || '0') || 0), 0);
  return (
    <FormModal title="New journal entry" wide label="Save entry" onClose={onClose} onSubmit={async () => {
      const ls = lines.filter((r) => r.ac).map((r) => ({ account: r.ac, debitPaise: toPaise(r.dr || '0') || 0, creditPaise: toPaise(r.cr || '0') || 0 }));
      await post('/api/accounting/journals', { date: v.date, memo: v.memo.trim(), lines: ls }); done();
    }}>
      <div className="form-grid">
        <Field label="Date"><DateInput className="inp" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="Memo"><input className="inp" placeholder="What is this adjustment?" value={v.memo} onChange={(e) => setV({ ...v, memo: e.target.value })} /></Field>
      </div>
      <div className="bk-jl-head"><span>Account</span><span>Debit ₹</span><span>Credit ₹</span></div>
      {lines.map((r, i) => (
        <div className="bk-jl" key={i}>
          <select className="inp" value={r.ac} aria-label="Account" onChange={(e) => set(i, 'ac', e.target.value)}><option value="">Choose an account</option>{accts.map((a) => <option key={a.code} value={a.code}>{a.group}: {a.name}</option>)}</select>
          <input className="inp" inputMode="decimal" placeholder="Debit ₹" aria-label="Debit" value={r.dr} onChange={(e) => set(i, 'dr', e.target.value)} />
          <input className="inp" inputMode="decimal" placeholder="Credit ₹" aria-label="Credit" value={r.cr} onChange={(e) => set(i, 'cr', e.target.value)} />
        </div>))}
      <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
        <button type="button" className="btn sm ghost" onClick={() => setLines([...lines, { ac: '', dr: '', cr: '' }])}>Add a line</button>
        <span className={d === c && d > 0 ? 'small' : 'muted small'} style={d === c && d > 0 ? { color: 'var(--good)' } : undefined}>Debits {inr(d)}, credits {inr(c)}{d === c && d > 0 ? '. Balanced.' : '. Not balanced yet.'}</span>
      </div>
    </FormModal>
  );
}

export function ReasonDialog({ title, lede, label, path, body, onClose, done }: { title: string; lede?: string; label: string; path: string; body: (reason: string) => unknown; onClose: () => void; done: () => void }) {
  const f = useForm({ reason: '' });
  return <FormModal title={title} lede={lede} label={label} onClose={onClose} onSubmit={async () => { await post(path, body(f.v.reason.trim())); done(); }}><Field label="Reason"><input className="inp" autoFocus {...f.bind('reason')} /></Field></FormModal>;
}

export function BudgetDialog({ onClose, done }: { onClose: () => void; done: () => void }) {
  const [d, setD] = useState<any>(null); const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => { api('/api/accounting/budgets').then((r) => { setD(r); setVals(Object.fromEntries(r.items.map((i: any) => [i.code, String(i.monthlyPaise / 100)]))); }); }, []);
  return (
    <FormModal title="Monthly budgets" lede="The amount you expect each month, in rupees. Leave blank for no budget." label="Save budgets" onClose={onClose} onSubmit={async () => {
      const cur = new Map<string, number>(d.items.map((i: any) => [i.code, i.monthlyPaise])); const items: any[] = [];
      for (const a of d.available) { const t = (vals[a.code] || '').trim(); if (!t && !cur.has(a.code)) continue; const p = t ? toPaise(t) : 0; if (p === null || p < 0) bad(`Check the amount for ${a.name}.`); if (p !== (cur.get(a.code) || 0)) items.push({ code: a.code, monthlyPaise: p }); }
      if (items.length) await put('/api/accounting/budgets', { items }); done();
    }}>
      {!d ? <Loading h={80} /> : <div className="form-grid" style={{ maxHeight: '52vh', overflow: 'auto' }}>{d.available.map((a: any) => (
        <Field key={a.code} label={`${a.type === 'income' ? 'Income' : 'Expense'}: ${a.name}`}><input className="inp" inputMode="decimal" placeholder="0" value={vals[a.code] ?? ''} onChange={(e) => setVals({ ...vals, [a.code]: e.target.value })} /></Field>))}</div>}
    </FormModal>
  );
}

export function AssetDialog({ onClose, done }: { onClose: () => void; done: () => void }) {
  const f = useForm({ name: '', cost: '', salvage: '', date: todayISO(), life: '60' });
  return (
    <FormModal title="Add an asset" onClose={onClose} onSubmit={async () => {
      const c = toPaise(f.v.cost), s = f.v.salvage.trim() ? toPaise(f.v.salvage) : 0; if (!c || c <= 0 || s === null) bad('Enter the cost in rupees.');
      await post('/api/accounting/assets', { name: f.v.name.trim(), costPaise: c, salvagePaise: s, purchaseDate: f.v.date, lifeMonths: Number(f.v.life) }); done();
    }}>
      <div className="form-grid">
        <Field label="Name" full><input className="inp" placeholder="Bowling machine" {...f.bind('name')} /></Field>
        <Field label="Cost (₹)"><input className="inp" inputMode="decimal" placeholder="120000" {...f.bind('cost')} /></Field>
        <Field label="Value left at the end (₹)"><input className="inp" inputMode="decimal" placeholder="0" {...f.bind('salvage')} /></Field>
        <Field label="Bought on"><DateInput className="inp" max={todayISO()} {...f.bind('date')} /></Field>
        <Field label="Useful life (months)" hint="60 months is five years."><input className="inp" inputMode="numeric" {...f.bind('life')} /></Field>
      </div>
    </FormModal>
  );
}

export function DisposeDialog({ a, onClose, done }: { a: any; onClose: () => void; done: () => void }) {
  const f = useForm({ on: todayISO() });
  return <FormModal title="Sold or scrapped" lede={`${a.name}: depreciation stops after this date.`} onClose={onClose} onSubmit={async () => { await post(`/api/accounting/assets/${a.id}/dispose`, { disposedOn: f.v.on }); done(); }}><Field label="Date"><DateInput className="inp" max={todayISO()} {...f.bind('on')} /></Field></FormModal>;
}
export { monthName };
