import { useState } from 'react';
import { PageHead, Stat, Table, Chip, Field, Modal, Loading, ErrorBox, useToast } from '../ui';
import { useApi, post, inr, fmtDate } from '../lib';
import { errText } from '../parts/admin/common';

interface Promo { id: string; code: string; label: string | null; kind: 'percent' | 'flat'; value: number; maxDiscountPaise: number | null; minTotalPaise: number | null; validFrom: string | null; validTo: string | null; usageLimit: number | null; used: number; active: boolean }

function rule(p: Promo) {
  const what = p.kind === 'percent' ? `${p.value}% off${p.maxDiscountPaise ? `, up to ${inr(p.maxDiscountPaise)}` : ''}` : `${inr(p.value)} off`;
  return [what, p.minTotalPaise ? `min ${inr(p.minTotalPaise)}` : '', p.validFrom || p.validTo ? [p.validFrom && 'from ' + fmtDate(p.validFrom), p.validTo && 'to ' + fmtDate(p.validTo)].filter(Boolean).join(' ') : ''].filter(Boolean).join(' · ');
}

function NewCodes({ onClose, onDone }: { onClose: () => void; onDone: (codes: string[]) => void }) {
  const [f, setF] = useState({ mode: 'auto', code: '', prefix: '', count: '1', one: true, kind: 'percent', value: '10', cap: '', min: '', from: '', to: '', limit: '', label: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const auto = f.mode === 'auto';
  async function create() {
    setErr(null); setBusy(true);
    const body: Record<string, unknown> = { kind: f.kind, value: f.kind === 'flat' ? Math.round(Number(f.value) * 100) : Number(f.value), label: f.label.trim() || undefined };
    if (f.kind === 'percent' && f.cap) body.maxDiscountPaise = Math.round(Number(f.cap) * 100);
    if (f.min) body.minTotalPaise = Math.round(Number(f.min) * 100);
    if (f.from) body.validFrom = f.from;
    if (f.to) body.validTo = f.to;
    if (auto) Object.assign(body, { auto: true, count: Number(f.count) || 1, prefix: f.prefix.trim() || undefined, oneTime: f.one });
    else { body.code = f.code.trim(); if (f.limit) body.usageLimit = Number(f.limit); }
    try { const r = await post<{ items: Promo[] }>('/api/staff/promos', body); onDone(r.items.map((p) => p.code)); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  }
  return (
    <Modal title="New promo codes" onClose={onClose} wide foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create'}</button></>}>
      <div className="form-grid">
        <Field label="Code" full><select className="inp" value={f.mode} onChange={set('mode')}><option value="auto">Generate codes for me</option><option value="manual">I will type the code</option></select></Field>
        {auto ? <>
          <Field label="How many codes"><input className="inp" type="number" min={1} max={50} value={f.count} onChange={set('count')} /></Field>
          <Field label="Code starts with"><input className="inp" maxLength={10} placeholder="Optional, for example VIP" value={f.prefix} onChange={set('prefix')} /></Field>
          <label className="check full"><input type="checkbox" checked={f.one} onChange={set('one')} /><span>One-time codes (each works once)</span></label>
        </> : <>
          <Field label="Code"><input className="inp" maxLength={20} placeholder="For example DIWALI10" value={f.code} onChange={set('code')} style={{ textTransform: 'uppercase' }} /></Field>
          <Field label="Times it can be used in total"><input className="inp" type="number" min={1} placeholder="Unlimited" value={f.limit} onChange={set('limit')} /></Field>
        </>}
        <Field label="Discount type"><select className="inp" value={f.kind} onChange={set('kind')}><option value="percent">Percentage off</option><option value="flat">Rupees off</option></select></Field>
        <Field label={f.kind === 'percent' ? 'Percent off' : 'Rupees off'}><input className="inp" type="number" min={1} value={f.value} onChange={set('value')} /></Field>
        {f.kind === 'percent' && <Field label="Largest discount in rupees"><input className="inp" type="number" min={0} placeholder="No cap" value={f.cap} onChange={set('cap')} /></Field>}
        <Field label="Smallest booking in rupees"><input className="inp" type="number" min={0} placeholder="No minimum" value={f.min} onChange={set('min')} /></Field>
        <Field label="Valid from"><input className="inp" type="date" value={f.from} onChange={set('from')} /></Field>
        <Field label="Valid until"><input className="inp" type="date" value={f.to} onChange={set('to')} /></Field>
        <Field label="Note" full><input className="inp" maxLength={80} placeholder="For yourself, for example Diwali weekend" value={f.label} onChange={set('label')} /></Field>
      </div>
      <div style={{ marginTop: 12 }}><ErrorBox msg={err} /></div>
    </Modal>
  );
}

export default function Promos({ sub }: { sub: string }) {
  void sub;
  const toast = useToast();
  const [data, error, reload] = useApi<{ items: Promo[] }>('/api/staff/promos');
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<string[] | null>(null);
  async function toggle(p: Promo) {
    try { await post(`/api/staff/promos/${encodeURIComponent(p.id)}/active`, { active: !p.active }); reload(); } catch (e) { toast(errText(e)); }
  }
  const items = data?.items || [];
  return (
    <div className="stack">
      <PageHead eyebrow="Ground" title="Promo codes" lede="Discounts your customers can enter when they book.">
        <button className="btn primary" onClick={() => setOpen(true)}>New codes</button>
      </PageHead>
      {fresh && (
        <div className="card card-pad">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{fresh.length === 1 ? 'Code ready' : `${fresh.length} codes ready`}</b>
            <button className="btn sm ghost" onClick={() => { navigator.clipboard?.writeText(fresh.join('\n')).then(() => toast('Copied'), () => {}); }}>Copy</button>
          </div>
          <div className="hint">Share these with your customers.</div>
          <pre className="codes">{fresh.join('\n')}</pre>
        </div>
      )}
      {error && <ErrorBox msg={error} />}
      {!data && !error && <Loading />}
      {data && <>
        <div className="grid g3">
          <Stat label="Codes" value={items.length} />
          <Stat label="Active" value={items.filter((p) => p.active).length} />
          <Stat label="Times used" value={items.reduce((a, p) => a + p.used, 0)} />
        </div>
        <div className="card">
          <Table rows={items} empty="No promo codes yet. Press New codes to build one." cols={[
            { head: 'Code', cell: (p) => <><b style={{ letterSpacing: '.06em' }}>{p.code}</b>{p.label && <div className="small muted">{p.label}</div>}</> },
            { head: 'Discount', cell: (p) => <span className="small">{rule(p)}</span> },
            { head: 'Used', cell: (p) => (p.usageLimit ? `${p.used} of ${p.usageLimit}` : p.used), num: true },
            { head: 'Status', cell: (p) => <Chip tone={p.active ? 'good' : 'mute'}>{p.active ? 'Active' : 'Off'}</Chip> },
            { head: '', cell: (p) => <button className="btn sm ghost" onClick={() => toggle(p)}>{p.active ? 'Switch off' : 'Switch on'}</button>, num: true },
          ]} />
        </div>
      </>}
      {open && <NewCodes onClose={() => setOpen(false)} onDone={(codes) => { setOpen(false); setFresh(codes); reload(); }} />}
    </div>
  );
}
