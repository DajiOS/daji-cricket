// A booking taken at the desk (walk-in or phone): pick the ground, day and session, add the customer and the money received.
import { useEffect, useMemo, useState } from 'react';
import { Modal, Field, ErrorBox, Loading, NameField, splitName, DateInput } from '../../ui';
import { api, post, useApi, inr, toPaise, todayISO } from '../../lib';
import { HAND_METHODS, errText, useCustomerMatch, MatchNote } from './common';

interface Ground { id: string; name: string; maxSlots: number; active: boolean }
interface SlotView { start: number; time: string; pricePaise: number; state: string }
interface RateOption { ruleId: string; label: string; ball: string; mode: 'hourly' | 'fixed'; time: string; endTime: string; pricePaise: number; state: string; slots?: SlotView[]; bundleDays: number; proRated?: boolean }
interface Avail { slots: SlotView[]; closed?: boolean; rates?: RateOption[]; formats: { formatId: string; windows: { time: string; endTime: string; pricePaise: number; state: string }[] }[] }
interface Choice { key: string; label: string; sub: string; price: number; body: Record<string, unknown> }

const hour12 = (t: string) => { const [a, b] = t.split(':').map(Number); const x = a! % 24; return `${x % 12 || 12}${b ? ':' + String(b).padStart(2, '0') : ''} ${x < 12 ? 'am' : 'pm'}`; };

export function NewBooking({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [gl] = useApi<{ items: Ground[] }>('/api/staff/grounds');
  const grounds = (gl?.items || []).filter((g) => g.active);
  const [groundId, setGroundId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [av, setAv] = useState<Avail | null>(null);
  const [avErr, setAvErr] = useState<string | null>(null);
  const [fixed, setFixed] = useState<string | null>(null);              // key of a chosen fixed session
  const [hr, setHr] = useState<{ group: string; start: number; n: number } | null>(null); // hourly: group, first slot index, hours
  const [cust, setCust] = useState({ name: '', phone: '', email: '' });
  const match = useCustomerMatch(cust, setCust);
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  const [reference, setReference] = useState('');
  const [players, setPlayers] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!groundId && grounds.length) setGroundId(grounds[0]!.id); }, [grounds.length]); // eslint-disable-line
  const ground = grounds.find((g) => g.id === groundId);
  useEffect(() => {
    if (!groundId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let live = true; setAv(null); setAvErr(null); setFixed(null); setHr(null);
    api<Avail>(`/api/grounds/${encodeURIComponent(groundId)}/availability?date=${date}`).then((a) => live && setAv(a)).catch((e) => live && setAvErr(e.message));
    return () => { live = false; };
  }, [groundId, date]);

  // what can be picked: fixed sessions (one tap) and hourly runs (start and hours)
  const { fixedChoices, hourly } = useMemo(() => {
    const fc: Choice[] = []; const hg: { key: string; label: string; slots: SlotView[]; rule: string | null }[] = [];
    if (!av) return { fixedChoices: fc, hourly: hg };
    if (av.rates?.length) {
      for (const o of av.rates) {
        if (o.mode === 'fixed') { if (o.state === 'available') fc.push({ key: o.ruleId, label: o.label, sub: `${hour12(o.time)} – ${hour12(o.endTime)} · ${o.ball}${o.bundleDays > 1 ? ` · ${o.bundleDays} days` : ''}`, price: o.pricePaise, body: { ruleId: o.ruleId, startTime: o.time } }); }
        else hg.push({ key: o.ruleId, label: `${o.label} · ${inr(o.pricePaise)} an hour`, slots: o.slots || [], rule: o.ruleId });
      }
    } else if (av.formats?.some((f) => f.windows.length)) {
      const g = (gl?.items || []).find((x) => x.id === groundId) as any;
      for (const f of av.formats) for (const w of f.windows) if (w.state === 'available') fc.push({ key: f.formatId + w.time, label: g?.formats?.find((x: any) => x.id === f.formatId)?.label || f.formatId, sub: `${hour12(w.time)} – ${hour12(w.endTime)}`, price: w.pricePaise, body: { formatId: f.formatId, startTime: w.time } });
    } else hg.push({ key: 'slots', label: 'Hours', slots: av.slots, rule: null });
    return { fixedChoices: fc, hourly: hg };
  }, [av, groundId, gl]);

  // the price of what is picked
  const picked = useMemo(() => {
    const f = fixedChoices.find((c) => c.key === fixed);
    if (f) return { body: f.body, total: f.price, label: f.label };
    if (hr) {
      const g = hourly.find((x) => x.key === hr.group); if (!g) return null;
      const run = g.slots.slice(hr.start, hr.start + hr.n);
      if (!run.length || run.some((s) => s.state !== 'available')) return null;
      return { body: { ...(g.rule ? { ruleId: g.rule } : {}), startTime: run[0]!.time, slots: run.length }, total: run.reduce((a, s) => a + s.pricePaise, 0), label: `${hour12(run[0]!.time)}, ${run.length} ${run.length === 1 ? 'hour' : 'hours'}` };
    }
    return null;
  }, [fixed, hr, fixedChoices, hourly]);
  useEffect(() => { if (!touched) setAmount(picked ? String(picked.total / 100) : ''); }, [picked, touched]);

  const maxHours = (g: { slots: SlotView[] }, start: number) => { let n = 0; while (start + n < g.slots.length && g.slots[start + n]!.state === 'available' && n < (ground?.maxSlots || 6)) n++; return n; };
  const submit = async () => {
    if (!picked) return setErr('Choose a session or the hours first.');
    const paise = toPaise(amount);
    if (paise === null || paise < 0) return setErr('Enter the amount received now, in rupees. Type 0 if nothing has been received yet.');
    if (paise > picked.total) return setErr(`That is more than the booking total of ${inr(picked.total)}.`);
    setBusy(true); setErr(null);
    try {
      const r = await post<{ booking: { id: string } }>('/api/staff/bookings', {
        groundId, date, ...picked.body, customer: { firstName: splitName(cust.name).first, lastName: splitName(cust.name).last, phone: cust.phone.trim(), ...(cust.email.trim() ? { email: cust.email.trim() } : {}) },
        payment: { method, amountPaise: paise, ...(reference.trim() ? { reference: reference.trim() } : {}) },
        ...(players ? { players: Number(players) } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onDone(r.booking.id);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };

  return (
    <Modal title="New booking" onClose={onClose} wide
      foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !picked} onClick={submit}>Create booking</button></>}>
      {!gl ? <Loading h={160} /> : (
        <div className="stack" style={{ gap: 18 }}>
          <div className="form-grid">
            <Field label="Ground"><select className="inp" value={groundId} onChange={(e) => setGroundId(e.target.value)}>{grounds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
            <Field label="Date"><DateInput className="inp" value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>

          <div>
            <div className="eyebrow">Session</div>
            {avErr ? <ErrorBox msg={avErr} /> : !av ? <Loading h={60} /> : av.closed ? <div className="muted">The ground is closed on this day.</div> : (
              <div className="stack" style={{ gap: 12 }}>
                {fixedChoices.length > 0 && <div className="picks">{fixedChoices.map((c) => (
                  <button key={c.key} type="button" className={`pick${fixed === c.key ? ' on' : ''}`} aria-pressed={fixed === c.key} onClick={() => { setFixed(c.key); setHr(null); }}>
                    <b>{c.label}</b><span>{c.sub}</span><em>{inr(c.price)}</em>
                  </button>))}</div>}
                {hourly.map((g) => {
                  const open = hr?.group === g.key;
                  return (
                    <div key={g.key}>
                      <div className="small muted" style={{ marginBottom: 6 }}>{g.label}</div>
                      {g.slots.length === 0 ? <div className="muted small">Nothing to book on this day.</div> : (
                        <div className="hours">{g.slots.map((s, i) => {
                          const inRun = open && i >= hr!.start && i < hr!.start + hr!.n;
                          return <button key={s.start} type="button" disabled={s.state !== 'available'} className={`hr${inRun ? ' on' : ''}`} aria-pressed={inRun}
                            onClick={() => { setFixed(null); setHr({ group: g.key, start: i, n: 1 }); }}>{hour12(s.time)}<small>{s.state === 'available' ? inr(s.pricePaise) : s.state === 'blocked' ? 'Closed' : s.state === 'past' ? 'Past' : s.state === 'held' ? 'Held' : 'Booked'}</small></button>;
                        })}</div>)}
                      {open && <div className="row" style={{ marginTop: 10 }}><span className="small muted">Hours in a row</span>
                        <select className="inp" style={{ width: 90 }} value={hr!.n} onChange={(e) => setHr({ ...hr!, n: Number(e.target.value) })}>
                          {Array.from({ length: maxHours(g, hr!.start) }, (_, k) => <option key={k} value={k + 1}>{k + 1}</option>)}</select></div>}
                    </div>);
                })}
                {!fixedChoices.length && !hourly.some((g) => g.slots.length) && <div className="muted">Nothing is on sale on this day.</div>}
              </div>)}
            {picked && <div className="picked">{picked.label} · total <b className="gold">{inr(picked.total)}</b></div>}
          </div>

          <div>
            <div className="eyebrow">Customer</div>
            <div className="form-grid">
              <NameField value={cust.name} onChange={(n) => setCust((c) => ({ ...c, name: n }))} />
              <Field label="Mobile" hint="An existing customer is found by this number."><input className="inp" inputMode="tel" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} /></Field>
              <Field label="Email (optional)"><input className="inp" type="email" value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} /></Field>
              <MatchNote m={match} />
              <Field label="Players (optional)"><input className="inp" inputMode="numeric" value={players} onChange={(e) => setPlayers(e.target.value.replace(/\D/g, ''))} /></Field>
              <Field label="Note (optional)" full><input className="inp" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>
          </div>

          <div>
            <div className="eyebrow">Money received now</div>
            <div className="form-grid">
              <Field label="Method"><select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>{HAND_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Amount (₹)" hint="Type 0 if nothing is received yet, or at least the advance. The rest is collected later."><input className="inp" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setTouched(true); }} /></Field>
              <Field label={method === 'upi' ? 'UPI reference (UTR)' : 'Reference (optional)'}><input className="inp" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            </div>
          </div>
          <ErrorBox msg={err} />
        </div>)}
    </Modal>
  );
}
